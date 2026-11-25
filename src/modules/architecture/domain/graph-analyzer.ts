export interface ArchitectureSourceFile {
  filePath: string;
  language: string;
  lineCount: number;
}

export interface ArchitectureSourceDependency {
  sourceFilePath: string;
  targetSpecifier: string;
  resolvedTargetPath: string | null;
  dependencyType: string;
}

export interface LayerBoundaryRule {
  name: string;
  fromLayer: string;
  forbiddenToLayers: string[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
}

export const DEFAULT_LAYER_BOUNDARY_RULES: LayerBoundaryRule[] = [
  {
    name: 'domain-no-infrastructure',
    fromLayer: 'domain',
    forbiddenToLayers: ['infrastructure', 'presentation'],
    severity: 'HIGH',
    rationale:
      'Pure domain logic must not depend on infrastructure adapters or HTTP/UI presentation modules.',
  },
  {
    name: 'shared-no-feature-application',
    fromLayer: 'shared',
    forbiddenToLayers: ['application', 'presentation'],
    severity: 'MEDIUM',
    rationale:
      'Shared cross-cutting utilities must remain decoupled from feature application and presentation layers.',
  },
  {
    name: 'presentation-no-direct-infrastructure',
    fromLayer: 'presentation',
    forbiddenToLayers: ['infrastructure'],
    severity: 'MEDIUM',
    rationale:
      'Presentation route handlers and UI components should delegate through application services rather than infrastructure internals.',
  },
];

export function classifyArchitecturalLayer(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (
    normalized.includes('/tests/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts')
  ) {
    return 'tests';
  }
  if (
    normalized.includes('/app/api/') ||
    normalized.includes('/routes/') ||
    normalized.includes('/controllers/') ||
    normalized.includes('/components/') ||
    normalized.includes('/pages/')
  ) {
    return 'presentation';
  }
  if (
    normalized.includes('/domain/') ||
    normalized.includes('/entities/') ||
    normalized.includes('/models/')
  ) {
    return 'domain';
  }
  if (
    normalized.includes('/infrastructure/') ||
    normalized.includes('/repositories/') ||
    normalized.includes('/db/') ||
    normalized.includes('/adapters/') ||
    normalized.includes('/database/')
  ) {
    return 'infrastructure';
  }
  if (
    normalized.includes('/application/') ||
    normalized.includes('/services/') ||
    normalized.includes('/usecases/')
  ) {
    return 'application';
  }
  if (
    normalized.includes('/shared/') ||
    normalized.includes('/lib/') ||
    normalized.includes('/utils/') ||
    normalized.includes('/common/')
  ) {
    return 'shared';
  }
  return 'application';
}

export function deriveModuleGroup(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts[0] === 'src' && parts[1] === 'modules' && parts[2]) {
    return parts[2];
  }
  if (parts[0] === 'src' && parts[1]) {
    return parts[1];
  }
  return parts[0] ?? 'root';
}

function matchTargetFile(
  resolvedPath: string | null,
  specifier: string,
  knownFiles: Set<string>,
): string | null {
  const candidates: string[] = [];
  if (resolvedPath) {
    candidates.push(
      resolvedPath,
      `${resolvedPath}.ts`,
      `${resolvedPath}.tsx`,
      `${resolvedPath}.js`,
      `${resolvedPath}.py`,
      `${resolvedPath}.go`,
      `${resolvedPath}/index.ts`,
      `${resolvedPath}/index.js`,
    );
  }
  if (specifier.startsWith('@/')) {
    const stripped = `src/${specifier.slice(2)}`;
    candidates.push(
      stripped,
      `${stripped}.ts`,
      `${stripped}.tsx`,
      `${stripped}.js`,
      `${stripped}/index.ts`,
    );
  }
  for (const c of candidates) {
    if (knownFiles.has(c)) {
      return c;
    }
  }
  return null;
}

/**
 * Tarjan's Strongly Connected Components (SCC) algorithm for deterministic
 * detection of all circular dependency cycles in the directed module graph.
 */
export function detectCircularDependencies(
  nodes: string[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);

      if (component.length > 1) {
        cycles.push(component.reverse());
      } else if (component.length === 1 && adjacency.get(v)?.has(v)) {
        cycles.push([v, v]);
      }
    }
  }

  for (const n of nodes) {
    if (!indices.has(n)) {
      strongConnect(n);
    }
  }

  return cycles;
}

export interface ComputedArchitectureNode {
  nodeKey: string;
  label: string;
  filePath: string;
  layer: string;
  moduleGroup: string;
  language: string;
  linesOfCode: number;
  fanIn: number;
  fanOut: number;
  instability: number;
  isOrphan: boolean;
  isHotspot: boolean;
}

export interface ComputedArchitectureEdge {
  sourceKey: string;
  targetKey: string;
  edgeType: string;
  isCircular: boolean;
  isViolation: boolean;
}

export interface ComputedArchitectureViolation {
  violationType: 'CIRCULAR_DEPENDENCY' | 'LAYER_BOUNDARY' | 'HIGH_COUPLING' | 'ORPHAN_MODULE';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  ruleName: string;
  message: string;
  sourcePath: string;
  targetPath: string | null;
  cyclePaths: string[] | null;
}

export function analyzeArchitectureGraph(
  files: ArchitectureSourceFile[],
  dependencies: ArchitectureSourceDependency[],
  rules: LayerBoundaryRule[] = DEFAULT_LAYER_BOUNDARY_RULES,
): {
  nodes: ComputedArchitectureNode[];
  edges: ComputedArchitectureEdge[];
  violations: ComputedArchitectureViolation[];
  summary: {
    nodesCount: number;
    edgesCount: number;
    circularDepsCount: number;
    violationsCount: number;
    orphanModulesCount: number;
    averageInstability: number;
    layerCounts: Record<string, number>;
  };
} {
  const knownFiles = new Set(files.map((f) => f.filePath));
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();
  const edgeTypes = new Map<string, string>();

  for (const f of files) {
    adjacency.set(f.filePath, new Set());
    reverseAdjacency.set(f.filePath, new Set());
  }

  for (const dep of dependencies) {
    if (!knownFiles.has(dep.sourceFilePath)) continue;
    const matchedTarget = matchTargetFile(dep.resolvedTargetPath, dep.targetSpecifier, knownFiles);
    if (!matchedTarget || matchedTarget === dep.sourceFilePath) continue;
    adjacency.get(dep.sourceFilePath)!.add(matchedTarget);
    reverseAdjacency.get(matchedTarget)!.add(dep.sourceFilePath);
    edgeTypes.set(`${dep.sourceFilePath}->${matchedTarget}`, dep.dependencyType || 'import');
  }

  const cycles = detectCircularDependencies([...knownFiles], adjacency);
  const circularNodeSet = new Set<string>();
  const circularEdgeKeys = new Set<string>();
  for (const cycle of cycles) {
    const memberSet = new Set(cycle);
    for (const src of cycle) {
      circularNodeSet.add(src);
      for (const dst of adjacency.get(src) ?? []) {
        if (memberSet.has(dst)) {
          circularEdgeKeys.add(`${src}->${dst}`);
        }
      }
    }
  }

  const layerByPath = new Map<string, string>();
  const layerCounts: Record<string, number> = {};
  for (const f of files) {
    const layer = classifyArchitecturalLayer(f.filePath);
    layerByPath.set(f.filePath, layer);
    layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
  }

  const violations: ComputedArchitectureViolation[] = [];
  const violationEdgeKeys = new Set<string>();

  for (const cycle of cycles) {
    violations.push({
      violationType: 'CIRCULAR_DEPENDENCY',
      severity: 'HIGH',
      ruleName: 'no-circular-dependencies',
      message: `Circular module dependency cycle detected across ${cycle.length} modules: ${cycle.join(' -> ')} -> ${cycle[0]}`,
      sourcePath: cycle[0]!,
      targetPath: cycle[cycle.length - 1] ?? null,
      cyclePaths: cycle,
    });
  }

  const edges: ComputedArchitectureEdge[] = [];
  for (const [src, targets] of adjacency.entries()) {
    const srcLayer = layerByPath.get(src) ?? 'application';
    for (const dst of targets) {
      const dstLayer = layerByPath.get(dst) ?? 'application';
      const edgeKey = `${src}->${dst}`;
      const isCircular = circularEdgeKeys.has(edgeKey);
      let isLayerViolation = false;

      for (const rule of rules) {
        if (rule.fromLayer === srcLayer && rule.forbiddenToLayers.includes(dstLayer)) {
          isLayerViolation = true;
          violationEdgeKeys.add(edgeKey);
          violations.push({
            violationType: 'LAYER_BOUNDARY',
            severity: rule.severity,
            ruleName: rule.name,
            message: `Layer boundary violation (${rule.name}): ${srcLayer} module "${src}" imports ${dstLayer} module "${dst}". ${rule.rationale}`,
            sourcePath: src,
            targetPath: dst,
            cyclePaths: null,
          });
        }
      }

      edges.push({
        sourceKey: src,
        targetKey: dst,
        edgeType: edgeTypes.get(edgeKey) ?? 'import',
        isCircular,
        isViolation: isCircular || isLayerViolation,
      });
    }
  }

  let instabilitySum = 0;
  let orphanModulesCount = 0;

  const nodes: ComputedArchitectureNode[] = files.map((f) => {
    const fanOut = adjacency.get(f.filePath)?.size ?? 0;
    const fanIn = reverseAdjacency.get(f.filePath)?.size ?? 0;
    const total = fanIn + fanOut;
    const instability = total === 0 ? 0 : Number((fanOut / total).toFixed(4));
    instabilitySum += instability;

    const lower = f.filePath.toLowerCase();
    const isEntryLike =
      lower.endsWith('index.ts') ||
      lower.endsWith('main.ts') ||
      lower.endsWith('route.ts') ||
      lower.endsWith('page.tsx') ||
      lower.includes('config') ||
      lower.endsWith('.json') ||
      lower.endsWith('.md');

    const isOrphan = files.length > 1 && fanIn === 0 && fanOut === 0 && !isEntryLike;
    const isHotspot = total >= 6 || f.lineCount >= 250 || circularNodeSet.has(f.filePath);

    if (isOrphan) {
      orphanModulesCount += 1;
      violations.push({
        violationType: 'ORPHAN_MODULE',
        severity: 'LOW',
        ruleName: 'no-orphan-modules',
        message: `Module "${f.filePath}" has zero incoming and zero outgoing internal dependencies.`,
        sourcePath: f.filePath,
        targetPath: null,
        cyclePaths: null,
      });
    }

    if (total >= 8) {
      violations.push({
        violationType: 'HIGH_COUPLING',
        severity: 'MEDIUM',
        ruleName: 'max-module-coupling',
        message: `Module "${f.filePath}" exhibits high coupling (fanIn=${fanIn}, fanOut=${fanOut}). Consider splitting responsibilities.`,
        sourcePath: f.filePath,
        targetPath: null,
        cyclePaths: null,
      });
    }

    return {
      nodeKey: f.filePath,
      label: f.filePath.split('/').pop() ?? f.filePath,
      filePath: f.filePath,
      layer: layerByPath.get(f.filePath) ?? 'application',
      moduleGroup: deriveModuleGroup(f.filePath),
      language: f.language,
      linesOfCode: f.lineCount,
      fanIn,
      fanOut,
      instability,
      isOrphan,
      isHotspot,
    };
  });

  return {
    nodes,
    edges,
    violations,
    summary: {
      nodesCount: nodes.length,
      edgesCount: edges.length,
      circularDepsCount: cycles.length,
      violationsCount: violations.length,
      orphanModulesCount,
      averageInstability: nodes.length > 0 ? Number((instabilitySum / nodes.length).toFixed(4)) : 0,
      layerCounts,
    },
  };
}
