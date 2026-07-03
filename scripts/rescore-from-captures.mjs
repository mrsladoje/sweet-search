#!/usr/bin/env node
/**
 * rescore-from-captures — re-run the FULL 3-judge panel on persisted captures.
 *
 * Why: on 2026-06-13 the DeepSeek balance ran out mid-run; the deepseek-flash
 * judge silently dropped out, leaving some cells with 2-judge (sonnet+gemini)
 * medians. We can't splice just the deepseek vote back in (only AGGREGATE
 * scores were persisted, not per-judge verdicts), so we re-score the affected
 * cells' panels from rawResponse/finalAnswer — JUDGES ONLY, no agent re-runs.
 *
 * Telemetry (calls, usage, $, wallMs, exitCode, ss, …) is taken verbatim from
 * the existing rows; only the judge-derived fields are replaced:
 *   score, USD, USD_noC, grounding, content, content_noD3, purity_ratio,
 *   signal_purity, usdTokens.
 *
 *   TARGET=oc-gpt CONC=4 node scripts/rescore-from-captures.mjs   # one cell (smoke)
 *   CONC=6 node scripts/rescore-from-captures.mjs                 # all affected cells
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgePanelScore, JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';
import { toRJudge, usdPanelScore, scoreUSD, composeUSD, computeRubricHash, USD_PARAMS } from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const CONC = Number(process.env.CONC || 6);
const ONLY = process.env.TARGET || '';

const PROBES = {
  vault: 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json',
  heldout: 'core/prompt-optimization/data/frozen/p7-heldout-probes.json',
  ood: 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json',
};
const probeMap = {};
for (const [set, f] of Object.entries(PROBES)) {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.probes || []);
  probeMap[set] = new Map(arr.map((p) => [p.id, p]));
}

// keyFor: unify bss rows (arm), oc rows (mode), and captures (arm) onto one key.
const isSsArm = (a) => a === 'ss' || /^mpp/.test(String(a));
const rowKey = (r) => `${(r.arm != null ? isSsArm(r.arm) : r.mode === 'mpp') ? 'ss' : 'nat'}|${r.id}|${r.rep}`;
const capKey = (c) => `${isSsArm(c.arm) ? 'ss' : 'nat'}|${c.probeId}|${c.rep}`;

// ── replica of the driver's scoreUsdInlineLocal (byte-for-byte semantics) ──────
async function scoreUsdInline(probe, rawResponse, arm) {
  try {
    const rJudge = toRJudge(rawResponse, arm);
    const needUsdPanel = !probe.expectedNoMatch && !!rJudge.trim();
    const [panelCorrectness, panel] = await Promise.all([
      judgePanelScore({ probe, answer: rJudge, panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
      needUsdPanel ? usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError }).then((r) => r.panel).catch(() => []) : Promise.resolve([]),
    ]);
    const sc = scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, rubricHash: computeRubricHash(USD_PARAMS) });
    const usdNoC = probe.expectedNoMatch ? sc.USD : composeUSD({ g: sc.grounding, signalPurity: 1, content: sc.content, purity_ratio: sc.purity_ratio }, USD_PARAMS);
    return { USD: sc.USD, USD_noC: usdNoC, grounding: sc.grounding, content: sc.content, content_noD3: sc.content_noD3, purity_ratio: sc.purity_ratio, signal_purity: sc.signal_purity, usdTokens: sc.total_tokens };
  } catch (e) { return { usdError: e.message }; }
}

async function rescoreCapture(cap, probe) {
  const ssArm = isSsArm(cap.arm) ? 'ss' : 'native';
  const [score, usd] = await Promise.all([
    judgePanelScore({ probe, answer: cap.finalAnswer || '', panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
    scoreUsdInline(probe, cap.rawResponse || '', ssArm),
  ]);
  return { score, ...usd };
}

// load a cell's telemetry rows from either a runs.jsonl (bss) or rows.json dirs (oc)
function loadTele(teleType, dirs) {
  const map = new Map();
  for (const d of dirs) {
    const base = path.join(RES, d);
    if (teleType === 'bss') {
      const f = path.join(base, 'runs.jsonl');
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
        const r = JSON.parse(line); if (r.error) continue;
        map.set(rowKey(r), r);
      }
    } else { // oc: rows.json holds an array; arm encoded as `mode`
      const f = path.join(base, 'rows.json');
      if (!fs.existsSync(f)) continue;
      for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) map.set(rowKey(r), r);
    }
  }
  return map;
}

function loadCaps(capDirs, repFilter) {
  const caps = [];
  for (const d of capDirs) {
    const base = path.join(RES, d, 'captures');
    const dir = fs.existsSync(base) ? base : path.join(RES, d); // oc captures live in a *-captures dir
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (repFilter && !repFilter(c.rep)) continue;
      caps.push(c);
    }
  }
  return caps;
}

// ── target table ──────────────────────────────────────────────────────────────
// out.kind 'shim' → write bss3k-<set>-<cell>-{mpp,native}/rows.json (cc/codex/ba).
// out.kind 'inplace' → overwrite the oc rows.json dirs (BH-FDR reads them directly).
const cap = (set, cell, shards) => shards.map((s) => `budget-sweep-smoke-${cell}-${set}${s}`);
const TARGETS = [
  { name: 'sonnet-max-vault', set: 'vault', probes: 'vault',
    capDirs: cap('vault', 'cc-sonnet-max', ['-s1', '-s2', '-s3']), teleType: 'bss',
    teleDirs: cap('vault', 'cc-sonnet-max', ['-s1', '-s2', '-s3']),
    out: { kind: 'shim', prefix: 'bss3k-vault-sonnet-max' } },
  { name: 'sonnet-max-heldout', set: 'heldout', probes: 'heldout',
    capDirs: ['budget-sweep-smoke-cc-sonnet-max-heldout'], teleType: 'bss',
    teleDirs: ['budget-sweep-smoke-cc-sonnet-max-heldout'],
    out: { kind: 'shim', prefix: 'bss3k-heldout-sonnet-max' } },
  { name: 'sonnet-max-ood', set: 'ood', probes: 'ood',
    capDirs: ['budget-sweep-smoke-cc-sonnet-max-ood'], teleType: 'bss',
    teleDirs: ['budget-sweep-smoke-cc-sonnet-max-ood'],
    out: { kind: 'shim', prefix: 'bss3k-ood-sonnet-max' } },
  { name: 'opus-xhigh-vault', set: 'vault', probes: 'vault',
    capDirs: cap('vault', 'cc-opus-xhigh', ['-s1', '-s2', '-s3']), teleType: 'bss',
    teleDirs: cap('vault', 'cc-opus-xhigh', ['-s1', '-s2', '-s3']),
    out: { kind: 'shim', prefix: 'bss3k-vault-opus-xhigh' } },
  { name: 'opus-xhigh-heldout', set: 'heldout', probes: 'heldout',
    capDirs: ['budget-sweep-smoke-cc-opus-xhigh-heldout'], teleType: 'bss',
    teleDirs: ['budget-sweep-smoke-cc-opus-xhigh-heldout'],
    out: { kind: 'shim', prefix: 'bss3k-heldout-opus-xhigh' } },
  { name: 'opus-xhigh-ood', set: 'ood', probes: 'ood',
    capDirs: ['budget-sweep-smoke-cc-opus-xhigh-ood'], teleType: 'bss',
    teleDirs: ['budget-sweep-smoke-cc-opus-xhigh-ood'],
    out: { kind: 'shim', prefix: 'bss3k-ood-opus-xhigh' } },
  // codex-low vault: rep1 was judged with deepseek ALIVE → keep; rescore rep2 ONLY.
  { name: 'cdx-low-vault-rep2', set: 'vault', probes: 'vault',
    capDirs: ['budget-sweep-smoke-codex-gpt-vault'], teleType: 'bss',
    teleDirs: ['budget-sweep-smoke-codex-gpt-vault'], repFilter: (r) => r === 2,
    out: { kind: 'shim', prefix: 'bss3k-vault-cdx-low' } },
  // oc-gpt vault: overwrite the 4 shard rows.json in place (BH-FDR reads them).
  { name: 'oc-gpt-vault', set: 'vault', probes: 'vault',
    capDirs: ['oc-vault-gpt-3k-s1-captures', 'oc-vault-gpt-3k-s2-captures', 'oc-vault-gpt-3k-s3-captures', 'oc-vault-gpt-3k-s4-captures'],
    teleType: 'oc', teleDirs: ['oc-vault-gpt-3k-s1-mpp', 'oc-vault-gpt-3k-s1-native', 'oc-vault-gpt-3k-s2-mpp', 'oc-vault-gpt-3k-s2-native', 'oc-vault-gpt-3k-s3-mpp', 'oc-vault-gpt-3k-s3-native', 'oc-vault-gpt-3k-s4-mpp', 'oc-vault-gpt-3k-s4-native'],
    out: { kind: 'inplace' } },
];

const JUDGE_FIELDS = ['score', 'USD', 'USD_noC', 'grounding', 'content', 'content_noD3', 'purity_ratio', 'signal_purity', 'usdTokens'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

async function runTarget(t) {
  const probes = probeMap[t.probes];
  const tele = loadTele(t.teleType, t.teleDirs);
  const caps = loadCaps(t.capDirs, t.repFilter);
  console.error(`\n[${t.name}] ${caps.length} captures, ${tele.size} telemetry rows`);
  // rescore caps (bounded concurrency), collect corrected judge fields by key
  const fixed = new Map();
  let i = 0, errs = 0;
  const worker = async () => {
    while (i < caps.length) {
      const c = caps[i++];
      const probe = probes.get(c.probeId);
      if (!probe) { console.error(`  ! no probe ${c.probeId}`); continue; }
      const j = await rescoreCapture(c, probe);
      if (j.usdError) { errs++; }
      fixed.set(capKey(c), j);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, caps.length) }, worker));
  // before/after content sanity (on the ss arm)
  const oldC = [], newC = [];
  for (const [k, j] of fixed) { const r = tele.get(k); if (r && k.startsWith('ss|')) { oldC.push(r.content); if (Number.isFinite(j.content)) newC.push(j.content); } }
  console.error(`  ss-arm content: old ${mean(oldC).toFixed(3)} → new ${mean(newC).toFixed(3)}  (usdErr=${errs})`);

  // merge + write
  const merged = [];
  for (const [k, r] of tele) {
    const j = fixed.get(k);
    if (!j) { merged.push(r); continue; }      // not rescored (e.g. cdx rep1) → keep
    const row = { ...r };
    for (const f of JUDGE_FIELDS) if (j[f] != null) row[f] = j[f];
    if (j.usdError) row.usdError = j.usdError;
    merged.push(row);
  }
  if (t.out.kind === 'shim') {
    for (const arm of ['mpp', 'native']) {
      const want = arm === 'mpp' ? 'ss' : 'nat';
      const rows = merged.filter((r) => rowKey(r).startsWith(want + '|'));
      const d = path.join(RES, `${t.out.prefix}-${arm}`);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'rows.json'), JSON.stringify(rows));
    }
  } else { // inplace: write back each oc shard dir
    for (const d of t.teleDirs) {
      const f = path.join(RES, d, 'rows.json');
      if (!fs.existsSync(f)) continue;
      const orig = JSON.parse(fs.readFileSync(f, 'utf8'));
      const out = orig.map((r) => { const j = fixed.get(rowKey(r)); if (!j) return r; const row = { ...r }; for (const ff of JUDGE_FIELDS) if (j[ff] != null) row[ff] = j[ff]; return row; });
      fs.writeFileSync(f, JSON.stringify(out, null, 2));
    }
  }
  console.error(`  wrote ${t.out.kind === 'shim' ? t.out.prefix + '-{mpp,native}' : t.teleDirs.length + ' oc dirs'}`);
}

(async () => {
  const targets = ONLY ? TARGETS.filter((t) => t.name.includes(ONLY)) : TARGETS;
  if (!targets.length) { console.error('no targets match', ONLY); process.exit(1); }
  for (const t of targets) await runTarget(t);
  console.error('\nrescore done.');
})();
