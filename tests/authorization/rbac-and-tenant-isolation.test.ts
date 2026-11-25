import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, disconnectPrisma } from '@/shared/database/prisma';
import { clearRateLimitsForTesting } from '@/shared/security/rate-limit';
import { buildRequest, extractCookies, readJson, type CookieJar } from '../helpers/http';

import { POST as registerPost } from '@/app/api/v1/auth/register/route';
import { POST as workspacesPost } from '@/app/api/v1/workspaces/route';
import { GET as workspaceGet, PATCH as workspacePatch } from '@/app/api/v1/workspaces/[id]/route';
import { POST as invitationsPost } from '@/app/api/v1/workspaces/[id]/invitations/route';
import { PATCH as memberPatch } from '@/app/api/v1/workspaces/[id]/members/[memberId]/route';
import { GET as repositoriesGet } from '@/app/api/v1/repositories/route';
import { GET as repositoryGet } from '@/app/api/v1/repositories/[id]/route';
import { GET as analyticsOverviewGet } from '@/app/api/v1/analytics/overview/route';
import { GET as notificationsGet } from '@/app/api/v1/notifications/route';
import { GET as auditLogsGet } from '@/app/api/v1/audit-logs/route';

describe('Authorization, RBAC, CSRF & Multi-Tenant Isolation', () => {
  const runSuffix = crypto.randomBytes(4).toString('hex');
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  let tenantAOwnerJar: CookieJar;
  let tenantADevJar: CookieJar;
  let tenantAViewerJar: CookieJar;
  let tenantBOwnerJar: CookieJar;
  let platformAdminJar: CookieJar;

  let workspaceAId: string;
  let workspaceBId: string;
  let repoAId: string;
  let repoBId: string;
  let devMembershipId: string;

  async function registerUserForTest(prefix: string, isPlatformAdmin = false) {
    const email = `authz-${prefix}-${runSuffix}@example.dev`;
    createdEmails.push(email);
    const res = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: {
          email,
          password: 'Authz!Password2026',
          fullName: `Authz ${prefix}`,
        },
      }),
    );
    expect(res.status).toBe(201);
    const jar = extractCookies(res);
    const body = await readJson<{ data: { user: { id: string } } }>(res);
    const userId = body.data.user.id;

    if (isPlatformAdmin) {
      await getPrisma().user.update({
        where: { id: userId },
        data: { isPlatformAdmin: true },
      });
    }

    return { userId, jar, email };
  }

  beforeAll(async () => {
    clearRateLimitsForTesting();
    const prisma = getPrisma();

    const ownerA = await registerUserForTest('owner-a');
    const devA = await registerUserForTest('dev-a');
    const viewerA = await registerUserForTest('viewer-a');
    const ownerB = await registerUserForTest('owner-b');
    const platformAdmin = await registerUserForTest('platform-admin', true);

    tenantAOwnerJar = ownerA.jar;
    tenantADevJar = devA.jar;
    tenantAViewerJar = viewerA.jar;
    tenantBOwnerJar = ownerB.jar;
    platformAdminJar = platformAdmin.jar;

    // Create Workspace A & Workspace B
    const wsARes = await workspacesPost(
      buildRequest('/api/v1/workspaces', {
        method: 'POST',
        jar: tenantAOwnerJar,
        body: { name: `Tenant A ${runSuffix}`, slug: `tenant-a-${runSuffix}` },
      }),
    );
    expect(wsARes.status).toBe(201);
    workspaceAId = (await readJson<{ data: { id: string } }>(wsARes)).data.id;
    createdWorkspaceIds.push(workspaceAId);

    const wsBRes = await workspacesPost(
      buildRequest('/api/v1/workspaces', {
        method: 'POST',
        jar: tenantBOwnerJar,
        body: { name: `Tenant B ${runSuffix}`, slug: `tenant-b-${runSuffix}` },
      }),
    );
    expect(wsBRes.status).toBe(201);
    workspaceBId = (await readJson<{ data: { id: string } }>(wsBRes)).data.id;
    createdWorkspaceIds.push(workspaceBId);

    // Add Developer and Viewer memberships to Workspace A
    const devMembership = await prisma.workspaceMember.create({
      data: {
        workspaceId: workspaceAId,
        userId: devA.userId,
        roleKey: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });
    devMembershipId = devMembership.id;

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspaceAId,
        userId: viewerA.userId,
        roleKey: 'VIEWER',
        status: 'ACTIVE',
      },
    });

    // Seed private repositories into Workspace A and Workspace B
    const repoA = await prisma.repository.create({
      data: {
        workspaceId: workspaceAId,
        githubRepoId: BigInt(Math.floor(Math.random() * 1_000_000_000) + 100_000),
        ownerLogin: 'tenant-a-org',
        name: 'tenant-a-private-core',
        fullName: 'tenant-a-org/tenant-a-private-core',
        visibility: 'PRIVATE',
        primaryLanguage: 'TypeScript',
      },
    });
    repoAId = repoA.id;

    const repoB = await prisma.repository.create({
      data: {
        workspaceId: workspaceBId,
        githubRepoId: BigInt(Math.floor(Math.random() * 1_000_000_000) + 200_000),
        ownerLogin: 'tenant-b-org',
        name: 'tenant-b-secret-algo',
        fullName: 'tenant-b-org/tenant-b-secret-algo',
        visibility: 'PRIVATE',
        primaryLanguage: 'Rust',
      },
    });
    repoBId = repoB.id;
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

  it('rejects all cross-tenant reads and writes between Tenant A and Tenant B', async () => {
    // Tenant A owner attempting to read or mutate Tenant B workspace
    const getWsB = await workspaceGet(
      buildRequest(`/api/v1/workspaces/${workspaceBId}`, { jar: tenantAOwnerJar }),
      { params: Promise.resolve({ id: workspaceBId }) },
    );
    expect(getWsB.status).toBe(403);

    const patchWsB = await workspacePatch(
      buildRequest(`/api/v1/workspaces/${workspaceBId}`, {
        method: 'PATCH',
        jar: tenantAOwnerJar,
        body: { name: 'Hijacked Tenant B' },
      }),
      { params: Promise.resolve({ id: workspaceBId }) },
    );
    expect(patchWsB.status).toBe(403);

    // Tenant A owner attempting to list Tenant B repositories, analytics, notifications, or audit logs
    expect(
      (
        await repositoriesGet(
          buildRequest('/api/v1/repositories', { jar: tenantAOwnerJar, workspaceId: workspaceBId }),
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await analyticsOverviewGet(
          buildRequest('/api/v1/analytics/overview', {
            jar: tenantAOwnerJar,
            workspaceId: workspaceBId,
          }),
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await notificationsGet(
          buildRequest('/api/v1/notifications', {
            jar: tenantAOwnerJar,
            workspaceId: workspaceBId,
          }),
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await auditLogsGet(
          buildRequest('/api/v1/audit-logs', { jar: tenantAOwnerJar, workspaceId: workspaceBId }),
        )
      ).status,
    ).toBe(403);

    // Broken Object-Level Authorization (BOLA): Tenant A owner passing own workspaceId but Tenant B repoId
    const bolaRepoRes = await repositoryGet(
      buildRequest(`/api/v1/repositories/${repoBId}`, {
        jar: tenantAOwnerJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: repoBId }) },
    );
    expect(bolaRepoRes.status).toBe(404);
  });

  it('enforces Platform Administrator boundary: no automatic access to private tenant repositories', async () => {
    const adminWsRes = await workspaceGet(
      buildRequest(`/api/v1/workspaces/${workspaceAId}`, { jar: platformAdminJar }),
      { params: Promise.resolve({ id: workspaceAId }) },
    );
    expect(adminWsRes.status).toBe(403);

    const adminReposRes = await repositoriesGet(
      buildRequest('/api/v1/repositories', { jar: platformAdminJar, workspaceId: workspaceAId }),
    );
    expect(adminReposRes.status).toBe(403);

    const adminRepoDetailRes = await repositoryGet(
      buildRequest(`/api/v1/repositories/${repoAId}`, {
        jar: platformAdminJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(adminRepoDetailRes.status).toBe(403);
  });

  it('enforces workspace RBAC boundaries for VIEWER and DEVELOPER roles', async () => {
    // VIEWER can read repositories & analytics
    expect(
      (
        await repositoriesGet(
          buildRequest('/api/v1/repositories', {
            jar: tenantAViewerJar,
            workspaceId: workspaceAId,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await analyticsOverviewGet(
          buildRequest('/api/v1/analytics/overview', {
            jar: tenantAViewerJar,
            workspaceId: workspaceAId,
          }),
        )
      ).status,
    ).toBe(200);

    // VIEWER & DEVELOPER cannot update workspace settings, invite members, modify roles, or view workspace audit logs
    for (const restrictedJar of [tenantAViewerJar, tenantADevJar]) {
      expect(
        (
          await workspacePatch(
            buildRequest(`/api/v1/workspaces/${workspaceAId}`, {
              method: 'PATCH',
              jar: restrictedJar,
              body: { name: 'Unauthorized Rename' },
            }),
            { params: Promise.resolve({ id: workspaceAId }) },
          )
        ).status,
      ).toBe(403);

      expect(
        (
          await invitationsPost(
            buildRequest(`/api/v1/workspaces/${workspaceAId}/invitations`, {
              method: 'POST',
              jar: restrictedJar,
              body: { email: 'sneaky@example.dev', roleKey: 'WORKSPACE_OWNER' },
            }),
            { params: Promise.resolve({ id: workspaceAId }) },
          )
        ).status,
      ).toBe(403);

      expect(
        (
          await memberPatch(
            buildRequest(`/api/v1/workspaces/${workspaceAId}/members/${devMembershipId}`, {
              method: 'PATCH',
              jar: restrictedJar,
              body: { roleKey: 'WORKSPACE_OWNER' },
            }),
            { params: Promise.resolve({ id: workspaceAId, memberId: devMembershipId }) },
          )
        ).status,
      ).toBe(403);

      expect(
        (
          await auditLogsGet(
            buildRequest('/api/v1/audit-logs', { jar: restrictedJar, workspaceId: workspaceAId }),
          )
        ).status,
      ).toBe(403);
    }
  });

  it('enforces CSRF protection on authenticated mutating endpoints', async () => {
    const missingCsrf = await workspacePatch(
      buildRequest(`/api/v1/workspaces/${workspaceAId}`, {
        method: 'PATCH',
        jar: tenantAOwnerJar,
        csrfOverride: null,
        body: { description: 'Missing CSRF token' },
      }),
      { params: Promise.resolve({ id: workspaceAId }) },
    );
    expect(missingCsrf.status).toBe(403);

    const wrongCsrf = await workspacePatch(
      buildRequest(`/api/v1/workspaces/${workspaceAId}`, {
        method: 'PATCH',
        jar: tenantAOwnerJar,
        csrfOverride: 'invalid-csrf-token-value-123456',
        body: { description: 'Forged CSRF token' },
      }),
      { params: Promise.resolve({ id: workspaceAId }) },
    );
    expect(wrongCsrf.status).toBe(403);

    const untrustedOrigin = await workspacePatch(
      buildRequest(`/api/v1/workspaces/${workspaceAId}`, {
        method: 'PATCH',
        jar: tenantAOwnerJar,
        origin: 'https://malicious-site.example',
        body: { description: 'Untrusted origin' },
      }),
      { params: Promise.resolve({ id: workspaceAId }) },
    );
    expect(untrustedOrigin.status).toBe(403);
  });
});
