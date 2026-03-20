import fs from "node:fs/promises";
import path from "node:path";
import { generateId } from "../../lib/utils.js";
import { SupportedLanguages } from "../../config/supported-languages.js";
import type {
  KnowledgeGraph,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
} from "../graph/types.js";

type SupportedManifestSymbolKind = Extract<
  NodeLabel,
  "Function" | "Method" | "Class" | "Interface" | "Process" | "File"
>;
type SupportedManifestRelationKind = Extract<
  RelationshipType,
  "CALLS" | "STEP_IN_PROCESS" | "DEFINES"
>;

interface ManifestSymbol {
  id: string;
  kind: SupportedManifestSymbolKind;
  name: string;
  filePath?: string;
  language?: string;
  isExported?: boolean;
  startLine?: number;
  endLine?: number;
  description?: string;
  processType?: "intra_community" | "cross_community";
  stepCount?: number;
  communities?: string[];
  entryPointId?: string;
  terminalId?: string;
}

interface ManifestRelation {
  from: string;
  to: string;
  type: SupportedManifestRelationKind;
  confidence?: number;
  reason?: string;
  step?: number;
}

interface ExternalManifest {
  symbols?: ManifestSymbol[];
  relations?: ManifestRelation[];
}

export interface ExternalManifestSummary {
  manifestPath: string;
  symbolsImported: number;
  symbolsReused: number;
  relationshipsImported: number;
  processesImported: number;
  warnings: string[];
}

const SUPPORTED_KINDS = new Set<SupportedManifestSymbolKind>([
  "Function",
  "Method",
  "Class",
  "Interface",
  "Process",
  "File",
]);
const SUPPORTED_RELATION_TYPES = new Set<SupportedManifestRelationKind>([
  "CALLS",
  "STEP_IN_PROCESS",
  "DEFINES",
]);
const EXTERNAL_REASON_PREFIX = "external-manifest";

const LANGUAGE_MAP: Record<string, SupportedLanguages> = {
  javascript: SupportedLanguages.JavaScript,
  typescript: SupportedLanguages.TypeScript,
  python: SupportedLanguages.Python,
  java: SupportedLanguages.Java,
  c: SupportedLanguages.C,
  cpp: SupportedLanguages.CPlusPlus,
  "c++": SupportedLanguages.CPlusPlus,
  csharp: SupportedLanguages.CSharp,
  "c#": SupportedLanguages.CSharp,
  go: SupportedLanguages.Go,
  ruby: SupportedLanguages.Ruby,
  rust: SupportedLanguages.Rust,
  php: SupportedLanguages.PHP,
  kotlin: SupportedLanguages.Kotlin,
  swift: SupportedLanguages.Swift,
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toRepoRelativePath = (repoPath: string, filePath?: string): string => {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  if (!path.isAbsolute(normalized)) return normalized.replace(/^\.\//, "");
  const relative = path.relative(repoPath, normalized).replace(/\\/g, "/");
  if (relative.startsWith("..")) return normalized;
  return relative || "";
};

const normalizeLanguage = (value?: string): SupportedLanguages | undefined => {
  if (!value) return undefined;
  return LANGUAGE_MAP[value.trim().toLowerCase()];
};

const normalizeConfidence = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  return 1.0;
};

const normalizeReason = (
  value: unknown,
  type: SupportedManifestRelationKind,
): string => {
  if (typeof value === "string" && value.trim()) {
    return `${EXTERNAL_REASON_PREFIX}:${type.toLowerCase()}:${value.trim()}`;
  }
  return `${EXTERNAL_REASON_PREFIX}:${type.toLowerCase()}`;
};

const hasGraphNode = (graph: KnowledgeGraph, nodeId: string): boolean => {
  return graph.getNode(nodeId) !== undefined;
};

const relationExists = (graph: KnowledgeGraph, relationId: string): boolean => {
  for (const rel of graph.iterRelationships()) {
    if (rel.id === relationId) return true;
  }
  return false;
};

const buildSyntheticId = (symbol: ManifestSymbol, repoPath: string): string => {
  if (symbol.kind === "Process") {
    const suffix = symbol.id
      .replace(/[^a-zA-Z0-9/_:-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    return suffix.startsWith("proc_")
      ? suffix
      : `proc_${suffix || "external_process"}`;
  }

  const relativePath = toRepoRelativePath(repoPath, symbol.filePath);

  if (symbol.kind === "File") {
    // File node IDs are File:<filePath> — must match what the parser creates
    if (relativePath) return generateId("File", relativePath);
    return generateId("File", `${EXTERNAL_REASON_PREFIX}:${symbol.id}`);
  }

  if (relativePath) {
    return generateId(symbol.kind, `${relativePath}:${symbol.name}`);
  }
  return generateId(
    symbol.kind,
    `${EXTERNAL_REASON_PREFIX}:${symbol.id}:${symbol.name}`,
  );
};

const toGraphNode = (
  symbol: ManifestSymbol,
  repoPath: string,
  nodeId: string,
  symbolIdMap: Map<string, string>,
): GraphNode => {
  const relativePath = toRepoRelativePath(repoPath, symbol.filePath);
  return {
    id: nodeId,
    label: symbol.kind,
    properties: {
      name: symbol.name,
      filePath: relativePath,
      startLine:
        typeof symbol.startLine === "number" ? symbol.startLine : undefined,
      endLine: typeof symbol.endLine === "number" ? symbol.endLine : undefined,
      language: normalizeLanguage(symbol.language),
      isExported: symbol.kind === "Process" ? undefined : !!symbol.isExported,
      description: symbol.description,
      processType: symbol.kind === "Process" ? symbol.processType : undefined,
      stepCount: symbol.kind === "Process" ? symbol.stepCount : undefined,
      communities: symbol.kind === "Process" ? symbol.communities : undefined,
      entryPointId:
        symbol.kind === "Process" && symbol.entryPointId
          ? symbolIdMap.get(symbol.entryPointId)
          : undefined,
      terminalId:
        symbol.kind === "Process" && symbol.terminalId
          ? symbolIdMap.get(symbol.terminalId)
          : undefined,
    },
  };
};

const buildRelationId = (
  relation: ManifestRelation,
  sourceId: string,
  targetId: string,
): string => {
  if (relation.type === "STEP_IN_PROCESS") {
    return generateId(
      "STEP_IN_PROCESS",
      `${sourceId}_step_${relation.step ?? 0}_${targetId}`,
    );
  }
  return generateId(relation.type, `${sourceId}->${targetId}`);
};

const toGraphRelation = (
  relation: ManifestRelation,
  sourceId: string,
  targetId: string,
): GraphRelationship => {
  return {
    id: buildRelationId(relation, sourceId, targetId),
    sourceId,
    targetId,
    type: relation.type,
    confidence: normalizeConfidence(relation.confidence),
    reason: normalizeReason(relation.reason, relation.type),
    step: relation.type === "STEP_IN_PROCESS" ? relation.step : undefined,
  };
};

const parseSymbol = (
  input: unknown,
  warnings: string[],
  index: number,
): ManifestSymbol | null => {
  if (!isRecord(input)) {
    warnings.push(`symbols[${index}] is not an object`);
    return null;
  }

  const { id, kind, name } = input;
  if (typeof id !== "string" || !id.trim()) {
    warnings.push(`symbols[${index}] is missing a string id`);
    return null;
  }
  if (
    typeof kind !== "string" ||
    !SUPPORTED_KINDS.has(kind as SupportedManifestSymbolKind)
  ) {
    warnings.push(`symbols[${index}] has unsupported kind '${String(kind)}'`);
    return null;
  }
  if (typeof name !== "string" || !name.trim()) {
    warnings.push(`symbols[${index}] is missing a string name`);
    return null;
  }

  return {
    id: id.trim(),
    kind: kind as SupportedManifestSymbolKind,
    name: name.trim(),
    filePath: typeof input.filePath === "string" ? input.filePath : undefined,
    language: typeof input.language === "string" ? input.language : undefined,
    isExported:
      typeof input.isExported === "boolean" ? input.isExported : undefined,
    startLine:
      typeof input.startLine === "number" ? input.startLine : undefined,
    endLine: typeof input.endLine === "number" ? input.endLine : undefined,
    description:
      typeof input.description === "string" ? input.description : undefined,
    processType:
      input.processType === "cross_community" ||
      input.processType === "intra_community"
        ? input.processType
        : undefined,
    stepCount:
      typeof input.stepCount === "number" ? input.stepCount : undefined,
    communities: Array.isArray(input.communities)
      ? input.communities.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined,
    entryPointId:
      typeof input.entryPointId === "string" ? input.entryPointId : undefined,
    terminalId:
      typeof input.terminalId === "string" ? input.terminalId : undefined,
  };
};

const parseRelation = (
  input: unknown,
  warnings: string[],
  index: number,
): ManifestRelation | null => {
  if (!isRecord(input)) {
    warnings.push(`relations[${index}] is not an object`);
    return null;
  }

  const { from, to, type } = input;
  if (
    typeof from !== "string" ||
    !from.trim() ||
    typeof to !== "string" ||
    !to.trim()
  ) {
    warnings.push(`relations[${index}] is missing from/to ids`);
    return null;
  }
  if (
    typeof type !== "string" ||
    !SUPPORTED_RELATION_TYPES.has(type as SupportedManifestRelationKind)
  ) {
    warnings.push(`relations[${index}] has unsupported type '${String(type)}'`);
    return null;
  }

  const step = typeof input.step === "number" ? input.step : undefined;
  if (type === "STEP_IN_PROCESS" && (!step || step < 1)) {
    warnings.push(
      `relations[${index}] must define a positive step for STEP_IN_PROCESS`,
    );
    return null;
  }

  return {
    from: from.trim(),
    to: to.trim(),
    type: type as SupportedManifestRelationKind,
    confidence:
      typeof input.confidence === "number" ? input.confidence : undefined,
    reason: typeof input.reason === "string" ? input.reason : undefined,
    step,
  };
};

const parseManifest = (raw: unknown, warnings: string[]): ExternalManifest => {
  if (!isRecord(raw)) {
    throw new Error("Manifest root must be an object");
  }

  const rawSymbols = Array.isArray(raw.symbols) ? raw.symbols : [];
  const rawRelations = Array.isArray(raw.relations) ? raw.relations : [];

  return {
    symbols: rawSymbols
      .map((item, index) => parseSymbol(item, warnings, index))
      .filter((item): item is ManifestSymbol => item !== null),
    relations: rawRelations
      .map((item, index) => parseRelation(item, warnings, index))
      .filter((item): item is ManifestRelation => item !== null),
  };
};

export const mergeExternalManifestIntoGraph = async (
  graph: KnowledgeGraph,
  repoPath: string,
  manifestPath: string,
): Promise<ExternalManifestSummary> => {
  const absoluteManifestPath = path.resolve(repoPath, manifestPath);
  const warnings: string[] = [];
  const raw = await fs.readFile(absoluteManifestPath, "utf8");
  const manifest = parseManifest(JSON.parse(raw), warnings);
  const symbolIdMap = new Map<string, string>();

  let symbolsImported = 0;
  let symbolsReused = 0;
  let relationshipsImported = 0;
  let processesImported = 0;

  for (const symbol of manifest.symbols ?? []) {
    symbolIdMap.set(symbol.id, buildSyntheticId(symbol, repoPath));
  }

  for (const symbol of manifest.symbols ?? []) {
    const nodeId = symbolIdMap.get(symbol.id)!;

    if (hasGraphNode(graph, nodeId)) {
      symbolsReused++;
      continue;
    }

    graph.addNode(toGraphNode(symbol, repoPath, nodeId, symbolIdMap));
    symbolsImported++;
    if (symbol.kind === "Process") {
      processesImported++;
    }
  }

  for (const relation of manifest.relations ?? []) {
    const sourceId = symbolIdMap.get(relation.from);
    const targetId = symbolIdMap.get(relation.to);

    if (!sourceId || !targetId) {
      warnings.push(
        `Skipped relation ${relation.type} from '${relation.from}' to '${relation.to}' because one endpoint is missing`,
      );
      continue;
    }
    if (!hasGraphNode(graph, sourceId) || !hasGraphNode(graph, targetId)) {
      warnings.push(
        `Skipped relation ${relation.type} from '${relation.from}' to '${relation.to}' because resolved graph node is missing`,
      );
      continue;
    }

    const graphRelation = toGraphRelation(relation, sourceId, targetId);
    if (relationExists(graph, graphRelation.id)) continue;

    graph.addRelationship(graphRelation);
    relationshipsImported++;
  }

  return {
    manifestPath: absoluteManifestPath,
    symbolsImported,
    symbolsReused,
    relationshipsImported,
    processesImported,
    warnings,
  };
};
