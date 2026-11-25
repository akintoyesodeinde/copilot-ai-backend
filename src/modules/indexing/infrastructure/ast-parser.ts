import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter';

export interface ExtractedSymbol {
  name: string;
  kind: string;
  signature: string | null;
  startLine: number;
  endLine: number;
  exported: boolean;
}

export interface ExtractedDependency {
  targetSpecifier: string;
  dependencyType: 'import' | 'require' | 'dynamic_import' | 'export_from';
  lineNumber: number;
}

export interface AstParseResult {
  engine: 'tree-sitter' | 'fallback';
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
}

const GRAMMAR_MAP: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  c_sharp: 'tree-sitter-c-sharp.wasm',
  rust: 'tree-sitter-rust.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  php: 'tree-sitter-php.wasm',
  ruby: 'tree-sitter-ruby.wasm',
};

let parserInitPromise: Promise<void> | null = null;
const loadedLanguages = new Map<string, Language>();

async function ensureTreeSitterReady(): Promise<void> {
  if (!parserInitPromise) {
    parserInitPromise = Parser.init();
  }
  await parserInitPromise;
}

function resolveGrammarWasmPath(wasmFilename: string): string | null {
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('@vscode/tree-sitter-wasm/package.json');
    const candidate = path.join(path.dirname(pkgPath), 'wasm', wasmFilename);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function getTreeSitterLanguage(language: string): Promise<Language | null> {
  const wasmFile = GRAMMAR_MAP[language];
  if (!wasmFile) return null;

  const cached = loadedLanguages.get(wasmFile);
  if (cached) return cached;

  const wasmPath = resolveGrammarWasmPath(wasmFile);
  if (!wasmPath) return null;

  await ensureTreeSitterReady();
  const loaded = await Language.load(wasmPath);
  loadedLanguages.set(wasmFile, loaded);
  return loaded;
}

function collectAstInfo(
  root: SyntaxNode,
  sourceLines: string[],
): {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
} {
  const symbols: ExtractedSymbol[] = [];
  const dependencies: ExtractedDependency[] = [];

  const visit = (node: SyntaxNode, insideExport: boolean) => {
    const type = node.type;
    const isExportNode = type === 'export_statement' || insideExport;

    if (
      type === 'function_declaration' ||
      type === 'class_declaration' ||
      type === 'interface_declaration' ||
      type === 'type_alias_declaration' ||
      type === 'method_definition' ||
      type === 'function_definition' ||
      type === 'method_declaration'
    ) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const rawLine = sourceLines[node.startPosition.row]?.trim() ?? '';
        const kind = type.includes('class')
          ? 'class'
          : type.includes('interface')
            ? 'interface'
            : type.includes('type_alias')
              ? 'type'
              : type.includes('method')
                ? 'method'
                : 'function';

        symbols.push({
          name: nameNode.text,
          kind,
          signature: rawLine.slice(0, 480) || null,
          startLine,
          endLine,
          exported: isExportNode || rawLine.startsWith('export '),
        });
      }
    }

    if (type === 'import_statement' || type === 'import_from_statement' || type === 'import_spec') {
      const sourceNode = node.childForFieldName('source') ?? node.childForFieldName('module_name');
      const rawText = sourceNode ? sourceNode.text : node.text;
      const match = /['"]([^'"]+)['"]/.exec(rawText);
      if (match?.[1]) {
        dependencies.push({
          targetSpecifier: match[1],
          dependencyType: 'import',
          lineNumber: node.startPosition.row + 1,
        });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        visit(child, isExportNode && type === 'export_statement');
      }
    }
  };

  visit(root, false);
  return { symbols, dependencies };
}

function fallbackStaticExtract(content: string): {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
} {
  const lines = content.split(/\r?\n/);
  const symbols: ExtractedSymbol[] = [];
  const dependencies: ExtractedDependency[] = [];

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();

    const fnMatch = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (fnMatch?.[2]) {
      symbols.push({
        name: fnMatch[2],
        kind: 'function',
        signature: trimmed.slice(0, 480),
        startLine: lineNo,
        endLine: lineNo,
        exported: Boolean(fnMatch[1]),
      });
    }

    const clsMatch = /^(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (clsMatch?.[2]) {
      symbols.push({
        name: clsMatch[2],
        kind: 'class',
        signature: trimmed.slice(0, 480),
        startLine: lineNo,
        endLine: lineNo,
        exported: Boolean(clsMatch[1]),
      });
    }

    const ifaceMatch = /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (ifaceMatch?.[2]) {
      symbols.push({
        name: ifaceMatch[2],
        kind: 'interface',
        signature: trimmed.slice(0, 480),
        startLine: lineNo,
        endLine: lineNo,
        exported: Boolean(ifaceMatch[1]),
      });
    }

    const pyFnMatch = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/.exec(trimmed);
    if (pyFnMatch?.[1]) {
      symbols.push({
        name: pyFnMatch[1],
        kind: 'function',
        signature: trimmed.slice(0, 480),
        startLine: lineNo,
        endLine: lineNo,
        exported: !pyFnMatch[1].startsWith('_'),
      });
    }

    const importMatch = /^import\s+.*?\s+from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (importMatch?.[1]) {
      dependencies.push({
        targetSpecifier: importMatch[1],
        dependencyType: 'import',
        lineNumber: lineNo,
      });
    }

    const reqMatch = /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(trimmed);
    if (reqMatch?.[1]) {
      dependencies.push({
        targetSpecifier: reqMatch[1],
        dependencyType: 'require',
        lineNumber: lineNo,
      });
    }
  });

  return { symbols, dependencies };
}

/**
 * Parses source code safely using Tree-sitter WASM without ever executing repository code.
 */
export async function parseSourceAst(language: string, content: string): Promise<AstParseResult> {
  const lines = content.split(/\r?\n/);

  try {
    const tsLang = await getTreeSitterLanguage(language);
    if (tsLang) {
      const parser = new Parser();
      try {
        parser.setLanguage(tsLang);
        const tree = parser.parse(content);
        if (tree) {
          const extracted = collectAstInfo(tree.rootNode, lines);
          tree.delete();
          return {
            engine: 'tree-sitter',
            symbols: extracted.symbols,
            dependencies: extracted.dependencies,
          };
        }
      } finally {
        parser.delete();
      }
    }
  } catch {
    // Fall back safely to regex extractor if WASM grammar fails on unusual syntax
  }

  const fallback = fallbackStaticExtract(content);
  return {
    engine: 'fallback',
    symbols: fallback.symbols,
    dependencies: fallback.dependencies,
  };
}

export interface SyntaxValidationDiagnostic {
  line: number;
  column: number;
  message: string;
}

/**
 * Validates generated test source syntax purely via Tree-sitter WASM AST parsing
 * without ever compiling or executing untrusted code on the API or worker host.
 */
export async function validateSourceSyntaxWithTreeSitter(
  language: string,
  sourceCode: string,
): Promise<{
  engine: 'tree-sitter-wasm' | 'brace-balance-fallback';
  valid: boolean;
  diagnostics: SyntaxValidationDiagnostic[];
}> {
  try {
    const tsLang = await getTreeSitterLanguage(language);
    if (tsLang) {
      const parser = new Parser();
      try {
        parser.setLanguage(tsLang);
        const tree = parser.parse(sourceCode);
        if (tree) {
          const diagnostics: SyntaxValidationDiagnostic[] = [];
          const visit = (node: SyntaxNode) => {
            if (node.isError || node.type === 'ERROR') {
              diagnostics.push({
                line: node.startPosition.row + 1,
                column: node.startPosition.column + 1,
                message: `Syntax error near "${node.text.slice(0, 60).replace(/\s+/g, ' ')}"`,
              });
            } else if (node.isMissing) {
              diagnostics.push({
                line: node.startPosition.row + 1,
                column: node.startPosition.column + 1,
                message: `Missing expected token (${node.type})`,
              });
            }
            if (node.hasError) {
              for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) visit(child);
              }
            }
          };

          if (tree.rootNode.hasError) {
            visit(tree.rootNode);
          }
          tree.delete();
          return {
            engine: 'tree-sitter-wasm',
            valid: diagnostics.length === 0,
            diagnostics: diagnostics.slice(0, 20),
          };
        }
      } finally {
        parser.delete();
      }
    }
  } catch {
    // Fall back safely below if grammar unavailable
  }

  // Fallback balanced delimiter check for unsupported languages
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const diagnostics: SyntaxValidationDiagnostic[] = [];
  const lines = sourceCode.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
      if (ch === ')' || ch === ']' || ch === '}') {
        if (stack.pop() !== pairs[ch]) {
          diagnostics.push({
            line: idx + 1,
            column: col + 1,
            message: `Unmatched closing delimiter "${ch}"`,
          });
        }
      }
    }
  });
  if (stack.length > 0) {
    diagnostics.push({
      line: lines.length,
      column: 1,
      message: `Unclosed delimiter(s): ${stack.join(', ')}`,
    });
  }
  return {
    engine: 'brace-balance-fallback',
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
