/**
 * Provenance of one repository checkout and its index, checked before any replay collects:
 *   - HEAD equals every probe's `repoSha`, and the tracked tree is clean;
 *   - the index identity: reconcile-manifest epoch + publishedAt, code-graph schema_meta version;
 *   - the index was built from that tree: every merkle-state.json entry's content hash (the
 *     indexer's own contentHash) equals the working tree file's hash.
 * Read-only: the index database is opened read-only.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { contentHash } from '../../core/incremental-indexing/infrastructure/hashing.mjs';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

/**
 * @param {string} repoDir
 * @param {Set<string>} expectedShas - the probes' repoSha values for this repository
 * @returns {Promise<{head: string, clean: boolean, index: object, problems: string[]}>}
 */
export async function verifyRepo(repoDir, expectedShas) {
  const problems = [];
  const head = git(repoDir, ['rev-parse', 'HEAD']);
  if (expectedShas.size !== 1) problems.push(`probes disagree on repoSha: ${[...expectedShas].join(', ')}`);
  if (!expectedShas.has(head)) problems.push(`HEAD ${head} is not the probes' repoSha ${[...expectedShas].join(', ')}`);
  const dirty = git(repoDir, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) problems.push(`tracked tree is not clean (${dirty.split('\n').length} paths)`);

  const state = path.join(repoDir, '.sweet-search');
  const manifest = JSON.parse(readFileSync(path.join(state, 'reconcile-manifest.json'), 'utf8'));
  const db = new Database(path.join(state, 'code-graph.db'), { readonly: true, fileMustExist: true });
  let schemaVersion = null;
  try { schemaVersion = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get()?.value ?? null; } catch { /* absent */ }
  db.close();

  const merkle = JSON.parse(readFileSync(path.join(state, 'merkle-state.json'), 'utf8'));
  const entries = Object.entries(merkle.files || {});
  let mismatched = 0;
  let missing = 0;
  const examples = [];
  for (const [rel, entry] of entries) {
    const abs = path.join(repoDir, rel);
    if (!existsSync(abs)) { missing++; if (examples.length < 5) examples.push(`missing ${rel}`); continue; }
    const hash = await contentHash(readFileSync(abs));
    const want = typeof entry === 'string' ? entry : entry.hash;
    if (hash !== want) { mismatched++; if (examples.length < 5) examples.push(`changed ${rel}`); }
  }
  if (mismatched || missing) problems.push(`index not built from this tree: ${mismatched} changed, ${missing} missing of ${entries.length} indexed files (${examples.join('; ')})`);

  return {
    head,
    clean: !dirty,
    index: {
      epoch: manifest.epoch ?? null,
      publishedAt: manifest.publishedAt ?? null,
      codeGraphEpoch: manifest.codeGraph?.epoch ?? null,
      codeGraphSchemaVersion: schemaVersion,
      merkleLastIndex: merkle.lastIndex ?? null,
      indexedFiles: entries.length,
      hashMismatches: mismatched,
      missingFiles: missing,
    },
    problems,
  };
}
