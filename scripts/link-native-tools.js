#!/usr/bin/env node
/**
 * Make each `ss-*` command the native binary itself.
 *
 * package.json "bin" links ss-search, ss-grep, ss-find, ss-read, ss-semantic and ss-trace
 * onto the PATH. npm can only link files of THIS package, and the native binary ships in
 * the platform package (@sweet-search/native-*), so the linked files start as small JS
 * stubs (bin/ss-*). This step replaces each stub, in place, with the native binary (a
 * hard link, or a copy across file systems) — the esbuild install optimisation. The PATH
 * entries npm made point at the stub paths, so after the swap `ss-grep` starts the Rust
 * client directly: no node process, one socket round trip to the warm daemon.
 *
 * Runs from postinstall and again from `sweet-search init` (installs that skip install
 * scripts — pnpm by default, --ignore-scripts — get it there). It never fails the caller:
 * when it cannot swap, the JS stubs stay and still work (core/agent-tools/launch.js).
 *
 * Refuses to touch a development checkout: the stubs there are tracked source files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativeBinarySupportsAgentTools, resolveNativeBinary } from '../core/infrastructure/native-resolver.js';
import { AGENT_TOOLS } from '../core/agent-tools/tools.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isInstalledPackage(root) {
  return root.split(path.sep).includes('node_modules');
}

function sameFile(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch { return false; }
}

function replaceWithBinary(binary, target) {
  // Already linked (init after postinstall). Renaming one hard link over another of the
  // same file is a no-op that would leave the temporary name behind.
  if (sameFile(binary, target)) return;
  const tmp = `${target}.native-${process.pid}`;
  try { fs.unlinkSync(tmp); } catch { /* none */ }
  try {
    fs.linkSync(binary, tmp);
  } catch {
    fs.copyFileSync(binary, tmp);
  }
  fs.chmodSync(tmp, 0o755);
  // rename is atomic: a concurrent `ss-grep` sees the stub or the binary, never half a file.
  fs.renameSync(tmp, target);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.packageRoot]
 * @param {boolean} [opts.force]          allow a development checkout (tests)
 * @param {() => string|null} [opts.resolveBinary]
 * @param {(bin: string) => boolean} [opts.supportsAgentTools]
 * @returns {{status: 'linked'|'skipped'|'failed', detail: string, linked: string[]}}
 */
export function linkNativeAgentTools({
  packageRoot = PACKAGE_ROOT,
  force = false,
  resolveBinary = resolveNativeBinary,
  supportsAgentTools = nativeBinarySupportsAgentTools,
} = {}) {
  const linked = [];
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return { status: 'skipped', detail: `no native ss-* tools for ${process.platform}; the JS stubs serve`, linked };
  }
  if (!force && !isInstalledPackage(packageRoot)) {
    return { status: 'skipped', detail: 'development checkout (bin/ss-* are source files)', linked };
  }
  const binary = resolveBinary();
  if (!binary) return { status: 'skipped', detail: 'no native binary for this platform; the JS stubs serve', linked };
  // Runs the binary: proves it executes on this host and speaks the ss-* protocol.
  if (!supportsAgentTools(binary)) {
    return { status: 'skipped', detail: `native binary ${binary} has no ss-* support; the JS stubs serve`, linked };
  }
  try {
    for (const name of Object.keys(AGENT_TOOLS)) {
      replaceWithBinary(binary, path.join(packageRoot, 'bin', name));
      linked.push(name);
    }
  } catch (err) {
    return { status: 'failed', detail: `${err?.code || err?.message || err} after ${linked.length} of ${Object.keys(AGENT_TOOLS).length}; the JS stubs serve the rest`, linked };
  }
  return { status: 'linked', detail: `ss-* run the native binary (${binary})`, linked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = linkNativeAgentTools();
    if (process.env.SWEET_SEARCH_DEBUG_INSTALL) process.stderr.write(`[sweet-search] ss-* tools: ${report.status} — ${report.detail}\n`);
  } catch {
    // Never fail an install over an optimisation.
  }
}
