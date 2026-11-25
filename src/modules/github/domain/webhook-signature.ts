import crypto from 'node:crypto';
import { getEnv } from '@/config/env';
import { UnauthorizedError, ValidationError } from '@/shared/http/problem-details';

export function computeGithubWebhookSignature(rawBody: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hmac}`;
}

export function verifyGithubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretOverride?: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const secret = secretOverride ?? getEnv().GITHUB_WEBHOOK_SECRET;
  const expected = computeGithubWebhookSignature(rawBody, secret);

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export interface GithubInstallStatePayload {
  workspaceId: string;
  userId: string;
  issuedAt: number;
  nonce: string;
}

export function createGithubInstallState(workspaceId: string, userId: string): string {
  const payload: GithubInstallStatePayload = {
    workspaceId,
    userId,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getEnv().SESSION_SECRET)
    .update(encoded, 'utf8')
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyGithubInstallState(state: string): GithubInstallStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ValidationError('Invalid GitHub installation state parameter');
  }

  const [encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getEnv().SESSION_SECRET)
    .update(encoded, 'utf8')
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError('GitHub installation state signature mismatch', 'INVALID_STATE');
  }

  const parsed = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  ) as GithubInstallStatePayload;

  // State valid for 15 minutes
  if (!parsed.workspaceId || !parsed.userId || Date.now() - parsed.issuedAt > 15 * 60_000) {
    throw new UnauthorizedError('GitHub installation state has expired', 'STATE_EXPIRED');
  }

  return parsed;
}
