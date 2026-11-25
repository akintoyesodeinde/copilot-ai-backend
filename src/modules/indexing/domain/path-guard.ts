import path from 'node:path';

export const MAX_INDEXABLE_FILE_BYTES = 512 * 1024; // 512 KiB

const EXCLUDED_DIRECTORY_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'target',
  'bin',
  'obj',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.mov',
]);

const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
]);

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.kdbx']);

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
]);

export interface FileGuardDecision {
  allowed: boolean;
  normalizedPath: string;
  reason?: string;
}

export function evaluateIndexableFile(filePath: string, content: string): FileGuardDecision {
  if (!filePath || filePath.includes('\0')) {
    return { allowed: false, normalizedPath: '', reason: 'INVALID_PATH_NULL_BYTE' };
  }

  const slashPath = filePath.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || /^[A-Za-z]:/.test(slashPath)) {
    return { allowed: false, normalizedPath: slashPath, reason: 'ABSOLUTE_PATH_BLOCKED' };
  }

  const normalized = path.posix.normalize(slashPath);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return { allowed: false, normalizedPath: normalized, reason: 'PATH_TRAVERSAL_BLOCKED' };
  }

  const segments = normalized.split('/');
  for (const seg of segments) {
    if (EXCLUDED_DIRECTORY_SEGMENTS.has(seg)) {
      return { allowed: false, normalizedPath: normalized, reason: `EXCLUDED_DIR:${seg}` };
    }
  }

  const baseName = segments[segments.length - 1] ?? '';
  const ext = path.posix.extname(baseName).toLowerCase();

  if (
    SENSITIVE_FILENAMES.has(baseName) ||
    baseName.startsWith('.env.') ||
    SENSITIVE_EXTENSIONS.has(ext)
  ) {
    return { allowed: false, normalizedPath: normalized, reason: 'SENSITIVE_CONFIG_EXCLUDED' };
  }

  if (LOCKFILES.has(baseName)) {
    return { allowed: false, normalizedPath: normalized, reason: 'GENERATED_LOCKFILE_EXCLUDED' };
  }

  if (BINARY_EXTENSIONS.has(ext) || content.includes('\0')) {
    return { allowed: false, normalizedPath: normalized, reason: 'BINARY_FILE_EXCLUDED' };
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_INDEXABLE_FILE_BYTES) {
    return { allowed: false, normalizedPath: normalized, reason: 'OVERSIZED_FILE_EXCLUDED' };
  }

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    return { allowed: false, normalizedPath: normalized, reason: 'PRIVATE_KEY_MATERIAL_EXCLUDED' };
  }

  return { allowed: true, normalizedPath: normalized };
}

export function detectLanguageFromPath(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.java':
      return 'java';
    case '.cs':
      return 'c_sharp';
    case '.rs':
      return 'rust';
    case '.sql':
      return 'sql';
    case '.json':
      return 'json';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.md':
      return 'markdown';
    default:
      return 'text';
  }
}
