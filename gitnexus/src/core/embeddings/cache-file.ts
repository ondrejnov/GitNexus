import fs from "fs/promises";
import path from "path";

export interface CachedEmbedding {
  nodeId: string;
  embedding: number[];
}

interface EmbeddingCacheFile {
  version: 1;
  savedAt: string;
  embeddings: CachedEmbedding[];
}

export interface LoadedEmbeddingCache {
  found: boolean;
  embeddingNodeIds: Set<string>;
  embeddings: CachedEmbedding[];
}

const toCachedEmbedding = (value: unknown): CachedEmbedding | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { nodeId?: unknown; embedding?: unknown };
  if (typeof candidate.nodeId !== "string" || candidate.nodeId.length === 0) {
    return null;
  }
  if (!Array.isArray(candidate.embedding)) {
    return null;
  }

  const embedding = candidate.embedding.map((component) =>
    typeof component === "number" ? component : Number(component),
  );
  if (
    embedding.length === 0 ||
    embedding.some((component) => !Number.isFinite(component))
  ) {
    return null;
  }

  return {
    nodeId: candidate.nodeId,
    embedding,
  };
};

const normalizeEmbeddings = (entries: CachedEmbedding[]): CachedEmbedding[] => {
  const deduped = new Map<string, CachedEmbedding>();
  for (const entry of entries) {
    deduped.set(entry.nodeId, entry);
  }
  return [...deduped.values()];
};

export const loadEmbeddingCacheFile = async (
  cachePath: string,
): Promise<LoadedEmbeddingCache> => {
  try {
    const raw = await fs.readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<EmbeddingCacheFile>;
    const embeddings = Array.isArray(parsed.embeddings)
      ? normalizeEmbeddings(
          parsed.embeddings
            .map(toCachedEmbedding)
            .filter((entry): entry is CachedEmbedding => entry !== null),
        )
      : [];

    return {
      found: true,
      embeddingNodeIds: new Set(embeddings.map((entry) => entry.nodeId)),
      embeddings,
    };
  } catch {
    return {
      found: false,
      embeddingNodeIds: new Set<string>(),
      embeddings: [],
    };
  }
};

export const saveEmbeddingCacheFile = async (
  cachePath: string,
  embeddings: CachedEmbedding[],
): Promise<void> => {
  const normalized = normalizeEmbeddings(embeddings);
  const payload: EmbeddingCacheFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    embeddings: normalized,
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });

  const tempPath = `${cachePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload)}\n`, "utf-8");
  await fs.rm(cachePath, { force: true });
  await fs.rename(tempPath, cachePath);
};
