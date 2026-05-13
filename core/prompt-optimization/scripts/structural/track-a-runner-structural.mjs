#!/usr/bin/env node
/**
 * track-a-runner-structural.mjs — deterministic per-(probe, phrasing) sweep
 * for the PHASE6_REDO structural redo (handoff 2026-05-14).
 *
 * For each probe (callers / callees / impact, ~170 total) emits 5 rows:
 *   - P1 very-short-keyword
 *   - P2 interrogative
 *   - P3 declarative
 *   - P4 imperative-medium
 *   - P5 long-NL
 * Plus an optional baseline row (the probe's `expectedSymbol` rendered
 * through the canonical phrasing for that relationship type — used as a
 * sanity check that the sweep cell ordering is non-degenerate).
 *
 * Per row:
 *   - call searcher.structuralSearch(phrasing, {})
 *   - grade returned entity names against probe.expected (Recall@5,
 *     Precision@5, F1@5; PASS / PARTIAL / FAIL)
 *   - for impact probes ALSO compute recall_at_5_2hop using
 *     probe.expected_2hop_diagnostic
 *
 * Output: core/prompt-optimization/data/query-shapes/structural/tracks/
 *         track-a-<runId>.jsonl
 *
 * Pattern: similar to ss-find's runner (single process; per-language
 * SweetSearch instance with explicit graphDbPath). structuralSearch only
 * uses this.graphSearch, which is constructed with graphDbPath in the
 * SweetSearch ctor, so the singleton-cached-repo problem in ss-semantic's
 * readSemantic path does NOT apply here (verified in Stage 0 Check 2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const PROBES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/probes.json');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/tracks');

// ---- Phrasing templates (must mirror verify-structural.mjs) ----
//
// These are the same 15 templates we verified in Stage 0. If you change
// one here, change it in verify-structural.mjs too — the parser regex
// is finicky and any drift produces "fall through to hybrid" failures
// that silently invalidate the structural test.
export const TEMPLATES = {
  callers: [
    { id: 'P1', label: 'very-short-keyword', tpl: (s) => `references to ${s}` },
    { id: 'P2', label: 'interrogative',       tpl: (s) => `who calls ${s}?` },
    { id: 'P3', label: 'declarative',         tpl: (s) => `callers of ${s}` },
    { id: 'P4', label: 'imperative-medium',   tpl: (s) => `show all callers of ${s}` },
    { id: 'P5', label: 'long-NL',             tpl: (s) => `please find every caller of ${s} in the codebase` },
  ],
  callees: [
    { id: 'P1', label: 'very-short-keyword', tpl: (s) => `dependencies of ${s}` },
    { id: 'P2', label: 'interrogative',       tpl: (s) => `what does ${s} call?` },
    { id: 'P3', label: 'declarative',         tpl: (s) => `callees of ${s}` },
    { id: 'P4', label: 'imperative-medium',   tpl: (s) => `list functions called by ${s}` },
    { id: 'P5', label: 'long-NL',             tpl: (s) => `what does ${s} depend on across the codebase` },
  ],
  impact: [
    { id: 'P1', label: 'very-short-keyword', tpl: (s) => `depends on ${s}` },
    { id: 'P2', label: 'interrogative',       tpl: (s) => `what depends on ${s}?` },
    { id: 'P3', label: 'declarative',         tpl: (s) => `impact of refactoring ${s}` },
    { id: 'P4', label: 'imperative-medium',   tpl: (s) => `show what breaks if I change ${s}` },
    { id: 'P5', label: 'long-NL',             tpl: (s) => `what needs to change if I refactor ${s} in this codebase` },
  ],
};

// ---- Grading ----

/**
 * Grade a structural-search response against the probe's expected set.
 *
 * Match: entity.name (case-sensitive) — same convention as ss-search and
 * ss-find symbol grading.
 *
 * Metrics:
 *   - recall_at_5    : |returned[:5] ∩ expected| / |expected|
 *   - precision_at_5 : |returned[:5] ∩ expected| / 5  (NOT / min(5, expected))
 *   - f1_at_5        : harmonic mean
 *
 * Verdict:
 *   - PASS    : recall_at_5 ≥ 0.5
 *   - PARTIAL : recall_at_5 > 0 but < 0.5
 *   - FAIL    : recall_at_5 == 0
 *
 * For impact probes the caller passes expected_2hop; we additionally
 * compute recall_at_5_2hop as a diagnostic (does NOT drive PASS/FAIL).
 */
export function gradeStructural(returnedNames, expected, k = 5, expected2Hop = null) {
  const expectedSet = new Set(expected);
  const top = (returnedNames || []).slice(0, k);
  const matches = top.filter((n) => expectedSet.has(n));
  const recall = expectedSet.size > 0 ? matches.length / expectedSet.size : 0;
  const precision = top.length > 0 ? matches.length / k : 0;
  const f1 = (recall + precision) > 0 ? (2 * recall * precision) / (recall + precision) : 0;

  let verdict;
  if (recall >= 0.5) verdict = 'PASS';
  else if (recall > 0) verdict = 'PARTIAL';
  else verdict = 'FAIL';

  const out = {
    verdict,
    reason: verdict === 'PASS' ? 'recall>=0.5' : verdict === 'PARTIAL' ? `recall=${recall.toFixed(2)}` : 'no overlap',
    recall_at_5: recall,
    precision_at_5: precision,
    f1_at_5: f1,
    n_returned: (returnedNames || []).length,
    n_matched: matches.length,
    n_expected: expectedSet.size,
  };
  if (expected2Hop) {
    const exp2 = new Set(expected2Hop);
    const m2 = top.filter((n) => exp2.has(n));
    out.recall_at_5_2hop = exp2.size > 0 ? m2.length / exp2.size : 0;
    out.n_matched_2hop = m2.length;
    out.n_expected_2hop = exp2.size;
  }
  return out;
}

function parseArgs(argv) {
  const out = {
    lang: null, relationship: null, phrasing: null, split: null,
    runId: null, includeBaseline: true, dryRun: false, verbose: false,
    logPath: undefined, k: 5,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--relationship=')) out.relationship = arg.slice('--relationship='.length);
    else if (arg.startsWith('--phrasing=')) out.phrasing = arg.slice('--phrasing='.length);
    else if (arg.startsWith('--split=')) out.split = arg.slice('--split='.length);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--k=')) out.k = parseInt(arg.slice('--k='.length), 10);
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--skip-baseline') out.includeBaseline = false;
    else if (arg === '--include-baseline') out.includeBaseline = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: track-a-runner-structural.mjs [--lang=...] [--relationship=callers|callees|impact] [--phrasing=P1..P5] [--split=dev|heldout] [--run-id=...] [--k=5] [--skip-baseline] [--dry-run] [--verbose] [--log=<path>|--no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`track-a-runner-structural: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== track-a-runner-structural run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* ignore */ }
    return orig(chunk, ...rest);
  };
  return fd;
}

function loadReposMap() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const m = new Map();
  for (const r of raw.repos || []) m.set(r.key || r.language, r);
  return m;
}
function loadProbes() {
  const raw = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
  return raw.probes || [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const defaultLog = path.join(TRACKS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  attachStdoutLogger(logPath);
  if (logPath) process.stdout.write(`track-a-runner-structural: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);

  const { default: SweetSearch } = await import('../../../search/sweet-search.js');

  const reposMap = loadReposMap();
  let probes = loadProbes();
  if (opts.lang) probes = probes.filter((p) => p.language === opts.lang);
  if (opts.relationship) probes = probes.filter((p) => p.relationship === opts.relationship);
  if (opts.split) probes = probes.filter((p) => p.split === opts.split);
  if (probes.length === 0) {
    process.stderr.write('track-a-runner-structural: no probes after filtering\n');
    process.exit(2);
  }

  const phrasings = opts.phrasing ? [opts.phrasing] : ['P1', 'P2', 'P3', 'P4', 'P5'];
  const perProbeRuns = phrasings.length + (opts.includeBaseline && !opts.phrasing ? 1 : 0);
  const plannedRuns = probes.length * perProbeRuns;

  const runId = opts.runId || `phase6-redo-structural-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const trackPath = path.join(TRACKS_DIR, `track-a-${runId}.jsonl`);

  process.stdout.write(`track-a-runner-structural: runId=${runId}\n  ${probes.length} probes × ${perProbeRuns} runs = ${plannedRuns} planned runs\n  output: ${path.relative(REPO_ROOT, trackPath)}\n`);

  if (opts.dryRun) {
    process.stdout.write(`(dry-run) would write to: ${path.relative(REPO_ROOT, trackPath)}\n`);
    process.exit(0);
  }

  const out = fs.createWriteStream(trackPath, { flags: 'w' });
  let totalRuns = 0, totalPass = 0, totalPartial = 0, totalFail = 0, totalErrors = 0;
  let totalRecallSum = 0;
  const start = Date.now();

  function fmtDur(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; }
  function emitProgress() {
    const wall = Date.now() - start;
    const pct = plannedRuns > 0 ? (totalRuns / plannedRuns) * 100 : 0;
    const rate = totalRuns > 0 ? wall / totalRuns : 0;
    const eta = (totalRuns > 0 && totalRuns < plannedRuns) ? rate * (plannedRuns - totalRuns) : 0;
    const avgRecall = totalRuns > 0 ? totalRecallSum / totalRuns : 0;
    process.stdout.write(
      `  [progress] ${String(totalRuns).padStart(5)}/${plannedRuns} (${pct.toFixed(1).padStart(5)}%) ` +
        `PASS=${String(totalPass).padStart(4)} PART=${String(totalPartial).padStart(4)} FAIL=${String(totalFail).padStart(4)} ` +
        `avgRecall@5=${avgRecall.toFixed(2)} err=${String(totalErrors).padStart(3)} wall=${fmtDur(wall).padStart(6)} eta=${eta > 0 ? fmtDur(eta).padStart(6) : '    --'}\n`,
    );
  }
  const progressTimer = setInterval(emitProgress, 10_000);

  // Group probes by language so we set up one SweetSearch instance per language.
  const byLang = new Map();
  for (const p of probes) {
    if (!byLang.has(p.language)) byLang.set(p.language, []);
    byLang.get(p.language).push(p);
  }

  for (const [language, langProbes] of byLang.entries()) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) { process.stderr.write(`  ! no repos.json entry for ${language}; skipping\n`); continue; }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const dataDir = path.join(projectRoot, '.sweet-search');
    if (!fs.existsSync(dataDir)) { process.stderr.write(`  ! .sweet-search missing for ${language}; skipping\n`); continue; }
    process.stdout.write(`\n=== ${language} (${langProbes.length} probes) ===\n`);

    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: path.join(dataDir, 'code-graph.db'),
      codebaseDbPath: path.join(dataDir, 'codebase.db'),
      hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
      verbose: false,
    });
    try { await searcher.init?.(); } catch { /* init may be optional on this path */ }

    for (const probe of langProbes) {
      const tpls = TEMPLATES[probe.relationship];
      if (!tpls) { process.stderr.write(`  ! unknown relationship ${probe.relationship}; skipping ${probe.probeId}\n`); continue; }

      const runs = [];
      if (opts.includeBaseline && !opts.phrasing) {
        // Baseline = P3 (canonical "<noun> of <symbol>") — the most boring
        // form. Lets the aggregator confirm cell ordering is non-degenerate.
        const baseTpl = tpls.find((t) => t.id === 'P3');
        runs.push({
          phrasing: 'P_baseline', label: `baseline (=${baseTpl.label})`,
          query: baseTpl.tpl(probe.expectedSymbol),
        });
      }
      for (const phrasingId of phrasings) {
        const t = tpls.find((x) => x.id === phrasingId);
        if (!t) continue;
        runs.push({ phrasing: phrasingId, label: t.label, query: t.tpl(probe.expectedSymbol) });
      }

      for (const run of runs) {
        const tStart = Date.now();
        let results = [];
        let error = null;
        let structuralType = null;
        let targetEntity = null;
        try {
          // Bypass routing — let structuralSearch parse its own query so
          // we genuinely test the agent-facing query → tool path.
          // Note: structuralSearch falls back to hybridSearchV2 if the
          // parser doesn't fire. The Stage 0 verification gates against
          // that, but we record structuralType so we can detect drift.
          results = await searcher.structuralSearch(run.query, {});
          // Re-parse to record structuralType for the row (no easy way to
          // get this back from the response without modifying the tool).
          const { default: SS } = await import('../../../search/sweet-search.js');
          // Import the parser by re-running the same regex set inline —
          // cheaper than mutating production code for telemetry.
          const parsed = parseStructuralQueryShim(run.query);
          structuralType = parsed.structuralType;
          targetEntity = parsed.targetEntity;
        } catch (err) {
          error = err.message;
          totalErrors++;
        }
        const returnedNames = (results || []).map((r) => r.name).filter(Boolean);
        const graded = gradeStructural(
          returnedNames,
          probe.expected,
          opts.k,
          probe.relationship === 'impact' ? probe.expected_2hop_diagnostic : null,
        );
        const wallMs = Date.now() - tStart;

        const row = {
          runId, probeId: probe.probeId, goldId: probe.goldId,
          language: probe.language, family: probe.family, split: probe.split,
          relationship: probe.relationship, expectedSymbol: probe.expectedSymbol,
          phrasing: run.phrasing, phrasingLabel: run.label, query: run.query,
          parsed_structuralType: structuralType, parsed_targetEntity: targetEntity,
          parserFired: structuralType === probe.relationship,
          returned: returnedNames.slice(0, opts.k),
          n_returned: returnedNames.length,
          verdict: graded.verdict, reason: graded.reason,
          recall_at_5: graded.recall_at_5,
          precision_at_5: graded.precision_at_5,
          f1_at_5: graded.f1_at_5,
          n_matched: graded.n_matched, n_expected: graded.n_expected,
          wallMs, error,
        };
        if (probe.relationship === 'impact') {
          row.recall_at_5_2hop = graded.recall_at_5_2hop;
          row.n_matched_2hop = graded.n_matched_2hop;
          row.n_expected_2hop = graded.n_expected_2hop;
        }

        out.write(JSON.stringify(row) + '\n');
        totalRuns++;
        totalRecallSum += graded.recall_at_5;
        if (graded.verdict === 'PASS') totalPass++;
        else if (graded.verdict === 'PARTIAL') totalPartial++;
        else totalFail++;

        if (opts.verbose) {
          const tag = graded.verdict === 'PASS' ? '✓' : (graded.verdict === 'PARTIAL' ? '~' : '✗');
          process.stdout.write(`  ${tag} ${probe.probeId.padEnd(20)} ${run.phrasing.padEnd(11)} ${graded.verdict.padEnd(7)} R@5=${graded.recall_at_5.toFixed(2)} ${wallMs}ms\n`);
        }
        if (totalRuns % 50 === 0) emitProgress();
      }
    }
    try { searcher.close?.(); } catch { /* ignore */ }
  }
  clearInterval(progressTimer);
  emitProgress();
  await new Promise((resolve) => out.end(resolve));
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(
    `\ntrack-a-runner-structural: ${totalRuns} rows written; PASS=${totalPass} PARTIAL=${totalPartial} FAIL=${totalFail} errors=${totalErrors} avgRecall@5=${(totalRecallSum/Math.max(1,totalRuns)).toFixed(3)} wall=${wallSec}s\n` +
    `  output: ${path.relative(REPO_ROOT, trackPath)}\n`,
  );
}

// ---- Parser shim (mirror of sweet-search.js STRUCTURAL_PATTERNS) ----
//
// We need parser output for telemetry (parserFired field). We can't easily
// import parseStructuralQuery — it's not exported. Mirror the regex set
// here. Single source of truth caveat: keep in sync with sweet-search.js.
const STRUCTURAL_PATTERNS = {
  callers: /\b(?:(?:what|who|show|find|list)\s+(?:calls?|callers?|calling|invokes?|references?|uses)\s+(?:of\s+|to\s+)?|callers?\s+of\s+|what\s+uses\s+|usages?\s+of\s+|references?\s+to\s+)(\w+)/i,
  callers2: /\bwhere\s+is\s+(\w+)\s+called\b/i,
  callees: /\bwhat\s+does\s+(\w+)\s+(?:call|invoke|use|depend\s+on|import)\b/i,
  callees2: /\b(?:callees?\s+of|dependencies\s+of|(?:methods?|functions?)\s+called\s+by)\s+(\w+)/i,
  implementations: /\b(?:(?:implementations?|implementers?|implementors?|subclasses?|subtypes?)\s+of|(?:classes?|types?)\s+(?:that\s+)?(?:implementing?|extending?)|(?:who|what)\s+(?:extends?|implements?))\s+(\w+)/i,
  impact: /\b(?:impact\s+of\s+(?:changing|modifying|refactoring|updating|deleting|removing|renaming|moving)|(?:what\s+)?depends?\s+on|(?:will|what)\s+breaks?\s+if\s+(?:I|we)\s+(?:change|modify|update|delete|remove)|affected\s+by\s+(?:changes?\s+to|modifying)?|(?:downstream|ripple)\s+effects?\s+of|what\s+needs?\s+to\s+change\s+if\s+(?:I|we)\s+(?:refactor|modify))\s+(\w+)/i,
};
export function parseStructuralQueryShim(query) {
  for (const [type, pattern] of Object.entries(STRUCTURAL_PATTERNS)) {
    const m = query.match(pattern);
    if (m) {
      let entity = null;
      for (let i = m.length - 1; i >= 1; i--) {
        if (m[i] !== undefined) { entity = m[i]; break; }
      }
      if (entity) {
        const normalized = type.replace(/\d+$/, '');
        return { structuralType: normalized, targetEntity: entity };
      }
    }
  }
  return { structuralType: null, targetEntity: null };
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`track-a-runner-structural: fatal ${err.stack || err.message}\n`); process.exit(1); });
}
