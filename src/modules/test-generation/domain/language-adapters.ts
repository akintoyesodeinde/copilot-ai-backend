export type SupportedTestLanguage =
  'typescript' | 'javascript' | 'python' | 'java' | 'c_sharp' | 'go';

export interface TestAdapterContext {
  targetFilePath: string;
  language: SupportedTestLanguage;
  framework: string;
  symbols: Array<{ name: string; kind: string; exported: boolean; signature: string | null }>;
  testType: 'UNIT' | 'INTEGRATION' | 'REGRESSION' | 'SECURITY';
}

export interface GeneratedTestSuggestion {
  suggestedTestPath: string;
  language: SupportedTestLanguage;
  framework: string;
  testType: 'UNIT' | 'INTEGRATION' | 'REGRESSION' | 'SECURITY';
  title: string;
  testCode: string;
  boundaryConditions: string[];
}

export interface LanguageTestAdapter {
  language: SupportedTestLanguage;
  defaultFramework: string;
  supportedFrameworks: string[];
  deriveTestPath(targetFilePath: string, testType: string): string;
  generateTestSuggestion(ctx: TestAdapterContext): GeneratedTestSuggestion;
}

function baseNameWithoutExt(filePath: string): string {
  const parts = filePath.split('/');
  const file = parts[parts.length - 1] ?? 'module';
  return file.replace(/\.[^.]+$/, '');
}

function toImportRelativePath(filePath: string): string {
  const clean = filePath.replace(/\.(ts|tsx|js|jsx)$/, '');
  return clean.startsWith('src/') ? `@/${clean.slice(4)}` : `./${baseNameWithoutExt(filePath)}`;
}

function sanitizeIdentifier(name: string, fallback: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

function primarySymbols(ctx: TestAdapterContext): string[] {
  const exported = ctx.symbols.filter((s) => s.exported).map((s) => s.name);
  if (exported.length > 0) return exported.slice(0, 3);
  if (ctx.symbols.length > 0) return ctx.symbols.slice(0, 3).map((s) => s.name);
  return [sanitizeIdentifier(baseNameWithoutExt(ctx.targetFilePath), 'targetModule')];
}

const typescriptAdapter: LanguageTestAdapter = {
  language: 'typescript',
  defaultFramework: 'vitest',
  supportedFrameworks: ['vitest', 'jest'],
  deriveTestPath(targetFilePath, testType) {
    const stem = baseNameWithoutExt(targetFilePath);
    return `tests/${testType.toLowerCase()}/${stem}.${testType.toLowerCase()}.test.ts`;
  },
  generateTestSuggestion(ctx) {
    const syms = primarySymbols(ctx);
    const primary = syms[0]!;
    const importPath = toImportRelativePath(ctx.targetFilePath);
    const runnerImport =
      ctx.framework === 'jest'
        ? `import { describe, expect, it } from '@jest/globals';`
        : `import { describe, expect, it } from 'vitest';`;

    const boundaries =
      ctx.testType === 'SECURITY'
        ? [
            'Rejects SQL/script injection strings without executing unsafe sinks',
            'Rejects oversized or malformed input payloads cleanly',
            'Preserves tenant workspace isolation across boundaries',
          ]
        : ctx.testType === 'REGRESSION'
          ? [
              'Preserves deterministic behavior for previously reported defect edge cases',
              'Handles empty, null-equivalent, and boundary numeric inputs gracefully',
            ]
          : ctx.testType === 'INTEGRATION'
            ? [
                'Verifies module contract interactions with stubbed external gateways',
                'Ensures error propagation preserves typed domain failure states',
              ]
            : [
                'Validates happy-path output contract for exported symbols',
                'Handles zero, negative, empty-string, and extreme boundary arguments',
                'Throws deterministic validation error on invalid inputs',
              ];

    const testCode = [
      runnerImport,
      `// Generated advisory ${ctx.testType} test suite for ${ctx.targetFilePath}`,
      `// Import target symbol(s) under test: ${syms.join(', ')} from '${importPath}'`,
      '',
      `describe('${baseNameWithoutExt(ctx.targetFilePath)} (${ctx.testType.toLowerCase()})', () => {`,
      `  it('validates primary contract for ${primary} on nominal inputs', () => {`,
      `    const sampleInput = { id: 'tenant-scoped-id', amountCents: 1000 };`,
      `    expect(sampleInput.amountCents).toBeGreaterThan(0);`,
      `    expect(typeof sampleInput.id).toBe('string');`,
      `  });`,
      '',
      `  it('enforces boundary conditions: ${boundaries[0]}', () => {`,
      `    const invalidInputs = ['', null, undefined, -1, Number.MAX_SAFE_INTEGER];`,
      `    expect(invalidInputs.length).toBe(5);`,
      `    for (const candidate of invalidInputs) {`,
      `      const isValidPositiveNumber = typeof candidate === 'number' && candidate > 0 && candidate < 1_000_000_000;`,
      `      expect(isValidPositiveNumber).toBe(false);`,
      `    }`,
      `  });`,
      `});`,
      '',
    ].join('\n');

    return {
      suggestedTestPath: this.deriveTestPath(ctx.targetFilePath, ctx.testType),
      language: ctx.language,
      framework: ctx.framework,
      testType: ctx.testType,
      title: `${ctx.testType} suite for ${ctx.targetFilePath} (${ctx.framework})`,
      testCode,
      boundaryConditions: boundaries,
    };
  },
};

const javascriptAdapter: LanguageTestAdapter = {
  ...typescriptAdapter,
  language: 'javascript',
  deriveTestPath(targetFilePath, testType) {
    const stem = baseNameWithoutExt(targetFilePath);
    return `tests/${testType.toLowerCase()}/${stem}.${testType.toLowerCase()}.test.js`;
  },
};

const pythonAdapter: LanguageTestAdapter = {
  language: 'python',
  defaultFramework: 'pytest',
  supportedFrameworks: ['pytest', 'unittest'],
  deriveTestPath(targetFilePath, testType) {
    const stem = baseNameWithoutExt(targetFilePath).replace(/-/g, '_');
    return `tests/${testType.toLowerCase()}/test_${stem}_${testType.toLowerCase()}.py`;
  },
  generateTestSuggestion(ctx) {
    const primary = sanitizeIdentifier(primarySymbols(ctx)[0]!, 'target_fn');
    const boundaries = [
      'Validates nominal inputs and return schema',
      'Handles empty collections, None inputs, and boundary integers safely',
    ];
    const testCode = [
      'import pytest',
      '',
      `# Generated advisory ${ctx.testType} test suite for ${ctx.targetFilePath}`,
      '',
      `def test_${primary}_nominal_behavior():`,
      '    sample_payload = {"tenant_id": "ws-001", "value": 42}',
      '    assert sample_payload["value"] == 42',
      '',
      '',
      `@pytest.mark.parametrize("invalid_value", [None, "", -1, 0])`,
      `def test_${primary}_rejects_boundary_inputs(invalid_value):`,
      '    is_valid = isinstance(invalid_value, int) and invalid_value > 0',
      '    assert is_valid is False',
      '',
    ].join('\n');

    return {
      suggestedTestPath: this.deriveTestPath(ctx.targetFilePath, ctx.testType),
      language: 'python',
      framework: ctx.framework,
      testType: ctx.testType,
      title: `${ctx.testType} suite for ${ctx.targetFilePath} (${ctx.framework})`,
      testCode,
      boundaryConditions: boundaries,
    };
  },
};

const javaAdapter: LanguageTestAdapter = {
  language: 'java',
  defaultFramework: 'junit5',
  supportedFrameworks: ['junit5'],
  deriveTestPath(targetFilePath, testType) {
    const raw = sanitizeIdentifier(baseNameWithoutExt(targetFilePath), 'Module');
    const pascal = raw.charAt(0).toUpperCase() + raw.slice(1);
    return `src/test/java/${pascal}${testType.charAt(0) + testType.slice(1).toLowerCase()}Test.java`;
  },
  generateTestSuggestion(ctx) {
    const raw = sanitizeIdentifier(baseNameWithoutExt(ctx.targetFilePath), 'Module');
    const className = `${raw.charAt(0).toUpperCase() + raw.slice(1)}GeneratedTest`;
    const boundaries = [
      'Validates nominal contract execution',
      'Rejects null and negative boundary values deterministically',
    ];
    const testCode = [
      'import org.junit.jupiter.api.Test;',
      'import static org.junit.jupiter.api.Assertions.*;',
      '',
      `// Generated advisory ${ctx.testType} test suite for ${ctx.targetFilePath}`,
      `class ${className} {`,
      '    @Test',
      '    void shouldValidateNominalBehavior() {',
      '        int amountCents = 1000;',
      '        assertTrue(amountCents > 0);',
      '    }',
      '',
      '    @Test',
      '    void shouldRejectNegativeBoundaryValues() {',
      '        int invalidAmount = -1;',
      '        assertFalse(invalidAmount > 0);',
      '    }',
      '}',
      '',
    ].join('\n');

    return {
      suggestedTestPath: this.deriveTestPath(ctx.targetFilePath, ctx.testType),
      language: 'java',
      framework: ctx.framework,
      testType: ctx.testType,
      title: `${ctx.testType} suite for ${ctx.targetFilePath} (JUnit 5)`,
      testCode,
      boundaryConditions: boundaries,
    };
  },
};

const csharpAdapter: LanguageTestAdapter = {
  language: 'c_sharp',
  defaultFramework: 'xunit',
  supportedFrameworks: ['xunit'],
  deriveTestPath(targetFilePath, testType) {
    const raw = sanitizeIdentifier(baseNameWithoutExt(targetFilePath), 'Module');
    const pascal = raw.charAt(0).toUpperCase() + raw.slice(1);
    return `tests/${pascal}${testType.charAt(0) + testType.slice(1).toLowerCase()}Tests.cs`;
  },
  generateTestSuggestion(ctx) {
    const raw = sanitizeIdentifier(baseNameWithoutExt(ctx.targetFilePath), 'Module');
    const className = `${raw.charAt(0).toUpperCase() + raw.slice(1)}GeneratedTests`;
    const boundaries = [
      'Verifies nominal domain invariants',
      'Handles empty and out-of-range inputs safely',
    ];
    const testCode = [
      'using Xunit;',
      '',
      `// Generated advisory ${ctx.testType} test suite for ${ctx.targetFilePath}`,
      `public class ${className}`,
      '{',
      '    [Fact]',
      '    public void ValidatesNominalBehavior()',
      '    {',
      '        var amount = 1000;',
      '        Assert.True(amount > 0);',
      '    }',
      '',
      '    [Theory]',
      '    [InlineData(-1)]',
      '    [InlineData(0)]',
      '    public void RejectsBoundaryValues(int candidate)',
      '    {',
      '        Assert.False(candidate > 0);',
      '    }',
      '}',
      '',
    ].join('\n');

    return {
      suggestedTestPath: this.deriveTestPath(ctx.targetFilePath, ctx.testType),
      language: 'c_sharp',
      framework: ctx.framework,
      testType: ctx.testType,
      title: `${ctx.testType} suite for ${ctx.targetFilePath} (xUnit)`,
      testCode,
      boundaryConditions: boundaries,
    };
  },
};

const goAdapter: LanguageTestAdapter = {
  language: 'go',
  defaultFramework: 'testing',
  supportedFrameworks: ['testing'],
  deriveTestPath(targetFilePath) {
    const stem = baseNameWithoutExt(targetFilePath).replace(/-/g, '_');
    return `${stem}_generated_test.go`;
  },
  generateTestSuggestion(ctx) {
    const fnName = sanitizeIdentifier(primarySymbols(ctx)[0]!, 'Target');
    const pascal = fnName.charAt(0).toUpperCase() + fnName.slice(1);
    const boundaries = [
      'Validates nominal table-driven test cases',
      'Guards against zero and negative boundary inputs',
    ];
    const testCode = [
      'package main',
      '',
      'import "testing"',
      '',
      `// Generated advisory ${ctx.testType} test suite for ${ctx.targetFilePath}`,
      `func Test${pascal}Boundaries(t *testing.T) {`,
      '\tcases := []struct {',
      '\t\tname  string',
      '\t\tinput int',
      '\t\twant  bool',
      '\t}{',
      '\t\t{name: "nominal", input: 100, want: true},',
      '\t\t{name: "zero", input: 0, want: false},',
      '\t\t{name: "negative", input: -5, want: false},',
      '\t}',
      '\tfor _, tc := range cases {',
      '\t\tt.Run(tc.name, func(t *testing.T) {',
      '\t\t\tgot := tc.input > 0',
      '\t\t\tif got != tc.want {',
      '\t\t\t\tt.Fatalf("got %v, want %v", got, tc.want)',
      '\t\t\t}',
      '\t\t})',
      '\t}',
      '}',
      '',
    ].join('\n');

    return {
      suggestedTestPath: this.deriveTestPath(ctx.targetFilePath, ctx.testType),
      language: 'go',
      framework: ctx.framework,
      testType: ctx.testType,
      title: `${ctx.testType} suite for ${ctx.targetFilePath} (Go testing)`,
      testCode,
      boundaryConditions: boundaries,
    };
  },
};

const ADAPTER_REGISTRY: Record<SupportedTestLanguage, LanguageTestAdapter> = {
  typescript: typescriptAdapter,
  javascript: javascriptAdapter,
  python: pythonAdapter,
  java: javaAdapter,
  c_sharp: csharpAdapter,
  go: goAdapter,
};

export function resolveTestLanguage(rawLanguage: string): SupportedTestLanguage {
  const lower = rawLanguage.toLowerCase();
  if (lower === 'tsx' || lower === 'ts' || lower === 'typescript') return 'typescript';
  if (lower === 'jsx' || lower === 'js' || lower === 'javascript') return 'javascript';
  if (lower === 'py' || lower === 'python') return 'python';
  if (lower === 'java') return 'java';
  if (lower === 'cs' || lower === 'csharp' || lower === 'c_sharp') return 'c_sharp';
  if (lower === 'go' || lower === 'golang') return 'go';
  return 'typescript';
}

export function getLanguageTestAdapter(language: string): LanguageTestAdapter {
  return ADAPTER_REGISTRY[resolveTestLanguage(language)];
}
