import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { NotFoundError } from '@/shared/http/problem-details';
import {
  paginateDescByCreatedAt,
  type PaginationMeta,
  type PaginationParams,
} from '@/shared/http/pagination';

export interface RepositoryListItemDto {
  id: string;
  workspaceId: string;
  githubRepoId: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  primaryLanguage: string | null;
  isActive: boolean;
  branchCount: number;
  commitCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listWorkspaceRepositories(
  workspaceId: string,
  pagination: PaginationParams,
  filters?: {
    search?: string;
    visibility?: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
    language?: string;
  },
): Promise<{ items: RepositoryListItemDto[]; pagination: PaginationMeta }> {
  const prisma = getPrisma();

  const where: Prisma.RepositoryWhereInput = {
    workspaceId,
    isActive: true,
    accessRevokedAt: null,
    ...(filters?.visibility ? { visibility: filters.visibility } : {}),
    ...(filters?.language ? { primaryLanguage: filters.language } : {}),
    ...(filters?.search
      ? {
          OR: [
            { name: { contains: filters.search } },
            { fullName: { contains: filters.search } },
            { description: { contains: filters.search } },
          ],
        }
      : {}),
    ...(pagination.cursor
      ? {
          OR: [
            { createdAt: { lt: pagination.cursor.createdAt } },
            {
              createdAt: pagination.cursor.createdAt,
              id: { lt: pagination.cursor.id },
            },
          ],
        }
      : {}),
  };

  const rows = await prisma.repository.findMany({
    where,
    include: {
      _count: {
        select: {
          branches: true,
          commits: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });

  const paged = paginateDescByCreatedAt(rows, pagination.limit);

  return {
    items: paged.items.map((repo) => ({
      id: repo.id,
      workspaceId: repo.workspaceId,
      githubRepoId: repo.githubRepoId.toString(),
      ownerLogin: repo.ownerLogin,
      name: repo.name,
      fullName: repo.fullName,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      visibility: repo.visibility,
      primaryLanguage: repo.primaryLanguage,
      isActive: repo.isActive,
      branchCount: repo._count.branches,
      commitCount: repo._count.commits,
      lastSyncedAt: repo.lastSyncedAt?.toISOString() ?? null,
      createdAt: repo.createdAt.toISOString(),
      updatedAt: repo.updatedAt.toISOString(),
    })),
    pagination: paged.pagination,
  };
}

export async function getWorkspaceRepositoryById(workspaceId: string, repositoryId: string) {
  const prisma = getPrisma();

  const repo = await prisma.repository.findUnique({
    where: {
      workspaceId_id: {
        workspaceId,
        id: repositoryId,
      },
    },
    include: {
      githubInstallation: {
        select: {
          id: true,
          accountLogin: true,
          accountType: true,
          status: true,
        },
      },
      branches: {
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      },
      commits: {
        orderBy: { committedAt: 'desc' },
        take: 25,
      },
    },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found in this workspace', 'REPOSITORY_NOT_FOUND');
  }

  return {
    id: repo.id,
    workspaceId: repo.workspaceId,
    githubRepoId: repo.githubRepoId.toString(),
    ownerLogin: repo.ownerLogin,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    defaultBranch: repo.defaultBranch,
    visibility: repo.visibility,
    primaryLanguage: repo.primaryLanguage,
    isActive: repo.isActive,
    lastSyncedAt: repo.lastSyncedAt?.toISOString() ?? null,
    createdAt: repo.createdAt.toISOString(),
    updatedAt: repo.updatedAt.toISOString(),
    installation: repo.githubInstallation,
    branches: repo.branches.map((b) => ({
      id: b.id,
      name: b.name,
      headSha: b.headSha,
      isDefault: b.isDefault,
      isProtected: b.isProtected,
      lastCommitAt: b.lastCommitAt?.toISOString() ?? null,
    })),
    recentCommits: repo.commits.map((c) => ({
      id: c.id,
      sha: c.sha,
      messageHeadline: c.messageHeadline,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt.toISOString(),
    })),
  };
}
