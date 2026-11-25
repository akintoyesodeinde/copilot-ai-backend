import fs from 'node:fs';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/shared/security/password';
import {
  PERMISSION_DEFINITIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
} from '../src/modules/authorization/domain/rbac';
import { PR_REVIEW_PROMPT_V1 } from '../src/modules/ai/domain/prompt-registry';

if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const databaseUrl =
  process.env.DATABASE_URL ??
  'mysql://codepilot:codepilot_dev_password@127.0.0.1:3306/codepilot_ai';

function createPrismaClient(url: string): PrismaClient {
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get('ssl-mode')?.toLowerCase();
  const useTls = sslMode === 'required' || sslMode === 'verify_ca' || sslMode === 'verify_identity';
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    connectionLimit: 5,
    allowPublicKeyRetrieval: !useTls,
    ssl: useTls ? { rejectUnauthorized: sslMode === 'verify_identity' } : undefined,
  });
  return new PrismaClient({ adapter });
}

async function seed() {
  const prisma = createPrismaClient(databaseUrl);

  try {
    // 1. Seed system permissions and roles
    for (const perm of PERMISSION_DEFINITIONS) {
      await prisma.permission.upsert({
        where: { key: perm.key },
        update: { description: perm.description },
        create: perm,
      });
    }

    const permissions = await prisma.permission.findMany();
    const permMap = new Map(permissions.map((p) => [p.key, p.id]));

    for (const roleDef of ROLE_DEFINITIONS) {
      const role = await prisma.role.upsert({
        where: { key: roleDef.key },
        update: { name: roleDef.name, description: roleDef.description },
        create: {
          key: roleDef.key,
          name: roleDef.name,
          scope: roleDef.scope,
          description: roleDef.description,
          isSystem: true,
        },
      });

      for (const permKey of roleDef.permissions) {
        const permissionId = permMap.get(permKey);
        if (permissionId) {
          await prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId } },
            update: {},
            create: { roleId: role.id, permissionId },
          });
        }
      }
    }

    // 2. Seed synthetic development accounts (local development & testing only)
    const devPasswordHash = await hashPassword('CodePilot!Dev2026');

    const owner = await prisma.user.upsert({
      where: { email: 'owner@acme-synthetic.dev' },
      update: {},
      create: {
        email: 'owner@acme-synthetic.dev',
        passwordHash: devPasswordHash,
        fullName: 'Adaeze Okonkwo (Synthetic Owner)',
        isPlatformAdmin: false,
      },
    });

    const developer = await prisma.user.upsert({
      where: { email: 'dev@acme-synthetic.dev' },
      update: {},
      create: {
        email: 'dev@acme-synthetic.dev',
        passwordHash: devPasswordHash,
        fullName: 'Daniel Mensah (Synthetic Dev)',
        isPlatformAdmin: false,
      },
    });

    const viewer = await prisma.user.upsert({
      where: { email: 'viewer@acme-synthetic.dev' },
      update: {},
      create: {
        email: 'viewer@acme-synthetic.dev',
        passwordHash: devPasswordHash,
        fullName: 'Elena Vance (Synthetic Viewer)',
        isPlatformAdmin: false,
      },
    });

    const platformAdmin = await prisma.user.upsert({
      where: { email: 'admin@codepilot-platform.dev' },
      update: {},
      create: {
        email: 'admin@codepilot-platform.dev',
        passwordHash: devPasswordHash,
        fullName: 'Platform Operations Admin',
        isPlatformAdmin: true,
      },
    });

    // 3. Seed primary synthetic workspace ("Acme Cloud Engineering")
    const acmeWorkspace = await prisma.workspace.upsert({
      where: { slug: 'acme-cloud-engineering' },
      update: {},
      create: {
        name: 'Acme Cloud Engineering',
        slug: 'acme-cloud-engineering',
        description: 'Synthetic development workspace for CodePilot AI Phase 1 verification',
        planTier: 'SANDBOX',
        createdByUserId: owner.id,
      },
    });

    await prisma.workspaceSetting.upsert({
      where: { workspaceId: acmeWorkspace.id },
      update: {},
      create: {
        workspaceId: acmeWorkspace.id,
        defaultAiProvider: 'mock',
        allowedAiProvidersJson: ['mock'],
        requireHumanApproval: true,
        autoReviewEnabled: false,
        dataRetentionDays: 90,
      },
    });

    await prisma.usageLimit.upsert({
      where: { workspaceId: acmeWorkspace.id },
      update: {},
      create: {
        workspaceId: acmeWorkspace.id,
        monthlyAiBudgetUsd: 25,
        maxMonthlyTokens: 2_000_000,
        maxRepositories: 25,
        maxMembers: 25,
      },
    });

    for (const [userId, roleKey] of [
      [owner.id, ROLE_KEYS.WORKSPACE_OWNER],
      [developer.id, ROLE_KEYS.DEVELOPER],
      [viewer.id, ROLE_KEYS.VIEWER],
    ] as const) {
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: acmeWorkspace.id, userId } },
        update: { roleKey, status: 'ACTIVE' },
        create: {
          workspaceId: acmeWorkspace.id,
          userId,
          roleKey,
          status: 'ACTIVE',
        },
      });
    }

    // 4. Seed synthetic GitHub installation, repositories, branches, and commits
    const installation = await prisma.githubInstallation.upsert({
      where: { githubInstallationId: BigInt(90000101) },
      update: {},
      create: {
        workspaceId: acmeWorkspace.id,
        githubInstallationId: BigInt(90000101),
        accountLogin: 'acme-synthetic-org',
        accountType: 'Organization',
        targetType: 'Organization',
        status: 'ACTIVE',
        permissionsJson: {
          contents: 'read',
          metadata: 'read',
          pull_requests: 'write',
          checks: 'write',
        },
        installedByUserId: owner.id,
      },
    });

    const syntheticRepos = [
      {
        githubRepoId: BigInt(910001),
        name: 'payments-ledger-service',
        fullName: 'acme-synthetic-org/payments-ledger-service',
        description: 'Synthetic TypeScript payments ledger microservice for code review testing',
        defaultBranch: 'main',
        visibility: 'PRIVATE' as const,
        primaryLanguage: 'TypeScript',
        commits: [
          {
            sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601',
            messageHeadline: 'feat: enforce idempotency keys on ledger transfer entries',
            authorName: 'Daniel Mensah',
            authorEmail: 'dev@acme-synthetic.dev',
            hoursAgo: 2,
          },
          {
            sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345602',
            messageHeadline: 'test: add currency rounding precision unit coverage',
            authorName: 'Adaeze Okonkwo',
            authorEmail: 'owner@acme-synthetic.dev',
            hoursAgo: 16,
          },
        ],
      },
      {
        githubRepoId: BigInt(910002),
        name: 'identity-gateway-api',
        fullName: 'acme-synthetic-org/identity-gateway-api',
        description: 'Synthetic OAuth2/OIDC gateway and token validation edge service',
        defaultBranch: 'main',
        visibility: 'PRIVATE' as const,
        primaryLanguage: 'Go',
        commits: [
          {
            sha: 'b1c2d3e4f5a60718293a4b5c6d7e8f9012345601',
            messageHeadline: 'security: enforce strict JWT audience verification on token exchange',
            authorName: 'Daniel Mensah',
            authorEmail: 'dev@acme-synthetic.dev',
            hoursAgo: 5,
          },
        ],
      },
      {
        githubRepoId: BigInt(910003),
        name: 'ml-inference-worker',
        fullName: 'acme-synthetic-org/ml-inference-worker',
        description: 'Synthetic Python asynchronous batch scoring worker',
        defaultBranch: 'main',
        visibility: 'INTERNAL' as const,
        primaryLanguage: 'Python',
        commits: [
          {
            sha: 'c1d2e3f4a5b60718293a4b5c6d7e8f9012345601',
            messageHeadline: 'chore: pin pydantic schema validation for inference batches',
            authorName: 'Adaeze Okonkwo',
            authorEmail: 'owner@acme-synthetic.dev',
            hoursAgo: 28,
          },
        ],
      },
    ];

    for (const r of syntheticRepos) {
      const repo = await prisma.repository.upsert({
        where: {
          workspaceId_githubRepoId: {
            workspaceId: acmeWorkspace.id,
            githubRepoId: r.githubRepoId,
          },
        },
        update: {},
        create: {
          workspaceId: acmeWorkspace.id,
          githubInstallationId: installation.id,
          githubRepoId: r.githubRepoId,
          ownerLogin: 'acme-synthetic-org',
          name: r.name,
          fullName: r.fullName,
          description: r.description,
          defaultBranch: r.defaultBranch,
          visibility: r.visibility,
          primaryLanguage: r.primaryLanguage,
          isActive: true,
          lastSyncedAt: new Date(),
        },
      });

      const latestCommit = r.commits[0];
      if (latestCommit) {
        await prisma.repositoryBranch.upsert({
          where: {
            workspaceId_repositoryId_name: {
              workspaceId: acmeWorkspace.id,
              repositoryId: repo.id,
              name: r.defaultBranch,
            },
          },
          update: { headSha: latestCommit.sha },
          create: {
            workspaceId: acmeWorkspace.id,
            repositoryId: repo.id,
            name: r.defaultBranch,
            headSha: latestCommit.sha,
            isDefault: true,
            isProtected: true,
            lastCommitAt: new Date(Date.now() - latestCommit.hoursAgo * 3600 * 1000),
          },
        });
      }

      for (const c of r.commits) {
        await prisma.repositoryCommit.upsert({
          where: {
            workspaceId_repositoryId_sha: {
              workspaceId: acmeWorkspace.id,
              repositoryId: repo.id,
              sha: c.sha,
            },
          },
          update: {},
          create: {
            workspaceId: acmeWorkspace.id,
            repositoryId: repo.id,
            sha: c.sha,
            messageHeadline: c.messageHeadline,
            authorName: c.authorName,
            authorEmail: c.authorEmail,
            committedAt: new Date(Date.now() - c.hoursAgo * 3600 * 1000),
          },
        });
      }
    }

    // 5. Seed versioned AI prompt registry & synthetic open pull request for Phase 2 workflows
    await prisma.promptVersion.upsert({
      where: {
        promptKey_version: {
          promptKey: PR_REVIEW_PROMPT_V1.promptKey,
          version: PR_REVIEW_PROMPT_V1.version,
        },
      },
      update: {
        systemPrompt: PR_REVIEW_PROMPT_V1.systemPrompt,
        userTemplate: PR_REVIEW_PROMPT_V1.userTemplate,
        outputSchemaName: PR_REVIEW_PROMPT_V1.outputSchemaName,
        isActive: true,
      },
      create: {
        promptKey: PR_REVIEW_PROMPT_V1.promptKey,
        version: PR_REVIEW_PROMPT_V1.version,
        purpose: PR_REVIEW_PROMPT_V1.purpose,
        systemPrompt: PR_REVIEW_PROMPT_V1.systemPrompt,
        userTemplate: PR_REVIEW_PROMPT_V1.userTemplate,
        outputSchemaName: PR_REVIEW_PROMPT_V1.outputSchemaName,
        isActive: true,
      },
    });

    const ledgerRepo = await prisma.repository.findUnique({
      where: {
        workspaceId_githubRepoId: {
          workspaceId: acmeWorkspace.id,
          githubRepoId: BigInt(910001),
        },
      },
    });

    if (ledgerRepo) {
      const seededPr = await prisma.pullRequest.upsert({
        where: {
          workspaceId_repositoryId_prNumber: {
            workspaceId: acmeWorkspace.id,
            repositoryId: ledgerRepo.id,
            prNumber: 42,
          },
        },
        update: {},
        create: {
          workspaceId: acmeWorkspace.id,
          repositoryId: ledgerRepo.id,
          githubPrId: BigInt(550042),
          prNumber: 42,
          title: 'feat: add ledger query helper and dynamic rule evaluator',
          description:
            'Synthetic pull request demonstrating unified diff inspection, automated AI review findings, human approval gates, and GitHub publishing.',
          state: 'OPEN',
          authorLogin: 'dmensah',
          baseBranch: 'main',
          headBranch: 'feat/ledger-dynamic-rules',
          baseSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601',
          headSha: 'f9e8d7c6b5a40312293a4b5c6d7e8f9012345699',
          isDraft: false,
          additions: 10,
          deletions: 0,
          changedFilesCount: 1,
          htmlUrl: 'https://github.com/acme-synthetic-org/payments-ledger-service/pull/42',
        },
      });

      await prisma.pullRequestFile.upsert({
        where: {
          workspaceId_pullRequestId_headSha_filePath: {
            workspaceId: acmeWorkspace.id,
            pullRequestId: seededPr.id,
            headSha: seededPr.headSha,
            filePath: 'src/ledger/query-helper.ts',
          },
        },
        update: {},
        create: {
          workspaceId: acmeWorkspace.id,
          pullRequestId: seededPr.id,
          headSha: seededPr.headSha,
          filePath: 'src/ledger/query-helper.ts',
          status: 'ADDED',
          additions: 10,
          deletions: 0,
          patch: [
            '@@ -0,0 +1,10 @@',
            '+export function findLedgerByAccount(db: { query: (sql: string) => unknown }, accountId: string) {',
            '+  const sql = `SELECT * FROM ledger_entries WHERE account_id = "${accountId}"`;',
            '+  return db.query(sql);',
            '+}',
            '+',
            '+export function evaluateFeeRule(ruleExpr: string): number {',
            '+  // Dynamic evaluation for synthetic review demonstration',
            '+  return Number(eval(ruleExpr));',
            '+}',
          ].join('\n'),
        },
      });
    }

    // 6. Seed initial notification & audit event if none exist yet
    const existingNotifCount = await prisma.notification.count({
      where: { workspaceId: acmeWorkspace.id },
    });
    if (existingNotifCount === 0) {
      await prisma.notification.createMany({
        data: [
          {
            workspaceId: acmeWorkspace.id,
            userId: owner.id,
            type: 'workspace.ready',
            severity: 'INFO',
            title: 'Synthetic Development Workspace Initialized',
            body: 'Acme Cloud Engineering is seeded with 3 synthetic repositories for Phase 1 dashboard verification.',
            linkPath: '/repositories',
          },
          {
            workspaceId: acmeWorkspace.id,
            userId: owner.id,
            type: 'security.policy',
            severity: 'WARNING',
            title: 'Human Approval Required for AI Review Publishing',
            body: 'Workspace policy enforces explicit engineer approval before publishing AI review comments to GitHub.',
            linkPath: '/settings',
          },
        ],
      });
    }

    const existingAuditCount = await prisma.auditLog.count({
      where: { workspaceId: acmeWorkspace.id },
    });
    if (existingAuditCount === 0) {
      await prisma.auditLog.create({
        data: {
          workspaceId: acmeWorkspace.id,
          actorUserId: owner.id,
          action: 'workspace.seeded',
          resourceType: 'workspace',
          resourceId: acmeWorkspace.id,
          outcome: 'SUCCESS',
          correlationId: 'seed-initial-0001',
          metadataJson: {
            synthetic: true,
            repositoriesSeeded: syntheticRepos.length,
            platformAdminId: platformAdmin.id,
          },
        },
      });
    }

    console.log('Seed completed cleanly for CodePilot AI Phases 1 & 2.');
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error) => {
  console.error('Database seed failed:', error);
  process.exit(1);
});
