#!/usr/bin/env node
/**
 * ss-grep allocation replay, collector (docs/SUGGESTED_PLAN.md, Step 0).
 *
 * For every unscoped ss-grep call recorded on a permitted probe set (dev or dev-confirm; a
 * held-out probe is refused), collect the matches with line numbers and the code-graph entity
 * spans of every matched file, read through the production CodeGraphRepository on a READ-ONLY
 * COPY of the index (the repository's own `.sweet-search/` is never written).
 *
 * Matches (--matcher): `engine` (default) is the engine's own bareGrep over the real index with
 * the tool's pattern steps (engine-matches.mjs), so the match set is the tool's. `rg` is the
 * exploratory collector's `rg -n` with the call's -i/-w/-F flags; the fidelity check showed it
 * differs from the engine on most calls (files outside the grep index, files over 1 MB).
 *
 * Provenance is verified per repository BEFORE anything is collected, and the run refuses on a
 * mismatch (pass --allow-mismatch only to inspect what differs; the output is then marked):
 *   - HEAD equals every probe's `repoSha`, and the tracked tree is clean;
 *   - the index identity is recorded: reconcile-manifest epoch + publishedAt, code-graph
 *     schema_meta version;
 *   - the index was built from that revision: every merkle-state.json entry's content hash
 *     (the indexer's own contentHash) equals the working tree file's hash.
 * The provenance is written into the output.
 *
 * Usage:
 *   node eval/grep-allocation-replay/collect.mjs [--set dev|dev-confirm] [--matcher engine|rg]
 *     [--dossiers DIR] [--probes a.json,b.json] [--repos DIR] [--out FILE] [--allow-mismatch]
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import {
  DEFAULT_DOSSIERS, DEFAULT_OUT, DEFAULT_PROBE_FILES, DEFAULT_REPOS, PERMITTED_SETS,
  dossierCalls, loadProbes, parseGrepCall, pyList,
} from './lib.mjs';
import { verifyRepo } from './provenance.mjs';

const MAX_LINES_PER_FILE = 400;
const MAX_TEXT = 300;

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SET = argValue('--set', 'dev');
const DOSSIERS = argValue('--dossiers', DEFAULT_DOSSIERS);
const PROBE_FILES = argValue('--probes', DEFAULT_PROBE_FILES.join(',')).split(',');
const REPOS = argValue('--repos', DEFAULT_REPOS);
const OUT = argValue('--out', path.join(DEFAULT_OUT, `collected-${SET}.json`));
const ALLOW_MISMATCH = process.argv.includes('--allow-mismatch');
const MATCHER = argValue('--matcher', 'engine');
if (!['engine', 'rg'].includes(MATCHER)) {
  process.stderr.write(`unknown --matcher ${MATCHER} (engine | rg)\n`);
  process.exit(2);
}

if (!PERMITTED_SETS.has(SET)) {
  process.stderr.write(`refusing --set ${SET}: only ${[...PERMITTED_SETS].join(', ')} may be collected per call\n`);
  process.exit(2);
}

function runRg(repoDir, { pattern, flags }) {
  return new Promise((resolve) => {
    const args = ['-n', '--no-heading', '--with-filename', '--no-messages', '--color', 'never',
      '-g', '!.sweet-search', '-g', '!.git', '--max-filesize', '1M',
      ...(flags.i ? ['-i'] : []), ...(flags.w ? ['-w'] : []), ...(flags.F ? ['-F'] : []), '-e', pattern];
    // stdin ignored: with no path and a readable stdin, rg searches stdin instead of the cwd
    const child = spawn('rg', args, { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] });
    const files = new Map();
    let buf = '';
    const take = (line) => {
      // CRLF sources: `.` never matches the trailing \r
      const m = line.replace(/\r$/, '').match(/^(.*?):(\d+):([\s\S]*)$/);
      if (!m) return;
      const file = m[1].replace(/^\.\//, '');
      let f = files.get(file);
      if (!f) { f = { total: 0, lines: [] }; files.set(file, f); }
      f.total++;
      if (f.lines.length < MAX_LINES_PER_FILE) f.lines.push([Number(m[2]), m[3].slice(0, MAX_TEXT)]);
    };
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    });
    child.on('close', () => { if (buf) take(buf); resolve(Object.fromEntries(files)); });
    child.on('error', () => resolve({}));
  });
}

/** Every grep of one repository through the engine, in a worker process rooted there. */
function engineMatches(repoDir, greps) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'grep-replay-engine-'));
  const job = path.join(tmp, 'job.json');
  const outFile = path.join(tmp, 'out.json');
  writeFileSync(job, JSON.stringify({ repoDir, outFile, greps }));
  const child = spawnSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'engine-matches.mjs'), job], {
    cwd: repoDir,
    env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: repoDir },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    if (child.status !== 0) throw new Error(`engine worker failed for ${repoDir}: ${String(child.stderr).slice(-1500)}`);
    return JSON.parse(readFileSync(outFile, 'utf8'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The production entity lookup on a read-only copy of the index (manifest epoch pinned). */
function openGraphCopy(repoDir) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'grep-replay-graph-'));
  const state = path.join(repoDir, '.sweet-search');
  for (const name of ['code-graph.db', 'code-graph.db-wal', 'code-graph.db-shm', 'reconcile-manifest.json']) {
    if (existsSync(path.join(state, name))) copyFileSync(path.join(state, name), path.join(tmp, name));
  }
  const repo = new CodeGraphRepository(path.join(tmp, 'code-graph.db'));
  repo.refreshManifestEpoch?.();
  return { repo, cleanup: () => { repo.close?.(); rmSync(tmp, { recursive: true, force: true }); } };
}

async function main() {
  const probes = loadProbes(PROBE_FILES);
  const skipped = { notInProbeFiles: 0, otherSet: 0, scopedOrUnparsable: 0, noRepo: 0 };
  const calls = [];
  for (const row of dossierCalls(DOSSIERS)) {
    const probe = probes.get(row.id);
    if (!probe) { skipped.notInProbeFiles++; continue; }
    if (probe.set !== SET) { skipped.otherSet++; continue; }
    const parsed = parseGrepCall(row.args);
    if (!parsed) { skipped.scopedOrUnparsable++; continue; }
    const repoDir = path.join(REPOS, probe.repo);
    if (!existsSync(repoDir)) { skipped.noRepo++; continue; }
    calls.push({
      probe: row.id, repo: probe.repo, stratum: probe.stratum ?? null, dossier: row.dossier,
      callIndex: row.callIndex, args: row.args, ...parsed,
      goldFiles: pyList(row.goldFiles).length ? pyList(row.goldFiles) : probe.expectedFiles,
      goldSymbols: pyList(row.goldSymbols).length ? pyList(row.goldSymbols) : probe.expectedSymbols,
      repoSha: probe.repoSha,
    });
  }
  if (skipped.otherSet) process.stderr.write(`[collect] ${skipped.otherSet} calls on probes outside set "${SET}" were not read\n`);

  const repos = [...new Set(calls.map(c => c.repo))].sort();
  const provenance = {};
  let refused = false;
  for (const repo of repos) {
    const shas = new Set(calls.filter(c => c.repo === repo).map(c => c.repoSha));
    provenance[repo] = await verifyRepo(path.join(REPOS, repo), shas);
    const p = provenance[repo];
    process.stderr.write(`[collect] ${repo}: HEAD ${p.head.slice(0, 10)} clean=${p.clean} epoch=${p.index.epoch} `
      + `published=${p.index.publishedAt} schema=${p.index.codeGraphSchemaVersion}${p.problems.length ? ` PROBLEMS: ${p.problems.join(' | ')}` : ' ok'}\n`);
    if (p.problems.length) refused = true;
  }
  if (refused && !ALLOW_MISMATCH) {
    process.stderr.write('[collect] refusing: provenance does not match (see above). Nothing was written.\n');
    process.exit(3);
  }

  const keyOf = c => JSON.stringify([c.repo, c.pattern, c.flags.i, c.flags.w, c.flags.F]);
  const greps = {};
  const grepNotes = {};
  const unique = [...new Map(calls.map(c => [keyOf(c), c])).values()];
  if (MATCHER === 'engine') {
    for (const repo of repos) {
      const mine = unique.filter(c => c.repo === repo).map(c => ({ key: keyOf(c), pattern: c.pattern, flags: c.flags }));
      const res = engineMatches(path.join(REPOS, repo), mine);
      for (const [key, r] of Object.entries(res)) {
        greps[key] = r.files;
        if (r.note) grepNotes[key] = { note: r.note, usedRegex: r.usedRegex };
      }
      process.stderr.write(`[collect] ${repo}: ${mine.length} greps through the engine\n`);
    }
  } else {
    for (let i = 0; i < unique.length; i += 8) {
      await Promise.all(unique.slice(i, i + 8).map(async (c) => { greps[keyOf(c)] = await runRg(path.join(REPOS, c.repo), c); }));
    }
  }
  for (const c of calls) c.grepKey = keyOf(c);

  const spans = {};
  const stale = {};
  for (const repo of repos) {
    const repoDir = path.join(REPOS, repo);
    const publishedMs = Date.parse(provenance[repo].index.publishedAt || '');
    const files = new Set();
    for (const [key, byFile] of Object.entries(greps)) if (JSON.parse(key)[0] === repo) for (const f of Object.keys(byFile)) files.add(f);
    const { repo: graph, cleanup } = openGraphCopy(repoDir);
    spans[repo] = {};
    stale[repo] = [];
    for (const file of [...files].sort()) {
      const ents = graph.findEntitiesInFile(file);
      if (ents.length) spans[repo][file] = ents.map(e => [e.startLine, e.endLine, e.name]);
      // the production freshness rule (index-freshness.js): newer than publishedAt = stale
      try { if (!(Number.isFinite(publishedMs) && statSync(path.join(repoDir, file)).mtimeMs <= publishedMs)) stale[repo].push(file); } catch { stale[repo].push(file); }
    }
    cleanup();
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    collector: 'eval/grep-allocation-replay/collect.mjs',
    collectedAt: new Date().toISOString(),
    set: SET,
    matcher: MATCHER,
    exploratory: SET === 'dev',
    provenanceVerified: !refused,
    grepNotes,
    provenance,
    skipped,
    calls,
    greps,
    spans,
    stale,
  }));
  process.stderr.write(`[collect] ${calls.length} calls, ${unique.length} unique greps, ${repos.length} repositories -> ${OUT}\n`);
}

await main();
