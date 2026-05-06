#!/usr/bin/env node
/**
 * Deterministic stratified split generator for sweet-search benchmarks.
 *
 * Implements the dev/held-out methodology mandated in CLAUDE.md / AGENTS.md:
 *   - 60% dev (iterate freely, inspect per-query)
 *   - 40% held-out (aggregate-only, milestones-only)
 *   - Stratified random sampling with seed=42
 *   - Stratification dimension chosen per benchmark (language, repo, etc.)
 *
 * Output (committed, version-controlled):
 *   eval/splits/<bench>/dev.json       { ids: [...] }
 *   eval/splits/<bench>/heldout.json   { ids: [...] }
 *   eval/splits/<bench>/manifest.json  { seed, stratifyBy, ratios, counts, source, generatedAt }
 *
 * The script is idempotent: identical seed + identical source = identical output.
 * If you change the source data or the split ratios, re-run and commit the result.
 *
 * Usage:
 *   node eval/scripts/generate-splits.js                 # regenerate all
 *   node eval/scripts/generate-splits.js --bench=gencodesearchnet
 *   node eval/scripts/generate-splits.js --check          # verify on-disk matches what we'd generate
 *
 * Methodology references:
 *   - sklearn StratifiedShuffleSplit (with random_state) — canonical stratified holdout
 *   - BEIR reproducibility (Kamalloo et al., SIGIR 2024) — persisted splits + fixed seeds
 *   - CLAUDE.md / AGENTS.md "Benchmark Methodology" section
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ─── Seeded RNG (Mulberry32) ────────────────────────────────────────────────
//
// Deterministic, fast, ~32 bits of state. Sufficient for shuffling thousands
// of items reproducibly. NOT cryptographic. The only requirement here is that
// (seed, input) → identical output across machines and across Node versions.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Fisher-Yates shuffle with a seeded RNG. Mutates the input array.
 * Same input + same seed always produces the same permutation.
 */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ─── Stratified split ───────────────────────────────────────────────────────

/**
 * Stratified random split.
 *
 * @param {Array<{id: string, stratum: string}>} items
 * @param {number} devRatio - fraction in dev (e.g. 0.6 for 60/40 split)
 * @param {number} seed - RNG seed (use 42 for canonical splits)
 * @returns {{ dev: string[], heldout: string[], counts: Record<string, {dev: number, heldout: number}> }}
 *
 * Algorithm:
 *   1. Group items by stratum.
 *   2. For each stratum: sort by id (deterministic input order), shuffle with
 *      a stratum-derived RNG, take first floor(N * devRatio) as dev.
 *   3. Concatenate per-stratum dev/held-out lists, sort by id (stable output).
 *
 * Sorting both before shuffling and after extraction makes the output
 * insensitive to input ordering (so a JSONL re-export with reshuffled lines
 * still produces identical splits).
 */
function stratifiedSplit(items, devRatio, seed) {
  const byStratum = new Map();
  for (const item of items) {
    const key = item.stratum;
    if (!byStratum.has(key)) byStratum.set(key, []);
    byStratum.get(key).push(item.id);
  }

  const dev = [];
  const heldout = [];
  const counts = {};

  // Iterate strata in sorted order so seed effects are stable.
  const strataKeys = [...byStratum.keys()].sort();

  for (const stratum of strataKeys) {
    const ids = byStratum.get(stratum).slice().sort();
    // Per-stratum sub-seed: combine global seed with stratum hash. This way
    // changing one stratum (e.g. adding a new repo) doesn't reshuffle all
    // other strata. djb2-like hash kept simple for portability.
    let h = 5381;
    for (let i = 0; i < stratum.length; i++) h = ((h << 5) + h + stratum.charCodeAt(i)) | 0;
    const subSeed = (seed ^ (h >>> 0)) >>> 0;
    const rng = mulberry32(subSeed);
    shuffleInPlace(ids, rng);

    const cut = Math.floor(ids.length * devRatio);
    const stratumDev = ids.slice(0, cut);
    const stratumHeldout = ids.slice(cut);
    dev.push(...stratumDev);
    heldout.push(...stratumHeldout);
    counts[stratum] = { dev: stratumDev.length, heldout: stratumHeldout.length };
  }

  dev.sort();
  heldout.sort();
  return { dev, heldout, counts };
}

// ─── Bench loaders ──────────────────────────────────────────────────────────

function loadJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

const BENCHES = {
  // GenCodeSearchNet — 6000 queries, 6 languages × 1000 each.
  // Stratify by language. 60/40 → 600 dev + 400 held-out per language.
  gencodesearchnet: {
    sourcePath: 'eval/data/gencodesearchnet/queries.jsonl',
    stratifyBy: 'language',
    devRatio: 0.6,
    extractItems(rows) {
      return rows.map(q => ({ id: q.query_id, stratum: q.language || 'unknown' }));
    },
    description: 'GenCodeSearchNet — natural-language → code function retrieval (6 languages).',
  },

  // Multi-repo ColGrep — ~480 queries, 4 repos × ~120 each.
  // Stratify by repo. 60/40 → ~72 dev + ~48 held-out per repo.
  // NOTE: the existing q.split field in queries.jsonl is hand-curated (~70/30)
  // and predates the canonical methodology. Once these external split files
  // exist, they are the source of truth — q.split becomes informational only.
  multirepo: {
    sourcePaths: [
      'eval/data/pattern-benchmark-fastify/queries.jsonl',
      'eval/data/pattern-benchmark-flask/queries.jsonl',
      'eval/data/pattern-benchmark-gin/queries.jsonl',
      'eval/data/pattern-benchmark-ripgrep/queries.jsonl',
    ],
    stratifyBy: 'repo',
    devRatio: 0.6,
    extractItems(rowsByFile) {
      const out = [];
      for (const rows of rowsByFile) {
        for (const q of rows) {
          out.push({ id: q.query_id, stratum: q.repo || 'unknown' });
        }
      }
      return out;
    },
    description: 'Multi-repo ColGrep — pattern + semantic queries on 4 real-world codebases.',
  },

  // Retrieval probes — 20 hand-curated queries × 3 repos.
  // Stratify by repo. 0.7 ratio → 14 dev + 6 held-out (above the 60% floor;
  // 60% would give 12 dev which is too few for a per-iteration regression set).
  'retrieval-probes': {
    sourcePath: 'eval/retrieval-probes/probes.json',
    sourceField: 'probes',
    stratifyBy: 'repo',
    devRatio: 0.7,
    extractItems(probes) {
      return probes.map(p => ({ id: p.id, stratum: p.repo || 'unknown' }));
    },
    description: 'Curated retrieval-quality probes — top-1 file/symbol grading on pinned repos.',
  },
};

const SEED = 42;

// ─── Generation ─────────────────────────────────────────────────────────────

function generateForBench(name, spec) {
  let items;
  let sourceLabel;

  if (spec.sourcePaths) {
    const rowsByFile = spec.sourcePaths.map(p => loadJsonl(path.join(REPO_ROOT, p)));
    items = spec.extractItems(rowsByFile);
    sourceLabel = spec.sourcePaths.join(', ');
  } else if (spec.sourceField) {
    const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, spec.sourcePath), 'utf-8'));
    items = spec.extractItems(raw[spec.sourceField] || []);
    sourceLabel = spec.sourcePath;
  } else {
    const rows = loadJsonl(path.join(REPO_ROOT, spec.sourcePath));
    items = spec.extractItems(rows);
    sourceLabel = spec.sourcePath;
  }

  // Reject duplicates — split files reference IDs and duplicate IDs
  // would cause a query to land in both dev and heldout.
  const seen = new Set();
  for (const item of items) {
    if (!item.id) throw new Error(`[${name}] item missing id: ${JSON.stringify(item)}`);
    if (seen.has(item.id)) throw new Error(`[${name}] duplicate id: ${item.id}`);
    seen.add(item.id);
  }

  const { dev, heldout, counts } = stratifiedSplit(items, spec.devRatio, SEED);

  return {
    dev,
    heldout,
    manifest: {
      bench: name,
      description: spec.description,
      source: sourceLabel,
      seed: SEED,
      devRatio: spec.devRatio,
      stratifyBy: spec.stratifyBy,
      total: items.length,
      counts,
      totals: { dev: dev.length, heldout: heldout.length },
      generatedAt: '<deterministic — see seed>',
      generator: 'eval/scripts/generate-splits.js',
    },
  };
}

function writeBench(name, result) {
  const dir = path.join(REPO_ROOT, 'eval', 'splits', name);
  fs.mkdirSync(dir, { recursive: true });

  // Pretty-print so diffs are reviewable.
  fs.writeFileSync(
    path.join(dir, 'dev.json'),
    JSON.stringify({ ids: result.dev }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'heldout.json'),
    JSON.stringify({ ids: result.heldout }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(result.manifest, null, 2) + '\n',
  );
}

function readExisting(name) {
  const dir = path.join(REPO_ROOT, 'eval', 'splits', name);
  if (!fs.existsSync(dir)) return null;
  return {
    dev: JSON.parse(fs.readFileSync(path.join(dir, 'dev.json'), 'utf-8')).ids,
    heldout: JSON.parse(fs.readFileSync(path.join(dir, 'heldout.json'), 'utf-8')).ids,
  };
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const benchArg = args.find(a => a.startsWith('--bench='));
  const onlyBench = benchArg ? benchArg.split('=')[1] : null;
  const checkMode = args.includes('--check');

  const targets = onlyBench ? [onlyBench] : Object.keys(BENCHES);
  let mismatch = false;

  for (const name of targets) {
    const spec = BENCHES[name];
    if (!spec) {
      console.error(`Unknown bench: ${name}. Available: ${Object.keys(BENCHES).join(', ')}`);
      process.exit(2);
    }

    const result = generateForBench(name, spec);

    if (checkMode) {
      const existing = readExisting(name);
      if (!existing) {
        console.error(`[${name}] CHECK FAILED — split files do not exist on disk`);
        mismatch = true;
        continue;
      }
      const ok = arraysEqual(existing.dev, result.dev) && arraysEqual(existing.heldout, result.heldout);
      if (!ok) {
        console.error(`[${name}] CHECK FAILED — on-disk splits differ from regeneration`);
        mismatch = true;
      } else {
        console.log(`[${name}] CHECK OK — dev=${result.dev.length}, heldout=${result.heldout.length}`);
      }
    } else {
      writeBench(name, result);
      const summary = Object.entries(result.manifest.counts)
        .map(([k, v]) => `${k}:${v.dev}/${v.heldout}`)
        .join(', ');
      console.log(`[${name}] wrote splits — total=${result.manifest.total}, dev=${result.dev.length}, heldout=${result.heldout.length} (${summary})`);
    }
  }

  if (checkMode && mismatch) process.exit(1);
}

main();
