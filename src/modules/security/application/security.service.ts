import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { ValidationError, NotFoundError } from '@/shared/http/problem-details';
import { paginateDescByCreatedAt, type PaginationParams } from '@/shared/http/pagination';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';
import { executeRepoIndexJob } from '@/modules/indexing/application/indexing.service';
import { getGithubGateway } from '@/modules/github/infrastructure/github-client';
import { detectLanguageFromPath } from '@/modules/indexing/domain/path-guard';
import {
  runAllDeterministicSecurityScanners,
  type ScannableFile,
} from '@/modules/security/domain/scanners';

export async function scheduleSecurityScan(input: {
  workspaceId: string;
  repositoryId: string;
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
    throw new NotFoundError('Repository not found or access has been revoked');
  }

  const commitSha =
    input.commitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  const scan = await prisma.securityScan.create({
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
    jobType: 'SECURITY_SCAN',
    idempotencyKey: `security-scan:${input.repositoryId}:${scan.id}`,
    payload: {
      repositoryId: input.repositoryId,
      securityScanId: scan.id,
      commitSha,
    },
    createdByUserId: input.actorUserId,
  });

  await prisma.securityScan.update({
    where: { id: scan.id },
    data: { analysisJobId: job.id },
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'security.scan.scheduled',
    resourceType: 'security_scan',
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

export async function executeSecurityScanJob(input: {
  workspaceId: string;
  repositoryId: string;
  securityScanId?: string;
  commitSha?: string;
}) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.repositoryId } },
    include: {
      githubInstallation: true,
      branches: { where: { isDefault: true }, take: 1 },
    },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access revoked');
  }

  const commitSha =
    input.commitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  let scan = input.securityScanId
    ? await prisma.securityScan.findUnique({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.securityScanId } },
      })
    : null;

  if (!scan) {
    scan = await prisma.securityScan.create({
      data: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        commitSha,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
  } else {
    scan = await prisma.securityScan.update({
      where: { id: scan.id },
      data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
    });
  }

  try {
    // Ensure repository files exist at this commit; trigger safe indexing if empty
    let indexedFiles = await prisma.repositoryFile.findMany({
      where: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        commitSha,
        isExcluded: false,
      },
      select: { filePath: true, language: true, contentPreview: true },
    });

    if (indexedFiles.length === 0) {
      await executeRepoIndexJob(input.workspaceId, input.repositoryId, commitSha);
      indexedFiles = await prisma.repositoryFile.findMany({
        where: {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
          commitSha,
          isExcluded: false,
        },
        select: { filePath: true, language: true, contentPreview: true },
      });
    }

    // Also include manifest & container files from the raw snapshot safely (read-only) for OSV/Trivy/Gitleaks
    const gateway = getGithubGateway();
    const installationId = repo.githubInstallation?.githubInstallationId ?? BigInt(90000101);
    const snapshotFiles = await gateway.fetchRepositorySnapshotFiles(
      installationId,
      repo.ownerLogin,
      repo.name,
      commitSha,
    );

    const fileMap = new Map<string, ScannableFile>();
    for (const f of indexedFiles) {
      if (f.contentPreview) {
        fileMap.set(f.filePath, {
          filePath: f.filePath,
          language: f.language,
          content: f.contentPreview,
        });
      }
    }
    for (const sf of snapshotFiles) {
      if (sf.filePath.includes('node_modules/') || sf.filePath.includes('..')) continue;
      if (!fileMap.has(sf.filePath)) {
        fileMap.set(sf.filePath, {
          filePath: sf.filePath,
          language: detectLanguageFromPath(sf.filePath),
          content: sf.content,
        });
      }
    }

    const scanResult = runAllDeterministicSecurityScanners([...fileMap.values()]);

    const criticalCount = scanResult.vulnerabilities.filter(
      (v) => v.severity === 'CRITICAL',
    ).length;
    const highCount = scanResult.vulnerabilities.filter((v) => v.severity === 'HIGH').length;
    const mediumCount = scanResult.vulnerabilities.filter((v) => v.severity === 'MEDIUM').length;
    const lowCount = scanResult.vulnerabilities.filter(
      (v) => v.severity === 'LOW' || v.severity === 'INFO',
    ).length;

    await prisma.$transaction(
      async (tx) => {
        if (scanResult.vulnerabilities.length > 0) {
          await tx.vulnerability.createMany({
            skipDuplicates: true,
            data: scanResult.vulnerabilities.map((v) => ({
              workspaceId: input.workspaceId,
              repositoryId: input.repositoryId,
              securityScanId: scan.id,
              scanner: v.scanner,
              source: v.source,
              ruleId: v.ruleId,
              cweId: v.cweId,
              cveId: v.cveId,
              owaspCategory: v.owaspCategory,
              severity: v.severity,
              status: 'OPEN',
              title: v.title,
              description: v.description,
              remediation: v.remediation,
              filePath: v.filePath,
              startLine: v.startLine,
              endLine: v.endLine,
              redactedSnippet: v.redactedSnippet,
              fingerprint: v.fingerprint,
            })),
          });
        }

        if (scanResult.packages.length > 0) {
          await tx.dependencyPackage.createMany({
            data: scanResult.packages.map((pkg) => ({
              workspaceId: input.workspaceId,
              repositoryId: input.repositoryId,
              securityScanId: scan.id,
              ecosystem: pkg.ecosystem,
              packageName: pkg.packageName,
              version: pkg.version,
              manifestPath: pkg.manifestPath,
              isDirect: pkg.isDirect,
              advisoryCount: pkg.advisoryCount,
              highestSeverity: pkg.highestSeverity,
              fixedVersion: pkg.fixedVersion,
            })),
          });
        }

        await tx.securityScan.update({
          where: { id: scan.id },
          data: {
            status: 'COMPLETED',
            scannersRunJson: scanResult.scannersRun as Prisma.InputJsonValue,
            findingsCount: scanResult.vulnerabilities.length,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            summaryJson: {
              filesScanned: fileMap.size,
              dependenciesAudited: scanResult.packages.length,
              deterministicFindings: scanResult.vulnerabilities.length,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    return {
      securityScanId: scan.id,
      commitSha,
      filesScanned: fileMap.size,
      findingsCount: scanResult.vulnerabilities.length,
      dependenciesAudited: scanResult.packages.length,
      criticalCount,
      highCount,
    };
  } catch (error) {
    await prisma.securityScan.update({
      where: { id: scan.id },
      data: {
        status: 'FAILED',
        errorMessage:
          error instanceof Error ? error.message.slice(0, 1000) : 'Security scan failed',
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function listRepositorySecurityScans(workspaceId: string, repositoryId: string) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true },
  });
  if (!repo) {
    throw new NotFoundError('Repository not found in this workspace');
  }

  const scans = await prisma.securityScan.findMany({
    where: { workspaceId, repositoryId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: {
      _count: { select: { vulnerabilities: true, dependencyPackages: true } },
    },
  });

  return scans.map((s) => ({
    id: s.id,
    repositoryId: s.repositoryId,
    analysisJobId: s.analysisJobId,
    commitSha: s.commitSha,
    status: s.status,
    scannersRun: (s.scannersRunJson as string[] | null) ?? [],
    findingsCount: s.findingsCount,
    criticalCount: s.criticalCount,
    highCount: s.highCount,
    mediumCount: s.mediumCount,
    lowCount: s.lowCount,
    dependenciesCount: s._count.dependencyPackages,
    summary: (s.summaryJson as Record<string, unknown> | null) ?? null,
    startedAt: s.startedAt?.toISOString() ?? null,
    completedAt: s.completedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function listWorkspaceVulnerabilities(
  workspaceId: string,
  pagination: PaginationParams,
  filters: {
    repositoryId?: string;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    scanner?: 'SEMGREP' | 'GITLEAKS' | 'OSV_SCANNER' | 'ESLINT' | 'TRIVY' | 'AI_ADVISORY';
    status?: 'OPEN' | 'TRIAGED' | 'FALSE_POSITIVE' | 'RISK_ACCEPTED' | 'FIXED';
    source?: 'DETERMINISTIC' | 'AI_ADVISORY';
  },
) {
  const prisma = getPrisma();
  const where: Prisma.VulnerabilityWhereInput = {
    workspaceId,
    ...(filters.repositoryId ? { repositoryId: filters.repositoryId } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.scanner ? { scanner: filters.scanner } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(pagination.cursor
      ? {
          OR: [
            { createdAt: { lt: pagination.cursor.createdAt } },
            { createdAt: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
          ],
        }
      : {}),
  };

  const rows = await prisma.vulnerability.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
    include: {
      repository: { select: { id: true, fullName: true } },
      riskAcceptances: {
        where: { revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const paged = paginateDescByCreatedAt(rows, pagination.limit);
  return {
    items: paged.items.map((v) => ({
      id: v.id,
      workspaceId: v.workspaceId,
      repositoryId: v.repositoryId,
      repository: v.repository,
      securityScanId: v.securityScanId,
      scanner: v.scanner,
      source: v.source,
      ruleId: v.ruleId,
      cweId: v.cweId,
      cveId: v.cveId,
      owaspCategory: v.owaspCategory,
      severity: v.severity,
      status: v.status,
      title: v.title,
      description: v.description,
      remediation: v.remediation,
      filePath: v.filePath,
      startLine: v.startLine,
      endLine: v.endLine,
      redactedSnippet: v.redactedSnippet,
      fingerprint: v.fingerprint,
      activeRiskAcceptance: v.riskAcceptances[0]
        ? {
            id: v.riskAcceptances[0].id,
            reason: v.riskAcceptances[0].reason,
            expiresAt: v.riskAcceptances[0].expiresAt.toISOString(),
          }
        : null,
      triagedAt: v.triagedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
    pagination: paged.pagination,
  };
}

export async function getWorkspaceVulnerabilityById(workspaceId: string, vulnerabilityId: string) {
  const prisma = getPrisma();
  const v = await prisma.vulnerability.findUnique({
    where: { workspaceId_id: { workspaceId, id: vulnerabilityId } },
    include: {
      repository: { select: { id: true, fullName: true } },
      triagedBy: { select: { id: true, fullName: true, email: true } },
      riskAcceptances: {
        orderBy: { createdAt: 'desc' },
        include: { acceptedBy: { select: { id: true, fullName: true, email: true } } },
      },
    },
  });

  if (!v) {
    throw new NotFoundError('Vulnerability not found in this workspace');
  }

  return {
    id: v.id,
    workspaceId: v.workspaceId,
    repositoryId: v.repositoryId,
    repository: v.repository,
    securityScanId: v.securityScanId,
    scanner: v.scanner,
    source: v.source,
    ruleId: v.ruleId,
    cweId: v.cweId,
    cveId: v.cveId,
    owaspCategory: v.owaspCategory,
    severity: v.severity,
    status: v.status,
    title: v.title,
    description: v.description,
    remediation: v.remediation,
    filePath: v.filePath,
    startLine: v.startLine,
    endLine: v.endLine,
    redactedSnippet: v.redactedSnippet,
    fingerprint: v.fingerprint,
    triagedBy: v.triagedBy,
    triagedAt: v.triagedAt?.toISOString() ?? null,
    riskAcceptances: v.riskAcceptances.map((r) => ({
      id: r.id,
      reason: r.reason,
      mitigatingControls: r.mitigatingControls,
      expiresAt: r.expiresAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      acceptedBy: r.acceptedBy,
      createdAt: r.createdAt.toISOString(),
    })),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export async function triageVulnerability(input: {
  workspaceId: string;
  vulnerabilityId: string;
  status: 'OPEN' | 'TRIAGED' | 'FALSE_POSITIVE' | 'FIXED';
  actorUserId: string;
  correlationId: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.vulnerability.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.vulnerabilityId } },
  });
  if (!existing) {
    throw new NotFoundError('Vulnerability not found in this workspace');
  }

  const updated = await prisma.vulnerability.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      triagedByUserId: input.actorUserId,
      triagedAt: new Date(),
    },
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'security.vulnerability.triaged',
    resourceType: 'vulnerability',
    resourceId: updated.id,
    outcome: 'SUCCESS',
    correlationId: input.correlationId,
    metadata: {
      previousStatus: existing.status,
      newStatus: input.status,
      scanner: existing.scanner,
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    triagedAt: updated.triagedAt?.toISOString() ?? null,
  };
}

export async function acceptVulnerabilityRisk(input: {
  workspaceId: string;
  vulnerabilityId: string;
  reason: string;
  mitigatingControls?: string;
  expiresAt: string;
  actorUserId: string;
  correlationId: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.vulnerability.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.vulnerabilityId } },
  });
  if (!existing) {
    throw new NotFoundError('Vulnerability not found in this workspace');
  }

  const expiryDate = new Date(input.expiresAt);
  if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) {
    throw new ValidationError('Risk acceptance expiration must be a valid future ISO timestamp');
  }

  const acceptance = await prisma.$transaction(async (tx) => {
    const created = await tx.riskAcceptance.create({
      data: {
        workspaceId: input.workspaceId,
        vulnerabilityId: existing.id,
        acceptedByUserId: input.actorUserId,
        reason: input.reason,
        mitigatingControls: input.mitigatingControls ?? null,
        expiresAt: expiryDate,
      },
    });

    await tx.vulnerability.update({
      where: { id: existing.id },
      data: {
        status: 'RISK_ACCEPTED',
        triagedByUserId: input.actorUserId,
        triagedAt: new Date(),
      },
    });

    return created;
  });

  await recordAuditEvent({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: 'security.vulnerability.risk_accepted',
    resourceType: 'risk_acceptance',
    resourceId: acceptance.id,
    outcome: 'SUCCESS',
    correlationId: input.correlationId,
    metadata: {
      vulnerabilityId: existing.id,
      severity: existing.severity,
      expiresAt: acceptance.expiresAt.toISOString(),
    },
  });

  return {
    id: acceptance.id,
    vulnerabilityId: existing.id,
    status: 'RISK_ACCEPTED',
    reason: acceptance.reason,
    mitigatingControls: acceptance.mitigatingControls,
    expiresAt: acceptance.expiresAt.toISOString(),
    createdAt: acceptance.createdAt.toISOString(),
  };
}
