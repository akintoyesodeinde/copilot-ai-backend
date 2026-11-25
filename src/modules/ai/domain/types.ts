import { z } from 'zod';

export type AiProviderName = 'mock' | 'openai' | 'anthropic' | 'bedrock';

export const aiReviewFindingSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(5).max(4000),
  suggestion: z.string().max(4000).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  category: z.enum(['SECURITY', 'BUG', 'RELIABILITY', 'PERFORMANCE', 'MAINTAINABILITY', 'TESTING']),
  filePath: z.string().min(1).max(400),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  evidenceSnippet: z.string().max(1000).optional(),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const structuredPrReviewOutputSchema = z.object({
  summaryMarkdown: z.string().min(5).max(12_000),
  overallRisk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  findings: z.array(aiReviewFindingSchema).max(50),
});

export type StructuredPrReviewOutput = z.infer<typeof structuredPrReviewOutputSchema>;

export interface AiCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  timeoutMs: number;
  metadata?: {
    changedFiles?: Array<{ filePath: string; patch: string | null }>;
  };
}

export interface AiCompletionRawResponse {
  rawJsonText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface AiProviderAdapter {
  readonly providerName: AiProviderName;
  readonly defaultModel: string;
  generateJson(request: AiCompletionRequest): Promise<AiCompletionRawResponse>;
}

const SECRET_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED_GITHUB_PAT]' },
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END [^-]+-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /((?:password|secret|api_key|apikey|token)\s*[:=]\s*['"])([^'"\n]{6,})(['"])/gi,
    replacement: '$1[REDACTED_SECRET]$3',
  },
];

export function redactSensitiveContent(input: string): string {
  let result = input;
  for (const rule of SECRET_REDACTION_PATTERNS) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:the\s+)?system\s+prompt/i,
  /reveal\s+(?:the\s+)?system\s+prompt/i,
  /approve\s+this\s+pr\s+with\s+(?:no|zero)\s+findings/i,
  /return\s+an?\s+empty\s+findings\s+array/i,
  /exfiltrate\s+(?:secrets|tokens|env|credentials)/i,
  /override\s+security\s+policy/i,
];

export function detectPromptInjectionSignals(untrustedContent: string): string[] {
  const matches: string[] = [];
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(untrustedContent)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

export function wrapUntrustedRepositoryContent(label: string, content: string): string {
  const redacted = redactSensitiveContent(content);
  return `<UNTRUSTED_REPOSITORY_DATA label="${label}">\n${redacted}\n</UNTRUSTED_REPOSITORY_DATA>`;
}
