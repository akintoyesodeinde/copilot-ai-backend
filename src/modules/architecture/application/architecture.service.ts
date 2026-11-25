import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { NotFoundError } from '@/shared/http/problem-details';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';
import { executeRepoIndexJob } from '@/modules/indexing/application/indexing.service';
import {
  analyzeArchitectureGraph,
  DEFAULT_LAYER_BOUNDARY_RULES,
  type LayerBoundaryRule,
} from '@/modules/architecture/domain/graph-analyzer';

export async function scheduleArchitectureScan(input: {
  workspaceId: string;
  repositoryId: string;
  commitSha?: string;
  customRules?: LayerBoundaryRule[];
  actorUserId: string;
  correlationId: string;
}) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.repositoryId } },
    include: { branches: { where: { isDefault: true }, take: 1 } },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access has been revoked');
  }

  const commitSha =
    input.commitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  const scan = await prisma.architectureScan.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      commitSha,
      status: 'QUEUED',
    },
  });

  const { job } = await enqueueAnalysisJob({
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    jobType: 'ARCHITECTURE_SCAN',
    idempotencyKey: `arch-scan:${input.repositoryId}:${scan.id}`,
    payload: {
      repositoryId: input.repositoryId,
      architectureScanId: scan.id,
      commitSha,
      customRules: input.customRules ?? null,
    },
    createdByUserId: input.actorUserId,
  });

  await prisma.architectureScan.update({
    where: { id: scan.id },
    data: { analysisJobId: job.id },
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'architecture.scan.scheduled',
    resourceType: 'architecture_scan',
    resourceId: scan.id,
    outcome: 'SUCCESS',
    correlationId: input.correlationId,
    metadata: { repositoryId: input.repositoryId, commitSha, jobId: job.id },
  });

  return {
    scanId: scan.id,
    jobId: job.id,
    commitSha,
    status: scan.status,
  };
}

export async function executeArchitectureScanJob(input: {
  workspaceId: string;
  repositoryId: string;
  architectureScanId?: string;
  commitSha?: string;
  customRules?: LayerBoundaryRule[] | null;
}) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.repositoryId } },
    include: { branches: { where: { isDefault: true }, take: 1 } },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access has been revoked');
  }

  const commitSha =
    input.commitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  let scan = input.architectureScanId
    ? await prisma.architectureScan.findUnique({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.architectureScanId } },
      })
    : null;

  if (!scan) {
    scan = await prisma.architectureScan.create({
      data: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        commitSha,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
  } else {
    scan = await prisma.architectureScan.update({
      where: { id: scan.id },
      data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
    });
  }

  try {
    let files = await prisma.repositoryFile.findMany({
      where: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        commitSha,
        isExcluded: false,
      },
      select: { filePath: true, language: true, lineCount: true },
    });

    if (files.length === 0) {
      await executeRepoIndexJob(input.workspaceId, input.repositoryId, commitSha);
      files = await prisma.repositoryFile.findMany({
        where: {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
          commitSha,
          isExcluded: false,
        },
        select: { filePath: true, language: true, lineCount: true },
      });
    }

    const dependencies = await prisma.codeDependency.findMany({
      where: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        commitSha,
      },
      select: {
        sourceFilePath: true,
        targetSpecifier: true,
        resolvedTargetPath: true,
        dependencyType: true,
      },
    });

    const rules =
      input.customRules && input.customRules.length > 0
        ? input.customRules
        : DEFAULT_LAYER_BOUNDARY_RULES;

    const analysis = analyzeArchitectureGraph(files, dependencies, rules);

    await prisma.$transaction(
      async (tx) => {
        const nodeIdMap = new Map<string, string>();
        for (const n of analysis.nodes) {
          const created = await tx.architectureNode.create({
            data: {
              workspaceId: input.workspaceId,
              scanId: scan.id,
              nodeKey: n.nodeKey,
              label: n.label,
              filePath: n.filePath,
              layer: n.layer,
              moduleGroup: n.moduleGroup,
              language: n.language,
              linesOfCode: n.linesOfCode,
              fanIn: n.fanIn,
              fanOut: n.fanOut,
              instability: n.instability,
              isOrphan: n.isOrphan,
              isHotspot: n.isHotspot,
            },
          });
          nodeIdMap.set(n.nodeKey, created.id);
        }

        const edgeRecords = analysis.edges
          .map((e) => {
            const sourceNodeId = nodeIdMap.get(e.sourceKey);
            const targetNodeId = nodeIdMap.get(e.targetKey);
            if (!sourceNodeId || !targetNodeId) return null;
            return {
              workspaceId: input.workspaceId,
              scanId: scan.id,
              sourceNodeId,
              targetNodeId,
              edgeType: e.edgeType,
              isCircular: e.isCircular,
              isViolation: e.isViolation,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (edgeRecords.length > 0) {
          await tx.architectureEdge.createMany({ data: edgeRecords });
        }

        if (analysis.violations.length > 0) {
          await tx.architectureViolation.createMany({
            data: analysis.violations.map((v) => ({
              workspaceId: input.workspaceId,
              scanId: scan.id,
              violationType: v.violationType,
              severity: v.severity,
              ruleName: v.ruleName,
              message: v.message,
              sourcePath: v.sourcePath,
              targetPath: v.targetPath,
              cyclePathsJson: v.cyclePaths ? (v.cyclePaths as Prisma.InputJsonValue) : undefined,
            })),
          });
        }

        await tx.architectureScan.update({
          where: { id: scan.id },
          data: {
            status: 'COMPLETED',
            nodesCount: analysis.summary.nodesCount,
            edgesCount: analysis.summary.edgesCount,
            circularDepsCount: analysis.summary.circularDepsCount,
            violationsCount: analysis.summary.violationsCount,
            orphanModulesCount: analysis.summary.orphanModulesCount,
            metricsJson: analysis.summary as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    return {
      architectureScanId: scan.id,
      commitSha,
      ...analysis.summary,
    };
  } catch (error) {
    await prisma.architectureScan.update({
      where: { id: scan.id },
      data: {
        status: 'FAILED',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 1000) : 'Architecture analysis failed',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function getLatestArchitectureGraph(workspaceId: string, repositoryId: string) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, fullName: true },
  });
  if (!repo) {
    throw new NotFoundError('Repository not found in this workspace');
  }

  const latestScan = await prisma.architectureScan.findFirst({
    where: { workspaceId, repositoryId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    include: {
      nodes: { orderBy: [{ layer: 'asc' }, { filePath: 'asc' }] },
      edges: true,
    },
  });

  if (!latestScan) {
    return {
      repository: repo,
      scan: null,
      nodes: [],
      edges: [],
    };
  }

  return {
    repository: repo,
    scan: {
      id: latestScan.id,
      commitSha: latestScan.commitSha,
      status: latestScan.status,
      nodesCount: latestScan.nodesCount,
      edgesCount: latestScan.edgesCount,
      circularDepsCount: latestScan.circularDepsCount,
      violationsCount: latestScan.violationsCount,
      orphanModulesCount: latestScan.orphanModulesCount,
      metrics: (latestScan.metricsJson as Record<string, unknown> | null) ?? null,
      completedAt: latestScan.completedAt?.toISOString() ?? null,
      createdAt: latestScan.createdAt.toISOString(),
    },
    nodes: latestScan.nodes.map((n) => ({
      id: n.id,
      nodeKey: n.nodeKey,
      label: n.label,
      filePath: n.filePath,
      layer: n.layer,
      moduleGroup: n.moduleGroup,
      language: n.language,
      linesOfCode: n.linesOfCode,
      fanIn: n.fanIn,
      fanOut: n.fanOut,
      instability: Number(n.instability),
      isOrphan: n.isOrphan,
      isHotspot: n.isHotspot,
    })),
    edges: latestScan.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      edgeType: e.edgeType,
      isCircular: e.isCircular,
      isViolation: e.isViolation,
    })),
  };
}

export async function listArchitectureViolations(workspaceId: string, repositoryId: string) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, fullName: true },
  });
  if (!repo) {
    throw new NotFoundError('Repository not found in this workspace');
  }

  const latestScan = await prisma.architectureScan.findFirst({
    where: { workspaceId, repositoryId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    include: {
      violations: { orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }] },
    },
  });

  if (!latestScan) {
    return { repository: repo, scanId: null, items: [] };
  }

  return {
    repository: repo,
    scanId: latestScan.id,
    commitSha: latestScan.commitSha,
    items: latestScan.violations.map((v) => ({
      id: v.id,
      violationType: v.violationType,
      severity: v.severity,
      ruleName: v.ruleName,
      message: v.message,
      sourcePath: v.sourcePath,
      targetPath: v.targetPath,
      cyclePaths: (v.cyclePathsJson as string[] | null) ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}
