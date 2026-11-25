import { z } from 'zod';
import { WORKSPACE_ROLE_KEYS } from '@/modules/authorization/domain/rbac';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Slug must be at least 2 characters')
    .max(100)
    .regex(slugRegex, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().trim().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  settings: z
    .object({
      defaultAiProvider: z.enum(['mock', 'openai', 'anthropic', 'bedrock']).optional(),
      allowedAiProviders: z
        .array(z.enum(['mock', 'openai', 'anthropic', 'bedrock']))
        .min(1)
        .optional(),
      requireHumanApproval: z.boolean().optional(),
      autoReviewEnabled: z.boolean().optional(),
      dataRetentionDays: z.number().int().min(7).max(365).optional(),
    })
    .optional(),
  usageLimits: z
    .object({
      monthlyAiBudgetUsd: z.number().min(0).max(10000).optional(),
      maxMonthlyTokens: z.number().int().min(10000).max(100_000_000).optional(),
    })
    .optional(),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().email('Valid email is required').max(255),
  roleKey: z.enum(WORKSPACE_ROLE_KEYS).default('DEVELOPER'),
});

export const updateMemberSchema = z
  .object({
    roleKey: z.enum(WORKSPACE_ROLE_KEYS).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
  })
  .refine((val) => val.roleKey !== undefined || val.status !== undefined, {
    message: 'At least one of roleKey or status must be provided',
  });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
