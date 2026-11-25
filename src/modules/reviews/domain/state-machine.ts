import type { CodeReviewStatus } from '@/generated/prisma/client';
import { ConflictError } from '@/shared/http/problem-details';

export const ALL_REVIEW_STATES: readonly CodeReviewStatus[] = [
  'QUEUED',
  'FETCHING_CONTEXT',
  'ANALYZING',
  'VALIDATING',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'COMPLETED_WITH_WARNINGS',
  'PUBLISHED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

const ALLOWED_TRANSITIONS: Record<CodeReviewStatus, readonly CodeReviewStatus[]> = {
  QUEUED: ['FETCHING_CONTEXT', 'CANCELLED', 'SUPERSEDED', 'FAILED'],
  FETCHING_CONTEXT: ['ANALYZING', 'CANCELLED', 'SUPERSEDED', 'FAILED'],
  ANALYZING: ['VALIDATING', 'CANCELLED', 'SUPERSEDED', 'FAILED'],
  VALIDATING: [
    'AWAITING_APPROVAL',
    'COMPLETED',
    'COMPLETED_WITH_WARNINGS',
    'FAILED',
    'CANCELLED',
    'SUPERSEDED',
  ],
  AWAITING_APPROVAL: ['COMPLETED', 'REJECTED', 'SUPERSEDED', 'CANCELLED'],
  COMPLETED: ['PUBLISHED', 'REJECTED', 'SUPERSEDED'],
  COMPLETED_WITH_WARNINGS: ['AWAITING_APPROVAL', 'PUBLISHED', 'REJECTED', 'SUPERSEDED'],
  PUBLISHED: [],
  REJECTED: ['SUPERSEDED'],
  FAILED: ['QUEUED', 'SUPERSEDED'],
  CANCELLED: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export function canTransitionReviewState(from: CodeReviewStatus, to: CodeReviewStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidReviewTransition(from: CodeReviewStatus, to: CodeReviewStatus): void {
  if (!canTransitionReviewState(from, to)) {
    throw new ConflictError(
      `Invalid review state transition from ${from} to ${to}`,
      'INVALID_REVIEW_STATE_TRANSITION',
    );
  }
}
