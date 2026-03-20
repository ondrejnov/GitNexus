import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import { mergeExternalManifestIntoGraph } from '../../src/core/ingestion/external-manifest.js';

const tempDirs: string[] = [];

async function makeRepoWithManifest(manifest: unknown) {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-manifest-'));
  tempDirs.push(repoDir);
  await fs.writeFile(path.join(repoDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return repoDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('mergeExternalManifestIntoGraph', () => {
  it('imports FE/BE symbols, calls, and processes', async () => {
    const repoDir = await makeRepoWithManifest({
      symbols: [
        { id: 'fe.query', kind: 'Function', name: 'useUsersQuery', filePath: 'frontend/src/useUsersQuery.ts', language: 'typescript', isExported: true },
        { id: 'fe.api', kind: 'Function', name: 'fetchUsers', filePath: 'frontend/src/usersClient.ts', language: 'typescript', isExported: true },
        { id: 'be.handler', kind: 'Function', name: 'list_users', filePath: 'backend/users/routes.py', language: 'python', isExported: true },
        { id: 'proc.users', kind: 'Process', name: 'GET /api/users', processType: 'cross_community', stepCount: 3, entryPointId: 'fe.query', terminalId: 'be.handler' },
      ],
      relations: [
        { from: 'fe.query', to: 'fe.api', type: 'CALLS', confidence: 1 },
        { from: 'fe.api', to: 'be.handler', type: 'CALLS', confidence: 0.9, reason: 'http GET /api/users' },
        { from: 'fe.query', to: 'proc.users', type: 'STEP_IN_PROCESS', step: 1 },
        { from: 'fe.api', to: 'proc.users', type: 'STEP_IN_PROCESS', step: 2 },
        { from: 'be.handler', to: 'proc.users', type: 'STEP_IN_PROCESS', step: 3 },
      ],
    });

    const graph = createKnowledgeGraph();
    const summary = await mergeExternalManifestIntoGraph(graph, repoDir, 'manifest.json');

    expect(summary.symbolsImported).toBe(4);
    expect(summary.relationshipsImported).toBe(5);
    expect(summary.processesImported).toBe(1);
    expect(summary.warnings).toHaveLength(0);

    const processNode = graph.getNode('proc_users');
    expect(processNode).toBeDefined();
    expect(processNode?.label).toBe('Process');

    const calls: Array<[string, string]> = [];
    const steps: number[] = [];
    for (const rel of graph.iterRelationships()) {
      if (rel.type === 'CALLS') calls.push([rel.sourceId, rel.targetId]);
      if (rel.type === 'STEP_IN_PROCESS') steps.push(rel.step || 0);
    }

    expect(calls).toContainEqual([
      'Function:frontend/src/useUsersQuery.ts:useUsersQuery',
      'Function:frontend/src/usersClient.ts:fetchUsers',
    ]);
    expect(calls).toContainEqual([
      'Function:frontend/src/usersClient.ts:fetchUsers',
      'Function:backend/users/routes.py:list_users',
    ]);
    expect(steps.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('reuses existing graph symbols when manifest resolves to same synthetic ids', async () => {
    const repoDir = await makeRepoWithManifest({
      symbols: [
        { id: 'fe.query', kind: 'Function', name: 'useUsersQuery', filePath: 'frontend/src/useUsersQuery.ts', language: 'typescript', isExported: true },
        { id: 'be.handler', kind: 'Function', name: 'list_users', filePath: 'backend/users/routes.py', language: 'python', isExported: true },
      ],
      relations: [
        { from: 'fe.query', to: 'be.handler', type: 'CALLS', confidence: 1 },
      ],
    });

    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'Function:frontend/src/useUsersQuery.ts:useUsersQuery',
      label: 'Function',
      properties: { name: 'useUsersQuery', filePath: 'frontend/src/useUsersQuery.ts', isExported: true },
    });

    const summary = await mergeExternalManifestIntoGraph(graph, repoDir, 'manifest.json');

    expect(summary.symbolsImported).toBe(1);
    expect(summary.symbolsReused).toBe(1);
    expect(graph.getNode('Function:backend/users/routes.py:list_users')).toBeDefined();
  });
});
