import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspaceVulnerabilities } from '@/modules/security/application/security.service';
import { parsePaginationParams } from '@/shared/http/pagination';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const SCANNERS = new Set(['SEMGREP', 'GITLEAKS', 'OSV_SCANNER', 'ESLINT', 'TRIVY', 'AI_ADVISORY']);
const STATUSES = new Set(['OPEN', 'TRIAGED', 'FALSE_POSITIVE', 'RISK_ACCEPTED', 'FIXED']);
const SOURCES = new Set(['DETERMINISTIC', 'AI_ADVISORY']);

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const pagination = parsePaginationParams(ctx.url);
  const repoParam = ctx.url.searchParams.get('repositoryId');
  const sevParam = ctx.url.searchParams.get('severity')?.toUpperCase();
  const scannerParam = ctx.url.searchParams.get('scanner')?.toUpperCase();
  const statusParam = ctx.url.searchParams.get('status')?.toUpperCase();
  const sourceParam = ctx.url.searchParams.get('source')?.toUpperCase();

  const result = await listWorkspaceVulnerabilities(workspaceId, pagination, {
    repositoryId: repoParam ? validateUuidParam(repoParam, 'repositoryId') : undefined,
    severity:
      sevParam && SEVERITIES.has(sevParam)
        ? (sevParam as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO')
        : undefined,
    scanner:
      scannerParam && SCANNERS.has(scannerParam)
        ? (scannerParam as
            'SEMGREP' | 'GITLEAKS' | 'OSV_SCANNER' | 'ESLINT' | 'TRIVY' | 'AI_ADVISORY')
        : undefined,
    status:
      statusParam && STATUSES.has(statusParam)
        ? (statusParam as 'OPEN' | 'TRIAGED' | 'FALSE_POSITIVE' | 'RISK_ACCEPTED' | 'FIXED')
        : undefined,
    source:
      sourceParam && SOURCES.has(sourceParam)
        ? (sourceParam as 'DETERMINISTIC' | 'AI_ADVISORY')
        : undefined,
  });

  return okResponse({ items: result.items }, ctx.correlationId, { pagination: result.pagination });
});
