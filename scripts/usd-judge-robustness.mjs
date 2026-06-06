#!/usr/bin/env node
/**
 * USD judge-robustness pass — recovers the per-judge votes the original scoring threw
 * away (only the median-aggregated content/USD_noC reached rows.json), by re-running
 * ONLY the 6-dim USD panel from each saved capture's rawResponse (no agent re-run; judges
 * are temp=0 so this reproduces the published scoring). Then, with per-judge votes in hand:
 *
 *   1. PER-JUDGE-ALONE sensitivity — each of the 3 disjoint-family judges, used ALONE,
 *      gives its own content_noD3; paired Δ (ss − native) per judge, pooled over the vault
 *      + per cell. If all 3 independently show the M++ win, it isn't a single-judge / median
 *      artifact. (Cleaner than leave-one-out: a 2-judge median is degenerate.)
 *   2. INTER-JUDGE AGREEMENT — per criterion, pairwise % agreement + Fleiss κ across judges.
 *   3. FULL-PANEL reproduction — median content_noD3 Δ, as a sanity check vs the published.
 *
 * Votes are persisted to results/usd-judge-votes-<SET>/<cell>.json → re-analysable offline.
 *
 *   SET=vault CONC=6 node scripts/usd-judge-robustness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRJudge, usdPanelScore, pairedBootstrapCI } from '../core/prompt-optimization/sweep/usd-metric.mjs';
import { JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const SET = process.env.SET || 'vault';
const CONC = Number(process.env.CONC || 6);
const SEED = Number(process.env.SEED || 42);
const CAP = Number(process.env.CAP || 65536);
const B = Number(process.env.B || 20000);
const FORCE = process.env.FORCE === '1';
const CD3_CRIT = ['answer_grounding', 'workable_code', 'edit_locality', 'sufficiency']; // content_noD3 = mean(D1,D2,D4,D5)

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (x, d = 3) => (x == null || Number.isNaN(x) ? 'NA' : Number(x).toFixed(d));
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rng = mulberry32(SEED);
const capBlocks = (raw) => String(raw || '').split('\n\n').map((b) => (b.length > CAP ? `${b.slice(0, CAP)}\n…[truncated]` : b)).join('\n\n');
function bootstrapP(vals) { const n = vals.length; if (!n) return 1; let le = 0, ge = 0; for (let k = 0; k < B; k++) { let s = 0; for (let i = 0; i < n; i++) s += vals[(rng() * n) | 0]; const m = s / n; if (m <= 0) le++; if (m >= 0) ge++; } return Math.min(1, 2 * Math.min(le / B, ge / B)); }
const medBin = (v) => { const s = v.filter((x) => x === 0 || x === 1).sort((a, b) => a - b); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { process.stdout.write(s + '\n'); }; // newline → flushes to the redirected log so progress is watchable
const JUDGE_RETRIES = Number(process.env.JUDGE_RETRIES || 4); // capture-level retries, ON TOP of runJudge's 429 backoff ladder
const RETRY_BACKOFF_MS = [2000, 5000, 10000, 20000];

async function pool(items, n, fn) { let i = 0; const w = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } }); await Promise.all(w); }

// vault cells → capture-dir regex (+ optional `captures` subdir for codex per-arm dirs)
const VAULT_CELLS = [
  { name: 'cdx-low', re: '^cdx-low-(mpp|native)-s\\d+$', sub: 'captures' },
  { name: 'cdx-high', re: '^cdx-high-(mpp|native)-s\\d+$', sub: 'captures' },
  { name: 'ba-glm', re: '^ba-glm-s\\d+-vault-captures$' },
  { name: 'ba-gpt', re: '^ba-gpt-s\\d+-vault-captures$' },
  { name: 'oc-glm', re: '^oc-vault-glm-s\\d+-captures$' },
  { name: 'cc-sonnet-med', re: '^cc-vault-sonnet-med-captures$' },
  { name: 'cc-sonnet-max', re: '^cc-vault-sonnet-max-captures$' },
  { name: 'cc-opus-low', re: '^cc-vault-opus-low-captures$' },
  { name: 'cc-opus-xhigh', re: '^cc-vault-opus-xhigh-captures$' },
];
const CELLS = SET === 'vault' ? VAULT_CELLS : VAULT_CELLS; // (only vault wired for now)

const probesAll = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const byId = new Map((Array.isArray(probesAll) ? probesAll : probesAll.probes).map((p) => [p.id, p]));

function captureFiles(cell) {
  const re = new RegExp(cell.re);
  const out = [];
  for (const d of fs.readdirSync(RES)) {
    if (!re.test(d)) continue;
    const cdir = cell.sub ? path.join(RES, d, cell.sub) : path.join(RES, d);
    if (!fs.existsSync(cdir)) continue;
    for (const f of fs.readdirSync(cdir)) if (f.endsWith('.json')) out.push(path.join(cdir, f));
  }
  return out;
}

const JIDS = JUDGE_PANEL.map((j) => j.model);
const VOTES_DIR = path.join(RES, `usd-judge-votes-${SET}`);
fs.mkdirSync(VOTES_DIR, { recursive: true });

// score one capture → per-judge cd3 + per-criterion votes (re-runs the 6-dim panel).
// Capture-level retry: re-run the panel until all 3 judges return a valid verdict
// (keeping the best partial), so a judge that exhausts runJudge's own 429 ladder still
// gets re-attempted. Returns {retries, failed:[jid...]} for coverage reporting.
async function scoreCapture(capPath) {
  const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  const probe = byId.get(cap.probeId);
  if (!probe || probe.expectedNoMatch) return null; // no-match probes don't exercise the dims
  const rJudge = toRJudge(capBlocks(cap.rawResponse), cap.arm);
  let best = null, retries = 0, lastErr = null;
  for (let t = 0; t <= JUDGE_RETRIES; t++) {
    let panel = null;
    try {
      const r = await usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError });
      panel = r.panel;
    } catch (e) { lastErr = String(e?.message || e); } // AllJudgesFailedError etc.
    if (panel) {
      const nValid = panel.filter((j) => j.verdictByCriterion).length;
      if (!best || nValid > best.nValid) best = { panel, nValid };
      if (nValid === JIDS.length) break; // full panel → done
    }
    if (t < JUDGE_RETRIES) { retries++; await sleep(RETRY_BACKOFF_MS[Math.min(t, RETRY_BACKOFF_MS.length - 1)]); }
  }
  if (!best) return { probeId: cap.probeId, arm: cap.arm, error: lastErr || 'panel-failed', retries };
  const judges = {}; const failed = [];
  for (const jid of JIDS) {
    const j = best.panel.find((x) => x.model === jid);
    const ok = !!j?.verdictByCriterion;
    if (!ok) failed.push(jid);
    const v = (c) => (j?.verdictByCriterion?.[c]?.v === 1 ? 1 : 0);
    judges[jid] = { votes: Object.fromEntries(CD3_CRIT.map((c) => [c, v(c)])), cd3: mean(CD3_CRIT.map((c) => v(c))), ok };
  }
  // panel median over the judges that actually returned a verdict (a failed judge is excluded, not counted as 0)
  const panelCd3 = mean(CD3_CRIT.map((c) => medBin(JIDS.filter((jid) => judges[jid].ok).map((jid) => judges[jid].votes[c]))));
  return { probeId: cap.probeId, arm: cap.arm, rep: cap.rep, judges, panelCd3, retries, failed };
}

// Fleiss κ for binary ratings: items × {n raters}, n1 = #raters voting 1.
function fleissKappaBinary(items) {
  const rows = items.filter((it) => it.n >= 2);
  if (!rows.length) return null;
  const N = rows.length;
  let Pbar = 0, sum1 = 0, sumN = 0;
  for (const it of rows) { const n = it.n, n1 = it.n1, n0 = n - n1; Pbar += (n1 * n1 + n0 * n0 - n) / (n * (n - 1)); sum1 += n1; sumN += n; }
  Pbar /= N;
  const p1 = sum1 / sumN, p0 = 1 - p1, Pe = p1 * p1 + p0 * p0;
  return Pe >= 1 ? 1 : (Pbar - Pe) / (1 - Pe);
}

(async () => {
  console.log(`USD judge-robustness — SET=${SET} judges=[${JIDS.join(', ')}] CONC=${CONC} SEED=${SEED}\n`);
  const perCell = [];
  const agreeItems = Object.fromEntries(CD3_CRIT.map((c) => [c, []]));       // {crit: [{n,n1}]}
  const PAIRS = [`${JIDS[0]}~${JIDS[1]}`, `${JIDS[0]}~${JIDS[2]}`, `${JIDS[1]}~${JIDS[2]}`];
  const pairAgree = Object.fromEntries(CD3_CRIT.map((c) => [c, Object.fromEntries(PAIRS.map((p) => [p, []]))])); // {crit:{pair:[0/1]}}
  const pooled = Object.fromEntries(JIDS.map((j) => [j, []]));                // judge → [Δ per paired probe] (pooled over cells)
  const pooledPanel = [];

  for (const cell of CELLS) {
    const voteFile = path.join(VOTES_DIR, `${cell.name}.json`);
    let scored;
    if (fs.existsSync(voteFile) && !FORCE) {
      scored = JSON.parse(fs.readFileSync(voteFile, 'utf8'));
      process.stdout.write(`  ${cell.name}: ${scored.length} cached votes (FORCE=1 to re-judge)\n`);
    } else {
      let files = captureFiles(cell);
      if (process.env.MAXFILES) files = files.slice(0, Number(process.env.MAXFILES));
      const total = files.length;
      const acc = [];
      let done = 0, errs = 0, withRetry = 0;
      const jfail = Object.fromEntries(JIDS.map((j) => [j, 0]));
      log(`\n[${cell.name}] judging ${total} captures (CONC=${CONC}) ...`);
      await pool(files, CONC, async (f) => {
        const s = await scoreCapture(f);
        done++;
        if (s) {
          acc.push(s);
          if (s.error) { errs++; log(`[${cell.name}] ${done}/${total} ${path.basename(f).replace('.json', '')} ERROR ${String(s.error).slice(0, 80)} (retries=${s.retries || 0})`); return; }
          if (s.retries) withRetry++;
          for (const jf of (s.failed || [])) jfail[jf]++;
          const jok = JIDS.length - (s.failed?.length || 0);
          log(`[${cell.name}] ${done}/${total} ${s.probeId}.${s.arm} jok=${jok}/${JIDS.length}${s.retries ? ` retry=${s.retries}` : ''}${s.failed?.length ? ` FAIL:${s.failed.join(',')}` : ''}`);
        } else { log(`[${cell.name}] ${done}/${total} (no-match/skip)`); }
      });
      scored = acc;
      fs.writeFileSync(voteFile, JSON.stringify(scored, null, 2));
      log(`[${cell.name}] DONE: ${scored.filter((s) => !s.error).length}/${total} scored, ${errs} hard-err, ${withRetry} needed retry; per-judge misses: ${JIDS.map((j) => `${j}=${jfail[j]}`).join(' ')}`);
    }

    // pair ss vs native by probeId (mean over reps), per judge + panel
    const ok = scored.filter((s) => !s.error);
    const ss = new Map(), nat = new Map();
    for (const s of ok) { const m = s.arm === 'ss' ? ss : nat; if (!m.has(s.probeId)) m.set(s.probeId, []); m.get(s.probeId).push(s); }
    const probeIds = [...ss.keys()].filter((p) => nat.has(p));
    const judgeDelta = {};
    for (const jid of JIDS) {
      // exclude a judge's FAILED records (don't miscount a missing verdict as a 0 vote);
      // a probe contributes only if both arms have ≥1 valid record from this judge.
      const d = [];
      for (const p of probeIds) {
        const sv = ss.get(p).filter((x) => x.judges[jid].ok), nv = nat.get(p).filter((x) => x.judges[jid].ok);
        if (sv.length && nv.length) d.push(mean(sv.map((x) => x.judges[jid].cd3)) - mean(nv.map((x) => x.judges[jid].cd3)));
      }
      const [lo, hi] = pairedBootstrapCI(d, B, rng);
      judgeDelta[jid] = { mean: mean(d), ci: [lo, hi], excludesZero: lo > 0 || hi < 0, p: bootstrapP(d), n: d.length };
      pooled[jid].push(...d);
    }
    const dPanel = probeIds.map((p) => mean(ss.get(p).map((x) => x.panelCd3)) - mean(nat.get(p).map((x) => x.panelCd3)));
    const [plo, phi] = pairedBootstrapCI(dPanel, B, rng);
    const panelDelta = { mean: mean(dPanel), ci: [plo, phi], excludesZero: plo > 0 || phi < 0, p: bootstrapP(dPanel), n: dPanel.length };
    pooledPanel.push(...dPanel);

    // agreement items: count only judges that returned a verdict (Fleiss handles n≥2 raters/item)
    for (const s of ok) for (const c of CD3_CRIT) { const votes = JIDS.filter((j) => s.judges[j].ok).map((j) => s.judges[j].votes[c]); if (votes.length >= 2) agreeItems[c].push({ n: votes.length, n1: votes.reduce((a, b) => a + b, 0) }); }
    for (const s of ok) { for (const c of CD3_CRIT) { for (const [a, b] of [[JIDS[0], JIDS[1]], [JIDS[0], JIDS[2]], [JIDS[1], JIDS[2]]]) { if (s.judges[a].ok && s.judges[b].ok) pairAgree[c][`${a}~${b}`].push(s.judges[a].votes[c] === s.judges[b].votes[c] ? 1 : 0); } } }

    perCell.push({ cell: cell.name, n: probeIds.length, judgeDelta, panelDelta });
  }

  // ── report ──
  console.log(`\n═══ PER-JUDGE-ALONE content_noD3 Δ (ss − native), per cell ═══`);
  console.log(`  cell                 ${JIDS.map((j) => j.padEnd(22)).join('')}panel(median)`);
  for (const c of perCell) {
    const row = JIDS.map((j) => { const r = c.judgeDelta[j]; return `${r.mean >= 0 ? '+' : ''}${fmt(r.mean, 2)}${r.excludesZero ? '*' : ' '}`.padEnd(22); }).join('');
    const pr = c.panelDelta;
    console.log(`  ${c.cell.padEnd(20)} ${row}${pr.mean >= 0 ? '+' : ''}${fmt(pr.mean, 2)}${pr.excludesZero ? '*' : ' '} (n=${c.n})`);
  }

  console.log(`\n═══ POOLED-VAULT per-judge Δ (the headline robustness number) ═══`);
  const pooledOut = {};
  for (const jid of JIDS) { const d = pooled[jid]; const [lo, hi] = pairedBootstrapCI(d, B, rng); const p = bootstrapP(d); pooledOut[jid] = { mean: mean(d), ci: [lo, hi], excludesZero: lo > 0 || hi < 0, p, n: d.length }; console.log(`  ${jid.padEnd(24)} Δ=${mean(d) >= 0 ? '+' : ''}${fmt(mean(d))}  CI[${fmt(lo)},${fmt(hi)}]  p=${fmt(p, 4)}  ${lo > 0 || hi < 0 ? 'SIG' : 'ns'}  (n=${d.length})`); }
  { const [lo, hi] = pairedBootstrapCI(pooledPanel, B, rng); console.log(`  ${'PANEL (median-of-3)'.padEnd(24)} Δ=${mean(pooledPanel) >= 0 ? '+' : ''}${fmt(mean(pooledPanel))}  CI[${fmt(lo)},${fmt(hi)}]  ${lo > 0 || hi < 0 ? 'SIG' : 'ns'}  (n=${pooledPanel.length})`); }
  const allJudgesAgree = JIDS.every((j) => pooledOut[j].excludesZero && pooledOut[j].mean > 0);
  console.log(`  → all 3 judges independently +SIG: ${allJudgesAgree ? 'YES — judge-robust' : 'NO — single-judge sensitivity'}`);

  console.log(`\n═══ INTER-JUDGE AGREEMENT (per content_noD3 criterion) ═══`);
  console.log(`  criterion          %agree(${JIDS[0]}~${JIDS[1]} / ${JIDS[0]}~${JIDS[2]} / ${JIDS[1]}~${JIDS[2]})   Fleissκ(3)`);
  const agreeOut = {};
  for (const c of CD3_CRIT) {
    const k = fleissKappaBinary(agreeItems[c]);
    const pa = PAIRS.map((p) => mean(pairAgree[c][p]));
    agreeOut[c] = { fleissKappa: k, pairwiseAgreement: pa };
    console.log(`  ${c.padEnd(18)} ${pa.map((x) => fmt(x, 2)).join(' / ')}            κ=${fmt(k, 3)}`);
  }

  const out = { set: SET, seed: SEED, judges: JIDS, perCell, pooled: pooledOut, agreement: agreeOut, allJudgesAgree };
  const outF = path.join(RES, `usd-judge-robustness-${SET}.json`);
  fs.writeFileSync(outF, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.relative(REPO, outF)}  + per-cell votes in ${path.relative(REPO, VOTES_DIR)}/`);
})();
