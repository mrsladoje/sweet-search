#!/usr/bin/env node

// Sweet Search CLI dispatcher (JS fallback for npm users).
//
// This file exists as a packaging workaround — npm bin must point to JS.
// On supported platforms, it dispatches to the native Rust binary.
// Package-management commands (init) always run in JS.

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

// Package-management commands always run in JS (never native dispatch)
if (args[0] === 'init') {
  const { runInit } = await import('../scripts/init.js');
  await runInit(args.slice(1));
} else if (args[0] === 'uninstall') {
  const { runUninstall } = await import('../scripts/uninstall.js');
  await runUninstall(args.slice(1));
} else if (args[0] === '--help' || args[0] === '-h' || args.length === 0) {
  console.log(`sweet-search — hybrid code search engine

Usage:
  sweet-search <query>          Search the indexed codebase
  sweet-search init [options]   Set up runtime assets and models
  sweet-search uninstall [opts] Remove local state created by init
  sweet-search --help           Show this help

Options:
  --mode <mode>     Search mode: auto, lexical, semantic, hybrid, pattern
  --top, -k <n>     Number of results (default: 10)
  --json            Output results as JSON
  --cold            Force cold start (skip warm server)

Run 'sweet-search init --help' or 'sweet-search uninstall --help' for subcommand options.`);
} else {
  const { resolveNativeBinary } = await import('../core/infrastructure/native-resolver.js');
  const nativeBin = resolveNativeBinary();

  if (nativeBin) {
    const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  } else {
    const { runCli } = await import('../core/search/search-cli.js');
    await runCli(args);
  }
}
