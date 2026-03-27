#!/usr/bin/env node

// Sweet Search CLI dispatcher (JS fallback for npm users).
//
// This file exists because in Phase 0 we only build one native binary
// (darwin-arm64). npm-installed users on other platforms need a working
// entry point until Phase 2 ships per-platform native packages.
//
// The user's primary workflow is running the Rust binary directly.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);

function findNativeBinary() {
  // 1. Local development: Rust build output
  const localBin = join(root, 'sweet-search-cli', 'target', 'release', 'sweet-search');
  if (existsSync(localBin)) return localBin;

  // 2. Platform package (Phase 2)
  // Names must match INIT_PLAN.md: native-darwin-arm64, native-linux-x64-gnu, etc.
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const libc = platform === 'linux' ? '-gnu' : '';
  const platformPkg = `@sweet-search/native-${platform}-${arch}${libc}`;
  try {
    const pkgDir = dirname(require.resolve(`${platformPkg}/package.json`));
    const bin = join(pkgDir, 'sweet-search');
    if (existsSync(bin)) return bin;
  } catch {
    // Platform package not installed — expected in Phase 0
  }

  return null;
}

const nativeBin = findNativeBinary();

if (nativeBin) {
  const result = spawnSync(nativeBin, process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  const { runCli } = await import('../core/search-cli.js');
  await runCli(process.argv.slice(2));
}
