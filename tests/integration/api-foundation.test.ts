import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, disconnectPrisma } from '@/shared/database/prisma';
import { clearRateLimitsForTesting } from '@/shared/security/rate-limit';
import { buildRequest, extractCookies, readJson } from '../helpers/http';

import { GET as healthLiveGet } from '@/app/api/v1/health/live/route';
import { GET as healthReadyGet } from '@/app/api/v1/health/ready/route';
import { GET as openApiGet } from '@/app/api/v1/openapi.json/route';
import { POST as registerPost } from '@/app/api/v1/auth/register/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as refreshPost } from '@/app/api/v1/auth/refresh/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { GET as meGet } from '@/app/api/v1/auth/me/route';
import { GET as workspacesGet, POST as workspacesPost } from '@/app/api/v1/workspaces/route';
import { GET as workspaceGet, PATCH as workspacePatch } from '@/app/api/v1/workspaces/[id]/route';
import { GET as membersGet } from '@/app/api/v1/workspaces/[id]/members/route';
import { POST as invitationsPost } from '@/app/api/v1/workspaces/[id]/invitations/route';
import { PATCH as memberPatch } from '@/app/api/v1/workspaces/[id]/members/[memberId]/route';
import { GET as repositoriesGet } from '@/app/api/v1/repositories/route';
import { GET as repositoryGet } from '@/app/api/v1/repositories/[id]/route';
import { GET as analyticsOverviewGet } from '@/app/api/v1/analytics/overview/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { PATCH as notificationPatch } from '@/app/api/v1/notifications/[id]/route';
import { GET as auditLogsGet } from '@/app/api/v1/audit-logs/route';

interface Envelope<T> {
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: {
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
    };
  };
}

describe('Phase 1 API Foundation Integration (MySQL)', () => {
  const runSuffix = crypto.randomBytes(4).toString('hex');
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(() => {
    clearRateLimitsForTesting();
  });

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await disconnectPrisma();
  });

  it('serves healthy liveness, MySQL readiness, and OpenAPI 3.1 contract', async () => {
    const liveRes = await healthLiveGet(buildRequest('/api/v1/health/live'));
    expect(liveRes.status).toBe(200);
    const liveBody = await readJson<Envelope<{ status: string }>>(liveRes);
    expect(liveBody.data.status).toBe('ok');
    expect(liveRes.headers.get('x-request-id')).toBeTruthy();

    const readyRes = await healthReadyGet(buildRequest('/api/v1/health/ready'));
    expect(readyRes.status).toBe(200);
    const readyBody =
      await readJson<Envelope<{ ready: boolean; checks: { database: { status: string } } }>>(
        readyRes,
      );
    expect(readyBody.data.ready).toBe(true);
    expect(readyBody.data.checks.database.status).toBe('up');

    const openApiRes = await openApiGet(buildRequest('/api/v1/openapi.json'));
    expect(openApiRes.status).toBe(200);
    const spec = await readJson<{ openapi: string }>(openApiRes);
    expect(spec.openapi).toBe('3.1.0');
  });

  it('executes full auth lifecycle: register, duplicate reject, login, refresh rotation & reuse detection, logout', async () => {
    const email = `int-auth-${runSuffix}@example.dev`;
    createdEmails.push(email);

    // 1. Register
    const regRes = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: {
          email,
          password: 'Secure!Password2026',
          fullName: 'Integration Test Engineer',
        },
      }),
    );
    expect(regRes.status).toBe(201);
    const regCookies = extractCookies(regRes);
    expect(regCookies.session).toBeTruthy();
    expect(regCookies.refresh).toBeTruthy();
    expect(regCookies.csrf).toBeTruthy();

    // 2. Duplicate registration rejected with RFC 9457 409
    const dupRes = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: {
          email,
          password: 'Secure!Password2026',
          fullName: 'Duplicate Attempt',
        },
      }),
    );
    expect(dupRes.status).toBe(409);
    expect(dupRes.headers.get('content-type')).toContain('application/problem+json');

    // 3. Invalid login rejected with 401
    const badLoginRes = await loginPost(
      buildRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'Wrong!Password2026' },
      }),
    );
    expect(badLoginRes.status).toBe(401);

    // 4. Valid login issues fresh cookies
    const loginRes = await loginPost(
      buildRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'Secure!Password2026' },
      }),
    );
    expect(loginRes.status).toBe(200);
    const loginCookies = extractCookies(loginRes);

    // 5. GET /auth/me returns profile
    const meRes = await meGet(buildRequest('/api/v1/auth/me', { jar: loginCookies }));
    expect(meRes.status).toBe(200);
    const meBody = await readJson<Envelope<{ user: { email: string } }>>(meRes);
    expect(meBody.data.user.email).toBe(email);

    // 6. Refresh token rotation
    const refreshRes = await refreshPost(
      buildRequest('/api/v1/auth/refresh', { method: 'POST', jar: loginCookies }),
    );
    expect(refreshRes.status).toBe(200);
    const rotatedCookies = extractCookies(refreshRes);
    expect(rotatedCookies.refresh).not.toBe(loginCookies.refresh);
    expect(rotatedCookies.session).not.toBe(loginCookies.session);

    // 7. Reusing old refresh token triggers reuse detection and revokes the session family
    const replayRes = await refreshPost(
      buildRequest('/api/v1/auth/refresh', { method: 'POST', jar: loginCookies }),
    );
    expect(replayRes.status).toBe(401);
    const replayBody = await readJson<{ code: string }>(replayRes);
    expect(replayBody.code).toBe('REFRESH_TOKEN_REUSED');

    // Rotated session should now also be revoked
    const revokedMeRes = await meGet(buildRequest('/api/v1/auth/me', { jar: rotatedCookies }));
    expect(revokedMeRes.status).toBe(401);

    // 8. Re-login and test explicit logout
    const login2Res = await loginPost(
      buildRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password: 'Secure!Password2026' },
      }),
    );
    const login2Cookies = extractCookies(login2Res);
    const logoutRes = await logoutPost(
      buildRequest('/api/v1/auth/logout', { method: 'POST', jar: login2Cookies }),
    );
    expect(logoutRes.status).toBe(200);

    const postLogoutMe = await meGet(buildRequest('/api/v1/auth/me', { jar: login2Cookies }));
    expect(postLogoutMe.status).toBe(401);
  });

  it('manages workspaces, settings, team invitations, repositories, analytics, notifications, and audit logs', async () => {
    const ownerEmail = `int-owner-${runSuffix}@example.dev`;
    const memberEmail = `int-member-${runSuffix}@example.dev`;
    createdEmails.push(ownerEmail, memberEmail);

    const ownerReg = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: ownerEmail, password: 'Owner!Password2026', fullName: 'Workspace Owner' },
      }),
    );
    const ownerJar = extractCookies(ownerReg);
    const ownerBody = await readJson<Envelope<{ user: { id: string } }>>(ownerReg);
    const ownerId = ownerBody.data.user.id;

    // Create second user to add as workspace member
    const memberReg = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: memberEmail, password: 'Member!Password2026', fullName: 'Team Member' },
      }),
    );
    const memberBody = await readJson<Envelope<{ user: { id: string } }>>(memberReg);
    const memberUserId = memberBody.data.user.id;

    // Create workspace
    const wsCreateRes = await workspacesPost(
      buildRequest('/api/v1/workspaces', {
        method: 'POST',
        jar: ownerJar,
        body: {
          name: `Core Platform ${runSuffix}`,
          slug: `core-platform-${runSuffix}`,
          description: 'Integration test workspace',
        },
      }),
    );
    expect(wsCreateRes.status).toBe(201);
    const wsCreated = await readJson<Envelope<{ id: string; roleKey: string }>>(wsCreateRes);
    const workspaceId = wsCreated.data.id;
    createdWorkspaceIds.push(workspaceId);
    expect(wsCreated.data.roleKey).toBe('WORKSPACE_OWNER');

    // List workspaces
    const wsListRes = await workspacesGet(buildRequest('/api/v1/workspaces', { jar: ownerJar }));
    expect(wsListRes.status).toBe(200);
    const wsList = await readJson<Envelope<{ items: Array<{ id: string }> }>>(wsListRes);
    expect(wsList.data.items.some((w) => w.id === workspaceId)).toBe(true);

    // Get and update workspace settings & budget
    const wsDetailRes = await workspaceGet(
      buildRequest(`/api/v1/workspaces/${workspaceId}`, { jar: ownerJar }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
    expect(wsDetailRes.status).toBe(200);

    const wsPatchRes = await workspacePatch(
      buildRequest(`/api/v1/workspaces/${workspaceId}`, {
        method: 'PATCH',
        jar: ownerJar,
        body: {
          description: 'Updated description',
          settings: { requireHumanApproval: true, dataRetentionDays: 120 },
          usageLimits: { monthlyAiBudgetUsd: 35 },
        },
      }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
    expect(wsPatchRes.status).toBe(200);
    const wsPatched = await readJson<
      Envelope<{
        description: string;
        settings: { dataRetentionDays: number };
        usageLimits: { monthlyAiBudgetUsd: number };
      }>
    >(wsPatchRes);
    expect(wsPatched.data.description).toBe('Updated description');
    expect(wsPatched.data.settings.dataRetentionDays).toBe(120);
    expect(wsPatched.data.usageLimits.monthlyAiBudgetUsd).toBe(35);

    // Invite member & verify duplicate rejection
    const inviteRes = await invitationsPost(
      buildRequest(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        jar: ownerJar,
        body: { email: `new-hire-${runSuffix}@example.dev`, roleKey: 'DEVELOPER' },
      }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
    expect(inviteRes.status).toBe(201);

    const dupInviteRes = await invitationsPost(
      buildRequest(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: 'POST',
        jar: ownerJar,
        body: { email: `new-hire-${runSuffix}@example.dev`, roleKey: 'DEVELOPER' },
      }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
    expect(dupInviteRes.status).toBe(409);

    // Add second member directly in DB to verify role updates + last-owner safeguard
    const prisma = getPrisma();
    const addedMembership = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: memberUserId,
        roleKey: 'VIEWER',
        status: 'ACTIVE',
      },
    });

    const membersRes = await membersGet(
      buildRequest(`/api/v1/workspaces/${workspaceId}/members`, { jar: ownerJar }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
    expect(membersRes.status).toBe(200);
    const membersBody = await readJson<
      Envelope<{
        members: Array<{ id: string; userId: string }>;
        pendingInvitations: Array<{ id: string }>;
      }>
    >(membersRes);
    expect(membersBody.data.members).toHaveLength(2);
    expect(membersBody.data.pendingInvitations).toHaveLength(1);

    // Promote viewer to developer
    const promoteRes = await memberPatch(
      buildRequest(`/api/v1/workspaces/${workspaceId}/members/${addedMembership.id}`, {
        method: 'PATCH',
        jar: ownerJar,
        body: { roleKey: 'DEVELOPER' },
      }),
      { params: Promise.resolve({ id: workspaceId, memberId: addedMembership.id }) },
    );
    expect(promoteRes.status).toBe(200);
    const promoted = await readJson<Envelope<{ roleKey: string }>>(promoteRes);
    expect(promoted.data.roleKey).toBe('DEVELOPER');

    // Protect last active Workspace Owner from self-demotion
    const ownerMembership = membersBody.data.members.find((m) => m.userId === ownerId);
    expect(ownerMembership).toBeDefined();
    const demoteLastOwnerRes = await memberPatch(
      buildRequest(`/api/v1/workspaces/${workspaceId}/members/${ownerMembership!.id}`, {
        method: 'PATCH',
        jar: ownerJar,
        body: { roleKey: 'DEVELOPER' },
      }),
      { params: Promise.resolve({ id: workspaceId, memberId: ownerMembership!.id }) },
    );
    expect(demoteLastOwnerRes.status).toBe(400);

    // Seed two synthetic repositories into this workspace and test cursor pagination + detail
    const repo1 = await prisma.repository.create({
      data: {
        workspaceId,
        githubRepoId: BigInt(Math.floor(Math.random() * 1_000_000_000) + 10_000),
        ownerLogin: 'acme-test',
        name: 'alpha-service',
        fullName: 'acme-test/alpha-service',
        defaultBranch: 'main',
        visibility: 'PRIVATE',
        primaryLanguage: 'TypeScript',
      },
    });
    await prisma.repositoryBranch.create({
      data: {
        workspaceId,
        repositoryId: repo1.id,
        name: 'main',
        headSha: '1111111111111111111111111111111111111111',
        isDefault: true,
        isProtected: true,
      },
    });
    await prisma.repositoryCommit.create({
      data: {
        workspaceId,
        repositoryId: repo1.id,
        sha: '1111111111111111111111111111111111111111',
        messageHeadline: 'feat: initial foundation commit',
        authorName: 'Workspace Owner',
        committedAt: new Date(),
      },
    });
    await prisma.repository.create({
      data: {
        workspaceId,
        githubRepoId: BigInt(Math.floor(Math.random() * 1_000_000_000) + 20_000),
        ownerLogin: 'acme-test',
        name: 'beta-worker',
        fullName: 'acme-test/beta-worker',
        defaultBranch: 'main',
        visibility: 'INTERNAL',
        primaryLanguage: 'Go',
      },
    });

    const page1Res = await repositoriesGet(
      buildRequest('/api/v1/repositories?limit=1', { jar: ownerJar, workspaceId }),
    );
    expect(page1Res.status).toBe(200);
    const page1 = await readJson<Envelope<{ items: Array<{ id: string }> }>>(page1Res);
    expect(page1.data.items).toHaveLength(1);
    expect(page1.meta.pagination?.hasMore).toBe(true);

    const page2Res = await repositoriesGet(
      buildRequest(
        `/api/v1/repositories?limit=1&cursor=${encodeURIComponent(page1.meta.pagination!.nextCursor!)}`,
        { jar: ownerJar, workspaceId },
      ),
    );
    expect(page2Res.status).toBe(200);
    const page2 = await readJson<Envelope<{ items: Array<{ id: string }> }>>(page2Res);
    expect(page2.data.items).toHaveLength(1);
    expect(page2.data.items[0]!.id).not.toBe(page1.data.items[0]!.id);

    const repoDetailRes = await repositoryGet(
      buildRequest(`/api/v1/repositories/${repo1.id}`, { jar: ownerJar, workspaceId }),
      { params: Promise.resolve({ id: repo1.id }) },
    );
    expect(repoDetailRes.status).toBe(200);
    const repoDetail =
      await readJson<Envelope<{ branches: unknown[]; recentCommits: unknown[] }>>(repoDetailRes);
    expect(repoDetail.data.branches).toHaveLength(1);
    expect(repoDetail.data.recentCommits).toHaveLength(1);

    // Real analytics overview
    const analyticsRes = await analyticsOverviewGet(
      buildRequest('/api/v1/analytics/overview', { jar: ownerJar, workspaceId }),
    );
    expect(analyticsRes.status).toBe(200);
    const analytics = await readJson<
      Envelope<{
        summary: {
          connectedRepositories: number;
          activeMembers: number;
          pendingInvitations: number;
        };
      }>
    >(analyticsRes);
    expect(analytics.data.summary.connectedRepositories).toBe(2);
    expect(analytics.data.summary.activeMembers).toBe(2);
    expect(analytics.data.summary.pendingInvitations).toBe(1);

    // Notifications list & mark as read
    const notifRes = await notificationsGet(
      buildRequest('/api/v1/notifications', { jar: ownerJar, workspaceId }),
    );
    expect(notifRes.status).toBe(200);
    const notifBody =
      await readJson<Envelope<{ items: Array<{ id: string }>; unreadCount: number }>>(notifRes);
    expect(notifBody.data.items.length).toBeGreaterThanOrEqual(1);
    expect(notifBody.data.unreadCount).toBeGreaterThanOrEqual(1);

    const firstNotifId = notifBody.data.items[0]!.id;
    const markReadRes = await notificationPatch(
      buildRequest(`/api/v1/notifications/${firstNotifId}`, {
        method: 'PATCH',
        jar: ownerJar,
        workspaceId,
      }),
      { params: Promise.resolve({ id: firstNotifId }) },
    );
    expect(markReadRes.status).toBe(200);
    const markedNotif = await readJson<Envelope<{ readAt: string | null }>>(markReadRes);
    expect(markedNotif.data.readAt).toBeTruthy();

    // Audit logs
    const auditRes = await auditLogsGet(
      buildRequest('/api/v1/audit-logs?limit=10', { jar: ownerJar, workspaceId }),
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await readJson<Envelope<{ items: Array<{ action: string }> }>>(auditRes);
    expect(auditBody.data.items.some((e) => e.action === 'workspace.created')).toBe(true);
  });
});
