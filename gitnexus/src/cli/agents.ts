/**
 * Agents Command
 *
 * Refreshes AGENTS.md and installs the bundled GitNexus skills for an already indexed repo.
 */

import path from "path";
import { getStoragePaths, loadMeta } from "../storage/repo-manager.js";
import { getCurrentCommit, getGitRoot, isGitRepo } from "../storage/git.js";
import { generateAIContextFiles } from "./ai-context.js";

const getRepoPath = (inputPath?: string): string | null => {
  if (inputPath) {
    return path.resolve(inputPath);
  }

  return getGitRoot(process.cwd());
};

export const agentsCommand = async (inputPath?: string) => {
  console.log("\n  GitNexus Agent Context\n");

  const repoPath = getRepoPath(inputPath);
  if (!repoPath) {
    console.log("  Not inside a git repository\n");
    process.exitCode = 1;
    return;
  }

  if (!isGitRepo(repoPath)) {
    console.log("  Not a git repository\n");
    process.exitCode = 1;
    return;
  }

  const { storagePath } = getStoragePaths(repoPath);
  const meta = await loadMeta(storagePath);
  if (!meta) {
    console.log("  Repository not indexed.");
    console.log("  Run: gitnexus analyze\n");
    process.exitCode = 1;
    return;
  }

  const currentCommit = getCurrentCommit(repoPath);
  if (currentCommit && meta.lastCommit && currentCommit !== meta.lastCommit) {
    console.log(
      "  Warning: index is stale relative to HEAD; run `gitnexus analyze` first if you want AGENTS.md to reflect the latest code.\n",
    );
  }

  const projectName = path.basename(repoPath);

  console.log("\n  Updating AGENTS.md...");
  const agentsResult = await generateAIContextFiles(
    repoPath,
    storagePath,
    projectName,
    {
      files: meta.stats?.files,
      nodes: meta.stats?.nodes,
      edges: meta.stats?.edges,
      communities: meta.stats?.communities,
      processes: meta.stats?.processes,
    },
    undefined,
    { targets: ["agents"] },
  );

  console.log("\n  Agent assets generated\n");
  if (agentsResult.files.length > 0) {
    console.log(`  Context: ${agentsResult.files.join(", ")}`);
  }
  console.log(`  ${repoPath}`);
  console.log("");

  // Tree-sitter and related parser/native handles may keep the process alive.
  // Match analyze's CLI behavior and exit explicitly once output is flushed.
  process.exit(0);
};
