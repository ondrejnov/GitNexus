import fs from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadEmbeddingCacheFile,
  saveEmbeddingCacheFile,
} from "../../src/core/embeddings/cache-file.js";
import { createTempDir, type TestDBHandle } from "../helpers/test-db.js";

describe("embedding cache file", () => {
  let tmpHandle: TestDBHandle;
  let cachePath: string;

  beforeEach(async () => {
    tmpHandle = await createTempDir("gitnexus-embedding-cache-");
    cachePath = path.join(tmpHandle.dbPath, ".gitnexus", "cache.json");
  });

  afterEach(async () => {
    await tmpHandle.cleanup();
  });

  it("returns an empty cache when the file is missing", async () => {
    const result = await loadEmbeddingCacheFile(cachePath);

    expect(result.found).toBe(false);
    expect(result.embeddings).toEqual([]);
    expect([...result.embeddingNodeIds]).toEqual([]);
  });

  it("round-trips embeddings through cache.json", async () => {
    await saveEmbeddingCacheFile(cachePath, [
      { nodeId: "Function:a", embedding: [1, 2, 3] },
      { nodeId: "Function:a", embedding: [9, 8, 7] },
      { nodeId: "Class:b", embedding: [4, 5, 6] },
    ]);

    const result = await loadEmbeddingCacheFile(cachePath);

    expect(result.found).toBe(true);
    expect(result.embeddings).toEqual([
      { nodeId: "Function:a", embedding: [9, 8, 7] },
      { nodeId: "Class:b", embedding: [4, 5, 6] },
    ]);
    expect([...result.embeddingNodeIds]).toEqual(["Function:a", "Class:b"]);
  });

  it("treats invalid cache content as a cache miss", async () => {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, "{not-json", "utf-8");

    const result = await loadEmbeddingCacheFile(cachePath);

    expect(result.found).toBe(false);
    expect(result.embeddings).toEqual([]);
  });

  it("drops entries with invalid embedding values", async () => {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        embeddings: [
          { nodeId: "Function:valid", embedding: [1, 2, 3] },
          { nodeId: "Function:invalid", embedding: [1, "bad", 3] },
        ],
      }),
      "utf-8",
    );

    const result = await loadEmbeddingCacheFile(cachePath);

    expect(result.found).toBe(true);
    expect(result.embeddings).toEqual([
      { nodeId: "Function:valid", embedding: [1, 2, 3] },
    ]);
  });
});
