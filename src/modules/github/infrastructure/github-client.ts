import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { getEnv } from '@/config/env';
import { getLogger } from '@/shared/logging/logger';

export interface GithubRemoteRepo {
  githubRepoId: bigint;
  ownerLogin: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  primaryLanguage: string | null;
}

export interface GithubRemoteBranch {
  name: string;
  headSha: string;
  isProtected: boolean;
}

export interface GithubRemoteCommit {
  sha: string;
  messageHeadline: string;
  authorName: string;
  authorEmail: string | null;
  committedAt: Date;
}

export interface GithubRemotePullRequest {
  githubPrId: bigint;
  prNumber: number;
  title: string;
  description: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFilesCount: number;
  htmlUrl: string | null;
  mergedAt: Date | null;
  closedAt: Date | null;
}

export interface GithubRemotePullRequestFile {
  filePath: string;
  previousFilePath: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  blobSha: string | null;
}

export interface GithubRemoteSourceFile {
  filePath: string;
  content: string;
}

export interface GithubExistingComment {
  id: bigint;
  body: string;
  path?: string;
  line?: number;
}

export interface GithubPublishReviewInput {
  installationId: bigint;
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  summaryBody: string;
  comments: Array<{
    filePath: string;
    lineNumber: number;
    body: string;
    publicationKey: string;
  }>;
}

export interface GithubPublishReviewResult {
  githubReviewId: bigint;
  publishedComments: Array<{
    publicationKey: string;
    githubCommentId: bigint;
  }>;
}

export interface GithubRateLimitInfo {
  remaining: number;
  resetAtEpochSec: number;
}

export interface GithubGateway {
  readonly mode: 'live' | 'fixture';
  getInstallationMetadata(installationId: bigint): Promise<{
    accountLogin: string;
    accountType: string;
    targetType: string;
    permissions: Record<string, string>;
  }>;
  listInstallationRepositories(installationId: bigint): Promise<GithubRemoteRepo[]>;
  listBranches(installationId: bigint, owner: string, repo: string): Promise<GithubRemoteBranch[]>;
  listCommits(
    installationId: bigint,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GithubRemoteCommit[]>;
  listPullRequests(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubRemotePullRequest[]>;
  getPullRequest(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubRemotePullRequest>;
  listPullRequestFiles(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubRemotePullRequestFile[]>;
  fetchRepositorySnapshotFiles(
    installationId: bigint,
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<GithubRemoteSourceFile[]>;
  listExistingReviewComments(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubExistingComment[]>;
  publishPullRequestReview(input: GithubPublishReviewInput): Promise<GithubPublishReviewResult>;
}

// ============================================================================
// Live Octokit GitHub App Gateway (least-privilege installation tokens)
// ============================================================================

async function withRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: unknown) {
      attempt += 1;
      const errObj = error as {
        status?: number;
        response?: { headers?: Record<string, string> };
      };
      const remaining = errObj.response?.headers?.['x-ratelimit-remaining'];
      const isRateLimited = errObj.status === 429 || (errObj.status === 403 && remaining === '0');

      if (!isRateLimited || attempt >= maxRetries) {
        throw error;
      }

      const resetSec = Number(errObj.response?.headers?.['x-ratelimit-reset'] ?? '0');
      const waitMs = Math.min(
        10_000,
        resetSec > 0 ? Math.max(500, resetSec * 1000 - Date.now()) : 500 * 2 ** attempt,
      );
      getLogger().warn({ attempt, waitMs }, 'GitHub API rate limit reached; backing off');
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export class OctokitGithubGateway implements GithubGateway {
  public readonly mode = 'live' as const;

  private async getInstallationOctokit(installationId: bigint): Promise<Octokit> {
    const env = getEnv();
    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      throw new Error(
        'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required when GITHUB_MODE=live',
      );
    }

    const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
    const auth = createAppAuth({
      appId: env.GITHUB_APP_ID,
      privateKey,
      installationId: Number(installationId),
    });

    const installationAuth = await auth({ type: 'installation' });
    return new Octokit({ auth: installationAuth.token });
  }

  private async getAppOctokit(): Promise<Octokit> {
    const env = getEnv();
    const privateKey = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');
    const auth = createAppAuth({
      appId: env.GITHUB_APP_ID,
      privateKey,
    });
    const appAuth = await auth({ type: 'app' });
    return new Octokit({ auth: appAuth.token });
  }

  async getInstallationMetadata(installationId: bigint) {
    const octokit = await this.getAppOctokit();
    const res = await withRateLimitRetry(() =>
      octokit.apps.getInstallation({ installation_id: Number(installationId) }),
    );
    const account = res.data.account;
    const login = account && 'login' in account && account.login ? account.login : 'unknown';
    const type = account && 'type' in account && account.type ? account.type : 'Organization';
    return {
      accountLogin: login,
      accountType: type,
      targetType: res.data.target_type ?? type,
      permissions: (res.data.permissions ?? {}) as Record<string, string>,
    };
  }

  async listInstallationRepositories(installationId: bigint): Promise<GithubRemoteRepo[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const repos = await withRateLimitRetry(() =>
      octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 }),
    );

    return repos.map((r) => ({
      githubRepoId: BigInt(r.id),
      ownerLogin: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      defaultBranch: r.default_branch ?? 'main',
      visibility:
        r.visibility === 'public' ? 'PUBLIC' : r.visibility === 'internal' ? 'INTERNAL' : 'PRIVATE',
      primaryLanguage: r.language ?? null,
    }));
  }

  async listBranches(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubRemoteBranch[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const branches = await withRateLimitRetry(() =>
      octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 }),
    );
    return branches.map((b) => ({
      name: b.name,
      headSha: b.commit.sha,
      isProtected: b.protected,
    }));
  }

  async listCommits(
    installationId: bigint,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GithubRemoteCommit[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const res = await withRateLimitRetry(() =>
      octokit.repos.listCommits({ owner, repo, sha: branch, per_page: 30 }),
    );
    return res.data.map((c) => ({
      sha: c.sha,
      messageHeadline: (c.commit.message.split('\n')[0] ?? '').slice(0, 255),
      authorName: c.commit.author?.name ?? c.author?.login ?? 'Unknown',
      authorEmail: c.commit.author?.email ?? null,
      committedAt: new Date(c.commit.author?.date ?? Date.now()),
    }));
  }

  async listPullRequests(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubRemotePullRequest[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const prs = await withRateLimitRetry(() =>
      octokit.paginate(octokit.pulls.list, { owner, repo, state: 'all', per_page: 50 }),
    );
    return prs.slice(0, 50).map((pr) => ({
      githubPrId: BigInt(pr.id),
      prNumber: pr.number,
      title: pr.title,
      description: pr.body ?? null,
      state: pr.merged_at ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
      authorLogin: pr.user?.login ?? 'unknown',
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      isDraft: Boolean(pr.draft),
      additions: 0,
      deletions: 0,
      changedFilesCount: 0,
      htmlUrl: pr.html_url ?? null,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    }));
  }

  async getPullRequest(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubRemotePullRequest> {
    const octokit = await this.getInstallationOctokit(installationId);
    const { data: pr } = await withRateLimitRetry(() =>
      octokit.pulls.get({ owner, repo, pull_number: prNumber }),
    );
    return {
      githubPrId: BigInt(pr.id),
      prNumber: pr.number,
      title: pr.title,
      description: pr.body ?? null,
      state: pr.merged_at ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
      authorLogin: pr.user?.login ?? 'unknown',
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      isDraft: Boolean(pr.draft),
      additions: pr.additions,
      deletions: pr.deletions,
      changedFilesCount: pr.changed_files,
      htmlUrl: pr.html_url ?? null,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    };
  }

  async listPullRequestFiles(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubRemotePullRequestFile[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const files = await withRateLimitRetry(() =>
      octokit.paginate(octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    );
    return files.map((f) => ({
      filePath: f.filename,
      previousFilePath: f.previous_filename ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
      blobSha: f.sha ?? null,
    }));
  }

  async fetchRepositorySnapshotFiles(
    installationId: bigint,
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<GithubRemoteSourceFile[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const { data: tree } = await withRateLimitRetry(() =>
      octokit.git.getTree({ owner, repo, tree_sha: commitSha, recursive: '1' }),
    );

    const blobs = (tree.tree ?? [])
      .filter(
        (entry) => entry.type === 'blob' && entry.path && entry.sha && (entry.size ?? 0) <= 512_000,
      )
      .slice(0, 100);

    const files: GithubRemoteSourceFile[] = [];
    for (const item of blobs) {
      if (!item.path || !item.sha) continue;
      const { data: blob } = await withRateLimitRetry(() =>
        octokit.git.getBlob({ owner, repo, file_sha: item.sha! }),
      );
      const content =
        blob.encoding === 'base64'
          ? Buffer.from(blob.content, 'base64').toString('utf8')
          : blob.content;
      files.push({ filePath: item.path, content });
    }
    return files;
  }

  async listExistingReviewComments(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubExistingComment[]> {
    const octokit = await this.getInstallationOctokit(installationId);
    const comments = await withRateLimitRetry(() =>
      octokit.paginate(octokit.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    );
    return comments.map((c) => ({
      id: BigInt(c.id),
      body: c.body,
      path: c.path,
      line: c.line ?? undefined,
    }));
  }

  async publishPullRequestReview(
    input: GithubPublishReviewInput,
  ): Promise<GithubPublishReviewResult> {
    const octokit = await this.getInstallationOctokit(input.installationId);
    const { data: review } = await withRateLimitRetry(() =>
      octokit.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.prNumber,
        commit_id: input.commitSha,
        event: 'COMMENT',
        body: input.summaryBody,
        comments: input.comments.map((c) => ({
          path: c.filePath,
          line: c.lineNumber,
          side: 'RIGHT' as const,
          body: `${c.body}\n\n<!-- codepilot-key:${c.publicationKey} -->`,
        })),
      }),
    );

    const existing = await this.listExistingReviewComments(
      input.installationId,
      input.owner,
      input.repo,
      input.prNumber,
    );

    const publishedComments = input.comments.map((c, idx) => {
      const matched = existing.find((e) => e.body.includes(`codepilot-key:${c.publicationKey}`));
      return {
        publicationKey: c.publicationKey,
        githubCommentId: matched ? matched.id : BigInt(review.id) * BigInt(1000) + BigInt(idx + 1),
      };
    });

    return {
      githubReviewId: BigInt(review.id),
      publishedComments,
    };
  }
}

// ============================================================================
// Deterministic Fixture GitHub Gateway (for Local Development & CI Testing)
// ============================================================================

const SYNTHETIC_LEDGER_SERVICE_TS = `import { validateCurrency } from './currency';

export interface TransferRequest {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export class LedgerTransferService {
  async executeTransfer(req: TransferRequest): Promise<{ ledgerId: string; status: string }> {
    if (!validateCurrency(req.currency)) {
      throw new Error('Unsupported currency');
    }
    if (req.amountCents <= 0) {
      throw new Error('Transfer amount must be positive');
    }
    return {
      ledgerId: \`ldg_\${req.idempotencyKey}\`,
      status: 'POSTED',
    };
  }
}

export function buildUnsafeQuery(accountId: string): string {
  return \`SELECT * FROM ledger_entries WHERE account_id = '\${accountId}'\`;
}
`;

const SYNTHETIC_CURRENCY_TS = `const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'NGN']);

export function validateCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.has(code.toUpperCase());
}

export function formatMinorUnits(cents: number, currency: string): string {
  return \`\${currency.toUpperCase()} \${(cents / 100).toFixed(2)}\`;
}
`;

const SYNTHETIC_PR_DIFF = `@@ -18,6 +18,16 @@ export class LedgerTransferService {
     return {
       ledgerId: \`ldg_\${req.idempotencyKey}\`,
       status: 'POSTED',
     };
   }
 }
+
+export function buildUnsafeQuery(accountId: string): string {
+  return \`SELECT * FROM ledger_entries WHERE account_id = '\${accountId}'\`;
+}
+
+export function runDynamicRule(expression: string): unknown {
+  return eval(expression);
+}
`;

export class FixtureGithubGateway implements GithubGateway {
  public readonly mode = 'fixture' as const;
  private publishedCommentsByPr = new Map<string, GithubExistingComment[]>();
  private overriddenHeadShaByPr = new Map<string, string>();
  private simulatedRateLimitFailuresRemaining = 0;
  private nextCommentId = BigInt(700001);
  private nextReviewId = BigInt(800001);

  public setPullRequestHeadShaForTest(
    owner: string,
    repo: string,
    prNumber: number,
    headSha: string,
  ): void {
    this.overriddenHeadShaByPr.set(`${owner}/${repo}#${prNumber}`, headSha);
  }

  public simulateRateLimitResponses(count: number): void {
    this.simulatedRateLimitFailuresRemaining = count;
  }

  public resetTestState(): void {
    this.publishedCommentsByPr.clear();
    this.overriddenHeadShaByPr.clear();
    this.simulatedRateLimitFailuresRemaining = 0;
  }

  private async maybeSimulateRateLimit(): Promise<void> {
    if (this.simulatedRateLimitFailuresRemaining > 0) {
      this.simulatedRateLimitFailuresRemaining -= 1;
      const err = Object.assign(new Error('GitHub API rate limit exceeded'), {
        status: 429,
        response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' } },
      });
      throw err;
    }
  }

  async getInstallationMetadata(installationId: bigint) {
    return {
      accountLogin: 'acme-synthetic-org',
      accountType: 'Organization',
      targetType: 'Organization',
      permissions: {
        contents: 'read',
        metadata: 'read',
        pull_requests: 'write',
        checks: 'write',
        installation_id: installationId.toString(),
      },
    };
  }

  async listInstallationRepositories(installationId: bigint): Promise<GithubRemoteRepo[]> {
    return withRateLimitRetry(async () => {
      await this.maybeSimulateRateLimit();
      // Deterministic pagination simulation across 2 logical pages
      const page1: GithubRemoteRepo[] = [
        {
          githubRepoId: BigInt(910001) + (installationId % BigInt(1000)),
          ownerLogin: 'acme-synthetic-org',
          name: 'payments-ledger-service',
          fullName: 'acme-synthetic-org/payments-ledger-service',
          description: 'Synthetic TypeScript payments ledger microservice',
          defaultBranch: 'main',
          visibility: 'PRIVATE',
          primaryLanguage: 'TypeScript',
        },
      ];
      const page2: GithubRemoteRepo[] = [
        {
          githubRepoId: BigInt(910002) + (installationId % BigInt(1000)),
          ownerLogin: 'acme-synthetic-org',
          name: 'identity-gateway-api',
          fullName: 'acme-synthetic-org/identity-gateway-api',
          description: 'Synthetic OAuth2/OIDC gateway service',
          defaultBranch: 'main',
          visibility: 'PRIVATE',
          primaryLanguage: 'Go',
        },
      ];
      return [...page1, ...page2];
    });
  }

  async listBranches(): Promise<GithubRemoteBranch[]> {
    return [
      {
        name: 'main',
        headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601',
        isProtected: true,
      },
      {
        name: 'feat/ledger-dynamic-rules',
        headSha: 'f9e8d7c6b5a40312293a4b5c6d7e8f9012345699',
        isProtected: false,
      },
    ];
  }

  async listCommits(): Promise<GithubRemoteCommit[]> {
    return [
      {
        sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601',
        messageHeadline: 'feat: enforce idempotency keys on ledger transfer entries',
        authorName: 'Daniel Mensah',
        authorEmail: 'dev@acme-synthetic.dev',
        committedAt: new Date(Date.now() - 2 * 3600_000),
      },
      {
        sha: 'f9e8d7c6b5a40312293a4b5c6d7e8f9012345699',
        messageHeadline: 'feat: add ledger query helper and dynamic rule evaluator',
        authorName: 'Daniel Mensah',
        authorEmail: 'dev@acme-synthetic.dev',
        committedAt: new Date(Date.now() - 3600_000),
      },
    ];
  }

  async listPullRequests(
    _installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<GithubRemotePullRequest[]> {
    const key = `${owner}/${repo}#42`;
    const headSha =
      this.overriddenHeadShaByPr.get(key) ?? 'f9e8d7c6b5a40312293a4b5c6d7e8f9012345699';

    return [
      {
        githubPrId: BigInt(550042),
        prNumber: 42,
        title: 'feat: add ledger query helper and dynamic rule evaluator',
        description:
          'Adds account query utility and dynamic rule evaluator for synthetic PR review verification.',
        state: 'OPEN',
        authorLogin: 'dmensah',
        baseBranch: 'main',
        headBranch: 'feat/ledger-dynamic-rules',
        baseSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601',
        headSha,
        isDraft: false,
        additions: 10,
        deletions: 0,
        changedFilesCount: 1,
        htmlUrl: `https://github.com/${owner}/${repo}/pull/42`,
        mergedAt: null,
        closedAt: null,
      },
    ];
  }

  async getPullRequest(
    installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubRemotePullRequest> {
    const list = await this.listPullRequests(installationId, owner, repo);
    const match = list.find((p) => p.prNumber === prNumber) ?? list[0]!;
    const key = `${owner}/${repo}#${prNumber}`;
    const overriddenSha = this.overriddenHeadShaByPr.get(key);
    return {
      ...match,
      prNumber,
      headSha: overriddenSha ?? match.headSha,
    };
  }

  async listPullRequestFiles(): Promise<GithubRemotePullRequestFile[]> {
    return [
      {
        filePath: 'src/ledger/transfer-service.ts',
        previousFilePath: null,
        status: 'modified',
        additions: 10,
        deletions: 0,
        patch: SYNTHETIC_PR_DIFF,
        blobSha: 'blob000111222333444555666777888999000111',
      },
    ];
  }

  async fetchRepositorySnapshotFiles(): Promise<GithubRemoteSourceFile[]> {
    return [
      {
        filePath: 'src/ledger/transfer-service.ts',
        content: SYNTHETIC_LEDGER_SERVICE_TS,
      },
      {
        filePath: 'src/ledger/currency.ts',
        content: SYNTHETIC_CURRENCY_TS,
      },
      {
        filePath: 'node_modules/ignored-pkg/index.js',
        content: 'module.exports = {};',
      },
      {
        filePath: '.env.production',
        content: 'SECRET_KEY=should_never_be_indexed',
      },
      {
        filePath: 'assets/logo.png',
        content: '\x89PNG\r\n\x1a\n',
      },
    ];
  }

  async listExistingReviewComments(
    _installationId: bigint,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubExistingComment[]> {
    return [...(this.publishedCommentsByPr.get(`${owner}/${repo}#${prNumber}`) ?? [])];
  }

  async publishPullRequestReview(
    input: GithubPublishReviewInput,
  ): Promise<GithubPublishReviewResult> {
    const key = `${input.owner}/${input.repo}#${input.prNumber}`;
    const existing = this.publishedCommentsByPr.get(key) ?? [];
    const publishedComments: Array<{ publicationKey: string; githubCommentId: bigint }> = [];

    for (const c of input.comments) {
      const marker = `codepilot-key:${c.publicationKey}`;
      const alreadyExists = existing.find((e) => e.body.includes(marker));
      if (alreadyExists) {
        publishedComments.push({
          publicationKey: c.publicationKey,
          githubCommentId: alreadyExists.id,
        });
        continue;
      }

      const id = this.nextCommentId;
      this.nextCommentId += BigInt(1);
      existing.push({
        id,
        body: `${c.body}\n\n<!-- ${marker} -->`,
        path: c.filePath,
        line: c.lineNumber,
      });
      publishedComments.push({
        publicationKey: c.publicationKey,
        githubCommentId: id,
      });
    }

    this.publishedCommentsByPr.set(key, existing);
    const reviewId = this.nextReviewId;
    this.nextReviewId += BigInt(1);

    return {
      githubReviewId: reviewId,
      publishedComments,
    };
  }
}

let activeGateway: GithubGateway | null = null;
export const fixtureGithubGateway = new FixtureGithubGateway();

export function getGithubGateway(): GithubGateway {
  if (activeGateway) {
    return activeGateway;
  }
  const env = getEnv();
  return env.GITHUB_MODE === 'live' ? new OctokitGithubGateway() : fixtureGithubGateway;
}

export function setGithubGatewayForTesting(gateway: GithubGateway | null): void {
  activeGateway = gateway;
}
