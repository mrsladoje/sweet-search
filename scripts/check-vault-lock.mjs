#!/usr/bin/env node
/**
 * Vault-lock checker — refuses Vault probe reads before the campaign-end
 * git tag exists.
 *
 * Plan reference: §0.5.3 Tier 3 (Vault), §11.11 (HOMP gate). The Vault is
 * opened EXACTLY ONCE at campaign end, gated by `release/<run-id>` tags.
 *
 * Behaviour:
 *   - As a CLI tool: scans the working tree for any source file (not test,
 *     not docs, not the lock-checker itself) that imports / reads
 *     `core/prompt-optimization/data/splits/freshstack_30.json` or
 *     `core/prompt-optimization/data/splits/vault_50.json` and exits 1 if
 *     any matching import is found AND no `release/*` tag is present at
 *     HEAD or earlier.
 *   - As a pre-commit hook: same check, but only against staged files.
 *   - Programmatic API (`assertVaultUnlocked`): module export for runners.
 *
 * Usage:
 *   node scripts/check-vault-lock.mjs --scan       (full tree scan; CI)
 *   node scripts/check-vault-lock.mjs --staged     (pre-commit hook)
 *   node scripts/check-vault-lock.mjs --runId X    (assertion mode for runners)
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

const VAULT_PATHS = [
  'core/prompt-optimization/data/splits/freshstack_30.json',
  'core/prompt-optimization/data/splits/vault_50.json',
];

const SCAN_IGNORE_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  '.sweet-search/',
  '.agentic-qe/',
  'target/',
  'docs/',
  'scripts/check-vault-lock.mjs',
  // The lock checker itself is permitted to mention the paths.
  'core/prompt-optimization/run-homp.mjs',
  // run-homp is the ONLY runtime accessor; it asserts release/<run-id> internally.
];

function args() {
  const a = process.argv.slice(2);
  const out = { scan: false, staged: false, runId: null };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t === '--scan') out.scan = true;
    else if (t === '--staged') out.staged = true;
    else if (t === '--runId') out.runId = a[++i];
  }
  if (!out.scan && !out.staged && !out.runId) out.scan = true;
  return out;
}

function hasReleaseTag() {
  try {
    const tags = execSync('git tag --list "release/*"', { encoding: 'utf8' });
    return tags.trim().length > 0;
  } catch {
    return false;
  }
}

function specificReleaseTag(runId) {
  const tag = `release/${runId}`;
  try {
    execSync(`git rev-parse --verify ${JSON.stringify(tag)}`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(process.cwd(), p);
    if (SCAN_IGNORE_PREFIXES.some((pref) => rel.startsWith(pref))) continue;
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && /\.(m?js|c?js|ts|tsx|json|py|rs|go)$/.test(e.name)) {
      out.push(rel);
    }
  }
}

function scanFile(rel) {
  let text;
  try {
    text = readFileSync(rel, 'utf8');
  } catch {
    return [];
  }
  const hits = [];
  for (const v of VAULT_PATHS) {
    if (text.includes(v)) hits.push(v);
  }
  return hits;
}

function stagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Programmatic assertion for runners. Throws if Vault is locked and no
 * `release/<runId>` tag exists.
 */
export function assertVaultUnlocked(runId) {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError('check-vault-lock: runId required');
  }
  if (!specificReleaseTag(runId)) {
    throw new Error(
      `check-vault-lock: Vault is LOCKED — git tag release/${runId} does not exist. ` +
        `Vault is opened EXACTLY ONCE at campaign end (§0.5.3, §11.11). ` +
        `Create the tag and try again: git tag release/${runId}`
    );
  }
}

async function main() {
  const opts = args();
  if (opts.runId) {
    try {
      assertVaultUnlocked(opts.runId);
      process.stdout.write(`OK release/${opts.runId} exists; Vault is unlocked.\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
  }

  const releaseTagPresent = hasReleaseTag();
  const filesToCheck = opts.staged ? stagedFiles() : [];
  if (opts.scan) {
    const collected = [];
    await walk(process.cwd(), collected);
    filesToCheck.push(...collected);
  }

  const offenders = [];
  for (const f of filesToCheck) {
    if (!existsSync(f)) continue;
    try {
      const st = statSync(f);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    const hits = scanFile(f);
    if (hits.length > 0) offenders.push({ file: f, hits });
  }

  if (offenders.length === 0) {
    process.stdout.write(`OK no Vault references found in ${opts.staged ? 'staged files' : 'tree'}.\n`);
    process.exit(0);
  }

  if (releaseTagPresent) {
    process.stdout.write(
      `OK release/* tag present; ${offenders.length} Vault references permitted (campaign-end mode).\n`
    );
    process.exit(0);
  }

  process.stderr.write(
    `BLOCK: Vault references found and no release/* tag exists. ` +
      `Vault opens EXACTLY ONCE at campaign end (§0.5.3).\n`
  );
  for (const o of offenders) {
    process.stderr.write(`  ${o.file}:\n`);
    for (const h of o.hits) process.stderr.write(`    - ${h}\n`);
  }
  process.stderr.write(
    `\nIf this is the campaign-end gate, create the tag first:\n` +
      `  git tag release/<run-id>\n` +
      `\nIf this is accidental, remove the import / read of the Vault path.\n`
  );
  process.exit(1);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`check-vault-lock: ${err.message}\n`);
    process.exit(2);
  });
}
