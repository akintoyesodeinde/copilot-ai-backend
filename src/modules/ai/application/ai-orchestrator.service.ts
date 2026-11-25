import { getEnv } from '@/config/env';
import { getPrisma } from '@/shared/database/prisma';
import { AppError, ForbiddenError } from '@/shared/http/problem-details';
import { sha256Hex } from '@/shared/security/tokens';
import { aiCircuitBreaker } from '@/modules/ai/domain/circuit-breaker';
import {
  ensureActivePromptVersion,
  PR_REVIEW_PROMPT_V1,
} from '@/modules/ai/domain/prompt-registry';
import {
  detectPromptInjectionSignals,
  redactSensitiveContent,
  structuredPrReviewOutputSchema,
  type AiProviderName,
  type StructuredPrReviewOutput,
} from '@/modules/ai/domain/types';
import { resolveAiProviderAdapter } from '@/modules/ai/infrastructure/providers';

export interface InvokeStructuredReviewInput {
  workspaceId: string;
  repositoryId: string;
  analysisJobId?: string;
  requestedProvider?: AiProviderName;
  userPrompt: string;
  changedFiles: Array<{ filePath: string; patch: string | null }>;
}

export interface InvokeStructuredReviewResult {
  aiRequestId: string;
  provider: AiProviderName;
  model: string;
  output: StructuredPrReviewOutput;
  promptInjectionSignals: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function currentBillingPeriod(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function invokeStructuredPrReview(
  input: InvokeStructuredReviewInput,
): Promise<InvokeStructuredReviewResult> {
  const env = getEnv();
  const prisma = getPrisma();

  const [settings, usageLimit, promptVersion] = await Promise.all([
    prisma.workspaceSetting.findUnique({ where: { workspaceId: input.workspaceId } }),
    prisma.usageLimit.findUnique({ where: { workspaceId: input.workspaceId } }),
    ensureActivePromptVersion(PR_REVIEW_PROMPT_V1),
  ]);

  const allowedProviders = Array.isArray(settings?.allowedAiProvidersJson)
    ? (settings.allowedAiProvidersJson as string[])
    : ['mock'];

  const provider: AiProviderName =
    input.requestedProvider ??
    ((settings?.defaultAiProvider as AiProviderName | undefined) || env.AI_DEFAULT_PROVIDER);

  // Security invariant: never transmit private repository code to an unapproved provider
  if (!allowedProviders.includes(provider)) {
    throw new ForbiddenError(
      `AI provider '${provider}' is not in this workspace's authorized provider allowlist`,
      'AI_PROVIDER_NOT_ALLOWED',
    );
  }

  const adapter = resolveAiProviderAdapter(provider);
  const redactedPrompt = redactSensitiveContent(input.userPrompt);
  const injectionSignals = detectPromptInjectionSignals(redactedPrompt);
  const requestHash = sha256Hex(`${provider}:${adapter.defaultModel}:${redactedPrompt}`);

  // Enforce workspace monthly USD & token spending guardrails before calling provider
  const estimatedInputTokens = Math.ceil(redactedPrompt.length / 4);
  if (usageLimit) {
    const spend = Number(usageLimit.currentMonthSpendUsd);
    const budget = Number(usageLimit.monthlyAiBudgetUsd);
    if (
      spend >= budget ||
      usageLimit.currentMonthTokens + estimatedInputTokens > usageLimit.maxMonthlyTokens
    ) {
      await prisma.aiRequest.create({
        data: {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
          analysisJobId: input.analysisJobId ?? null,
          promptVersionId: promptVersion.id,
          provider,
          model: adapter.defaultModel,
          purpose: 'PR_REVIEW',
          status: 'BUDGET_EXCEEDED',
          requestHash,
          errorCode: 'AI_BUDGET_EXCEEDED',
          errorMessage: 'Workspace monthly AI spending or token limit exceeded',
        },
      });
      throw new AppError({
        status: 402,
        code: 'AI_BUDGET_EXCEEDED',
        title: 'AI Budget Limit Exceeded',
        detail: 'Workspace monthly AI spend or token quota has been exhausted.',
      });
    }
  }

  // Circuit breaker check
  if (!aiCircuitBreaker.checkAllow(provider)) {
    await prisma.aiRequest.create({
      data: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        analysisJobId: input.analysisJobId ?? null,
        promptVersionId: promptVersion.id,
        provider,
        model: adapter.defaultModel,
        purpose: 'PR_REVIEW',
        status: 'CIRCUIT_OPEN',
        requestHash,
        errorCode: 'AI_CIRCUIT_OPEN',
        errorMessage: `Circuit breaker is OPEN for AI provider '${provider}'`,
      },
    });
    throw new AppError({
      status: 503,
      code: 'AI_CIRCUIT_OPEN',
      title: 'AI Provider Temporarily Unavailable',
      detail: `Circuit breaker is open for provider '${provider}'.`,
    });
  }

  const aiReq = await prisma.aiRequest.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      analysisJobId: input.analysisJobId ?? null,
      promptVersionId: promptVersion.id,
      provider,
      model: adapter.defaultModel,
      purpose: 'PR_REVIEW',
      status: 'PENDING',
      requestHash,
    },
  });

  const startMs = Date.now();
  let lastError: unknown;
  let rawResponse: Awaited<ReturnType<typeof adapter.generateJson>> | null = null;

  // Controlled retry (up to 2 attempts for transient network errors)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      rawResponse = await adapter.generateJson({
        systemPrompt: promptVersion.systemPrompt,
        userPrompt: redactedPrompt,
        model: adapter.defaultModel,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        metadata: { changedFiles: input.changedFiles },
      });
      aiCircuitBreaker.recordSuccess(provider);
      break;
    } catch (error) {
      lastError = error;
      aiCircuitBreaker.recordFailure(provider);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
  }

  const latencyMs = Date.now() - startMs;

  if (!rawResponse) {
    const errMsg = lastError instanceof Error ? lastError.message : 'AI provider invocation failed';
    await prisma.aiRequest.update({
      where: { id: aiReq.id },
      data: {
        status: 'FAILED',
        latencyMs,
        errorCode: 'AI_PROVIDER_ERROR',
        errorMessage: errMsg.slice(0, 1000),
      },
    });
    throw new AppError({
      status: 502,
      code: 'AI_PROVIDER_ERROR',
      title: 'AI Provider Failed',
      detail: errMsg,
    });
  }

  // Request-level cost cap check
  if (rawResponse.estimatedCostUsd > env.AI_MAX_REQUEST_COST_USD) {
    await prisma.aiRequest.update({
      where: { id: aiReq.id },
      data: {
        status: 'BUDGET_EXCEEDED',
        latencyMs,
        estimatedCostUsd: rawResponse.estimatedCostUsd,
        errorCode: 'REQUEST_COST_LIMIT_EXCEEDED',
        errorMessage: `Request cost $${rawResponse.estimatedCostUsd} exceeds per-request cap $${env.AI_MAX_REQUEST_COST_USD}`,
      },
    });
    throw new AppError({
      status: 402,
      code: 'REQUEST_COST_LIMIT_EXCEEDED',
      title: 'Request Budget Exceeded',
      detail: 'Single AI request exceeded maximum permitted cost threshold.',
    });
  }

  // Strict structured JSON + Zod validation
  let parsedOutput: StructuredPrReviewOutput;
  try {
    const parsedJson = JSON.parse(rawResponse.rawJsonText) as unknown;
    parsedOutput = structuredPrReviewOutputSchema.parse(parsedJson);
  } catch (error) {
    await prisma.aiRequest.update({
      where: { id: aiReq.id },
      data: {
        status: 'REJECTED_SCHEMA',
        inputTokens: rawResponse.inputTokens,
        outputTokens: rawResponse.outputTokens,
        totalTokens: rawResponse.inputTokens + rawResponse.outputTokens,
        estimatedCostUsd: rawResponse.estimatedCostUsd,
        latencyMs,
        errorCode: 'INVALID_AI_STRUCTURED_OUTPUT',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 1000) : 'Invalid AI JSON output',
      },
    });
    throw new AppError({
      status: 422,
      code: 'INVALID_AI_STRUCTURED_OUTPUT',
      title: 'Invalid AI Output',
      detail: 'AI provider returned output that failed structured schema validation.',
    });
  }

  const totalTokens = rawResponse.inputTokens + rawResponse.outputTokens;
  const period = currentBillingPeriod();

  await prisma.$transaction(async (tx) => {
    await tx.aiRequest.update({
      where: { id: aiReq.id },
      data: {
        status: 'SUCCEEDED',
        model: rawResponse!.model,
        inputTokens: rawResponse!.inputTokens,
        outputTokens: rawResponse!.outputTokens,
        totalTokens,
        estimatedCostUsd: rawResponse!.estimatedCostUsd,
        latencyMs,
      },
    });

    await tx.aiUsageRecord.create({
      data: {
        workspaceId: input.workspaceId,
        aiRequestId: aiReq.id,
        provider,
        model: rawResponse!.model,
        purpose: 'PR_REVIEW',
        inputTokens: rawResponse!.inputTokens,
        outputTokens: rawResponse!.outputTokens,
        totalTokens,
        costUsd: rawResponse!.estimatedCostUsd,
        billingPeriod: period,
      },
    });

    if (usageLimit) {
      await tx.usageLimit.update({
        where: { workspaceId: input.workspaceId },
        data: {
          currentMonthTokens: { increment: totalTokens },
          currentMonthSpendUsd: { increment: rawResponse!.estimatedCostUsd },
        },
      });
    }
  });

  return {
    aiRequestId: aiReq.id,
    provider,
    model: rawResponse.model,
    output: parsedOutput,
    promptInjectionSignals: injectionSignals,
    inputTokens: rawResponse.inputTokens,
    outputTokens: rawResponse.outputTokens,
    costUsd: rawResponse.estimatedCostUsd,
  };
}

export async function getWorkspaceAiUsage(workspaceId: string, billingPeriod?: string) {
  const prisma = getPrisma();
  const period = billingPeriod || currentBillingPeriod();

  const [usageLimit, records, byProvider, recentRequests] = await Promise.all([
    prisma.usageLimit.findUnique({ where: { workspaceId } }),
    prisma.aiUsageRecord.aggregate({
      where: { workspaceId, billingPeriod: period },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        costUsd: true,
      },
      _count: { _all: true },
    }),
    prisma.aiUsageRecord.groupBy({
      by: ['provider', 'model'],
      where: { workspaceId, billingPeriod: period },
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
    }),
    prisma.aiRequest.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        provider: true,
        model: true,
        purpose: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        latencyMs: true,
        errorCode: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    billingPeriod: period,
    budget: usageLimit
      ? {
          monthlyAiBudgetUsd: Number(usageLimit.monthlyAiBudgetUsd),
          currentMonthSpendUsd: Number(usageLimit.currentMonthSpendUsd),
          maxMonthlyTokens: usageLimit.maxMonthlyTokens,
          currentMonthTokens: usageLimit.currentMonthTokens,
        }
      : null,
    periodTotals: {
      requests: records._count._all,
      inputTokens: records._sum.inputTokens ?? 0,
      outputTokens: records._sum.outputTokens ?? 0,
      totalTokens: records._sum.totalTokens ?? 0,
      costUsd: Number(records._sum.costUsd ?? 0),
    },
    breakdownByProvider: byProvider.map((g) => ({
      provider: g.provider,
      model: g.model,
      requests: g._count._all,
      totalTokens: g._sum.totalTokens ?? 0,
      costUsd: Number(g._sum.costUsd ?? 0),
    })),
    recentRequests: recentRequests.map((r) => ({
      ...r,
      estimatedCostUsd: Number(r.estimatedCostUsd),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
