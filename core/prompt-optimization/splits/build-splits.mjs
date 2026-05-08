/**
 * Deterministic stratified splits for the prompt-optimization campaign.
 *
 * Plan §11.2: 60/40 dev/heldout split of the 100-probe stratified set,
 * stratified by language × query-type (A/B) — five repos collapse to four
 * languages, two stratification cells each → 8-10 cells of ~10-12 probes
 * each. FreshStack-30 holdout is the verbatim uv post-cutoff probe set.
 *
 * The split is identical-by-construction with a fixed seed (42). The same
 * Mulberry32 RNG used by `eval/scripts/generate-splits.js` keeps the
 * codebase consistent. Plan reference: §13.3, §13.11.
 *
 * Usage:
 *   node core/prompt-optimization/splits/build-splits.mjs           # write all splits
 *   node core/prompt-optimization/splits/build-splits.mjs --check   # verify on-disk match
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../stats/rng.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const REPO_TO_LANG = {
  fastify: 'js',
  express: 'js',
  gin: 'go',
  ripgrep: 'rust',
  flask: 'py',
};

const SOURCE_STRATIFIED_100 = path.join(REPO_ROOT, 'eval', 'retrieval-probes', 'probes-stratified-100.json');
const SOURCE_FRESHSTACK_30 = path.join(REPO_ROOT, 'eval', 'freshstack', 'uv-queries.json');

const OUT_DIR = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data', 'splits');
const DEV_OUT = path.join(OUT_DIR, 'dev_60.json');
const HELDOUT_OUT = path.join(OUT_DIR, 'heldout_40.json');
const FRESHSTACK_OUT = path.join(OUT_DIR, 'freshstack_30.json');
const MANIFEST_OUT = path.join(OUT_DIR, 'manifest.json');

export const SPLIT_SEED = 42;
export const DEV_RATIO = 0.6;

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Stratified random split with per-stratum RNG sub-seed.
 * Returns sorted dev / heldout id arrays for stable diffs.
 */
export function stratifiedSplit({ items, devRatio = DEV_RATIO, seed = SPLIT_SEED }) {
  const byStratum = new Map();
  for (const it of items) {
    const arr = byStratum.get(it.stratum) ?? [];
    arr.push(it.id);
    byStratum.set(it.stratum, arr);
  }
  const dev = [];
  const heldout = [];
  const counts = {};
  for (const stratum of [...byStratum.keys()].sort()) {
    const ids = byStratum.get(stratum).slice().sort();
    const subSeed = (seed ^ djb2(stratum)) >>> 0;
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

function loadProbes(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.probes ?? [];
}

function describeStratum(probe) {
  const lang = REPO_TO_LANG[probe.repo] ?? probe.repo;
  const type = probe.stratification ?? 'X';
  return `${lang}|${type}`;
}

export function buildSplits({ check = false } = {}) {
  const stratified100 = loadProbes(SOURCE_STRATIFIED_100);
  if (stratified100.length !== 100) {
    throw new Error(`build-splits: expected 100 stratified probes, got ${stratified100.length}`);
  }
  const items = stratified100.map(p => ({ id: p.id, stratum: describeStratum(p) }));
  const { dev, heldout, counts } = stratifiedSplit({ items });

  if (dev.length !== 60 || heldout.length !== 40) {
    throw new Error(`build-splits: expected 60/40, got ${dev.length}/${heldout.length}`);
  }

  const freshstack = loadProbes(SOURCE_FRESHSTACK_30);
  if (freshstack.length !== 30) {
    throw new Error(`build-splits: expected 30 freshstack probes, got ${freshstack.length}`);
  }

  const devPayload = {
    schemaVersion: 1,
    split: 'dev',
    parent: 'eval/retrieval-probes/probes-stratified-100.json',
    seed: SPLIT_SEED,
    devRatio: DEV_RATIO,
    stratifyBy: 'lang|stratification',
    counts,
    ids: dev,
  };
  const heldoutPayload = {
    schemaVersion: 1,
    split: 'heldout',
    parent: 'eval/retrieval-probes/probes-stratified-100.json',
    seed: SPLIT_SEED,
    devRatio: DEV_RATIO,
    stratifyBy: 'lang|stratification',
    counts,
    ids: heldout,
  };
  const freshstackPayload = {
    schemaVersion: 1,
    split: 'freshstack',
    parent: 'eval/freshstack/uv-queries.json',
    description: 'Post-cutoff fresh-repo holdout (uv@bb8109a). Milestone-only; never iterate against this set.',
    ids: freshstack.map(p => p.id),
  };
  const manifest = {
    schemaVersion: 1,
    generatedBy: 'core/prompt-optimization/splits/build-splits.mjs',
    seed: SPLIT_SEED,
    devRatio: DEV_RATIO,
    stratifyBy: 'lang|stratification',
    sources: {
      dev_60: 'eval/retrieval-probes/probes-stratified-100.json',
      heldout_40: 'eval/retrieval-probes/probes-stratified-100.json',
      freshstack_30: 'eval/freshstack/uv-queries.json',
    },
    totals: {
      dev_60: dev.length,
      heldout_40: heldout.length,
      freshstack_30: freshstack.length,
    },
    countsPerStratum: counts,
  };

  const writes = [
    [DEV_OUT, devPayload],
    [HELDOUT_OUT, heldoutPayload],
    [FRESHSTACK_OUT, freshstackPayload],
    [MANIFEST_OUT, manifest],
  ];

  if (check) {
    const mismatches = [];
    for (const [file, payload] of writes) {
      const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const expected = JSON.stringify(payload, null, 2) + '\n';
      if (onDisk !== expected) mismatches.push(path.relative(REPO_ROOT, file));
    }
    return { ok: mismatches.length === 0, mismatches, manifest };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, payload] of writes) {
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  }
  return { ok: true, manifest };
}

const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; }
  catch { return false; }
})();
if (isMain) {
  const check = process.argv.includes('--check');
  const result = buildSplits({ check });
  if (check) {
    if (result.ok) {
      process.stdout.write('build-splits: on-disk splits match generator output ✓\n');
      process.exit(0);
    }
    process.stderr.write(`build-splits: mismatch in:\n  ${result.mismatches.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`build-splits: wrote dev_60 / heldout_40 / freshstack_30 + manifest under data/splits/\n`);
  process.stdout.write(`  totals: ${JSON.stringify(result.manifest.totals)}\n`);
}
