# GitNexus Fork Overview

## The Problem This Fork Solves

Static code analysis works by reading source files and following imports and function calls through the codebase. This works well within a single language, but it breaks down completely at language boundaries.

A real-world web application typically has a TypeScript or JavaScript frontend and a Python, Go, or Java backend. The frontend calls the backend over HTTP, JSON-RPC, or some other transport — not via a direct import. There is no `import` statement in the TypeScript code that points to the Python function, so the static analyzer never sees that connection. From the perspective of tracing execution flows, the two halves of the system appear completely disconnected.

This means that upstream GitNexus, like all static analysis tools, can give you a complete picture of what happens inside the frontend and a complete picture of what happens inside the backend, but it cannot show you the path that goes from a user action in the browser all the way to a database call in the backend. That cross-stack flow simply does not exist in the graph.

## What This Fork Adds

This fork introduces an external manifest — a JSON file you provide alongside your codebase that explicitly declares the cross-language relationships the static analyzer cannot discover on its own.

```bash
gitnexus analyze --manifest <path-to-manifest.json>
```

The manifest lists symbols (functions, files, endpoints) and relationships between them, including which frontend call maps to which backend handler and what execution process that call belongs to. GitNexus reads this manifest during analysis and merges those relationships into the knowledge graph before running community detection and process tracing. The cross-stack flows then become visible alongside the purely in-language ones.

The manifest format supports symbols in any of the languages GitNexus already handles, so a TypeScript frontend calling a Python handler calling a Go service can all be connected in a single graph.

An example manifest is included in `gitnexus/examples/fe-be-manifest.json` to show the expected structure.

## What Stays The Same

This is a purely additive change. If you do not pass `--manifest`, the behavior is identical to upstream GitNexus. All existing tooling, MCP tools, and CLI commands work as before.
