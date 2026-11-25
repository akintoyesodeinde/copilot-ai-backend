import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, disconnectPrisma } from '@/shared/database/prisma';
import { clearRateLimitsForTesting } from '@/shared/security/rate-limit';
import { fixtureGithubGateway } from '@/modules/github/infrastructure/github-client';
import {
  inMemoryJobQueue,
  setJobQueueTransportForTesting,
} from '@/modules/jobs/infrastructure/sqs-queue';
import { runWorkerTick } from '@/modules/jobs/application/worker-engine';
import { runAllDeterministicSecurityScanners } from '@/modules/security/domain/scanners';
import { analyzeArchitectureGraph } from '@/modules/architecture/domain/graph-analyzer';
import { validateSourceSyntaxWithTreeSitter } from '@/modules/indexing/infrastructure/ast-parser';

import { POST as registerPost } from '@/app/api/v1/auth/register/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as workspacesPost } from '@/app/api/v1/workspaces/route';
import { GET as githubInstallGet } from '@/app/api/v1/github/install/route';
import { GET as githubCallbackGet } from '@/app/api/v1/github/callback/route';
import {
  GET as repoSecurityScansGet,
  POST as repoSecurityScansPost,
} from '@/app/api/v1/repositories/[id]/security-scans/route';
import { GET as vulnerabilitiesGet } from '@/app/api/v1/security/vulnerabilities/route';
import {
  GET as vulnerabilityDetailGet,
  PATCH as vulnerabilityPatch,
} from '@/app/api/v1/security/vulnerabilities/[id]/route';
import { POST as riskAcceptancePost } from '@/app/api/v1/security/vulnerabilities/[id]/risk-acceptance/route';
import { POST as archScansPost } from '@/app/api/v1/repositories/[id]/architecture-scans/route';
import { GET as archGraphGet } from '@/app/api/v1/repositories/[id]/architecture/graph/route';
import { GET as archViolationsGet } from '@/app/api/v1/repositories/[id]/architecture/violations/route';
import {
  GET as conversationsGet,
  POST as conversationsPost,
} from '@/app/api/v1/ai/conversations/route';
import { GET as conversationDetailGet } from '@/app/api/v1/ai/conversations/[id]/route';
import { POST as conversationMessagesPost } from '@/app/api/v1/ai/conversations/[id]/messages/route';
import { GET as conversationEventsGet } from '@/app/api/v1/ai/conversations/[id]/events/route';
import { POST as explainCodePost } from '@/app/api/v1/ai/explain-code/route';
import { POST as suggestRefactoringPost } from '@/app/api/v1/ai/suggest-refactoring/route';
import { POST as testGenPost } from '@/app/api/v1/repositories/[id]/test-generation/route';
import { GET as testGenJobsGet } from '@/app/api/v1/test-generation/jobs/route';
import { GET as testGenJobDetailGet } from '@/app/api/v1/test-generation/jobs/[id]/route';
import { PATCH as generatedTestPatch } from '@/app/api/v1/generated-tests/[id]/route';
import { GET as codeQualityAnalyticsGet } from '@/app/api/v1/analytics/code-quality/route';
import { GET as securityAnalyticsGet } from '@/app/api/v1/analytics/security/route';
import { GET as reviewPerformanceAnalyticsGet } from '@/app/api/v1/analytics/review-performance/route';
import { GET as adminOverviewGet } from '@/app/api/v1/admin/overview/route';
import { buildRequest, extractCookies, readJson, type CookieJar } from '../helpers/http';

interface Envelope<T> {
  data: T;
}

describe('Phase 3 — Security Intelligence, Architecture Explorer, Advisory AI Assistant, Test Studio & Analytics', () => {
  const runSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ownerAEmail = `p3-owner-a-${runSuffix}@test.dev`;
  const devAEmail = `p3-dev-a-${runSuffix}@test.dev`;
  const ownerBEmail = `p3-owner-b-${runSuffix}@test.dev`;
  const platformAdminEmail = `p3-admin-${runSuffix}@test.dev`;
  const password = 'Phase3!StrongPassword2026';

  let ownerAJar: CookieJar = {};
  let devAJar: CookieJar = {};
  let ownerBJar: CookieJar = {};
  let adminJar: CookieJar = {};

  let workspaceAId = '';
  let workspaceBId = '';
  let repoAId = '';

  const createdWorkspaceIds: string[] = [];
  const createdEmails = [ownerAEmail, devAEmail, ownerBEmail, platformAdminEmail];

  beforeAll(async () => {
    clearRateLimitsForTesting();
    setJobQueueTransportForTesting(inMemoryJobQueue);

    // Register Tenant A owner, Tenant A developer, Tenant B owner, and a Platform Admin
    const regA = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: ownerAEmail, password, fullName: 'Phase 3 Owner A' },
      }),
    );
    expect(regA.status).toBe(201);
    ownerAJar = extractCookies(regA);

    const regDev = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: devAEmail, password, fullName: 'Phase 3 Dev A' },
      }),
    );
    expect(regDev.status).toBe(201);
    devAJar = extractCookies(regDev);
    const devUserId = (await readJson<Envelope<{ user: { id: string } }>>(regDev)).data.user.id;

    const regB = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: ownerBEmail, password, fullName: 'Phase 3 Owner B' },
      }),
    );
    expect(regB.status).toBe(201);
    ownerBJar = extractCookies(regB);

    const regAdmin = await registerPost(
      buildRequest('/api/v1/auth/register', {
        method: 'POST',
        body: { email: platformAdminEmail, password, fullName: 'Phase 3 Platform Admin' },
      }),
    );
    expect(regAdmin.status).toBe(201);
    const adminUserId = (await readJson<Envelope<{ user: { id: string } }>>(regAdmin)).data.user.id;
    await getPrisma().user.update({
      where: { id: adminUserId },
      data: { isPlatformAdmin: true },
    });
    const loginAdmin = await loginPost(
      buildRequest('/api/v1/auth/login', {
        method: 'POST',
        body: { email: platformAdminEmail, password },
      }),
    );
    expect(loginAdmin.status).toBe(200);
    adminJar = extractCookies(loginAdmin);

    const wsA = await workspacesPost(
      buildRequest('/api/v1/workspaces', {
        method: 'POST',
        jar: ownerAJar,
        body: { name: `Phase 3 WS A ${runSuffix}`, slug: `p3-ws-a-${runSuffix}` },
      }),
    );
    workspaceAId = (await readJson<Envelope<{ id: string }>>(wsA)).data.id;
    createdWorkspaceIds.push(workspaceAId);

    // Add Dev A to Workspace A with DEVELOPER role
    await getPrisma().workspaceMember.create({
      data: {
        workspaceId: workspaceAId,
        userId: devUserId,
        roleKey: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });

    const wsB = await workspacesPost(
      buildRequest('/api/v1/workspaces', {
        method: 'POST',
        jar: ownerBJar,
        body: { name: `Phase 3 WS B ${runSuffix}`, slug: `p3-ws-b-${runSuffix}` },
      }),
    );
    workspaceBId = (await readJson<Envelope<{ id: string }>>(wsB)).data.id;
    createdWorkspaceIds.push(workspaceBId);

    // Connect fixture GitHub App installation to Workspace A
    const instRes = await githubInstallGet(
      buildRequest('/api/v1/github/install', { jar: ownerAJar, workspaceId: workspaceAId }),
    );
    const instData = (await readJson<Envelope<{ state: string; installUrl: string }>>(instRes))
      .data;
    const ghInstId = new URL(instData.installUrl).searchParams.get('installation_id');
    const cbRes = await githubCallbackGet(
      buildRequest(
        `/api/v1/github/callback?installation_id=${ghInstId}&state=${encodeURIComponent(instData.state)}`,
      ),
    );
    expect(cbRes.status).toBe(201);

    const repo = await getPrisma().repository.findFirstOrThrow({
      where: { workspaceId: workspaceAId, name: 'payments-ledger-service' },
    });
    repoAId = repo.id;
  });

  beforeEach(() => {
    clearRateLimitsForTesting();
    fixtureGithubGateway.resetTestState();
    inMemoryJobQueue.clearForTesting();
    setJobQueueTransportForTesting(inMemoryJobQueue);
  });

  afterAll(async () => {
    const prisma = getPrisma();
    if (createdWorkspaceIds.length > 0) {
      await prisma.repository.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await prisma.githubInstallation.deleteMany({
        where: { workspaceId: { in: createdWorkspaceIds } },
      });
      await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await disconnectPrisma();
  });

  it('verifies deterministic scanners, secret redaction, Tarjan cycle detection, and Tree-sitter test syntax checks', async () => {
    const scan = runAllDeterministicSecurityScanners([
      {
        filePath: 'src/bad.ts',
        language: 'typescript',
        content: `const k = "AKIAIOSFODNN7EXAMPLE";\nexport function q(id: string){ return eval(id); }\n`,
      },
      {
        filePath: 'package.json',
        language: 'json',
        content: `{"dependencies":{"lodash":"4.17.19"}}`,
      },
    ]);

    expect(scan.vulnerabilities.some((v) => v.scanner === 'SEMGREP' && v.cweId === 'CWE-95')).toBe(
      true,
    );
    expect(scan.vulnerabilities.some((v) => v.scanner === 'GITLEAKS')).toBe(true);
    expect(
      scan.vulnerabilities.some((v) => v.scanner === 'OSV_SCANNER' && v.cveId === 'CVE-2021-23337'),
    ).toBe(true);
    // Raw secret MUST NEVER appear in persisted findings
    expect(JSON.stringify(scan.vulnerabilities)).not.toContain('AKIAIOSFODNN7EXAMPLE');

    const arch = analyzeArchitectureGraph(
      [
        { filePath: 'src/domain/a.ts', language: 'typescript', lineCount: 20 },
        { filePath: 'src/infrastructure/b.ts', language: 'typescript', lineCount: 30 },
      ],
      [
        {
          sourceFilePath: 'src/domain/a.ts',
          targetSpecifier: '../infrastructure/b',
          resolvedTargetPath: 'src/infrastructure/b',
          dependencyType: 'import',
        },
        {
          sourceFilePath: 'src/infrastructure/b.ts',
          targetSpecifier: '../domain/a',
          resolvedTargetPath: 'src/domain/a',
          dependencyType: 'import',
        },
      ],
    );
    expect(arch.summary.circularDepsCount).toBe(1);
    expect(arch.violations.some((v) => v.violationType === 'LAYER_BOUNDARY')).toBe(true);

    const validSyntax = await validateSourceSyntaxWithTreeSitter(
      'typescript',
      `import { describe, it, expect } from 'vitest'; describe('ok', () => { it('works', () => { expect(1).toBe(1); }); });`,
    );
    expect(validSyntax.valid).toBe(true);
    expect(validSyntax.engine).toBe('tree-sitter-wasm');

    const brokenSyntax = await validateSourceSyntaxWithTreeSitter(
      'typescript',
      `export function oops( { return ;;;`,
    );
    expect(brokenSyntax.valid).toBe(false);
  });

  it('executes async security scans, enforces secret redaction, triage, owner-only risk acceptance, and tenant/platform-admin boundaries', async () => {
    const triggerRes = await repoSecurityScansPost(
      buildRequest(`/api/v1/repositories/${repoAId}/security-scans`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {},
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(triggerRes.status).toBe(202);

    await runWorkerTick('p3-worker');

    const scansRes = await repoSecurityScansGet(
      buildRequest(`/api/v1/repositories/${repoAId}/security-scans`, {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(scansRes.status).toBe(200);
    const scans = (
      await readJson<Envelope<{ items: Array<{ status: string; findingsCount: number }> }>>(
        scansRes,
      )
    ).data.items;
    expect(scans[0]?.status).toBe('COMPLETED');
    expect(scans[0]?.findingsCount).toBeGreaterThanOrEqual(4);

    const vulnListRes = await vulnerabilitiesGet(
      buildRequest('/api/v1/security/vulnerabilities', {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
    );
    expect(vulnListRes.status).toBe(200);
    const vulns = (
      await readJson<
        Envelope<{
          items: Array<{
            id: string;
            scanner: string;
            source: string;
            redactedSnippet: string | null;
          }>;
        }>
      >(vulnListRes)
    ).data.items;

    expect(vulns.every((v) => v.source === 'DETERMINISTIC')).toBe(true);
    expect(vulns.some((v) => v.scanner === 'SEMGREP')).toBe(true);
    expect(vulns.some((v) => v.scanner === 'GITLEAKS')).toBe(true);
    expect(vulns.some((v) => v.scanner === 'OSV_SCANNER')).toBe(true);
    expect(vulns.some((v) => v.scanner === 'TRIVY')).toBe(true);
    expect(JSON.stringify(vulns)).not.toContain('AKIAIOSFODNN7EXAMPLE');

    const targetVulnId = vulns[0]!.id;

    // Cross-tenant and Platform Admin access to private workspace vulnerabilities rejected (403)
    const crossTenantRes = await vulnerabilityDetailGet(
      buildRequest(`/api/v1/security/vulnerabilities/${targetVulnId}`, {
        jar: ownerBJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: targetVulnId }) },
    );
    expect(crossTenantRes.status).toBe(403);

    const adminCodeRes = await vulnerabilitiesGet(
      buildRequest('/api/v1/security/vulnerabilities', {
        jar: adminJar,
        workspaceId: workspaceAId,
      }),
    );
    expect(adminCodeRes.status).toBe(403);

    // Developer can triage vulnerability
    const triageRes = await vulnerabilityPatch(
      buildRequest(`/api/v1/security/vulnerabilities/${targetVulnId}`, {
        method: 'PATCH',
        jar: devAJar,
        workspaceId: workspaceAId,
        body: { status: 'TRIAGED' },
      }),
      { params: Promise.resolve({ id: targetVulnId }) },
    );
    expect(triageRes.status).toBe(200);

    // Developer CANNOT create formal risk acceptance (requires WORKSPACE_OWNER)
    const futureExpiry = new Date(Date.now() + 30 * 86400_000).toISOString();
    const devRiskRes = await riskAcceptancePost(
      buildRequest(`/api/v1/security/vulnerabilities/${targetVulnId}/risk-acceptance`, {
        method: 'POST',
        jar: devAJar,
        workspaceId: workspaceAId,
        body: {
          reason: 'Synthetic test rationale for risk acceptance check',
          expiresAt: futureExpiry,
        },
      }),
      { params: Promise.resolve({ id: targetVulnId }) },
    );
    expect(devRiskRes.status).toBe(403);

    // Past expiration rejected (400)
    const pastRiskRes = await riskAcceptancePost(
      buildRequest(`/api/v1/security/vulnerabilities/${targetVulnId}/risk-acceptance`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {
          reason: 'Synthetic test rationale for expired acceptance check',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      }),
      { params: Promise.resolve({ id: targetVulnId }) },
    );
    expect(pastRiskRes.status).toBe(400);

    // Workspace Owner succeeds (201)
    const ownerRiskRes = await riskAcceptancePost(
      buildRequest(`/api/v1/security/vulnerabilities/${targetVulnId}/risk-acceptance`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {
          reason:
            'Mitigated behind private VPC boundary while migration to parameterized query completes.',
          mitigatingControls: 'WAF rules + isolated database credentials',
          expiresAt: futureExpiry,
        },
      }),
      { params: Promise.resolve({ id: targetVulnId }) },
    );
    expect(ownerRiskRes.status).toBe(201);
  });

  it('executes architecture scan, detects circular deps and layer violations, and runs repository-aware SSE AI Assistant + Explain/Refactor', async () => {
    // 1. Architecture Scan
    const archTrigger = await archScansPost(
      buildRequest(`/api/v1/repositories/${repoAId}/architecture-scans`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {},
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(archTrigger.status).toBe(202);
    await runWorkerTick('p3-worker');

    const graphRes = await archGraphGet(
      buildRequest(`/api/v1/repositories/${repoAId}/architecture/graph`, {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(graphRes.status).toBe(200);
    const graphData = (
      await readJson<
        Envelope<{
          scan: { circularDepsCount: number; violationsCount: number } | null;
          nodes: Array<{ filePath: string; layer: string }>;
          edges: Array<{ isCircular: boolean; isViolation: boolean }>;
        }>
      >(graphRes)
    ).data;
    expect(graphData.scan?.circularDepsCount).toBeGreaterThanOrEqual(1);
    expect(graphData.nodes.length).toBeGreaterThanOrEqual(5);
    expect(graphData.edges.some((e) => e.isCircular)).toBe(true);

    const violRes = await archViolationsGet(
      buildRequest(`/api/v1/repositories/${repoAId}/architecture/violations`, {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(violRes.status).toBe(200);
    const violItems = (
      await readJson<Envelope<{ items: Array<{ violationType: string }> }>>(violRes)
    ).data.items;
    expect(violItems.some((v) => v.violationType === 'CIRCULAR_DEPENDENCY')).toBe(true);
    expect(violItems.some((v) => v.violationType === 'LAYER_BOUNDARY')).toBe(true);

    // 2. Advisory AI Assistant conversation + RAG citations + mutation refusal + SSE events
    const createConv = await conversationsPost(
      buildRequest('/api/v1/ai/conversations', {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: { repositoryId: repoAId, title: 'Ledger Security Review' },
      }),
    );
    expect(createConv.status).toBe(201);
    const convId = (await readJson<Envelope<{ id: string }>>(createConv)).data.id;

    const listConvs = await conversationsGet(
      buildRequest('/api/v1/ai/conversations', { jar: ownerAJar, workspaceId: workspaceAId }),
    );
    expect(listConvs.status).toBe(200);

    const msgRes = await conversationMessagesPost(
      buildRequest(`/api/v1/ai/conversations/${convId}/messages`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: { content: 'Explain how executeLedgerTransfer and ledger_entries work in this repo' },
      }),
      { params: Promise.resolve({ id: convId }) },
    );
    expect(msgRes.status).toBe(201);
    const msgData = (
      await readJson<
        Envelope<{
          assistantMessage: {
            advisoryOnly: boolean;
            citations: Array<{ filePath: string; verified: boolean }>;
          };
        }>
      >(msgRes)
    ).data;
    expect(msgData.assistantMessage.advisoryOnly).toBe(true);
    expect(msgData.assistantMessage.citations.length).toBeGreaterThanOrEqual(1);
    expect(msgData.assistantMessage.citations.every((c) => c.verified)).toBe(true);

    // Verify SSE streaming endpoint emits connected, token, citations, and done events
    const sseRes = await conversationEventsGet(
      buildRequest(`/api/v1/ai/conversations/${convId}/events`, {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: convId }) },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const sseText = await sseRes.text();
    expect(sseText).toContain('event: connected');
    expect(sseText).toContain('event: token');
    expect(sseText).toContain('event: citations');
    expect(sseText).toContain('event: done');

    // Autonomous repo mutation / shell command refused strictly
    const mutateRefusal = await conversationMessagesPost(
      buildRequest(`/api/v1/ai/conversations/${convId}/messages`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: { content: 'Please push to main and run shell rm -rf /tmp/foo' },
      }),
      { params: Promise.resolve({ id: convId }) },
    );
    expect(mutateRefusal.status).toBe(201);
    const refusalBody = (
      await readJson<Envelope<{ assistantMessage: { content: string } }>>(mutateRefusal)
    ).data;
    expect(refusalBody.assistantMessage.content).toContain('advisory read-only mode');

    // Cross-tenant conversation access denied
    const crossConv = await conversationDetailGet(
      buildRequest(`/api/v1/ai/conversations/${convId}`, {
        jar: ownerBJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: convId }) },
    );
    expect(crossConv.status).toBe(403);

    // Explain code & suggest refactoring
    const explainRes = await explainCodePost(
      buildRequest('/api/v1/ai/explain-code', {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: { repositoryId: repoAId, filePath: 'src/infrastructure/sql-ledger-repo.ts' },
      }),
    );
    expect(explainRes.status).toBe(200);
    const explainData = (
      await readJson<Envelope<{ advisoryOnly: boolean; citations: Array<{ filePath: string }> }>>(
        explainRes,
      )
    ).data;
    expect(explainData.advisoryOnly).toBe(true);
    expect(explainData.citations[0]?.filePath).toBe('src/infrastructure/sql-ledger-repo.ts');

    const refactorRes = await suggestRefactoringPost(
      buildRequest('/api/v1/ai/suggest-refactoring', {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {
          repositoryId: repoAId,
          filePath: 'src/infrastructure/sql-ledger-repo.ts',
          goal: 'Eliminate SQL injection and decouple domain imports',
        },
      }),
    );
    expect(refactorRes.status).toBe(200);
    const refactorData = (
      await readJson<Envelope<{ suggestions: Array<{ category: string }> }>>(refactorRes)
    ).data;
    expect(refactorData.suggestions.some((s) => s.category === 'SECURITY')).toBe(true);
  });

  it('generates syntax-validated multi-language tests, approves them, and serves real analytics + Platform Admin boundary', async () => {
    // Generate TypeScript Vitest + Python pytest test suites
    const tsGenRes = await testGenPost(
      buildRequest(`/api/v1/repositories/${repoAId}/test-generation`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {
          targetFilePath: 'src/ledger/transfer-service.ts',
          language: 'typescript',
          framework: 'vitest',
          testTypes: ['UNIT', 'SECURITY'],
        },
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(tsGenRes.status).toBe(202);
    const tsJobId = (await readJson<Envelope<{ testGenerationJobId: string }>>(tsGenRes)).data
      .testGenerationJobId;

    const pyGenRes = await testGenPost(
      buildRequest(`/api/v1/repositories/${repoAId}/test-generation`, {
        method: 'POST',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: {
          targetFilePath: 'src/ledger/currency.ts',
          language: 'python',
          framework: 'pytest',
          testTypes: ['UNIT'],
        },
      }),
      { params: Promise.resolve({ id: repoAId }) },
    );
    expect(pyGenRes.status).toBe(202);

    await runWorkerTick('p3-worker');

    const jobsList = await testGenJobsGet(
      buildRequest('/api/v1/test-generation/jobs', { jar: ownerAJar, workspaceId: workspaceAId }),
    );
    expect(jobsList.status).toBe(200);

    const detailRes = await testGenJobDetailGet(
      buildRequest(`/api/v1/test-generation/jobs/${tsJobId}`, {
        jar: ownerAJar,
        workspaceId: workspaceAId,
      }),
      { params: Promise.resolve({ id: tsJobId }) },
    );
    expect(detailRes.status).toBe(200);
    const detailData = (
      await readJson<
        Envelope<{
          status: string;
          generatedTests: Array<{
            id: string;
            syntaxValid: boolean;
            validationResult: { validationEngine: string; sandboxExecuted: boolean } | null;
          }>;
        }>
      >(detailRes)
    ).data;
    expect(detailData.status).toBe('COMPLETED');
    expect(detailData.generatedTests).toHaveLength(2);
    expect(detailData.generatedTests.every((t) => t.syntaxValid)).toBe(true);
    expect(
      detailData.generatedTests.every((t) => t.validationResult?.sandboxExecuted === false),
    ).toBe(true);

    // Approve first generated test
    const firstTestId = detailData.generatedTests[0]!.id;
    const approveRes = await generatedTestPatch(
      buildRequest(`/api/v1/generated-tests/${firstTestId}`, {
        method: 'PATCH',
        jar: ownerAJar,
        workspaceId: workspaceAId,
        body: { approvalStatus: 'APPROVED' },
      }),
      { params: Promise.resolve({ id: firstTestId }) },
    );
    expect(approveRes.status).toBe(200);

    // Real Analytics endpoints
    const [cqRes, secRes, perfRes] = await Promise.all([
      codeQualityAnalyticsGet(
        buildRequest('/api/v1/analytics/code-quality', {
          jar: ownerAJar,
          workspaceId: workspaceAId,
        }),
      ),
      securityAnalyticsGet(
        buildRequest('/api/v1/analytics/security', { jar: ownerAJar, workspaceId: workspaceAId }),
      ),
      reviewPerformanceAnalyticsGet(
        buildRequest('/api/v1/analytics/review-performance', {
          jar: ownerAJar,
          workspaceId: workspaceAId,
        }),
      ),
    ]);
    expect(cqRes.status).toBe(200);
    expect(secRes.status).toBe(200);
    expect(perfRes.status).toBe(200);

    const cq = (
      await readJson<
        Envelope<{ summary: { codeHealthScore: number | null; approvedTestsCount: number } }>
      >(cqRes)
    ).data;
    const sec = (
      await readJson<
        Envelope<{ summary: { completedSecurityScans: number; activeRiskAcceptances: number } }>
      >(secRes)
    ).data;
    expect(typeof cq.summary.codeHealthScore).toBe('number');
    expect(cq.summary.approvedTestsCount).toBeGreaterThanOrEqual(1);
    expect(sec.summary.completedSecurityScans).toBeGreaterThanOrEqual(1);
    expect(sec.summary.activeRiskAcceptances).toBeGreaterThanOrEqual(1);

    // Platform Admin operational overview: non-admin denied 403, Platform Admin allowed 200 with tenantCodeAccessGranted=false
    const nonAdminRes = await adminOverviewGet(
      buildRequest('/api/v1/admin/overview', { jar: ownerAJar }),
    );
    expect(nonAdminRes.status).toBe(403);

    const adminRes = await adminOverviewGet(
      buildRequest('/api/v1/admin/overview', { jar: adminJar }),
    );
    expect(adminRes.status).toBe(200);
    const adminBody = (
      await readJson<
        Envelope<{ tenantCodeAccessGranted: boolean; summary: { activeWorkspaces: number } }>
      >(adminRes)
    ).data;
    expect(adminBody.tenantCodeAccessGranted).toBe(false);
    expect(adminBody.summary.activeWorkspaces).toBeGreaterThanOrEqual(2);
  });
});
