#!/usr/bin/env node
/**
 * Restamp golden indexes with the full 2.8.2 config fingerprint, WITHOUT re-embedding.
 *
 * Why: 2.8.2 (3b53d078) widened the index config fingerprint with five fields — liModel,
 * liQuantization, chunkingVersion, enrichmentVersion, sparseGramWeightsId — and treats a
 * stored fingerprint that LACKS a field as a mismatch ("rebuild once"). On a mismatch the
 * reconcile daemon's tick is a no-op, so in a bench run the sweet arm's index would stop
 * following the agent's edits. Every golden built before 2.8.2 lacks the fields, although
 * its content is what the current code builds (owner, 2026-09-30: no index-format change
 * since 2.8.1).
 *
 * A golden is restamped ONLY when everything that can be checked matches the running code:
 *   - the six fields it already records (provider, model, dimension, hnswDimension,
 *     pipelineVersion, hashAlgorithm) and the state `version` equal the current values;
 *   - the late-interaction store's own header names the current LI model and quantization
 *     (quantBits 4 = int4, 8 = int8);
 *   - reconcile-manifest.json's sparse-gram weightsId is one the current indexer writes
 *     (`corpus-bigram-v1-<hash>`, the fallback id, or the default id).
 * chunkingVersion / enrichmentVersion are recorded nowhere in an index; they are stamped on
 * the owner's statement above. Fields already present are never overwritten. Anything that
 * cannot be verified is refused and listed — never guessed.
 *
 * Usage:
 *   node restamp-golden-fingerprint.mjs [--apply] <golden-root> [<golden-root> ...]
 *     <golden-root>: a dir of golden dirs (each holding .sweet-search/merkle-state.json),
 *                    e.g. $HOME/.ss-eval/golden or the vault $HOME/.ss-eval/vault/golden.
 *   Without --apply it is a dry run. Prints one line per golden and a summary; exit 1 if any
 *   golden was refused (so a caller can stop before re-manifesting / pushing).
 *   Read-only golden dirs (golden-vault.sh locks them) are made writable for the write and
 *   their modes restored after.
 */

import { chmodSync, closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { buildConfigFingerprint } = await import(join(REPO, 'core/indexing/config-fingerprint.js'));
const { DEFAULT_SPARSE_GRAM_WEIGHTS_ID } = await import(join(REPO, 'core/incremental-indexing/infrastructure/manifest.mjs'));

const ORIGINAL_FIELDS = ['provider', 'model', 'dimension', 'hnswDimension', 'pipelineVersion', 'hashAlgorithm'];
const NEW_FIELDS = ['liModel', 'liQuantization', 'chunkingVersion', 'enrichmentVersion', 'sparseGramWeightsId'];
const QUANT_BITS = { int4: 4, int8: 8 };
// The indexer's fallback id IS the default table id (sparse-gram-delta.mjs FALLBACK_WEIGHTS_ID).
const FALLBACK_WEIGHTS_IDS = new Set([DEFAULT_SPARSE_GRAM_WEIGHTS_ID]);

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const roots = argv.filter(a => !a.startsWith('--'));
if (!roots.length) {
  console.error('usage: restamp-golden-fingerprint.mjs [--apply] <golden-root> [...]');
  process.exit(2);
}

const current = buildConfigFingerprint();

/** Read the LI store's leading JSON header fields (modelId, quantBits) without loading the file. */
function liHeader(stateDir) {
  const segManifest = join(stateDir, 'codebase-late-interaction.db.segments', 'manifest.json');
  if (existsSync(segManifest)) {
    try {
      const m = JSON.parse(readFileSync(segManifest, 'utf8'));
      const src = m.header || m.meta || m;
      if (src.modelId !== undefined) return { modelId: src.modelId, quantBits: src.quantBits, source: 'segments manifest' };
    } catch { /* fall through to the single-file store */ }
  }
  const db = join(stateDir, 'codebase-late-interaction.db');
  if (!existsSync(db)) return null;
  const fd = openSync(db, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString('utf8');
    const modelId = head.match(/"modelId":"([^"]*)"/)?.[1];
    const quantBits = head.match(/"quantBits":(\d+)/)?.[1];
    if (modelId === undefined) return null;
    return { modelId, quantBits: quantBits === undefined ? undefined : Number(quantBits), source: 'store header' };
  } finally {
    closeSync(fd);
  }
}

function sparseWeightsId(stateDir) {
  try {
    return JSON.parse(readFileSync(join(stateDir, 'reconcile-manifest.json'), 'utf8'))?.sparseGram?.weightsId ?? null;
  } catch {
    return null;
  }
}

/** @returns {{status: 'restamped'|'would-restamp'|'already-current'|'skipped'|'refused', why?: string}} */
function restampOne(goldenDir) {
  const stateDir = join(goldenDir, '.sweet-search');
  const statePath = join(stateDir, 'merkle-state.json');
  if (!existsSync(statePath)) return { status: 'skipped', why: 'no index here (no .sweet-search/merkle-state.json)' };
  let state;
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch (e) { return { status: 'refused', why: `merkle-state.json unreadable: ${e.message}` }; }
  const fp = state.config_fingerprint;
  if (!fp || typeof fp !== 'object') return { status: 'refused', why: 'no config_fingerprint' };

  for (const k of ORIGINAL_FIELDS) {
    if (fp[k] !== current[k]) return { status: 'refused', why: `${k} ${JSON.stringify(fp[k])} != current ${JSON.stringify(current[k])}` };
  }
  if (fp.version !== current.version) return { status: 'refused', why: `state version ${fp.version} != ${current.version}` };

  const missing = NEW_FIELDS.filter(k => !Object.prototype.hasOwnProperty.call(fp, k));
  const wrong = NEW_FIELDS.filter(k => Object.prototype.hasOwnProperty.call(fp, k) && fp[k] !== current[k]);
  if (wrong.length) return { status: 'refused', why: `stored ${wrong.map(k => `${k}=${JSON.stringify(fp[k])}`).join(', ')} differs from current` };
  if (!missing.length) return { status: 'already-current' };

  // Verify what the index itself records.
  if (missing.includes('liModel') || missing.includes('liQuantization')) {
    if (current.liModel === null) {
      if (liHeader(stateDir)) return { status: 'refused', why: 'index has an LI store but LI is disabled in the running config' };
    } else {
      const h = liHeader(stateDir);
      if (!h) return { status: 'refused', why: 'LI store header not found (cannot verify LI model/quantization)' };
      if (h.modelId !== current.liModel) return { status: 'refused', why: `LI model ${h.modelId} (${h.source}) != current ${current.liModel}` };
      const bits = QUANT_BITS[current.liQuantization];
      if (bits === undefined) return { status: 'refused', why: `current LI quantization ${current.liQuantization} has no known quantBits mapping` };
      if (h.quantBits !== bits) return { status: 'refused', why: `LI quantBits ${h.quantBits} (${h.source}) != ${bits} for ${current.liQuantization}` };
    }
  }
  if (missing.includes('sparseGramWeightsId')) {
    const id = sparseWeightsId(stateDir);
    if (!id) return { status: 'refused', why: 'reconcile-manifest.json has no sparseGram.weightsId (cannot verify sparse weights)' };
    if (!id.startsWith('corpus-bigram-v1-') && !FALLBACK_WEIGHTS_IDS.has(id)) {
      return { status: 'refused', why: `sparse weightsId ${id} is not one the current indexer writes` };
    }
  }

  if (!apply) return { status: 'would-restamp', why: `adds ${missing.join(', ')}` };

  const next = { ...state, config_fingerprint: { ...fp } };
  for (const k of missing) next.config_fingerprint[k] = current[k];
  // Golden dirs may be locked read-only (golden-vault.sh push): open them for the write only.
  const lockedDirs = [goldenDir, stateDir].filter(d => (statSync(d).mode & 0o200) === 0);
  const fileMode = statSync(statePath).mode & 0o777;
  try {
    for (const d of lockedDirs) chmodSync(d, statSync(d).mode | 0o200);
    const tmp = `${statePath}.restamp-tmp`;
    writeFileSync(tmp, JSON.stringify(next));
    chmodSync(tmp, fileMode);
    renameSync(tmp, statePath);
  } finally {
    for (const d of lockedDirs) chmodSync(d, statSync(d).mode & ~0o222);
  }
  return { status: 'restamped', why: `added ${missing.join(', ')}` };
}

const counts = { restamped: 0, 'would-restamp': 0, 'already-current': 0, skipped: 0, refused: 0 };
const refused = [];
for (const root of roots) {
  const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(root, d.name));
  for (const dir of dirs) {
    const r = restampOne(dir);
    counts[r.status] += 1;
    if (r.status === 'refused') refused.push(`${dir}: ${r.why}`);
    console.log(`${r.status.padEnd(15)} ${dir}${r.why ? `  (${r.why})` : ''}`);
  }
}
console.log(`\nsummary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}  (${apply ? 'APPLIED' : 'dry run'})`);
if (refused.length) {
  console.log(`\nREFUSED (${refused.length}) — not changed:`);
  for (const line of refused) console.log(`  ${line}`);
  process.exit(1);
}
