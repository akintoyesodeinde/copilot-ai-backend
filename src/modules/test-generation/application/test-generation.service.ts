import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { NotFoundError } from '@/shared/http/problem-details';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';
import { executeRepoIndexJob } from '@/modules/indexing/application/indexing.service';
import { validateSourceSyntaxWithTreeSitter } from '@/modules/indexing/infrastructure/ast-parser';
import {
  getLanguageTestAdapter,
  resolveTestLanguage,
} from '@/modules/test-generation/domain/language-adapters';

export async function scheduleTestGeneration(input: {
  workspaceId: string;
  repositoryId: string;
  targetFilePath: string;
  language?: string;
  framework?: string;
  testTypes?: Array<'UNIT' | 'INTEGRATION' | 'REGRESSION' | 'SECURITY'>;
  commitSha?: string;
  actorUserId: string;
  correlationId: string;
}) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.repositoryId } },
    include: { branches: { where: { isDefault: true }, take: 1 } },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access revoked');
  }

  const commitSha =
    input.commitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  const resolvedLang = resolveTestLanguage(
    input.language ||
      (input.targetFilePath.endsWith('.py')
        ? 'python'
        : input.targetFilePath.endsWith('.go')
          ? 'go'
          : input.targetFilePath.endsWith('.java')
            ? 'java'
            : input.targetFilePath.endsWith('.cs')
              ? 'c_sharp'
              : input.targetFilePath.endsWith('.js') || input.targetFilePath.endsWith('.jsx')
                ? 'javascript'
                : 'typescript'),
  );
  const adapter = getLanguageTestAdapter(resolvedLang);
  const framework =
    input.framework && adapter.supportedFrameworks.includes(input.framework)
      ? input.framework
      : adapter.defaultFramework;
  const testTypes: Array<'UNIT' | 'INTEGRATION' | 'REGRESSION' | 'SECURITY'> =
    input.testTypes && input.testTypes.length > 0 ? input.testTypes : ['UNIT', 'SECURITY'];

  const testGenJob = await prisma.testGenerationJob.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      commitSha,
      targetFilePath: input.targetFilePath,
      language: resolvedLang,
      framework,
      testTypesJson: testTypes as Prisma.InputJsonValue,
      status: 'QUEUED',
      createdByUserId: input.actorUserId,
    },
  });

  const { job } = await enqueueAnalysisJob({
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    jobType: 'TEST_GENERATION',
    idempotencyKey: `test-gen:${input.repositoryId}:${testGenJob.id}`,
    payload: {
      repositoryId: input.repositoryId,
      testGenerationJobId: testGenJob.id,
      commitSha,
    },
    createdByUserId: input.actorUserId,
  });

  await prisma.testGenerationJob.update({
    where: { id: testGenJob.id },
    data: { analysisJobId: job.id },
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'test_generation.scheduled',
    resourceType: 'test_generation_job',
    resourceId: testGenJob.id,
    outcome: 'SUCCESS',
    correlationId: input.correlationId,
    metadata: {
      repositoryId: input.repositoryId,
      targetFilePath: input.targetFilePath,
      language: resolvedLang,
      framework,
      jobId: job.id,
    },
  });

  return {
    testGenerationJobId: testGenJob.id,
    analysisJobId: job.id,
    language: resolvedLang,
    framework,
    testTypes,
    status: testGenJob.status,
  };
}

export async function executeTestGenerationJob(input: {
  workspaceId: string;
  repositoryId: string;
  testGenerationJobId: string;
}) {
  const prisma = getPrisma();
  const jobRecord = await prisma.testGenerationJob.findUnique({
    where: {
      workspaceId_id: { workspaceId: input.workspaceId, id: input.testGenerationJobId },
    },
  });

  if (!jobRecord) {
    throw new NotFoundError('Test generation job not found');
  }

  await prisma.testGenerationJob.update({
    where: { id: jobRecord.id },
    data: { status: 'RUNNING', errorMessage: null },
  });

  try {
    // Ensure repository symbols exist for grounding
    let symbols = await prisma.codeSymbol.findMany({
      where: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        filePath: jobRecord.targetFilePath,
      },
      select: { name: true, kind: true, exported: true, signature: true },
      take: 25,
    });

    if (symbols.length === 0) {
      await executeRepoIndexJob(input.workspaceId, input.repositoryId, jobRecord.commitSha);
      symbols = await prisma.codeSymbol.findMany({
        where: {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
          filePath: jobRecord.targetFilePath,
        },
        select: { name: true, kind: true, exported: true, signature: true },
        take: 25,
      });
    }

    const lang = resolveTestLanguage(jobRecord.language);
    const adapter = getLanguageTestAdapter(lang);
    const testTypes = ((jobRecord.testTypesJson as string[] | null) ?? ['UNIT']) as Array<
      'UNIT' | 'INTEGRATION' | 'REGRESSION' | 'SECURITY'
    >;

    const createdIds: string[] = [];

    for (const testType of testTypes) {
      const suggestion = adapter.generateTestSuggestion({
        targetFilePath: jobRecord.targetFilePath,
        language: lang,
        framework: jobRecord.framework,
        symbols,
        testType,
      });

      // Validate syntax purely with Tree-sitter WASM AST — NEVER execute untrusted code on host
      const syntaxCheck = await validateSourceSyntaxWithTreeSitter(
        suggestion.language,
        suggestion.testCode,
      );

      const saved = await prisma.generatedTest.create({
        data: {
          workspaceId: input.workspaceId,
          testGenerationJobId: jobRecord.id,
          repositoryId: input.repositoryId,
          targetFilePath: jobRecord.targetFilePath,
          suggestedTestPath: suggestion.suggestedTestPath,
          language: suggestion.language,
          framework: suggestion.framework,
          testType: suggestion.testType,
          title: suggestion.title,
          testCode: suggestion.testCode,
          boundaryConditionsJson: suggestion.boundaryConditions as Prisma.InputJsonValue,
          syntaxValid: syntaxCheck.valid,
          syntaxErrorsJson: syntaxCheck.diagnostics as unknown as Prisma.InputJsonValue,
          approvalStatus: 'PENDING',
        },
      });

      await prisma.testExecutionResult.create({
        data: {
          workspaceId: input.workspaceId,
          generatedTestId: saved.id,
          validationEngine: syntaxCheck.engine,
          syntaxPassed: syntaxCheck.valid,
          diagnosticsJson: syntaxCheck.diagnostics as unknown as Prisma.InputJsonValue,
          sandboxExecuted: false,
          summary: syntaxCheck.valid
            ? `Syntax verified via ${syntaxCheck.engine} AST parser with zero errors. Host execution disabled by security policy.`
            : `Detected ${syntaxCheck.diagnostics.length} syntax diagnostic(s) via ${syntaxCheck.engine}.`,
        },
      });

      createdIds.push(saved.id);
    }

    await prisma.testGenerationJob.update({
      where: { id: jobRecord.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return {
      testGenerationJobId: jobRecord.id,
      generatedTestsCount: createdIds.length,
      generatedTestIds: createdIds,
    };
  } catch (error) {
    await prisma.testGenerationJob.update({
      where: { id: jobRecord.id },
      data: {
        status: 'FAILED',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 1000) : 'Test generation failed',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function listTestGenerationJobs(workspaceId: string, repositoryId?: string) {
  const prisma = getPrisma();
  const jobs = await prisma.testGenerationJob.findMany({
    where: {
      workspaceId,
      ...(repositoryId ? { repositoryId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      repository: { select: { id: true, fullName: true } },
      generatedTests: {
        select: {
          id: true,
          testType: true,
          syntaxValid: true,
          approvalStatus: true,
          suggestedTestPath: true,
        },
      },
    },
  });

  return jobs.map((j) => ({
    id: j.id,
    repositoryId: j.repositoryId,
    repository: j.repository,
    analysisJobId: j.analysisJobId,
    commitSha: j.commitSha,
    targetFilePath: j.targetFilePath,
    language: j.language,
    framework: j.framework,
    testTypes: (j.testTypesJson as string[]) ?? [],
    status: j.status,
    generatedTestsCount: j.generatedTests.length,
    syntaxValidCount: j.generatedTests.filter((t) => t.syntaxValid).length,
    approvedCount: j.generatedTests.filter((t) => t.approvalStatus === 'APPROVED').length,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  }));
}

export async function getTestGenerationJobDetail(workspaceId: string, jobId: string) {
  const prisma = getPrisma();
  const job = await prisma.testGenerationJob.findUnique({
    where: { workspaceId_id: { workspaceId, id: jobId } },
    include: {
      repository: { select: { id: true, fullName: true } },
      generatedTests: {
        orderBy: { createdAt: 'asc' },
        include: {
          executionResults: { orderBy: { createdAt: 'desc' }, take: 1 },
          approvedBy: { select: { id: true, fullName: true, email: true } },
        },
      },
    },
  });

  if (!job) {
    throw new NotFoundError('Test generation job not found in this workspace');
  }

  return {
    id: job.id,
    repositoryId: job.repositoryId,
    repository: job.repository,
    analysisJobId: job.analysisJobId,
    commitSha: job.commitSha,
    targetFilePath: job.targetFilePath,
    language: job.language,
    framework: job.framework,
    testTypes: (job.testTypesJson as string[]) ?? [],
    status: job.status,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    generatedTests: job.generatedTests.map((t) => ({
      id: t.id,
      targetFilePath: t.targetFilePath,
      suggestedTestPath: t.suggestedTestPath,
      language: t.language,
      framework: t.framework,
      testType: t.testType,
      title: t.title,
      testCode: t.testCode,
      boundaryConditions: (t.boundaryConditionsJson as string[] | null) ?? [],
      syntaxValid: t.syntaxValid,
      syntaxErrors:
        (t.syntaxErrorsJson as Array<{ line: number; column: number; message: string }> | null) ??
        [],
      approvalStatus: t.approvalStatus,
      approvedBy: t.approvedBy,
      approvedAt: t.approvedAt?.toISOString() ?? null,
      validationResult: t.executionResults[0]
        ? {
            validationEngine: t.executionResults[0].validationEngine,
            syntaxPassed: t.executionResults[0].syntaxPassed,
            sandboxExecuted: t.executionResults[0].sandboxExecuted,
            summary: t.executionResults[0].summary,
          }
        : null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function updateGeneratedTestApproval(input: {
  workspaceId: string;
  generatedTestId: string;
  approvalStatus: 'APPROVED' | 'REJECTED';
  actorUserId: string;
  correlationId: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.generatedTest.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.generatedTestId } },
  });
  if (!existing) {
    throw new NotFoundError('Generated test not found in this workspace');
  }

  const updated = await prisma.generatedTest.update({
    where: { id: existing.id },
    data: {
      approvalStatus: input.approvalStatus,
      approvedByUserId: input.actorUserId,
      approvedAt: new Date(),
    },
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: `test_generation.test.${input.approvalStatus.toLowerCase()}`,
    resourceType: 'generated_test',
    resourceId: updated.id,
    outcome: 'SUCCESS',
    correlationId: input.correlationId,
    metadata: { suggestedTestPath: existing.suggestedTestPath, language: existing.language },
  });

  return {
    id: updated.id,
    approvalStatus: updated.approvalStatus,
    approvedAt: updated.approvedAt?.toISOString() ?? null,
  };
}
