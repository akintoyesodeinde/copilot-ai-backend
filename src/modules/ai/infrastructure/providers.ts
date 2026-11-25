import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { getEnv } from '@/config/env';
import type {
  AiCompletionRawResponse,
  AiCompletionRequest,
  AiProviderAdapter,
  AiProviderName,
  StructuredPrReviewOutput,
} from '@/modules/ai/domain/types';

// ============================================================================
// OpenAI Adapter
// ============================================================================

export class OpenAiProviderAdapter implements AiProviderAdapter {
  public readonly providerName = 'openai' as const;
  public readonly defaultModel: string;

  constructor(defaultModel?: string) {
    this.defaultModel = defaultModel ?? getEnv().OPENAI_MODEL;
  }

  async generateJson(request: AiCompletionRequest): Promise<AiCompletionRawResponse> {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const rawJsonText = json.choices?.[0]?.message?.content ?? '';
      const inputTokens = json.usage?.prompt_tokens ?? Math.ceil(request.userPrompt.length / 4);
      const outputTokens = json.usage?.completion_tokens ?? Math.ceil(rawJsonText.length / 4);
      const estimatedCostUsd = Number(
        ((inputTokens * 0.0004 + outputTokens * 0.0016) / 1000).toFixed(6),
      );

      return {
        rawJsonText,
        model: json.model ?? request.model,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// Anthropic Adapter
// ============================================================================

export class AnthropicProviderAdapter implements AiProviderAdapter {
  public readonly providerName = 'anthropic' as const;
  public readonly defaultModel: string;

  constructor(defaultModel?: string) {
    this.defaultModel = defaultModel ?? getEnv().ANTHROPIC_MODEL;
  }

  async generateJson(request: AiCompletionRequest): Promise<AiCompletionRawResponse> {
    const env = getEnv();
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          max_tokens: 2048,
          temperature: 0.1,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Anthropic API returned HTTP ${response.status}`);
      }

      const json = (await response.json()) as {
        model?: string;
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const rawJsonText = json.content?.find((c) => c.type === 'text')?.text ?? '';
      const inputTokens = json.usage?.input_tokens ?? Math.ceil(request.userPrompt.length / 4);
      const outputTokens = json.usage?.output_tokens ?? Math.ceil(rawJsonText.length / 4);
      const estimatedCostUsd = Number(
        ((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(6),
      );

      return {
        rawJsonText,
        model: json.model ?? request.model,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// Optional Amazon Bedrock Adapter
// ============================================================================

export class BedrockProviderAdapter implements AiProviderAdapter {
  public readonly providerName = 'bedrock' as const;
  public readonly defaultModel: string;

  constructor(defaultModel?: string) {
    this.defaultModel = defaultModel ?? getEnv().BEDROCK_MODEL_ID;
  }

  async generateJson(request: AiCompletionRequest): Promise<AiCompletionRawResponse> {
    const env = getEnv();
    const client = new BedrockRuntimeClient({ region: env.AWS_REGION });
    const modelId = request.model || this.defaultModel;

    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: request.systemPrompt }],
        messages: [{ role: 'user', content: [{ text: request.userPrompt }] }],
        inferenceConfig: { maxTokens: 2048, temperature: 0.1 },
      }),
    );

    const rawJsonText = response.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    const inputTokens = response.usage?.inputTokens ?? Math.ceil(request.userPrompt.length / 4);
    const outputTokens = response.usage?.outputTokens ?? Math.ceil(rawJsonText.length / 4);
    const estimatedCostUsd = Number(
      ((inputTokens * 0.003 + outputTokens * 0.015) / 1000).toFixed(6),
    );

    return {
      rawJsonText,
      model: modelId,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    };
  }
}

// ============================================================================
// Deterministic Mock AI Provider (Zero Paid Credentials for Local & CI Tests)
// ============================================================================

export type MockAiBehavior = 'normal' | 'invalid_json' | 'hallucinated_file' | 'provider_error';

export class MockAiProviderAdapter implements AiProviderAdapter {
  public readonly providerName = 'mock' as const;
  public readonly defaultModel = 'codepilot-deterministic-mock-v1';
  private behavior: MockAiBehavior = 'normal';

  public setBehaviorForTesting(behavior: MockAiBehavior): void {
    this.behavior = behavior;
  }

  async generateJson(request: AiCompletionRequest): Promise<AiCompletionRawResponse> {
    if (this.behavior === 'provider_error') {
      throw new Error('Simulated AI provider outage (503 Service Unavailable)');
    }

    const inputTokens = Math.max(
      50,
      Math.ceil((request.systemPrompt.length + request.userPrompt.length) / 4),
    );

    if (this.behavior === 'invalid_json') {
      return {
        rawJsonText: '{"summaryMarkdown": "Broken payload without required fields"',
        model: this.defaultModel,
        inputTokens,
        outputTokens: 20,
        estimatedCostUsd: 0.0001,
      };
    }

    const changedFiles = request.metadata?.changedFiles ?? [];
    const findings: StructuredPrReviewOutput['findings'] = [];

    if (this.behavior === 'hallucinated_file') {
      findings.push({
        title: 'Hallucinated issue in non-existent path',
        description: 'This finding points to a file that is not part of the pull request diff.',
        severity: 'HIGH',
        category: 'BUG',
        filePath: 'src/does-not-exist/phantom.ts',
        startLine: 999,
        endLine: 1005,
        confidence: 0.42,
      });
    }

    for (const file of changedFiles) {
      const patch = file.patch ?? '';
      const lines = patch.split(/\r?\n/);
      let currentRightLine = 1;

      for (const line of lines) {
        const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
        if (hunk?.[1]) {
          currentRightLine = Number.parseInt(hunk[1], 10);
          continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
          const addedCode = line.slice(1);
          if (/\beval\s*\(/.test(addedCode)) {
            findings.push({
              title: 'Unsafe dynamic code execution via eval()',
              description:
                'Calling eval() on untrusted expressions allows arbitrary code execution within the Node.js runtime.',
              suggestion:
                'Replace eval() with an explicit allowlisted rule evaluator or safe expression AST parser.',
              severity: 'CRITICAL',
              category: 'SECURITY',
              filePath: file.filePath,
              startLine: currentRightLine,
              endLine: currentRightLine,
              evidenceSnippet: addedCode.trim(),
              confidence: 0.96,
            });
          } else if (/SELECT\s+.+\$\{/.test(addedCode)) {
            findings.push({
              title: 'Potential SQL injection via template interpolation',
              description:
                'Interpolating user-controlled identifiers directly inside a SQL query string exposes the database to SQL injection.',
              suggestion: 'Use parameterized Prisma queries or prepared bind parameters.',
              severity: 'HIGH',
              category: 'SECURITY',
              filePath: file.filePath,
              startLine: currentRightLine,
              endLine: currentRightLine,
              evidenceSnippet: addedCode.trim(),
              confidence: 0.93,
            });
          }
          currentRightLine += 1;
        } else if (!line.startsWith('-')) {
          currentRightLine += 1;
        }
      }
    }

    const overallRisk: StructuredPrReviewOutput['overallRisk'] = findings.some(
      (f) => f.severity === 'CRITICAL',
    )
      ? 'CRITICAL'
      : findings.some((f) => f.severity === 'HIGH')
        ? 'HIGH'
        : findings.length > 0
          ? 'MEDIUM'
          : 'LOW';

    const output: StructuredPrReviewOutput = {
      summaryMarkdown:
        findings.length > 0
          ? `CodePilot AI analyzed ${changedFiles.length} changed file(s) and identified ${findings.length} actionable issue(s) requiring attention before merge.`
          : `CodePilot AI analyzed ${changedFiles.length} changed file(s) and found no high-risk defects.`,
      overallRisk,
      findings,
    };

    const rawJsonText = JSON.stringify(output);
    const outputTokens = Math.max(25, Math.ceil(rawJsonText.length / 4));
    const estimatedCostUsd = Number(
      ((inputTokens * 0.0001 + outputTokens * 0.0002) / 1000).toFixed(6),
    );

    return {
      rawJsonText,
      model: this.defaultModel,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    };
  }
}

export const mockAiProvider = new MockAiProviderAdapter();

export function resolveAiProviderAdapter(provider: AiProviderName): AiProviderAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAiProviderAdapter();
    case 'anthropic':
      return new AnthropicProviderAdapter();
    case 'bedrock':
      return new BedrockProviderAdapter();
    case 'mock':
    default:
      return mockAiProvider;
  }
}
