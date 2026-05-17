#!/usr/bin/env node
/**
 * diagnose-dev-failures.mjs — Stage 3 deep-dive for ss-semantic Phase 6 v2.
 *
 * For each dev FAIL in the v3 sweep, run readSemantic with verbose=true and
 * emit:
 *   - the query used (best-shape: V2 for C-family, V1 elsewhere)
 *   - the gold containingChunk
 *   - the top-8 pre-merge ranked chunks with per-signal scores
 *   - the final merged spans (with score)
 *   - a categorization tag (see below)
 *
 * Categorization tags (Stage 3 taxonomy, applied per failure):
 *
 *   MaxSimSmallChunkInflation : tiny chunk (≤ 5 lines) outscored the gold
 *                                chunk on MaxSim alone (RB-001 type)
 *   ChunkerMegaChunk           : gold chunk is part of a 100+ line chunk
 *                                covering many siblings (RB-004 type)
 *   ChunkerSymbolNotChunked    : no returned chunk has the expected symbol
 *                                in its symbol/signature metadata
 *   FellBackToFile             : readSemantic returned fellBack=true (file
 *                                not indexed or no signal hit)
 *   WrongChunkBeatRight        : the right chunk exists in pre-merge ranking
 *                                but at rank ≥ 2; ranker chose another
 *   GoldIsTooNarrow            : gold containingChunk is < 5 lines (Scala
 *                                one-liner pattern); IoU≥0.5 impossible
 *   OverlayRequired            : chunker output doesn't include any chunk
 *                                that covers the gold line range at all
 *
 * Output: failure-analysis/stage3-diagnosis.jsonl + stage3-taxonomy.md
 *
 * Uses the same orchestrator/child pattern as track-a-runner-ss-semantic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const FAILURES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis/stage0-failures.jsonl');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');

const FAMILY_OF_LANG = {
  java: 'OO-monolithic', csharp: 'OO-monolithic', kotlin: 'OO-monolithic', scala: 'OO-monolithic',
  rust: 'Systems-modular-terse', go: 'Systems-modular-terse',
  c: 'C-family', cpp: 'C-family', zig: 'C-family',
  javascript: 'JS-mobile', typescript: 'JS-mobile', 'typescript-lib': 'JS-mobile', dart: 'JS-mobile',
  python: 'Scripting-dynamic', ruby: 'Scripting-dynamic', php: 'Scripting-dynamic', lua: 'Scripting-dynamic', elixir: 'Scripting-dynamic',
};
const BEST_SHAPE = (fam) => fam === 'C-family' ? 'V2' : 'V1';

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const e of raw.repos || []) map.set(e.key || e.language, e);
  return map;
}

function loadDevFailures() {
  const splits = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const dev = new Set();
  for (const [, s] of Object.entries(splits.perLanguage)) for (const id of s.dev || []) dev.add(id);
  const lines = fs.readFileSync(FAILURES_PATH, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('{')).map(JSON.parse);
  return lines.filter((r) => r.verdict === 'FAIL' && dev.has(r.goldId));
}

function loadInput(lang, goldId) {
  return JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, `${lang}-${goldId}.json`), 'utf8'));
}

function loadVariant(lang, goldId, shape) {
  const p = path.join(VARIANTS_DIR, `${lang}-${goldId}-${shape}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function categorize(diag) {
  const { fellBack, preMergeRanked, mergedSpans, gold, expectedSymbol } = diag;
  if (fellBack) return ['FellBackToFile'];
  if (!preMergeRanked || preMergeRanked.length === 0) return ['OverlayRequired'];

  const tags = [];
  const goldLen = gold.endLine - gold.startLine + 1;
  if (goldLen < 5) tags.push('GoldIsTooNarrow');

  // Find the chunk that best contains the gold
  let bestContainingChunkIdx = -1;
  let bestContainingIou = 0;
  preMergeRanked.forEach((r, i) => {
    const ov = Math.max(0, Math.min(r.endLine, gold.endLine) - Math.max(r.startLine, gold.startLine) + 1);
    if (ov <= 0) return;
    const aLen = r.endLine - r.startLine + 1;
    const bLen = goldLen;
    const iou = ov / (aLen + bLen - ov);
    if (iou > bestContainingIou) { bestContainingIou = iou; bestContainingChunkIdx = i; }
  });

  // No chunk overlaps gold at all
  if (bestContainingChunkIdx < 0) {
    tags.push('OverlayRequired');
    return tags;
  }

  // Mega-chunk: best containing chunk is ≥ 3x the gold length
  const bestChunk = preMergeRanked[bestContainingChunkIdx];
  const bestChunkLen = bestChunk.endLine - bestChunk.startLine + 1;
  if (bestChunkLen >= 3 * goldLen) tags.push('ChunkerMegaChunk');

  // Symbol not chunked: no chunk has the expected symbol metadata
  if (expectedSymbol) {
    const symLower = String(expectedSymbol).toLowerCase();
    const anyHasSym = preMergeRanked.some((r) => (r.symbol || '').toLowerCase().includes(symLower) || symLower.includes((r.symbol || '').toLowerCase()));
    if (!anyHasSym && bestChunk.symbol == null) tags.push('ChunkerSymbolNotChunked');
  }

  // Wrong chunk beat right: best containing chunk is at rank ≥ 1 (0-indexed)
  if (bestContainingChunkIdx >= 1) tags.push('WrongChunkBeatRight');

  // MaxSim small-chunk inflation: top-by-score chunk is short AND has no symbol
  // AND outscored the best-containing chunk on MaxSim alone.
  const topByScore = [...preMergeRanked].sort((a, b) => b.score - a.score)[0];
  const topLen = topByScore.endLine - topByScore.startLine + 1;
  if (topLen <= 5 && !topByScore.symbol && topByScore.maxsim != null && bestChunk.maxsim != null && topByScore.maxsim > bestChunk.maxsim) {
    tags.push('MaxSimSmallChunkInflation');
  }

  if (tags.length === 0) tags.push('Unclassified');
  return tags;
}

async function orchestrate() {
  const reposMap = loadReposManifest();
  const failures = loadDevFailures();
  process.stdout.write(`orchestrator: ${failures.length} dev FAILs to diagnose\n`);

  const byLang = new Map();
  for (const f of failures) {
    if (!byLang.has(f.language)) byLang.set(f.language, []);
    byLang.get(f.language).push(f);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'stage3-diagnosis.jsonl');
  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let total = 0;
  for (const [lang, langFailures] of byLang) {
    const repoEntry = reposMap.get(lang);
    if (!repoEntry) { process.stderr.write(`  ! no repo ${lang}\n`); continue; }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    process.stdout.write(`\n--- ${lang} (${langFailures.length} failures) ---\n`);
    const goldIds = langFailures.map((f) => f.goldId).join(',');
    const res = spawnSync(process.argv[0], [process.argv[1], '--child', lang, goldIds], {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SS_SEMANTIC_DIAGNOSE_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      process.stderr.write(`  child ${lang} exited ${res.status}: ${res.stderr.toString().slice(0, 300)}\n`);
      continue;
    }
    for (const line of res.stdout.toString().split(/\r?\n/)) {
      if (!line.startsWith('{')) { if (line.trim()) process.stdout.write('  ' + line + '\n'); continue; }
      out.write(line + '\n');
      total++;
    }
  }
  await new Promise((r) => out.end(r));
  process.stdout.write(`\norchestrator: ${total} diagnostic rows written\n  output: ${path.relative(REPO_ROOT, outPath)}\n`);
}

async function child(lang, goldIdsCsv) {
  const goldIds = goldIdsCsv.split(',').filter(Boolean);
  const { readSemantic } = await import('../../search-runtime.mjs');
  for (const goldId of goldIds) {
    const input = loadInput(lang, goldId);
    const fam = input.family || FAMILY_OF_LANG[lang];
    const shape = BEST_SHAPE(fam);
    const variant = loadVariant(lang, goldId, shape);
    if (!variant) { process.stderr.write(`  ! no variant for ${lang}-${goldId}-${shape}\n`); continue; }
    let resp;
    try {
      resp = await readSemantic({
        path: input.expectedFile,
        query: variant.query,
        projectRoot: process.env.SWEET_SEARCH_PROJECT_ROOT,
        topK: 8,
        verbose: true,
      });
    } catch (err) {
      process.stderr.write(`  ! readSemantic error ${lang}-${goldId}: ${err.message}\n`);
      continue;
    }
    const gold = input.containingChunk;
    const diag = {
      goldId,
      language: lang,
      family: fam,
      shape,
      query: variant.query,
      expectedFile: input.expectedFile,
      expectedSymbol: input.expectedSymbol,
      expectedSymbolType: input.expectedSymbolType,
      gold: { startLine: gold.startLine, endLine: gold.endLine, lengthLines: gold.endLine - gold.startLine + 1 },
      fellBack: !!resp.fellBack,
      reason: resp.reason ?? null,
      signals: resp.signals ? {
        liRan: resp.signals.liRan,
        lexicalHits: resp.signals.lexicalHits,
        symbolHits: resp.signals.symbolHits,
        maxsimHits: resp.signals.maxsimHits,
        fusedCandidates: resp.signals.fusedCandidates,
      } : null,
      preMergeRanked: (resp.signals?.preMergeRanked ?? []).map((r) => ({
        startLine: r.startLine, endLine: r.endLine, score: r.score, symbol: r.symbol, type: r.type,
        lexical: r.signals.lexical, symbolScore: r.signals.symbol, maxsim: r.signals.maxsim, fused: r.signals.fused,
      })),
      mergedSpans: (resp.spans ?? []).map((s) => ({
        startLine: s.startLine, endLine: s.endLine, score: s.score, symbols: s.symbols ?? [], types: s.types ?? [],
      })),
      goldNotes: input.goldNotes,
    };
    diag.tags = categorize(diag);
    process.stdout.write(JSON.stringify(diag) + '\n');
  }
}

async function main() {
  if (process.env.SS_SEMANTIC_DIAGNOSE_CHILD === '1' && process.argv[2] === '--child') {
    await child(process.argv[3], process.argv[4]);
  } else {
    await orchestrate();
  }
}

main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
