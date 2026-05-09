/**
 * Track A — deterministic per-tool query-shape sweep (§7.4).
 *
 * For each (gold × variant × tool) tuple:
 *   1. Invoke the tool with the variant's query (regex anchor for ss-find).
 *   2. Capture the rank-ordered result list.
 *   3. Score deterministically:
 *        - file_recall@K  for K ∈ {1, 3, 5}
 *        - symbol_recall@1
 *        - gold_line_overlap (when expectedLineRanges is set)
 *        - returned_token_count (per-result code-block length)
 *        - latency_ms
 *        - follow_up_reads: 1 if expectedFile not in top-1 but in top-3, 0 otherwise
 *   4. Emit one JSONL record per tuple.
 *
 * Repo isolation: per repo, SWEET_SEARCH_PROJECT_ROOT must be set before
 * sweet-search modules are imported. We spawn a worker per repo
 * (`track-a-worker.mjs`) so the per-process module init binds to one repo
 * only. The driver in this file orchestrates the workers.
 *
 * Tools in scope (§7.1):
 *   - 'ss-search'  → core/search/sweet-search.js (auto/CatBoost-routed)
 *   - 'ss-find'    → core/search/sweet-search.js patternSearch (ColGrep)
 *   - 'ss-semantic'→ core/search/search-read-semantic.js readSemantic
 *   - 'structural' → core/search/sweet-search.js with mode='hybrid' + relationship verb
 *
 * `ss-grep` is excluded from the shape claim space (literal regex only — no
 * shape to optimise per §7.1). Its regex-specificity side analysis lives in
 * `track-a-ssgrep-side.mjs` (separate, optional).
 *
 * Plan reference: §7.4 deterministic sweep, §7.6 promotion gate.
 *
 * Usage:
 *   node core/prompt-optimization/sweep/track-a.mjs --run qshape-v1 [--dry-run]
 *   node core/prompt-optimization/sweep/track-a.mjs --run qshape-v1 --repo gin
 *   node core/prompt-optimization/sweep/track-a.mjs --run qshape-v1 --tool ss-find
 *
 * Output: core/prompt-optimization/data/results/<run>/track-a.jsonl
 *         core/prompt-optimization/data/results/<run>/track-a-summary.json
 *
 * Stop rule (§13.7 P6.2): halt if best-shape `recall@1` < 0.5 across all 4
 * tools. The summary aggregator flags this; the driver returns a non-zero
 * exit code so a CI gate can pick it up.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const QSHAPE_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes');
const RESULTS_BASE = path.join(REPO_ROOT, 'core/prompt-optimization/data/results');

const TOOLS_IN_SCOPE = ['ss-search', 'ss-find', 'ss-semantic', 'structural'];

// ─── argv ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    runId: null,
    repo: null,
    tool: null,
    dryRun: false,
    workerPath: path.join(__dirname, 'track-a-worker.mjs'),
  };
  for (const arg of argv) {
    if (arg.startsWith('--run=')) opts.runId = arg.split('=')[1];
    else if (arg === '--run') {
      const i = argv.indexOf('--run');
      opts.runId = argv[i + 1];
    } else if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg === '--repo') {
      const i = argv.indexOf('--repo');
      opts.repo = argv[i + 1];
    } else if (arg.startsWith('--tool=')) opts.tool = arg.split('=')[1];
    else if (arg === '--tool') {
      const i = argv.indexOf('--tool');
      opts.tool = argv[i + 1];
    } else if (arg === '--dry-run') opts.dryRun = true;
  }
  if (!opts.runId) {
    process.stderr.write('track-a: --run <runId> required (matches preregistration tag)\n');
    process.exit(2);
  }
  return opts;
}

// ─── load probe set ───────────────────────────────────────────────────────

function loadGolds() {
  const p = path.join(QSHAPE_DIR, 'golds.json');
  if (!existsSync(p)) {
    process.stderr.write(`track-a: ${p} missing — run build-golds.mjs first\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadVariants() {
  const p = path.join(QSHAPE_DIR, 'variants.json');
  if (!existsSync(p)) {
    process.stderr.write(`track-a: ${p} missing — run build-variants.mjs first\n`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ─── tuple expansion ──────────────────────────────────────────────────────

function buildTuples({ goldsRaw, variantsRaw, toolFilter }) {
  const goldById = new Map(goldsRaw.records.map((g) => [g.id, g]));
  const tuples = [];
  const tools = toolFilter ? [toolFilter] : TOOLS_IN_SCOPE;
  for (const vrec of variantsRaw.perGold) {
    const gold = goldById.get(vrec.goldId);
    if (!gold) {
      throw new Error(`variants.json references unknown gold "${vrec.goldId}"`);
    }
    for (const variant of vrec.variants) {
      for (const tool of tools) {
        tuples.push({ gold, variant, tool });
      }
    }
  }
  return tuples;
}

function groupByRepo(tuples) {
  const byRepo = new Map();
  for (const t of tuples) {
    const repo = t.gold.repo;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push(t);
  }
  return byRepo;
}

// ─── repo isolation: spawn worker per repo ────────────────────────────────

function workerEnvFor(repo) {
  const repoDir = path.join(REPO_ROOT, 'eval/repos', repo);
  if (!existsSync(repoDir)) {
    throw new Error(
      `track-a: missing repo dir ${repoDir}. Run eval/scripts/fetch-benchmark-repos.js`
    );
  }
  if (!existsSync(path.join(repoDir, '.sweet-search/codebase.db'))) {
    throw new Error(
      `track-a: ${repo} not indexed (no .sweet-search/codebase.db). ` +
      `Index with: SWEET_SEARCH_PROJECT_ROOT=${repoDir} ` +
      `node core/indexing/index-codebase-v21.js --full --sqlite-fast`
    );
  }
  return {
    cwd: repoDir,
    env: {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: repoDir,
    },
  };
}

function runRepoWorker({ workerPath, repo, tuples, runId, dryRun }) {
  const repoEnv = workerEnvFor(repo);
  const tuplesPayload = tuples.map((t) => ({
    goldId: t.gold.id,
    variantId: t.variant.variantId,
    tool: t.tool,
    query: t.variant.query,
    regex: t.variant.regex,
    expectedFiles: t.gold.expectedFiles,
    expectedSymbols: t.gold.expectedSymbols,
    expectedLineRanges: t.gold.expectedLineRanges,
    qshape_stratum: t.gold.qshape_stratum,
    shape: t.variant.shape,
    isBaseline: !!t.variant.isBaseline,
  }));

  const args = [workerPath, '--run', runId, '--repo', repo];
  if (dryRun) args.push('--dry-run');

  const r = spawnSync('node', args, {
    ...repoEnv,
    input: JSON.stringify({ tuples: tuplesPayload }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) {
    process.stderr.write(
      `track-a worker for ${repo} exited ${r.status}\nSTDERR:\n${r.stderr || '(empty)'}\n`
    );
    return null;
  }
  // Worker emits one JSON line per tuple to stdout, plus a final line
  // starting with `# summary:` carrying its own aggregation. SweetSearch
  // and underlying Rust/native modules also write informational lines to
  // stdout during init (e.g., "[MaxSim] Tier 1: Native Rust"); skip any
  // line that's not pure JSON or our `# summary:` sentinel.
  const lines = r.stdout.split('\n').filter(Boolean);
  const records = [];
  let summary = null;
  for (const line of lines) {
    if (line.startsWith('# summary:')) {
      try {
        summary = JSON.parse(line.slice('# summary:'.length).trim());
      } catch { /* ignore malformed summary */ }
      continue;
    }
    if (!line.startsWith('{')) continue;          // skip non-JSON noise
    try {
      records.push(JSON.parse(line));
    } catch {
      // Mid-line junk that happens to start with '{' is rare but not
      // fatal — skip and continue.
    }
  }
  return { records, summary };
}

// ─── aggregation ──────────────────────────────────────────────────────────

function summarise(allRecords) {
  // Group by (tool, shape) and compute mean of recall metrics.
  const cells = new Map();
  for (const r of allRecords) {
    const key = `${r.tool}|${r.shape}`;
    if (!cells.has(key)) {
      cells.set(key, {
        tool: r.tool,
        shape: r.shape,
        n: 0,
        sum: { fr1: 0, fr3: 0, fr5: 0, sr1: 0, lo: 0, tok: 0, fol: 0, lat: 0 },
      });
    }
    const c = cells.get(key);
    c.n += 1;
    c.sum.fr1 += r.metrics?.file_recall_at_1 ?? 0;
    c.sum.fr3 += r.metrics?.file_recall_at_3 ?? 0;
    c.sum.fr5 += r.metrics?.file_recall_at_5 ?? 0;
    c.sum.sr1 += r.metrics?.symbol_recall_at_1 ?? 0;
    c.sum.lo  += r.metrics?.gold_line_overlap ?? 0;
    c.sum.tok += r.metrics?.tokens_returned ?? 0;
    c.sum.fol += r.metrics?.follow_up_reads ?? 0;
    c.sum.lat += r.metrics?.latency_ms ?? 0;
  }
  const cellArr = [...cells.values()].map((c) => ({
    tool: c.tool,
    shape: c.shape,
    n: c.n,
    file_recall_at_1: c.sum.fr1 / c.n,
    file_recall_at_3: c.sum.fr3 / c.n,
    file_recall_at_5: c.sum.fr5 / c.n,
    symbol_recall_at_1: c.sum.sr1 / c.n,
    gold_line_overlap: c.sum.lo / c.n,
    tokens_returned_mean: c.sum.tok / c.n,
    follow_up_reads_mean: c.sum.fol / c.n,
    latency_ms_mean: c.sum.lat / c.n,
  }));

  // Per-tool best/worst shape
  const byTool = {};
  for (const cell of cellArr) {
    if (!byTool[cell.tool]) byTool[cell.tool] = [];
    byTool[cell.tool].push(cell);
  }
  for (const tool of Object.keys(byTool)) {
    byTool[tool].sort((a, b) => b.file_recall_at_1 - a.file_recall_at_1);
  }
  const perToolBestRecall1 = Object.fromEntries(
    Object.entries(byTool).map(([t, cells]) => [t, cells[0]?.file_recall_at_1 ?? 0])
  );
  const stopP62 = Object.values(perToolBestRecall1).every((v) => v < 0.5);

  return {
    nRecords: allRecords.length,
    nCells: cellArr.length,
    cells: cellArr,
    perToolBestRecall1,
    stopRuleP62Triggered: stopP62,
    stopRuleP62Note:
      'Per §13.7 P6.2: halt if best-shape recall@1 < 0.5 across ALL 4 tools (variant grid is misframed).',
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const goldsRaw = loadGolds();
  const variantsRaw = loadVariants();

  const allTuples = buildTuples({ goldsRaw, variantsRaw, toolFilter: opts.tool });
  const byRepo = groupByRepo(allTuples);
  const reposToRun = opts.repo ? [opts.repo] : [...byRepo.keys()];

  process.stdout.write(
    `track-a: run=${opts.runId} repos=[${reposToRun.join(',')}] ` +
    `tools=[${opts.tool ?? TOOLS_IN_SCOPE.join(',')}] ` +
    `tuples=${allTuples.length} dryRun=${opts.dryRun}\n`
  );

  const outDir = path.join(RESULTS_BASE, opts.runId);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'track-a.jsonl');
  // append-only — multiple repo runs in sequence accumulate
  const allRecords = [];

  for (const repo of reposToRun) {
    const tuples = byRepo.get(repo);
    if (!tuples) {
      process.stderr.write(`track-a: no tuples for repo ${repo}; skipping\n`);
      continue;
    }
    process.stdout.write(`track-a: ${repo} tuples=${tuples.length}\n`);
    const res = runRepoWorker({
      workerPath: opts.workerPath,
      repo,
      tuples,
      runId: opts.runId,
      dryRun: opts.dryRun,
    });
    if (!res) {
      process.stderr.write(`track-a: ${repo} worker failed; aborting run\n`);
      process.exit(3);
    }
    for (const rec of res.records) {
      appendFileSync(outPath, JSON.stringify(rec) + '\n');
      allRecords.push(rec);
    }
  }

  const summary = summarise(allRecords);
  const summaryPath = path.join(outDir, 'track-a-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`track-a: ${allRecords.length} records → ${outPath}\n`);
  process.stdout.write(`track-a: summary → ${summaryPath}\n`);
  process.stdout.write(
    `track-a: per-tool best recall@1 = ${JSON.stringify(summary.perToolBestRecall1)}\n`
  );
  if (summary.stopRuleP62Triggered && !opts.dryRun) {
    process.stderr.write(
      `track-a: STOP RULE TRIGGERED (P6.2) — best shape recall@1 < 0.5 across all tools.\n` +
      `Variant grid is likely misframed. Halt sweep before P6.3 per §13.7.\n`
    );
    process.exit(4);
  }
}

main();
