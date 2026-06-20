#!/usr/bin/env node

// Sweet Search CLI dispatcher (JS fallback for npm users).
//
// This file exists as a packaging workaround — npm bin must point to JS.
// On supported platforms, it dispatches to the native Rust binary.
// Package-management commands (init) always run in JS.

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

function envFalsey(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

// Package-management commands always run in JS (never native dispatch)
if (args[0] === 'init') {
  const { runInit } = await import('../scripts/init.js');
  await runInit(args.slice(1));
} else if (args[0] === 'uninstall') {
  const { runUninstall } = await import('../scripts/uninstall.js');
  await runUninstall(args.slice(1));
} else if (args[0] === 'prewarm-vocab') {
  const { handlePrewarmVocabCli } = await import('./vocabulary/index.js');
  await handlePrewarmVocabCli(args.slice(1));
} else if (args[0] === 'reconcile' || args[0] === 'rebuild') {
  const { handleIncrementalCli } = await import('./incremental-indexing/application/operator-cli.mjs');
  await handleIncrementalCli(args[0], args.slice(1));
} else if (args[0] === 'read') {
  // Filesystem-grounded reader. Default dispatches to the native Unix-socket
  // client so the warm daemon serves the read without per-call node startup.
  // readFiles statSync's every call, so read-your-writes freshness is preserved.
  // Set SWEET_SEARCH_READ_VIA_DAEMON=0 to force the in-process path.
  if (!envFalsey('SWEET_SEARCH_READ_VIA_DAEMON')) {
    const { resolveNativeBinary } = await import('./infrastructure/index.js');
    const nativeBin = resolveNativeBinary();
    if (nativeBin) {
      const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
      process.exit(result.status ?? 1);
    }
  }
  const { handleReadCli } = await import('./search/search-read.js');
  await handleReadCli(args.slice(1));
} else if (args[0] === 'read-semantic') {
  // Hybrid span-selection reader. Default dispatches to the native Unix-socket
  // client so the warm daemon can serve LI scoring without per-call
  // model/session startup. Set SWEET_SEARCH_SEMANTIC_VIA_DAEMON=0 to force the
  // legacy in-process path for debugging.
  if (!envFalsey('SWEET_SEARCH_SEMANTIC_VIA_DAEMON')) {
    const { resolveNativeBinary } = await import('./infrastructure/index.js');
    const nativeBin = resolveNativeBinary();
    if (nativeBin) {
      const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
      process.exit(result.status ?? 1);
    }
  }
  const { handleReadSemanticCli } = await import('./search/search-read-semantic.js');
  await handleReadSemanticCli(args.slice(1));
} else if (args[0] === 'trace') {
  // Unified structural code context: callers, callees, and impact. Default
  // dispatches to the native Unix-socket client so the warm daemon serves the
  // code-graph traversal without per-call node startup + cold code-graph.db
  // open. Set SWEET_SEARCH_TRACE_VIA_DAEMON=0 to force the in-process path.
  if (!envFalsey('SWEET_SEARCH_TRACE_VIA_DAEMON')) {
    const { resolveNativeBinary } = await import('./infrastructure/index.js');
    const nativeBin = resolveNativeBinary();
    if (nativeBin) {
      const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
      process.exit(result.status ?? 1);
    }
  }
  const { handleTraceCli } = await import('./search/search-trace.js');
  await handleTraceCli(args.slice(1));
} else if (args[0] === 'index') {
  // Indexing pipeline. Forwarded to index-codebase-v21.js::main(), which
  // reads its own flags via process.argv. Setting argv here is required
  // because the indexer's parseArgs reads process.argv.slice(2) by default.
  // Without this subcommand, npm-installed users had no way to invoke
  // indexing — `node ./node_modules/sweet-search/core/indexing/index-codebase-v21.js`
  // was a silent no-op (direct-run guard mismatched under symlinked installs)
  // and the bin had no `index` entry at all. Forwards every argument after
  // `index` so existing flag combos (--full / --graph-only / --vectors-only /
  // --files-from-stdin / --late-interaction-model=… / etc.) all work.
  const indexerArgs = args.slice(1);
  const hasAddHint = indexerArgs.includes('--add') || indexerArgs.some((arg) => arg.startsWith('--add='));
  if (hasAddHint) {
    const { handleIndexAddCli } = await import('./incremental-indexing/application/operator-cli.mjs');
    await handleIndexAddCli(indexerArgs);
  } else {
    process.argv = [process.argv[0], 'index-codebase-v21.js', ...indexerArgs];
    const { main: runIndexer } = await import('./indexing/index-codebase-v21.js');
    await runIndexer();
  }
} else if (args[0] === '--serve' || args[0] === '--stop') {
  // Warm search server lifecycle is implemented in JS.
  const { runCli } = await import('./search/index.js');
  await runCli(args);
} else if (args[0] === '--help' || args[0] === '-h' || args.length === 0) {
  console.log(`sweet-search — hybrid code search engine

Usage:
  sweet-search <query>                  Search the indexed codebase
  sweet-search trace <symbol>           Structural context: callers, callees, impact
  sweet-search read <file...>           Filesystem-grounded read (1-20 files)
  sweet-search read-semantic <f> <q>    Return only file spans relevant to a query
  sweet-search index [options]          Build / update the codebase index
  sweet-search index --add <path>       Hint a file as dirty
  sweet-search reconcile status         Show incremental epoch and dirty status
  sweet-search reconcile inspect <path> Explain why a file is dirty or clean
  sweet-search reconcile pause|resume   Pause or resume automatic reconcile work
  sweet-search rebuild status           Show incremental maintenance queue
  sweet-search rebuild force <tier>     Queue maintenance for a tier
  sweet-search init [options]           Set up runtime assets and models
  sweet-search uninstall [opts]         Remove local state created by init
  sweet-search prewarm-vocab [file]     Pre-warm vocabulary cache with terms
  sweet-search --help                   Show this help

Options:
  --mode <mode>     Search mode: auto, lexical, semantic, hybrid, pattern
  --top, -k <n>     Number of results (default: 10)
  --json            Output results as JSON
  --cold            Force cold start (skip warm server)

Indexing flags (sweet-search index ...):
  --full            Full reindex from scratch
  --graph-only      Build code graph only
  --vectors-only    Build vectors + HNSW only (skips code graph)
  --files-from-stdin  Read newline-delimited paths from stdin
  --add <path>        Queue a dirty-file hint without running the indexer
  --late-interaction-model=ID  Override the LI variant for this run
  --no-late-interaction        Skip LI index build
  --quiet | --verbose          Logging verbosity

Run 'sweet-search init --help' or 'sweet-search uninstall --help' for subcommand options.`);
} else {
  const { resolveNativeBinary } = await import('./infrastructure/index.js');
  const nativeBin = resolveNativeBinary();

  if (nativeBin) {
    const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  } else {
    const { runCli } = await import('./search/index.js');
    await runCli(args);
  }
}
