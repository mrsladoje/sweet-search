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
} else {
  const { resolveNativeBinary } = await import('../core/native-resolver.js');
  const nativeBin = resolveNativeBinary();

  if (nativeBin) {
    const result = spawnSync(nativeBin, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  } else {
    const { runCli } = await import('../core/search-cli.js');
    await runCli(args);
  }
}
