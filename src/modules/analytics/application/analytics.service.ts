import { getPrisma } from '@/shared/database/prisma';

export async function getWorkspaceAnalyticsOverview(workspaceId: string, userId: string) {
  const prisma = getPrisma();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    workspace,
    activeRepositories,
    totalBranches,
    totalCommits,
    activeMembers,
    pendingInvitations,
    activeGithubInstallations,
    unreadNotifications,
    recentAuditEventsCount,
    openPullRequests,
    completedReviews,
    totalReviewFindings,
    activeJobs,
    openVulnerabilities,
    architectureViolations,
    generatedTests,
    aiConversations,
    languageGroups,
    visibilityGroups,
    recentCommits,
    recentAuditEvents,
  ] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { usageLimit: true, settings: true },
    }),
    prisma.repository.count({
      where: { workspaceId, isActive: true, accessRevokedAt: null },
    }),
    prisma.repositoryBranch.count({ where: { workspaceId } }),
    prisma.repositoryCommit.count({ where: { workspaceId } }),
    prisma.workspaceMember.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.workspaceInvitation.count({
      where: { workspaceId, status: 'PENDING', expiresAt: { gt: new Date() } },
    }),
    prisma.githubInstallation.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.notification.count({ where: { workspaceId, userId, readAt: null } }),
    prisma.auditLog.count({
      where: { workspaceId, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.pullRequest.count({ where: { workspaceId, state: 'OPEN' } }),
    prisma.codeReview.count({
      where: {
        workspaceId,
        status: { in: ['AWAITING_APPROVAL', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'PUBLISHED'] },
      },
    }),
    prisma.reviewFinding.count({ where: { workspaceId } }),
    prisma.analysisJob.count({ where: { workspaceId, status: { in: ['QUEUED', 'RUNNING'] } } }),
    prisma.vulnerability.count({ where: { workspaceId, status: 'OPEN' } }),
    prisma.architectureViolation.count({ where: { workspaceId } }),
    prisma.generatedTest.count({ where: { workspaceId } }),
    prisma.aiConversation.count({ where: { workspaceId } }),
    prisma.repository.groupBy({
      by: ['primaryLanguage'],
      where: { workspaceId, isActive: true, accessRevokedAt: null },
      _count: { _all: true },
    }),
    prisma.repository.groupBy({
      by: ['visibility'],
      where: { workspaceId, isActive: true, accessRevokedAt: null },
      _count: { _all: true },
    }),
    prisma.repositoryCommit.findMany({
      where: { workspaceId },
      include: {
        repository: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { committedAt: 'desc' },
      take: 6,
    }),
    prisma.auditLog.findMany({
      where: { workspaceId },
      include: {
        actor: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  return {
    workspaceId,
    summary: {
      connectedRepositories: activeRepositories,
      trackedBranches: totalBranches,
      trackedCommits: totalCommits,
      activeMembers,
      pendingInvitations,
      activeGithubInstallations,
      unreadNotifications,
      auditEventsLast7Days: recentAuditEventsCount,
      openPullRequests,
      completedReviews,
      totalReviewFindings,
      activeJobs,
      openVulnerabilities,
      architectureViolations,
      generatedTests,
      aiConversations,
    },
    usage: workspace?.usageLimit
      ? {
          monthlyAiBudgetUsd: Number(workspace.usageLimit.monthlyAiBudgetUsd),
          currentMonthSpendUsd: Number(workspace.usageLimit.currentMonthSpendUsd),
          maxMonthlyTokens: workspace.usageLimit.maxMonthlyTokens,
          currentMonthTokens: workspace.usageLimit.currentMonthTokens,
          maxRepositories: workspace.usageLimit.maxRepositories,
          maxMembers: workspace.usageLimit.maxMembers,
        }
      : null,
    repositoriesByLanguage: languageGroups
      .map((g) => ({
        language: g.primaryLanguage ?? 'Unknown',
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    repositoriesByVisibility: visibilityGroups.map((g) => ({
      visibility: g.visibility,
      count: g._count._all,
    })),
    recentCommits: recentCommits.map((c) => ({
      id: c.id,
      sha: c.sha,
      messageHeadline: c.messageHeadline,
      authorName: c.authorName,
      committedAt: c.committedAt.toISOString(),
      repository: c.repository,
    })),
    recentActivity: recentAuditEvents.map((e) => ({
      id: e.id,
      action: e.action,
      resourceType: e.resourceType,
      outcome: e.outcome,
      actorName: e.actor?.fullName ?? 'System',
      createdAt: e.createdAt.toISOString(),
    })),
    moduleReadiness: {
      foundation: { status: 'AVAILABLE', phase: 1 },
      automatedPrReviews: { status: 'AVAILABLE', phase: 2 },
      repositoryIndexing: { status: 'AVAILABLE', phase: 2 },
      securityScanning: { status: 'AVAILABLE', phase: 3 },
      architectureAnalysis: { status: 'AVAILABLE', phase: 3 },
      aiCodingAssistant: { status: 'AVAILABLE', phase: 3 },
      aiTestStudio: { status: 'AVAILABLE', phase: 3 },
    },
  };
}

/**
 * Deterministic Code Quality & Architecture Analytics derived strictly from persisted MySQL metrics.
 * Transparent Code Health Score formula (0-100):
 *   100 - min(40, circularDeps * 12) - min(30, layerViolations * 6)
 *       - min(15, highCouplingViolations * 4) - min(15, round(avgInstability * 15))
 */
export async function getCodeQualityAnalytics(workspaceId: string) {
  const prisma = getPrisma();

  const [
    indexedFilesCount,
    symbolsCount,
    completedArchScans,
    latestViolations,
    generatedTestsTotal,
    syntaxValidTestsCount,
    approvedTestsCount,
  ] = await Promise.all([
    prisma.repositoryFile.count({ where: { workspaceId, isExcluded: false } }),
    prisma.codeSymbol.count({ where: { workspaceId } }),
    prisma.architectureScan.findMany({
      where: { workspaceId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { repository: { select: { id: true, fullName: true } } },
    }),
    prisma.architectureViolation.groupBy({
      by: ['violationType'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.generatedTest.count({ where: { workspaceId } }),
    prisma.generatedTest.count({ where: { workspaceId, syntaxValid: true } }),
    prisma.generatedTest.count({ where: { workspaceId, approvalStatus: 'APPROVED' } }),
  ]);

  // Keep latest completed architecture scan per repository
  const latestByRepo = new Map<string, (typeof completedArchScans)[number]>();
  for (const s of completedArchScans) {
    if (!latestByRepo.has(s.repositoryId)) {
      latestByRepo.set(s.repositoryId, s);
    }
  }
  const latestScans = [...latestByRepo.values()];

  const totalNodes = latestScans.reduce((acc, s) => acc + s.nodesCount, 0);
  const totalEdges = latestScans.reduce((acc, s) => acc + s.edgesCount, 0);
  const totalCircular = latestScans.reduce((acc, s) => acc + s.circularDepsCount, 0);
  const totalOrphans = latestScans.reduce((acc, s) => acc + s.orphanModulesCount, 0);

  const avgInstability =
    latestScans.length > 0
      ? Number(
          (
            latestScans.reduce((acc, s) => {
              const m = (s.metricsJson as { averageInstability?: number } | null) ?? {};
              return acc + (typeof m.averageInstability === 'number' ? m.averageInstability : 0);
            }, 0) / latestScans.length
          ).toFixed(4),
        )
      : 0;

  const violationMap = new Map(latestViolations.map((v) => [v.violationType, v._count._all]));
  const layerViolations = violationMap.get('LAYER_BOUNDARY') ?? 0;
  const highCouplingViolations = violationMap.get('HIGH_COUPLING') ?? 0;

  const codeHealthScore =
    latestScans.length === 0
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            100 -
              Math.min(40, totalCircular * 12) -
              Math.min(30, layerViolations * 6) -
              Math.min(15, highCouplingViolations * 4) -
              Math.min(15, Math.round(avgInstability * 15)),
          ),
        );

  return {
    workspaceId,
    summary: {
      indexedFilesCount,
      symbolsCount,
      scannedRepositories: latestScans.length,
      totalModules: totalNodes,
      totalDependencyEdges: totalEdges,
      circularDependencies: totalCircular,
      orphanModules: totalOrphans,
      averageInstability: avgInstability,
      codeHealthScore,
      generatedTestsTotal,
      syntaxValidTestsRate:
        generatedTestsTotal > 0
          ? Number((syntaxValidTestsCount / generatedTestsTotal).toFixed(4))
          : null,
      approvedTestsCount,
    },
    violationsByType: latestViolations.map((v) => ({
      violationType: v.violationType,
      count: v._count._all,
    })),
    repositorySnapshots: latestScans.map((s) => ({
      repositoryId: s.repositoryId,
      repositoryName: s.repository.fullName,
      commitSha: s.commitSha,
      nodesCount: s.nodesCount,
      edgesCount: s.edgesCount,
      circularDepsCount: s.circularDepsCount,
      violationsCount: s.violationsCount,
      orphanModulesCount: s.orphanModulesCount,
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
    methodology: {
      formula:
        '100 - min(40, circularDeps * 12) - min(30, layerBoundaryViolations * 6) - min(15, highCoupling * 4) - min(15, round(avgInstability * 15))',
      caveats: [
        'Computed exclusively from deterministic static AST dependency graphs; returns null until at least one repository architecture scan completes.',
        'Does not reflect runtime code coverage or dynamic reflection imports.',
      ],
    },
  };
}

export async function getSecurityAnalytics(workspaceId: string) {
  const prisma = getPrisma();

  const [
    bySeverity,
    byStatus,
    byScanner,
    bySource,
    totalScans,
    vulnerablePackagesCount,
    totalPackagesCount,
    activeRiskAcceptances,
  ] = await Promise.all([
    prisma.vulnerability.groupBy({
      by: ['severity'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.vulnerability.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.vulnerability.groupBy({
      by: ['scanner'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.vulnerability.groupBy({
      by: ['source'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.securityScan.count({ where: { workspaceId, status: 'COMPLETED' } }),
    prisma.dependencyPackage.count({ where: { workspaceId, advisoryCount: { gt: 0 } } }),
    prisma.dependencyPackage.count({ where: { workspaceId } }),
    prisma.riskAcceptance.count({
      where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  const statusMap = new Map(byStatus.map((s) => [s.status, s._count._all]));
  const totalVulnerabilities = byStatus.reduce((acc, s) => acc + s._count._all, 0);

  return {
    workspaceId,
    summary: {
      completedSecurityScans: totalScans,
      totalVulnerabilities,
      openVulnerabilities: statusMap.get('OPEN') ?? 0,
      triagedVulnerabilities: statusMap.get('TRIAGED') ?? 0,
      falsePositiveVulnerabilities: statusMap.get('FALSE_POSITIVE') ?? 0,
      riskAcceptedVulnerabilities: statusMap.get('RISK_ACCEPTED') ?? 0,
      fixedVulnerabilities: statusMap.get('FIXED') ?? 0,
      totalDependenciesAudited: totalPackagesCount,
      vulnerableDependenciesCount: vulnerablePackagesCount,
      activeRiskAcceptances,
    },
    bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count._all })),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    byScanner: byScanner.map((s) => ({ scanner: s.scanner, count: s._count._all })),
    bySource: bySource.map((s) => ({ source: s.source, count: s._count._all })),
  };
}

export async function getReviewPerformanceAnalytics(workspaceId: string) {
  const prisma = getPrisma();

  const [
    reviewsByStatus,
    findingsBySource,
    findingsBySeverity,
    feedbackByVote,
    aiAgg,
    aiByPurpose,
  ] = await Promise.all([
    prisma.codeReview.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.reviewFinding.groupBy({
      by: ['source'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.reviewFinding.groupBy({
      by: ['severity'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.reviewFeedback.groupBy({
      by: ['vote'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.aiRequest.aggregate({
      where: { workspaceId, status: 'SUCCEEDED' },
      _count: { _all: true },
      _avg: { latencyMs: true },
      _sum: { totalTokens: true, estimatedCostUsd: true },
    }),
    prisma.aiUsageRecord.groupBy({
      by: ['purpose'],
      where: { workspaceId },
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
    }),
  ]);

  const voteMap = new Map(feedbackByVote.map((v) => [v.vote, v._count._all]));
  const helpful = voteMap.get('HELPFUL') ?? 0;
  const falsePositive = voteMap.get('FALSE_POSITIVE') ?? 0;
  const notHelpful = voteMap.get('NOT_HELPFUL') ?? 0;
  const feedbackTotal = helpful + falsePositive + notHelpful;

  return {
    workspaceId,
    summary: {
      totalReviews: reviewsByStatus.reduce((acc, r) => acc + r._count._all, 0),
      totalFindings: findingsBySource.reduce((acc, f) => acc + f._count._all, 0),
      succeededAiRequests: aiAgg._count._all,
      averageAiLatencyMs: Math.round(aiAgg._avg.latencyMs ?? 0),
      totalTokensConsumed: aiAgg._sum.totalTokens ?? 0,
      totalEstimatedCostUsd: Number(aiAgg._sum.estimatedCostUsd ?? 0),
      feedbackTotal,
      helpfulPrecisionRate:
        helpful + falsePositive > 0
          ? Number((helpful / (helpful + falsePositive)).toFixed(4))
          : null,
    },
    reviewsByStatus: reviewsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    findingsBySource: findingsBySource.map((f) => ({ source: f.source, count: f._count._all })),
    findingsBySeverity: findingsBySeverity.map((f) => ({
      severity: f.severity,
      count: f._count._all,
    })),
    feedbackByVote: feedbackByVote.map((v) => ({ vote: v.vote, count: v._count._all })),
    aiUsageByPurpose: aiByPurpose.map((p) => ({
      purpose: p.purpose,
      requests: p._count._all,
      totalTokens: p._sum.totalTokens ?? 0,
      costUsd: Number(p._sum.costUsd ?? 0),
    })),
  };
}

/**
 * Strictly Platform Administrator operational view.
 * Returns aggregated non-code platform telemetry ONLY — never accesses or exposes
 * private tenant repository files, diffs, symbols, or source snippets.
 */
export async function getPlatformAdminOverview() {
  const prisma = getPrisma();
  const [totalUsers, totalWorkspaces, activeRepositories, jobsByStatus, aiAgg, recentFailedJobs] =
    await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.workspace.count({ where: { archivedAt: null } }),
      prisma.repository.count({ where: { isActive: true, accessRevokedAt: null } }),
      prisma.analysisJob.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.aiUsageRecord.aggregate({
        _count: { _all: true },
        _sum: { totalTokens: true, costUsd: true },
      }),
      prisma.analysisJob.count({ where: { status: { in: ['FAILED', 'DEAD_LETTERED'] } } }),
    ]);

  return {
    scope: 'PLATFORM_OPERATIONS_METADATA_ONLY',
    tenantCodeAccessGranted: false,
    summary: {
      activeUsers: totalUsers,
      activeWorkspaces: totalWorkspaces,
      connectedRepositories: activeRepositories,
      totalAiRequests: aiAgg._count._all,
      totalPlatformTokens: aiAgg._sum.totalTokens ?? 0,
      totalPlatformAiSpendUsd: Number(aiAgg._sum.costUsd ?? 0),
      failedOrDeadLetteredJobs: recentFailedJobs,
    },
    jobsByStatus: jobsByStatus.map((j) => ({ status: j.status, count: j._count._all })),
  };
}
