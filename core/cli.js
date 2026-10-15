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
  // Name the resident daemon so ps/Activity Monitor shows what it is instead
  // of an anonymous `node`. Entrypoint-scoped: library consumers of the
  // search modules are never retitled. Liveness checks are lock/pid-based,
  // never command-line matching, so this is cosmetic-only.
  if (args[0] === '--serve') {
    try { process.title = 'sweet-search-daemon'; } catch { /* best-effort */ }
    // Bench-only pid ledger (no-op unless SWEET_SEARCH_SPAWN_LEDGER_DIR is set).
    // Self-registration covers every spawner (JS shims, native CLI, prewarm hook).
    if (process.env.SWEET_SEARCH_SPAWN_LEDGER_DIR) {
      try {
        const { recordSpawn } = await import('./infrastructure/spawn-ledger.js');
        recordSpawn({ pid: process.pid, role: 'daemon-self' });
      } catch { /* best-effort */ }
    }
  }
  // Warm search server lifecycle is implemented in JS.
  const { runCli } = await import('./search/index.js');
  await runCli(args);
} else if (args[0] === 'status') {
  const { runStatusCli } = await import('./search/setup-status.js');
  await runStatusCli(args.slice(1));
} else if (args[0] === 'daemon') {
  // Server lifecycle (start / status / stop / restart) lives in the native client, which
  // also owns the search path's start-up wait.
  const { resolveNativeBinary } = await import('./infrastructure/index.js');
  const nativeBin = resolveNativeBinary();
  if (!nativeBin) {
    console.error('The daemon commands need the native client, which is not installed for this platform.');
    console.error('The search server still starts on the first search. Check it with: sweet-search status');
    process.exit(1);
  }
  const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help' || args.length === 0) {
  console.log(`sweet-search — local code search for coding agents (text, embeddings and code graph)

Set up a project (run these in the project root, in this order):
  1. sweet-search init       Download the models (about 523 MB, once per machine)
                             and write the agent instruction files.
  2. sweet-search index      Build the index in .sweet-search/. Run it again after
                             large changes; small edits are picked up automatically.
  3. sweet-search "<query>"  Search. The first search starts a background search
                             server and waits while it loads the index.
  At any time: sweet-search status    shows what is missing and names the next command.

What setup needs (agent sandboxes often block these; ask for permission to run
init, index and the first search outside the sandbox):
  - npm 11 or later may skip install scripts. Install with:
      npm install -g sweet-search --allow-scripts=sweet-search,onnxruntime-node
  - Network access to huggingface.co during init (or SWEET_SEARCH_HF_ENDPOINT).
  - Write access to the model cache, ~/.cache/sweet-search/models
    (or set SWEET_SEARCH_MODEL_CACHE to a writable directory).
  - A background process that outlives the command: the search server. It keeps
    the index in memory. Manage it with: sweet-search daemon start|status|stop|restart
    Its log is .sweet-search/daemon.log.

Search and read:
  sweet-search "<query>"                Search the indexed codebase
  sweet-search trace <symbol>           Structural context: callers, callees, impact
  sweet-search read <file...>           Filesystem-grounded read (1-20 files)
  sweet-search read-semantic <f> <q>    Return only file spans relevant to a query

Search options:
  --mode <mode>     auto (default), lexical, semantic, hybrid, pattern
  --top, -k <n>     Number of results (default: 10)
  --json            Output results as JSON
  --cold            Run in this process (skip the search server)
  Run 'sweet-search "x" --help' for all search options.

Setup and state:
  sweet-search init [options]           Set up models and agent files ('init --help')
  sweet-search status [--json]          Show the setup and the next command to run
  sweet-search daemon <command>         start | status | stop | restart the search server
  sweet-search uninstall [options]      Remove local state created by init
  sweet-search index [options]          Build or update the index
  sweet-search index --add <path>       Mark a file as changed
  sweet-search reconcile status         Show the automatic update state
  sweet-search reconcile inspect <path> Explain why a file is or is not marked changed
  sweet-search reconcile pause|resume   Pause or resume automatic updates
                                        (pause --reason <text>)
  sweet-search rebuild status           Show the update queue
  sweet-search rebuild force <tier>     Queue a rebuild of one index part
  sweet-search prewarm-vocab [file]     Pre-warm the vocabulary cache with terms

Index options (sweet-search index ...):
  --full            Rebuild everything from scratch
  --graph-only      Build only the code graph (search needs a full index)
  --vectors-only    Build only vectors and the vector index (skips the code graph)
  --files-from-stdin  Read newline-separated paths from stdin
  --late-interaction-model=ID  Use another late-interaction model for this run
  --no-late-interaction        Skip the late-interaction index
  --quiet | --verbose          Less or more output

Exit codes: 0 success; 1 failure; 2 usage error.`);
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
