import path from 'node:path';
import { getPrisma } from '@/shared/database/prisma';
import { ForbiddenError, NotFoundError } from '@/shared/http/problem-details';
import { sha256Hex } from '@/shared/security/tokens';
import { getGithubGateway } from '@/modules/github/infrastructure/github-client';
import { getArtifactStorage } from '@/modules/jobs/infrastructure/s3-storage';
import {
  detectLanguageFromPath,
  evaluateIndexableFile,
} from '@/modules/indexing/domain/path-guard';
import { parseSourceAst } from '@/modules/indexing/infrastructure/ast-parser';

const MAX_LINES_PER_CHUNK = 80;

function resolveRelativeImport(sourceFilePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const baseDir = path.posix.dirname(sourceFilePath);
  const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
  return resolved.startsWith('..') ? null : resolved;
}

function splitIntoCodeChunks(
  filePath: string,
  language: string,
  content: string,
  symbols: Array<{ name: string; startLine: number; endLine: number }>,
): Array<{
  chunkIndex: number;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  content: string;
  tokenEstimate: number;
}> {
  const lines = content.split(/\r?\n/);
  const chunks: Array<{
    chunkIndex: number;
    startLine: number;
    endLine: number;
    symbolName: string | null;
    content: string;
    tokenEstimate: number;
  }> = [];

  let chunkIdx = 0;
  for (let start = 0; start < lines.length; start += MAX_LINES_PER_CHUNK) {
    const slice = lines.slice(start, start + MAX_LINES_PER_CHUNK);
    const startLine = start + 1;
    const endLine = start + slice.length;
    const chunkText = slice.join('\n');
    const overlappingSymbol = symbols.find(
      (s) => s.startLine >= startLine && s.startLine <= endLine,
    );

    chunks.push({
      chunkIndex: chunkIdx++,
      startLine,
      endLine,
      symbolName: overlappingSymbol?.name ?? null,
      content: chunkText,
      tokenEstimate: Math.max(1, Math.ceil(chunkText.length / 4)),
    });
  }

  if (chunks.length === 0) {
    chunks.push({
      chunkIndex: 0,
      startLine: 1,
      endLine: 1,
      symbolName: null,
      content: `// Empty file: ${filePath} (${language})`,
      tokenEstimate: 8,
    });
  }

  return chunks;
}

export async function executeRepoIndexJob(
  workspaceId: string,
  repositoryId: string,
  requestedCommitSha?: string,
) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    include: {
      githubInstallation: true,
      branches: { where: { isDefault: true }, take: 1 },
    },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository is inactive or access has been revoked');
  }

  const commitSha =
    requestedCommitSha || repo.branches[0]?.headSha || 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  const installationId = repo.githubInstallation?.githubInstallationId ?? BigInt(90000101);
  if (repo.githubInstallation && repo.githubInstallation.status !== 'ACTIVE') {
    throw new ForbiddenError('GitHub App installation is revoked; indexing blocked');
  }

  // Upsert commit-scoped index record
  const indexRecord = await prisma.repositoryIndex.upsert({
    where: {
      workspaceId_repositoryId_commitSha: { workspaceId, repositoryId, commitSha },
    },
    update: {
      status: 'INDEXING',
      startedAt: new Date(),
      errorMessage: null,
    },
    create: {
      workspaceId,
      repositoryId,
      commitSha,
      status: 'INDEXING',
      startedAt: new Date(),
    },
  });

  try {
    const gateway = getGithubGateway();
    const rawFiles = await gateway.fetchRepositorySnapshotFiles(
      installationId,
      repo.ownerLogin,
      repo.name,
      commitSha,
    );

    let filesIndexed = 0;
    let symbolsExtracted = 0;
    let chunksCreated = 0;
    let excludedCount = 0;
    const artifactManifest: Array<{ filePath: string; language: string; contentHash: string }> = [];

    for (const rawFile of rawFiles) {
      const guard = evaluateIndexableFile(rawFile.filePath, rawFile.content);
      if (!guard.allowed) {
        excludedCount += 1;
        continue;
      }

      const language = detectLanguageFromPath(guard.normalizedPath);
      const contentHash = sha256Hex(rawFile.content);
      const sizeBytes = Buffer.byteLength(rawFile.content, 'utf8');
      const lineCount = rawFile.content.split(/\r?\n/).length;

      // Incremental indexing check: skip re-parsing if exact same file hash already indexed for this commit
      const existingFile = await prisma.repositoryFile.findUnique({
        where: {
          workspaceId_repositoryId_commitSha_filePath: {
            workspaceId,
            repositoryId,
            commitSha,
            filePath: guard.normalizedPath,
          },
        },
      });

      const s3Key = `workspaces/${workspaceId}/repos/${repositoryId}/commits/${commitSha}/files/${guard.normalizedPath}.json`;
      await getArtifactStorage().putJsonArtifact(s3Key, {
        filePath: guard.normalizedPath,
        commitSha,
        language,
        contentHash,
        content: rawFile.content,
      });

      const savedFile = await prisma.repositoryFile.upsert({
        where: {
          workspaceId_repositoryId_commitSha_filePath: {
            workspaceId,
            repositoryId,
            commitSha,
            filePath: guard.normalizedPath,
          },
        },
        update: {
          indexId: indexRecord.id,
          language,
          sizeBytes,
          lineCount,
          contentHash,
          contentPreview: rawFile.content.slice(0, 32_000),
          s3ObjectKey: s3Key,
          isExcluded: false,
          exclusionReason: null,
        },
        create: {
          workspaceId,
          repositoryId,
          indexId: indexRecord.id,
          commitSha,
          filePath: guard.normalizedPath,
          language,
          sizeBytes,
          lineCount,
          contentHash,
          contentPreview: rawFile.content.slice(0, 32_000),
          s3ObjectKey: s3Key,
          isExcluded: false,
        },
      });

      artifactManifest.push({
        filePath: guard.normalizedPath,
        language,
        contentHash,
      });

      if (existingFile && existingFile.contentHash === contentHash) {
        filesIndexed += 1;
        continue;
      }

      const parsed = await parseSourceAst(language, rawFile.content);
      const chunks = splitIntoCodeChunks(
        guard.normalizedPath,
        language,
        rawFile.content,
        parsed.symbols,
      );

      await prisma.$transaction(
        async (tx) => {
          await tx.codeSymbol.deleteMany({
            where: { workspaceId, fileId: savedFile.id },
          });
          await tx.codeChunk.deleteMany({
            where: { workspaceId, fileId: savedFile.id },
          });
          await tx.codeDependency.deleteMany({
            where: { workspaceId, indexId: indexRecord.id, sourceFilePath: guard.normalizedPath },
          });

          if (parsed.symbols.length > 0) {
            await tx.codeSymbol.createMany({
              data: parsed.symbols.map((s) => ({
                workspaceId,
                repositoryId,
                fileId: savedFile.id,
                commitSha,
                filePath: guard.normalizedPath,
                name: s.name,
                kind: s.kind,
                signature: s.signature,
                startLine: s.startLine,
                endLine: s.endLine,
                exported: s.exported,
              })),
            });
          }

          await tx.codeChunk.createMany({
            data: chunks.map((c) => ({
              workspaceId,
              repositoryId,
              fileId: savedFile.id,
              commitSha,
              filePath: guard.normalizedPath,
              chunkIndex: c.chunkIndex,
              startLine: c.startLine,
              endLine: c.endLine,
              symbolName: c.symbolName,
              language,
              content: c.content,
              tokenEstimate: c.tokenEstimate,
            })),
          });

          if (parsed.dependencies.length > 0) {
            await tx.codeDependency.createMany({
              data: parsed.dependencies.map((d) => ({
                workspaceId,
                repositoryId,
                indexId: indexRecord.id,
                commitSha,
                sourceFilePath: guard.normalizedPath,
                targetSpecifier: d.targetSpecifier,
                resolvedTargetPath: resolveRelativeImport(guard.normalizedPath, d.targetSpecifier),
                dependencyType: d.dependencyType,
                lineNumber: d.lineNumber,
              })),
            });
          }
        },
        { maxWait: 15_000, timeout: 30_000 },
      );

      filesIndexed += 1;
      symbolsExtracted += parsed.symbols.length;
      chunksCreated += chunks.length;
    }

    const indexArtifactKey = `workspaces/${workspaceId}/repos/${repositoryId}/commits/${commitSha}/index-manifest.json`;
    const artifactUri = await getArtifactStorage().putJsonArtifact(indexArtifactKey, {
      workspaceId,
      repositoryId,
      commitSha,
      filesIndexed,
      excludedCount,
      symbolsExtracted,
      chunksCreated,
      files: artifactManifest,
    });

    await prisma.repositoryIndex.update({
      where: { id: indexRecord.id },
      data: {
        status: 'COMPLETED',
        filesIndexed,
        symbolsExtracted,
        chunksCreated,
        s3ArtifactKey: artifactUri,
        completedAt: new Date(),
      },
    });

    return {
      indexId: indexRecord.id,
      commitSha,
      filesIndexed,
      excludedCount,
      symbolsExtracted,
      chunksCreated,
      artifactUri,
    };
  } catch (error) {
    await prisma.repositoryIndex.update({
      where: { id: indexRecord.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Indexing failed',
      },
    });
    throw error;
  }
}

export async function listRepositoryFiles(
  workspaceId: string,
  repositoryId: string,
  filters?: { commitSha?: string; language?: string; search?: string },
) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, isActive: true, accessRevokedAt: true },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found in this workspace', 'REPOSITORY_NOT_FOUND');
  }

  let targetCommitSha = filters?.commitSha;
  if (!targetCommitSha) {
    const latestIndex = await prisma.repositoryIndex.findFirst({
      where: { workspaceId, repositoryId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { commitSha: true },
    });
    targetCommitSha = latestIndex?.commitSha;
  }

  if (!targetCommitSha) {
    return { commitSha: null, items: [] };
  }

  const files = await prisma.repositoryFile.findMany({
    where: {
      workspaceId,
      repositoryId,
      commitSha: targetCommitSha,
      isExcluded: false,
      ...(filters?.language ? { language: filters.language } : {}),
      ...(filters?.search ? { filePath: { contains: filters.search } } : {}),
    },
    orderBy: { filePath: 'asc' },
    take: 250,
  });

  return {
    commitSha: targetCommitSha,
    items: files.map((f) => ({
      id: f.id,
      filePath: f.filePath,
      language: f.language,
      sizeBytes: f.sizeBytes,
      lineCount: f.lineCount,
      contentHash: f.contentHash,
      contentPreview: f.contentPreview,
      updatedAt: f.updatedAt.toISOString(),
    })),
  };
}

export async function listRepositorySymbols(
  workspaceId: string,
  repositoryId: string,
  filters?: { commitSha?: string; kind?: string; search?: string },
) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, isActive: true, accessRevokedAt: true },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found in this workspace', 'REPOSITORY_NOT_FOUND');
  }

  let targetCommitSha = filters?.commitSha;
  if (!targetCommitSha) {
    const latestIndex = await prisma.repositoryIndex.findFirst({
      where: { workspaceId, repositoryId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { commitSha: true },
    });
    targetCommitSha = latestIndex?.commitSha;
  }

  if (!targetCommitSha) {
    return { commitSha: null, items: [] };
  }

  const symbols = await prisma.codeSymbol.findMany({
    where: {
      workspaceId,
      repositoryId,
      commitSha: targetCommitSha,
      ...(filters?.kind ? { kind: filters.kind } : {}),
      ...(filters?.search ? { name: { contains: filters.search } } : {}),
    },
    orderBy: [{ filePath: 'asc' }, { startLine: 'asc' }],
    take: 300,
  });

  return {
    commitSha: targetCommitSha,
    items: symbols.map((s) => ({
      id: s.id,
      filePath: s.filePath,
      name: s.name,
      kind: s.kind,
      signature: s.signature,
      startLine: s.startLine,
      endLine: s.endLine,
      exported: s.exported,
    })),
  };
}

/**
 * Tenant-scoped MySQL FULLTEXT RAG context retrieval for AI reviews & assistant.
 */
export async function retrieveRelevantCodeChunks(
  workspaceId: string,
  repositoryId: string,
  queryTerms: string,
  limit = 6,
): Promise<Array<{ filePath: string; startLine: number; endLine: number; content: string }>> {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { isActive: true, accessRevokedAt: true },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    return [];
  }

  const sanitized = queryTerms
    .replace(/[^A-Za-z0-9_.\s/-]/g, ' ')
    .trim()
    .slice(0, 200);

  if (sanitized.length >= 3) {
    try {
      const ftsRows = await prisma.$queryRaw<
        Array<{ file_path: string; start_line: number; end_line: number; content: string }>
      >`
        SELECT file_path, start_line, end_line, content
        FROM code_chunks
        WHERE workspace_id = ${workspaceId}
          AND repository_id = ${repositoryId}
          AND MATCH(content, file_path, symbol_name) AGAINST (${sanitized} IN NATURAL LANGUAGE MODE)
        LIMIT ${limit}
      `;
      if (ftsRows.length > 0) {
        return ftsRows.map((r) => ({
          filePath: r.file_path,
          startLine: r.start_line,
          endLine: r.end_line,
          content: r.content,
        }));
      }
    } catch {
      // Fallback to latest indexed chunks for this tenant repository
    }
  }

  const fallback = await prisma.codeChunk.findMany({
    where: { workspaceId, repositoryId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { filePath: true, startLine: true, endLine: true, content: true },
  });

  return fallback;
}
