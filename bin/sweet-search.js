#!/usr/bin/env node

// Sweet Search CLI dispatcher (JS fallback for npm users).
//
// This file exists as a packaging workaround — npm bin must point to JS.
// On supported platforms, it dispatches to the native Rust binary.
// The user's primary workflow is running the Rust binary directly.

import { spawnSync } from 'node:child_process';
import { resolveNativeBinary } from '../core/native-resolver.js';

const nativeBin = resolveNativeBinary();

if (nativeBin) {
  const result = spawnSync(nativeBin, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  const { runCli } = await import('../core/search-cli.js');
  await runCli(process.argv.slice(2));
}
