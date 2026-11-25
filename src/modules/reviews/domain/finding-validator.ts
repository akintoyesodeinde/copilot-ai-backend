import type { FindingSeverity, FindingSource } from '@/generated/prisma/client';
import { sha256Hex } from '@/shared/security/tokens';
import type { StructuredPrReviewOutput } from '@/modules/ai/domain/types';

export interface DiffFileInput {
  filePath: string;
  patch: string | null;
}

export interface NormalizedFinding {
  fingerprint: string;
  source: FindingSource;
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  suggestion: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  evidenceSnippet: string | null;
  confidence: number | null;
}

export interface DiffLineCoverage {
  validLines: Set<number>;
  maxRightLine: number;
}

export function parsePatchRightLines(patch: string | null): DiffLineCoverage {
  const validLines = new Set<number>();
  let maxRightLine = 1;
  if (!patch) {
    return { validLines, maxRightLine };
  }

  let currentRightLine = 1;
  for (const line of patch.split(/\r?\n/)) {
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (hunk?.[1]) {
      currentRightLine = Number.parseInt(hunk[1], 10);
      const span = hunk[2] ? Number.parseInt(hunk[2], 10) : 1;
      maxRightLine = Math.max(maxRightLine, currentRightLine + Math.max(1, span));
      continue;
    }

    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }

    if (line.startsWith('+')) {
      validLines.add(currentRightLine);
      maxRightLine = Math.max(maxRightLine, currentRightLine);
      currentRightLine += 1;
    } else if (!line.startsWith('-')) {
      validLines.add(currentRightLine);
      maxRightLine = Math.max(maxRightLine, currentRightLine);
      currentRightLine += 1;
    }
  }

  return { validLines, maxRightLine };
}

export function computeFindingFingerprint(finding: {
  filePath: string;
  startLine: number;
  category: string;
  title: string;
}): string {
  const normalized = [
    finding.filePath.trim().toLowerCase(),
    String(finding.startLine),
    finding.category.trim().toUpperCase(),
    finding.title.trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
  return sha256Hex(normalized);
}

const DETERMINISTIC_RULES: Array<{
  pattern: RegExp;
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  suggestion: string;
}> = [
  {
    pattern: /\beval\s*\(/,
    severity: 'CRITICAL',
    category: 'SECURITY',
    title: 'Dangerous eval() execution detected',
    description:
      'Deterministic static rule: eval() executes arbitrary strings as code and introduces severe code-injection risk.',
    suggestion: 'Remove eval() and use a safe declarative parser or allowlisted dispatch map.',
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    severity: 'HIGH',
    category: 'SECURITY',
    title: 'Raw HTML injection surface via dangerouslySetInnerHTML',
    description:
      'Deterministic static rule: injecting unsanitized HTML exposes users to Cross-Site Scripting (XSS).',
    suggestion: 'Render structured React elements or sanitize HTML through DOMPurify.',
  },
  {
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+.+\$\{/i,
    severity: 'HIGH',
    category: 'SECURITY',
    title: 'SQL query string interpolation detected',
    description:
      'Deterministic static rule: interpolating expressions into SQL text can permit SQL injection.',
    suggestion: 'Use Prisma parameterized queries or bound SQL placeholders.',
  },
  {
    pattern: /(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/,
    severity: 'CRITICAL',
    category: 'SECURITY',
    title: 'Potential hardcoded credential detected in diff',
    description:
      'Deterministic static rule: credential-like token pattern detected in added lines (value redacted).',
    suggestion:
      'Rotate the credential immediately and inject secrets via AWS Parameter Store or environment variables.',
  },
];

export function runDeterministicDiffChecks(changedFiles: DiffFileInput[]): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];

  for (const file of changedFiles) {
    if (!file.patch) continue;
    let rightLine = 1;

    for (const line of file.patch.split(/\r?\n/)) {
      const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      if (hunk?.[1]) {
        rightLine = Number.parseInt(hunk[1], 10);
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        const added = line.slice(1);
        for (const rule of DETERMINISTIC_RULES) {
          if (rule.pattern.test(added)) {
            const safeSnippet = rule.title.includes('credential')
              ? '[REDACTED_CREDENTIAL_PATTERN]'
              : added.trim().slice(0, 300);
            findings.push({
              fingerprint: computeFindingFingerprint({
                filePath: file.filePath,
                startLine: rightLine,
                category: rule.category,
                title: rule.title,
              }),
              source: 'DETERMINISTIC',
              severity: rule.severity,
              category: rule.category,
              title: rule.title,
              description: rule.description,
              suggestion: rule.suggestion,
              filePath: file.filePath,
              startLine: rightLine,
              endLine: rightLine,
              evidenceSnippet: safeSnippet,
              confidence: 1.0,
            });
          }
        }
        rightLine += 1;
      } else if (!line.startsWith('-') && !line.startsWith('---')) {
        rightLine += 1;
      }
    }
  }

  return findings;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/**
 * Validates AI findings against actual changed files & diff line coverage,
 * drops hallucinated paths/lines, merges deterministic findings, and deduplicates.
 */
export function validateAndNormalizeFindings(
  changedFiles: DiffFileInput[],
  deterministicFindings: NormalizedFinding[],
  aiFindings: StructuredPrReviewOutput['findings'],
): {
  accepted: NormalizedFinding[];
  rejectedCount: number;
  rejectionReasons: string[];
} {
  const coverageByFile = new Map<string, DiffLineCoverage>();
  for (const file of changedFiles) {
    coverageByFile.set(file.filePath, parsePatchRightLines(file.patch));
  }

  const byKey = new Map<string, NormalizedFinding>();
  const lineCategorySeen = new Set<string>();

  for (const det of deterministicFindings) {
    byKey.set(det.fingerprint, det);
    lineCategorySeen.add(`${det.filePath}:${det.startLine}:${det.category}`);
  }

  let rejectedCount = 0;
  const rejectionReasons: string[] = [];

  for (const raw of aiFindings) {
    const coverage = coverageByFile.get(raw.filePath);
    if (!coverage) {
      rejectedCount += 1;
      rejectionReasons.push(`Rejected hallucinated filePath: ${raw.filePath}`);
      continue;
    }

    const lineWithinBounds =
      raw.startLine >= 1 &&
      raw.endLine >= raw.startLine &&
      (coverage.validLines.size === 0 ||
        coverage.validLines.has(raw.startLine) ||
        raw.startLine <= coverage.maxRightLine + 5);

    if (!lineWithinBounds) {
      rejectedCount += 1;
      rejectionReasons.push(
        `Rejected out-of-range line reference ${raw.filePath}:${raw.startLine}-${raw.endLine}`,
      );
      continue;
    }

    // Deduplicate AI finding if deterministic scanner already flagged the exact same file/line/category
    const lineCatKey = `${raw.filePath}:${raw.startLine}:${raw.category}`;
    if (lineCategorySeen.has(lineCatKey)) {
      continue;
    }

    const fingerprint = computeFindingFingerprint({
      filePath: raw.filePath,
      startLine: raw.startLine,
      category: raw.category,
      title: raw.title,
    });

    if (!byKey.has(fingerprint)) {
      byKey.set(fingerprint, {
        fingerprint,
        source: 'AI',
        severity: raw.severity,
        category: raw.category,
        title: raw.title,
        description: raw.description,
        suggestion: raw.suggestion ?? null,
        filePath: raw.filePath,
        startLine: raw.startLine,
        endLine: raw.endLine,
        evidenceSnippet: raw.evidenceSnippet ?? null,
        confidence: raw.confidence,
      });
      lineCategorySeen.add(lineCatKey);
    }
  }

  const accepted = Array.from(byKey.values()).sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.filePath.localeCompare(b.filePath),
  );

  return { accepted, rejectedCount, rejectionReasons };
}
