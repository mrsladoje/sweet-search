#!/usr/bin/env node
/**
 * diagnose-file-header.mjs — Fix 1 prep.
 *
 * For each of the 3 dev FAILs where top-1 is the file header chunk (JV-002,
 * RB-001, RB-004), call readSemantic with verbose=true and dump the per-chunk
 * signal breakdown (lexical, symbol, MaxSim, fused). This lets us see WHY
 * the ranker put the file-header chunk first instead of the real symbol chunk.
 *
 * Same orchestrator/child pattern as track-a-runner-ss-semantic (each gold's
 * language gets a child process with SWEET_SEARCH_PROJECT_ROOT set before the
 * readSemantic import).
 *
 * Hypotheses to test:
 *   H1: file-header chunk is a giant chunk (50+ lines of imports + comments)
 *       and lexical regex catches lots of single-token hits cumulatively.
 *   H2: MaxSim score is structurally inflated for short / boilerplate chunks
 *       because the bi-encoder hasn't seen enough such text and produces
 *       a weakly-pooled embedding that matches any query.
 *   H3: chunker labels file-header as a "code" chunk with `symbol: package`
 *       (or `module` / etc.) which is matched by lexical/symbol scoring on
 *       queries containing those words.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const TARGETS = [
  { lang: 'java',  goldId: 'JV-002', shape: 'V1' }, // "get constructor"
  { lang: 'ruby',  goldId: 'RB-001', shape: 'V1' }, // "show Sinatra::Base"
  { lang: 'ruby',  goldId: 'RB-004', shape: 'V1' }, // "find Sinatra::Application"
];

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const entry of raw.repos || []) map.set(entry.key || entry.language, entry);
  return map;
}

function loadInput(language, goldId) {
  return JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, `${language}-${goldId}.json`), 'utf8'));
}

function loadVariant(language, goldId, shape) {
  return JSON.parse(fs.readFileSync(path.join(VARIANTS_DIR, `${language}-${goldId}-${shape}.json`), 'utf8'));
}

async function orchestrate() {
  const reposMap = loadReposManifest();
  for (const t of TARGETS) {
    const repoEntry = reposMap.get(t.lang);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    process.stdout.write(`\n=== ${t.lang}-${t.goldId} (shape=${t.shape}, projectRoot=${path.relative(REPO_ROOT, projectRoot)}) ===\n`);
    const childArgs = [process.argv[1], '--child', t.lang, t.goldId, t.shape];
    const res = spawnSync(process.argv[0], childArgs, {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot },
      stdio: 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) process.stderr.write(`  child exited ${res.status}\n`);
  }
}

async function child(lang, goldId, shape) {
  const input = loadInput(lang, goldId);
  const variant = loadVariant(lang, goldId, shape);
  process.stdout.write(`Query: ${JSON.stringify(variant.query)}\n`);
  process.stdout.write(`Symbol: ${input.expectedSymbol} | File: ${input.expectedFile}\n`);
  process.stdout.write(`Gold containingChunk: lines ${input.containingChunk.startLine}-${input.containingChunk.endLine}\n`);

  const { readSemantic } = await import('../../../search/search-read-semantic.js');
  const resp = await readSemantic({
    path: input.expectedFile,
    query: variant.query,
    projectRoot: process.env.SWEET_SEARCH_PROJECT_ROOT,
    topK: 8,
    verbose: true,
  });
  process.stdout.write(`\nSignals summary: liRan=${resp.signals.liRan} fusedCandidates=${resp.signals.fusedCandidates} lexicalHits=${resp.signals.lexicalHits} symbolHits=${resp.signals.symbolHits} maxsimHits=${resp.signals.maxsimHits}\n`);
  process.stdout.write(`\nPre-merge ranked chunks (top-${resp.signals.preMergeRanked.length}):\n`);
  for (const r of resp.signals.preMergeRanked) {
    const inGold = (r.startLine <= input.containingChunk.endLine && r.endLine >= input.containingChunk.startLine);
    const tag = inGold ? '★' : ' ';
    process.stdout.write(`  ${tag} lines ${String(r.startLine).padStart(4)}-${String(r.endLine).padEnd(4)} score=${r.score.toFixed(3)} lex=${(r.signals.lexical).toFixed(2)} sym=${(r.signals.symbol).toFixed(2)} maxsim=${r.signals.maxsim == null ? '   - ' : r.signals.maxsim.toFixed(3)} fused=${r.signals.fused.toFixed(3)}  sym=${(r.symbol ?? '').padEnd(30)} type=${r.type ?? ''}\n`);
  }
  process.stdout.write(`\nFinal merged spans:\n`);
  for (const s of resp.spans) {
    const inGold = (s.startLine <= input.containingChunk.endLine && s.endLine >= input.containingChunk.startLine);
    const tag = inGold ? '★' : ' ';
    process.stdout.write(`  ${tag} lines ${s.startLine}-${s.endLine} score=${s.score.toFixed(3)} symbols=[${(s.symbols || []).join(', ')}] types=[${(s.types || []).join(', ')}]\n`);
  }
  process.stdout.write(`\nTimings: ${JSON.stringify(resp.timings)}\n`);
}

async function main() {
  if (process.argv[2] === '--child') {
    await child(process.argv[3], process.argv[4], process.argv[5]);
  } else {
    await orchestrate();
  }
}

main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
