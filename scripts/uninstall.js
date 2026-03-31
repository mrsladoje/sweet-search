#!/usr/bin/env node

/**
 * Sweet Search uninstall — reverses everything `sweet-search init` created.
 *
 * Removes .sweet-search/ config directory and init-managed model cache
 * contents for the current project. Does not touch user source code,
 * indexes, or database files outside of .sweet-search/.
 *
 * Usage:
 *   sweet-search uninstall [--dry-run] [--keep-models] [--purge] [--force]
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const result = { dryRun: false, keepModels: false, purge: false, force: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--keep-models') result.keepModels = true;
    else if (arg === '--purge') result.purge = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Size helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        try {
          total += statSync(join(entry.parentPath || entry.path, entry.name)).size;
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return total;
}

// ---------------------------------------------------------------------------
// Project root detection (same logic as init.js)
// ---------------------------------------------------------------------------

function detectProjectRoot(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// Model cache resolution (same defaults as core/config.js)
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';

function resolveModelCacheRoot() {
  if (process.env.SWEET_SEARCH_MODEL_CACHE) {
    return process.env.SWEET_SEARCH_MODEL_CACHE;
  }
  return join(homedir(), '.cache', 'sweet-search', 'models');
}

function getModelCacheDirs(initConfig) {
  const cacheRoot = resolveModelCacheRoot(initConfig);
  const dirs = [];

  if (!initConfig || !initConfig.models) return dirs;

  // Collect cache dirs for models that init managed
  for (const [key, info] of Object.entries(initConfig.models)) {
    if (info.cacheDir && existsSync(info.cacheDir)) {
      dirs.push({ key, path: info.cacheDir, size: dirSize(info.cacheDir) });
    }
  }

  return dirs;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Sweet Search uninstall — remove local state created by init

Usage:
  sweet-search uninstall [options]

Options:
  --dry-run        Show what would be removed without deleting
  --keep-models    Preserve the model cache (may be shared/expensive)
  --purge          Also run \`npm uninstall sweet-search\` and remove @sweet-search/* packages
  --force          Skip confirmation prompt (for CI/scripted use)
  --help, -h       Show this help

What gets removed:
  - .sweet-search/ config directory and all generated config
  - Init-managed model cache for this project's profile

What is NOT removed:
  - User source code, indexes, or database files outside .sweet-search/
  - The npm package itself (unless --purge)
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runUninstall(args) {
  const parsed = parseArgs(args);
  if (parsed.help) { printHelp(); return; }

  const projectRoot = detectProjectRoot();
  const dataDir = join(projectRoot, DATA_DIR_NAME);

  // Load existing init config (if any)
  let initConfig = null;
  const configPath = join(dataDir, 'config.json');
  if (existsSync(configPath)) {
    try { initConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* corrupted config */ }
  }

  // Collect what to remove
  const removals = [];
  let totalBytes = 0;

  // 1. .sweet-search/ directory
  if (existsSync(dataDir)) {
    const size = dirSize(dataDir);
    removals.push({ label: DATA_DIR_NAME + '/', path: dataDir, size, type: 'config' });
    totalBytes += size;
  }

  // 2. Model cache (unless --keep-models)
  if (!parsed.keepModels) {
    const modelDirs = getModelCacheDirs(initConfig);
    for (const md of modelDirs) {
      removals.push({ label: `model cache: ${md.key}`, path: md.path, size: md.size, type: 'model' });
      totalBytes += md.size;
    }
  }

  // Nothing to remove?
  if (removals.length === 0) {
    console.log('Nothing to remove — Sweet Search is not initialized in this project.');
    return;
  }

  // Report
  console.log('');
  console.log(`Sweet Search uninstall${parsed.dryRun ? ' (dry run)' : ''}`);
  console.log(`  Project: ${projectRoot}`);
  console.log('');
  console.log('  Will remove:');
  for (const r of removals) {
    console.log(`    ${r.label} (${formatBytes(r.size)})`);
  }
  console.log(`  Total: ${formatBytes(totalBytes)}`);
  if (parsed.keepModels) {
    console.log('  Model cache: kept (--keep-models)');
  }
  console.log('');

  if (parsed.dryRun) {
    console.log('Dry run — nothing was removed.');
    return;
  }

  // Confirmation (unless --force)
  if (!parsed.force && process.stdin.isTTY) {
    process.stdout.write('Proceed? [y/N] ');
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('', a => { rl.close(); resolve(a.trim().toLowerCase()); });
    });
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Cancelled.');
      return;
    }
  }

  // Remove
  let removed = 0;
  let kept = 0;
  for (const r of removals) {
    try {
      rmSync(r.path, { recursive: true, force: true });
      console.log(`  Removed: ${r.label}`);
      removed++;
    } catch (err) {
      console.log(`  Failed to remove ${r.label}: ${err.message}`);
      kept++;
    }
  }

  // Purge npm packages
  if (parsed.purge) {
    console.log('');
    console.log('  Purging npm packages...');
    try {
      execSync('npm uninstall sweet-search @sweet-search/native-darwin-arm64 @sweet-search/native-darwin-x64 @sweet-search/native-linux-x64-gnu @sweet-search/native-linux-arm64-gnu 2>/dev/null || true', {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log('  npm packages removed.');
    } catch {
      console.log('  npm uninstall failed (packages may not be installed).');
    }
  }

  // Summary
  console.log('');
  console.log(`Uninstall complete: ${removed} removed, ${kept} failed.`);
  if (!parsed.purge) {
    console.log('  Note: The sweet-search npm package is still installed. Use --purge to remove it.');
  }
}
