import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/core/embeddings/embedder.js", () => ({
  initEmbedder: vi.fn(),
  embedBatch: vi.fn(),
  embedText: vi.fn(),
  embeddingToArray: vi.fn((embedding: number[]) => embedding),
  isEmbedderReady: vi.fn(() => false),
}));

vi.mock("../../src/core/embeddings/text-generator.js", () => ({
  generateBatchEmbeddingTexts: vi.fn(() => []),
  generateEmbeddingText: vi.fn(() => ""),
}));

import * as embedder from "../../src/core/embeddings/embedder.js";
import { runEmbeddingPipeline } from "../../src/core/embeddings/embedding-pipeline.js";

describe("runEmbeddingPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips model load when all embeddable nodes are already cached", async () => {
    const executeQuery = vi.fn(async (cypher: string) => {
      if (cypher.includes("MATCH (n:Function)")) {
        return [
          {
            id: "fn:1",
            name: "cachedFn",
            label: "Function",
            filePath: "src/cached.ts",
            content: "export function cachedFn() {}",
          },
        ];
      }

      return [];
    });
    const executeWithReusedStatement = vi.fn();
    const onProgress = vi.fn();

    await runEmbeddingPipeline(
      executeQuery,
      executeWithReusedStatement,
      onProgress,
      {},
      new Set(["fn:1"]),
    );

    expect(vi.mocked(embedder.initEmbedder)).not.toHaveBeenCalled();
    expect(vi.mocked(embedder.embedBatch)).not.toHaveBeenCalled();
    expect(executeWithReusedStatement).not.toHaveBeenCalled();
    expect(executeQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "CREATE_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 'embedding'",
      ),
    );
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: "ready",
        percent: 100,
        nodesProcessed: 0,
        totalNodes: 0,
      }),
    );
  });
});
