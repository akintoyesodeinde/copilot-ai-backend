export interface OpenApi31Document {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
    schemas: Record<string, Record<string, unknown>>;
  };
  paths: Record<string, Record<string, unknown>>;
}

const problemDetailsSchema: Record<string, unknown> = {
  type: 'object',
  required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'correlationId'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    code: { type: 'string' },
    correlationId: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'message'],
        properties: {
          field: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};

const responseMetaSchema: Record<string, unknown> = {
  type: 'object',
  required: ['requestId', 'timestamp'],
  properties: {
    requestId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    pagination: {
      type: 'object',
      required: ['limit', 'hasMore', 'nextCursor'],
      properties: {
        limit: { type: 'integer' },
        hasMore: { type: 'boolean' },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  },
};

const problemResponseRef = (description: string): Record<string, unknown> => ({
  description,
  content: {
    'application/problem+json': {
      schema: { $ref: '#/components/schemas/ProblemDetails' },
    },
  },
});

const workspaceHeaderParam: Record<string, unknown> = {
  name: 'X-Workspace-Id',
  in: 'header',
  required: false,
  description: 'Target tenant workspace UUID (may alternatively be supplied as ?workspaceId=)',
  schema: { type: 'string', format: 'uuid' },
};

const workspaceQueryParam: Record<string, unknown> = {
  name: 'workspaceId',
  in: 'query',
  required: false,
  description: 'Target tenant workspace UUID (may alternatively be supplied via X-Workspace-Id)',
  schema: { type: 'string', format: 'uuid' },
};

const paginationParams: Array<Record<string, unknown>> = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Opaque base64url pagination cursor returned by a previous page',
  },
];

export function getOpenApiSpec(): OpenApi31Document {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CodePilot AI — Intelligent Code Review Platform API',
      version: '1.0.0',
      description:
        'Standalone headless REST API backend for CodePilot AI. Implements multi-tenant workspace management, Argon2id session authentication with refresh token rotation, workspace RBAC, cursor pagination, and RFC 9457 Problem Details error contracts.',
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Local development API server',
      },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'cp_session',
          description: 'HttpOnly session cookie issued on registration, login, or refresh',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description:
            'Double-submit CSRF token required on all authenticated state-changing requests',
        },
      },
      schemas: {
        ProblemDetails: problemDetailsSchema,
        ResponseMeta: responseMetaSchema,
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'fullName'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 255 },
            password: {
              type: 'string',
              minLength: 10,
              maxLength: 128,
              description: 'Must contain uppercase, lowercase, number, and symbol',
            },
            fullName: { type: 'string', minLength: 2, maxLength: 150 },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
        },
        CreateWorkspaceRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
            slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
            description: { type: 'string', maxLength: 500 },
          },
        },
        UpdateWorkspaceRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
            description: { type: ['string', 'null'], maxLength: 500 },
            settings: {
              type: 'object',
              properties: {
                defaultAiProvider: {
                  type: 'string',
                  enum: ['mock', 'openai', 'anthropic', 'bedrock'],
                },
                allowedAiProviders: {
                  type: 'array',
                  items: { type: 'string', enum: ['mock', 'openai', 'anthropic', 'bedrock'] },
                },
                requireHumanApproval: { type: 'boolean' },
                autoReviewEnabled: { type: 'boolean' },
                dataRetentionDays: { type: 'integer', minimum: 7, maximum: 365 },
              },
            },
            usageLimits: {
              type: 'object',
              properties: {
                monthlyAiBudgetUsd: { type: 'number', minimum: 0, maximum: 10000 },
                maxMonthlyTokens: { type: 'integer', minimum: 10000, maximum: 100000000 },
              },
            },
          },
        },
        CreateInvitationRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            roleKey: { type: 'string', enum: ['WORKSPACE_OWNER', 'DEVELOPER', 'VIEWER'] },
          },
        },
        UpdateMemberRequest: {
          type: 'object',
          properties: {
            roleKey: { type: 'string', enum: ['WORKSPACE_OWNER', 'DEVELOPER', 'VIEWER'] },
            status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'REMOVED'] },
          },
        },
      },
    },
    paths: {
      '/api/v1/auth/register': {
        post: {
          tags: ['Authentication'],
          summary: 'Register a new user account',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
            },
          },
          responses: {
            '201': { description: 'User registered and authenticated via HttpOnly cookies' },
            '400': problemResponseRef('Validation error'),
            '409': problemResponseRef('Email already exists'),
            '429': problemResponseRef('Rate limit exceeded'),
          },
        },
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Authentication'],
          summary: 'Authenticate with email and password',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
            },
          },
          responses: {
            '200': { description: 'Authenticated session issued via HttpOnly cookies' },
            '400': problemResponseRef('Validation error'),
            '401': problemResponseRef('Invalid credentials'),
            '429': problemResponseRef('Rate limit exceeded'),
          },
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          tags: ['Authentication'],
          summary: 'Rotate refresh token and issue new session cookies',
          responses: {
            '200': { description: 'Session and refresh token rotated' },
            '401': problemResponseRef('Missing, expired, invalid, or reused refresh token'),
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          tags: ['Authentication'],
          summary: 'Revoke current session and clear authentication cookies',
          security: [{ sessionCookie: [], csrfToken: [] }],
          responses: {
            '200': { description: 'Session revoked' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('CSRF verification failed'),
          },
        },
      },
      '/api/v1/auth/me': {
        get: {
          tags: ['Authentication'],
          summary: 'Retrieve current authenticated user profile and active workspace memberships',
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'Current user profile and workspace memberships' },
            '401': problemResponseRef('Unauthorized'),
          },
        },
      },
      '/api/v1/workspaces': {
        get: {
          tags: ['Workspaces'],
          summary: 'List workspaces accessible to the authenticated user',
          security: [{ sessionCookie: [] }],
          responses: {
            '200': { description: 'List of active workspaces' },
            '401': problemResponseRef('Unauthorized'),
          },
        },
        post: {
          tags: ['Workspaces'],
          summary: 'Create a new tenant workspace',
          security: [{ sessionCookie: [], csrfToken: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateWorkspaceRequest' },
              },
            },
          },
          responses: {
            '201': { description: 'Workspace created with caller assigned as WORKSPACE_OWNER' },
            '400': problemResponseRef('Validation error'),
            '401': problemResponseRef('Unauthorized'),
            '409': problemResponseRef('Workspace slug already exists'),
          },
        },
      },
      '/api/v1/workspaces/{id}': {
        get: {
          tags: ['Workspaces'],
          summary: 'Get workspace details, settings, and usage limits (requires workspace:read)',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { description: 'Workspace details' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden (non-member or insufficient role)'),
          },
        },
        patch: {
          tags: ['Workspaces'],
          summary:
            'Update workspace metadata, settings, or usage limits (requires workspace:update)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateWorkspaceRequest' },
              },
            },
          },
          responses: {
            '200': { description: 'Workspace updated' },
            '400': problemResponseRef('Validation error'),
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden (requires WORKSPACE_OWNER)'),
          },
        },
      },
      '/api/v1/workspaces/{id}/members': {
        get: {
          tags: ['Workspaces'],
          summary: 'List workspace members and pending invitations (requires member:read)',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': { description: 'Workspace members and pending invitations' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/workspaces/{id}/invitations': {
        post: {
          tags: ['Workspaces'],
          summary: 'Invite a user to join the workspace (requires member:invite)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateInvitationRequest' },
              },
            },
          },
          responses: {
            '201': { description: 'Invitation created' },
            '400': problemResponseRef('Validation error'),
            '403': problemResponseRef('Forbidden (requires WORKSPACE_OWNER)'),
            '409': problemResponseRef(
              'Already a member, pending invite exists, or member cap reached',
            ),
          },
        },
      },
      '/api/v1/workspaces/{id}/members/{memberId}': {
        patch: {
          tags: ['Workspaces'],
          summary: 'Update member role or status (requires member:update)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            {
              name: 'memberId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UpdateMemberRequest' } },
            },
          },
          responses: {
            '200': { description: 'Member updated' },
            '400': problemResponseRef('Validation error or last owner protection'),
            '403': problemResponseRef('Forbidden (requires WORKSPACE_OWNER)'),
            '404': problemResponseRef('Member not found'),
          },
        },
      },
      '/api/v1/repositories': {
        get: {
          tags: ['Repositories'],
          summary:
            'List connected repositories in the selected workspace (requires repository:read)',
          security: [{ sessionCookie: [] }],
          parameters: [
            workspaceHeaderParam,
            workspaceQueryParam,
            ...paginationParams,
            { name: 'search', in: 'query', schema: { type: 'string' } },
            {
              name: 'visibility',
              in: 'query',
              schema: { type: 'string', enum: ['PUBLIC', 'PRIVATE', 'INTERNAL'] },
            },
            { name: 'language', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Cursor-paginated repository list' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef(
              'Forbidden (cross-tenant or Platform Admin without workspace membership)',
            ),
          },
        },
      },
      '/api/v1/repositories/{id}': {
        get: {
          tags: ['Repositories'],
          summary:
            'Get repository metadata, branches, and recent commits (requires repository:read)',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
            workspaceQueryParam,
          ],
          responses: {
            '200': { description: 'Repository details with branches and commits' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
            '404': problemResponseRef('Repository not found in workspace'),
          },
        },
      },
      '/api/v1/analytics/overview': {
        get: {
          tags: ['Analytics'],
          summary: 'Get real database-backed engineering overview metrics for a workspace',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam],
          responses: {
            '200': { description: 'Workspace analytics overview' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List tenant-scoped notifications for the authenticated user',
          security: [{ sessionCookie: [] }],
          parameters: [
            workspaceHeaderParam,
            workspaceQueryParam,
            ...paginationParams,
            { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            '200': { description: 'Cursor-paginated notifications and unread count' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/notifications/{id}': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark a notification as read',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
            workspaceQueryParam,
          ],
          responses: {
            '200': { description: 'Notification marked as read' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
            '404': problemResponseRef('Notification not found'),
          },
        },
      },
      '/api/v1/audit-logs': {
        get: {
          tags: ['Audit'],
          summary:
            'List workspace security and operational audit logs (requires audit:read / WORKSPACE_OWNER)',
          security: [{ sessionCookie: [] }],
          parameters: [
            workspaceHeaderParam,
            workspaceQueryParam,
            ...paginationParams,
            { name: 'action', in: 'query', schema: { type: 'string' } },
            {
              name: 'outcome',
              in: 'query',
              schema: { type: 'string', enum: ['SUCCESS', 'FAILURE', 'DENIED'] },
            },
          ],
          responses: {
            '200': { description: 'Cursor-paginated audit logs' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden (requires WORKSPACE_OWNER)'),
          },
        },
      },
      '/api/v1/health/live': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe confirming the API process is responsive',
          responses: {
            '200': { description: 'Process is live' },
          },
        },
      },
      '/api/v1/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe verifying MySQL database connectivity',
          responses: {
            '200': { description: 'API and MySQL database are ready' },
            '503': { description: 'Database dependency is unavailable' },
          },
        },
      },
      '/api/v1/github/installations': {
        get: {
          tags: ['GitHub'],
          summary: 'List GitHub App installations connected to the active workspace',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam],
          responses: {
            '200': { description: 'Connected installations' },
            '401': problemResponseRef('Unauthorized'),
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/github/install': {
        get: {
          tags: ['GitHub'],
          summary: 'Generate a signed least-privilege GitHub App installation URL',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam],
          responses: {
            '200': { description: 'Signed installation redirect URL' },
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/github/callback': {
        get: {
          tags: ['GitHub'],
          summary: 'Verify signed installation state and bind GitHub App installation to workspace',
          responses: {
            '201': { description: 'Installation bound and repositories synced' },
            '400': problemResponseRef('Invalid parameters'),
            '409': problemResponseRef('Installation already bound to another workspace'),
          },
        },
      },
      '/api/v1/github/installations/{id}': {
        delete: {
          tags: ['GitHub'],
          summary: 'Revoke a GitHub App installation and immediately disable repository access',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Installation revoked' },
            '403': problemResponseRef('Forbidden'),
            '404': problemResponseRef('Not found'),
          },
        },
      },
      '/api/v1/webhooks/github': {
        post: {
          tags: ['GitHub'],
          summary:
            'Ingest HMAC-SHA256 signed GitHub webhooks with delivery deduplication and transactional outbox',
          responses: {
            '202': { description: 'Webhook accepted' },
            '401': problemResponseRef('Invalid signature'),
            '403': problemResponseRef('Unauthorized installation'),
          },
        },
      },
      '/api/v1/repositories/{id}/sync': {
        post: {
          tags: ['Repositories'],
          summary:
            'Schedule asynchronous repository branch, commit, and PR sync (HTTP 202 Accepted)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '202': { description: 'Durable sync job scheduled' },
            '403': problemResponseRef('Forbidden'),
            '404': problemResponseRef('Not found'),
          },
        },
      },
      '/api/v1/repositories/{id}/index': {
        post: {
          tags: ['Code Intelligence'],
          summary: 'Schedule commit-SHA Tree-sitter AST indexing job (HTTP 202 Accepted)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '202': { description: 'Durable indexing job scheduled' },
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/repositories/{id}/branches': {
        get: {
          tags: ['Repositories'],
          summary: 'List tracked branches for a repository',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Repository branches' } },
        },
      },
      '/api/v1/repositories/{id}/files': {
        get: {
          tags: ['Code Intelligence'],
          summary: 'List commit-scoped indexed source files for a repository',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Indexed source files' } },
        },
      },
      '/api/v1/repositories/{id}/symbols': {
        get: {
          tags: ['Code Intelligence'],
          summary: 'List Tree-sitter AST extracted symbols for a repository',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Extracted AST symbols' } },
        },
      },
      '/api/v1/pull-requests': {
        get: {
          tags: ['Pull Requests'],
          summary: 'List tenant-scoped pull requests with latest AI review summary',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam, ...paginationParams],
          responses: { '200': { description: 'Cursor-paginated pull requests' } },
        },
      },
      '/api/v1/pull-requests/{id}': {
        get: {
          tags: ['Pull Requests'],
          summary: 'Retrieve pull request details and review history',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Pull request details' },
            '404': problemResponseRef('Not found'),
          },
        },
      },
      '/api/v1/pull-requests/{id}/diff': {
        get: {
          tags: ['Pull Requests'],
          summary: 'Retrieve changed files and unified diffs for a pull request head commit',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Pull request diff files' } },
        },
      },
      '/api/v1/pull-requests/{id}/reviews': {
        post: {
          tags: ['Reviews'],
          summary: 'Schedule an idempotent automated PR review job (HTTP 202 Accepted)',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '202': { description: 'Review job accepted' },
            '403': problemResponseRef('Forbidden'),
          },
        },
      },
      '/api/v1/reviews/{id}': {
        get: {
          tags: ['Reviews'],
          summary: 'Get automated code review status, summary, and lifecycle timestamps',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Review detail' },
            '404': problemResponseRef('Not found'),
          },
        },
      },
      '/api/v1/reviews/{id}/findings': {
        get: {
          tags: ['Reviews'],
          summary: 'List validated deterministic and AI review findings with severity filters',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Review findings' } },
        },
      },
      '/api/v1/reviews/{id}/approve': {
        post: {
          tags: ['Reviews'],
          summary: 'Approve a completed review awaiting human approval prior to GitHub publishing',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Review approved' },
            '409': problemResponseRef('Invalid state transition'),
          },
        },
      },
      '/api/v1/reviews/{id}/reject': {
        post: {
          tags: ['Reviews'],
          summary: 'Reject a generated review to prevent publishing',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Review rejected' } },
        },
      },
      '/api/v1/reviews/{id}/publish': {
        post: {
          tags: ['Reviews'],
          summary:
            'Publish an approved review to GitHub with stale head-SHA and duplicate comment guards',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Review published to GitHub' },
            '403': problemResponseRef('Human approval required'),
            '409': problemResponseRef('Stale PR head SHA'),
          },
        },
      },
      '/api/v1/findings/{id}/feedback': {
        post: {
          tags: ['Reviews'],
          summary:
            'Record developer quality feedback (HELPFUL, NOT_HELPFUL, FALSE_POSITIVE) on a finding',
          security: [{ sessionCookie: [], csrfToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: { '200': { description: 'Feedback recorded' } },
        },
      },
      '/api/v1/jobs': {
        get: {
          tags: ['Jobs'],
          summary: 'List workspace background analysis jobs',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam, ...paginationParams],
          responses: { '200': { description: 'Cursor-paginated jobs list' } },
        },
      },
      '/api/v1/jobs/{id}': {
        get: {
          tags: ['Jobs'],
          summary: 'Inspect durable analysis job status, attempts, heartbeats, and result',
          security: [{ sessionCookie: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            workspaceHeaderParam,
          ],
          responses: {
            '200': { description: 'Job detail' },
            '404': problemResponseRef('Not found'),
          },
        },
      },
      '/api/v1/ai/usage': {
        get: {
          tags: ['AI'],
          summary:
            'Retrieve workspace AI token usage, provider breakdown, and spending budget status',
          security: [{ sessionCookie: [] }],
          parameters: [workspaceHeaderParam, workspaceQueryParam],
          responses: { '200': { description: 'AI usage summary' } },
        },
      },
    },
  };
}
