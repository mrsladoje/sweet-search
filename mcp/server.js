#!/usr/bin/env node
/**
 * MCP server entry. Prepares the project root, then loads the server (server-main.js).
 *
 * The root must be settled BEFORE the server's modules load: core/infrastructure/config
 * fixes PROJECT_ROOT and every index path when it is first imported, and ES imports all
 * load before a module's own code runs. A linked git worktree with no index of its own
 * gets one here, cloned from its main checkout's (core/indexing/worktree-index.mjs), and
 * the server then serves the worktree. Without this, the walk up from a worktree inside
 * its main checkout (`<repo>/.claude/worktrees/x`) lands on the main checkout and serves
 * its files to the worktree's agent.
 *
 * This file imports only modules that read no configuration.
 */

// ESM-safe stdout protection, as in server-main.js: stdout is the protocol channel.
console.log = (...args) => console.error(...args);

import { resolveRoots, worktreeSplitNotice } from '../core/search/worktree-roots.js';
import { ensureWorktreeIndex } from '../core/indexing/worktree-index.mjs';

async function prepareWorktreeRoot() {
  if (process.argv.includes('--project-root') || process.env.SWEET_SEARCH_PROJECT_ROOT) return;
  let roots;
  try {
    roots = resolveRoots({ cwd: process.cwd() });
  } catch {
    return;
  }
  if (!roots.split) return;
  let ok = false;
  try {
    // Bounded: an MCP client gives a server a limited time to answer its handshake.
    ok = await ensureWorktreeIndex({
      mainCheckout: roots.indexRoot,
      worktree: roots.fileRoot,
      waitMs: 20_000,
      log: (msg) => console.error(`[sweet-search-mcp] worktree index: ${msg}`),
    });
  } catch { ok = false; }
  // Either way the root is the worktree: never fall back to the main checkout, whose
  // files are not the agent's. Without an index the tools say so.
  process.env.SWEET_SEARCH_PROJECT_ROOT = roots.fileRoot;
  if (!ok) {
    console.error(`[sweet-search-mcp] ${worktreeSplitNotice(roots.indexRoot, 'none')}`);
    console.error('[sweet-search-mcp] This worktree has no index of its own yet; search tools will report no index until the next start.');
  }
}

await prepareWorktreeRoot();
await import('./server-main.js');
