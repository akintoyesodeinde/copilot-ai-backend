import fs from 'node:fs';
import path from 'node:path';
import { runAllDeterministicSecurityScanners } from '../src/modules/security/domain/scanners';
import { analyzeArchitectureGraph } from '../src/modules/architecture/domain/graph-analyzer';
import { detectPromptInjectionSignals } from '../src/modules/ai/domain/types';
import { validateAndNormalizeFindings } from '../src/modules/reviews/domain/finding-validator';
import { getLanguageTestAdapter } from '../src/modules/test-generation/domain/language-adapters';
import { validateSourceSyntaxWithTreeSitter } from '../src/modules/indexing/infrastructure/ast-parser';

interface EvalCaseResult {
  id: string;
  category: string;
  passed: boolean;
  details: string;
}

async function main() {
  const datasetPath = path.resolve(process.cwd(), 'evals/dataset-v1.json');
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as {
    datasetVersion: string;
    cases: Array<Record<string, unknown>>;
  };

  const results: EvalCaseResult[] = [];
  let falsePositivesOnClean = 0;
  let truePositivesExpected = 0;
  let truePositivesDetected = 0;
  let secretLeaksDetected = 0;
  let hallucinationsRejected = 0;
  let hallucinationsSubmitted = 0;
  let generatedTestsValidated = 0;
  let generatedTestsPassedSyntax = 0;

  for (const c of dataset.cases) {
    const id = String(c.id);
    const category = String(c.category);

    if (
      category === 'clean_code' ||
      category === 'security_vulnerability' ||
      category === 'secret_detection' ||
      category === 'dependency_vulnerability' ||
      category === 'container_security' ||
      category === 'prompt_injection'
    ) {
      const filePath = String(c.filePath);
      const language = String(c.language);
      const content = String(c.content);
      const scan = runAllDeterministicSecurityScanners([{ filePath, language, content }]);

      let passed = true;
      const notes: string[] = [];

      if (typeof c.expectedMaxVulnerabilities === 'number') {
        if (scan.vulnerabilities.length > c.expectedMaxVulnerabilities) {
          passed = false;
          falsePositivesOnClean += scan.vulnerabilities.length;
        }
        notes.push(`findings=${scan.vulnerabilities.length}`);
      }

      if (typeof c.expectedMinVulnerabilities === 'number') {
        truePositivesExpected += c.expectedMinVulnerabilities;
        truePositivesDetected += Math.min(
          scan.vulnerabilities.length,
          c.expectedMinVulnerabilities,
        );
        if (scan.vulnerabilities.length < c.expectedMinVulnerabilities) {
          passed = false;
        }
        notes.push(`findings=${scan.vulnerabilities.length}/${c.expectedMinVulnerabilities}`);
      }

      if (Array.isArray(c.expectedCweIds)) {
        const foundCwes = new Set(scan.vulnerabilities.map((v) => v.cweId));
        for (const cwe of c.expectedCweIds as string[]) {
          if (!foundCwes.has(cwe)) passed = false;
        }
      }

      if (Array.isArray(c.expectedCveIds)) {
        const foundCves = new Set(scan.vulnerabilities.map((v) => v.cveId));
        for (const cve of c.expectedCveIds as string[]) {
          if (!foundCves.has(cve)) passed = false;
        }
      }

      if (Array.isArray(c.mustNotContainRawStrings)) {
        const serialized = JSON.stringify(scan.vulnerabilities);
        for (const raw of c.mustNotContainRawStrings as string[]) {
          if (serialized.includes(raw)) {
            passed = false;
            secretLeaksDetected += 1;
          }
        }
        notes.push(`rawSecretLeaks=${secretLeaksDetected}`);
      }

      if (typeof c.expectedMinInjectionSignals === 'number') {
        const signals = detectPromptInjectionSignals(content);
        if (signals.length < c.expectedMinInjectionSignals) {
          passed = false;
        }
        notes.push(`injectionSignals=${signals.length}`);
      }

      results.push({ id, category, passed, details: notes.join(', ') });
    } else if (category === 'architecture_analysis') {
      const files = c.files as Array<{ filePath: string; language: string; lineCount: number }>;
      const deps = c.dependencies as Array<{
        sourceFilePath: string;
        targetSpecifier: string;
        resolvedTargetPath: string | null;
        dependencyType: string;
      }>;
      const graph = analyzeArchitectureGraph(files, deps);
      const layerCount = graph.violations.filter(
        (v) => v.violationType === 'LAYER_BOUNDARY',
      ).length;
      const passed =
        graph.summary.circularDepsCount >= Number(c.expectedCircularDeps ?? 1) &&
        layerCount >= Number(c.expectedLayerViolations ?? 1);
      results.push({
        id,
        category,
        passed,
        details: `cycles=${graph.summary.circularDepsCount}, layerViolations=${layerCount}`,
      });
    } else if (category === 'hallucination_filtering') {
      const validFilePath = String(c.validFilePath);
      const hallucinatedFilePath = String(c.hallucinatedFilePath);
      hallucinationsSubmitted += 2;

      const validated = validateAndNormalizeFindings(
        [
          {
            filePath: validFilePath,
            patch: '@@ -1,1 +1,3 @@\n+export const x = 1;\n+export const y = 2;\n',
          },
        ],
        [],
        [
          {
            severity: 'HIGH',
            category: 'BUG',
            title: 'Hallucinated nonexistent file',
            description: 'Points to file that does not exist in PR diff',
            suggestion: 'Ignore',
            filePath: hallucinatedFilePath,
            startLine: 10,
            endLine: 10,
            confidence: 0.9,
          },
          {
            severity: 'MEDIUM',
            category: 'BUG',
            title: 'Out-of-bounds line number',
            description: 'Points to line 999 outside changed diff lines',
            suggestion: 'Ignore',
            filePath: validFilePath,
            startLine: 999,
            endLine: 1000,
            confidence: 0.85,
          },
          {
            severity: 'LOW',
            category: 'MAINTAINABILITY',
            title: 'Valid grounded finding',
            description: 'References real changed line in diff',
            suggestion: 'Add unit test',
            filePath: validFilePath,
            startLine: 2,
            endLine: 2,
            confidence: 0.88,
          },
        ],
      );

      hallucinationsRejected += validated.rejectedCount;
      const passed = validated.rejectedCount === 2 && validated.accepted.length === 1;
      results.push({
        id,
        category,
        passed,
        details: `accepted=${validated.accepted.length}, rejectedHallucinations=${validated.rejectedCount}`,
      });
    } else if (category === 'test_syntax_validation') {
      const langs = c.languages as string[];
      let allValid = true;
      for (const lang of langs) {
        const adapter = getLanguageTestAdapter(lang);
        const generated = adapter.generateTestSuggestion({
          targetFilePath: `src/sample/service.${lang === 'python' ? 'py' : lang === 'go' ? 'go' : lang === 'java' ? 'java' : lang === 'c_sharp' ? 'cs' : 'ts'}`,
          language: adapter.language,
          framework: adapter.defaultFramework,
          symbols: [{ name: 'calculateFee', kind: 'function', exported: true, signature: null }],
          testType: 'UNIT',
        });
        const check = await validateSourceSyntaxWithTreeSitter(
          generated.language,
          generated.testCode,
        );
        generatedTestsValidated += 1;
        if (check.valid && check.engine === 'tree-sitter-wasm') {
          generatedTestsPassedSyntax += 1;
        } else {
          allValid = false;
        }
      }
      // Also verify intentionally broken syntax is rejected
      const brokenCheck = await validateSourceSyntaxWithTreeSitter(
        'typescript',
        'export function broken( { return ;;;',
      );
      if (brokenCheck.valid) {
        allValid = false;
      }

      results.push({
        id,
        category,
        passed: allValid,
        details: `validSuites=${generatedTestsPassedSyntax}/${generatedTestsValidated}, brokenSyntaxRejected=${!brokenCheck.valid}`,
      });
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const report = {
    datasetVersion: dataset.datasetVersion,
    executedAt: new Date().toISOString(),
    totalCases: results.length,
    passedCases: passedCount,
    failedCases: results.length - passedCount,
    metrics: {
      overallPassRate: Number((passedCount / results.length).toFixed(4)),
      cleanCodeFalsePositives: falsePositivesOnClean,
      vulnerabilityRecallRate:
        truePositivesExpected > 0
          ? Number((truePositivesDetected / truePositivesExpected).toFixed(4))
          : 1,
      rawSecretLeakCount: secretLeaksDetected,
      hallucinationRejectionRate:
        hallucinationsSubmitted > 0
          ? Number((hallucinationsRejected / hallucinationsSubmitted).toFixed(4))
          : 1,
      generatedTestSyntaxPassRate:
        generatedTestsValidated > 0
          ? Number((generatedTestsPassedSyntax / generatedTestsValidated).toFixed(4))
          : 1,
    },
    results,
  };

  const outDir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'ai-eval-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(
    `CodePilot AI Evaluation v${dataset.datasetVersion}: ${passedCount}/${results.length} passed`,
  );
  console.log(JSON.stringify(report.metrics, null, 2));
  for (const r of results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.id} (${r.category}): ${r.details}`);
  }

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('AI Evaluation runner failed:', err);
  process.exit(1);
});
