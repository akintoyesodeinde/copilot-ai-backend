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
      automatedPrReviews: { status: 'PLANNED', phase: 2 },
      repositoryIndexing: { status: 'PLANNED', phase: 2 },
      securityScanning: { status: 'PLANNED', phase: 3 },
      architectureAnalysis: { status: 'PLANNED', phase: 3 },
      aiCodingAssistant: { status: 'PLANNED', phase: 3 },
      aiTestStudio: { status: 'PLANNED', phase: 3 },
    },
  };
}
