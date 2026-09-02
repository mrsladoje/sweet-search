// e2-drivers.mjs — ranked cost drivers for epoch C, the all-transcript claude variant,
// and the size a lever must reach to buy -15% per harness.
import fs from 'node:fs';
import { load, cellRows, mean, bootCI } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const P = { in: 0.10, cache: 0.01, out: 0.60 };
const M = (rs, f) => mean(rs.map(f));
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');

console.log('### Cost anatomy of one sweet TAB rollout, epoch C (ideal columns, exact identity)\n');
console.log(['harness', '$ideal', 'INGEST$', 'INGEST%', 'RESIDENT$', 'RESIDENT%', 'OUTPUT$', 'OUTPUT%', 'sidechain$', 'sidechain%'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const form of ['native', 'tab']) {
    const c = cellRows(R, { epoch: 'C', harness, form });
    const tot = M(c, r => r.idealUsd) + M(c, r => r.sidechainUsd);
    console.log([`${harness}/${form}`, M(c, r => r.idealUsd).toFixed(6),
      M(c, r => r.ingestUsd).toFixed(6), pct(M(c, r => r.ingestUsd), tot),
      M(c, r => r.residentUsd).toFixed(6), pct(M(c, r => r.residentUsd), tot),
      M(c, r => r.outputUsd).toFixed(6), pct(M(c, r => r.outputUsd), tot),
      M(c, r => r.sidechainUsd).toFixed(6), pct(M(c, r => r.sidechainUsd), tot)].join('\t'));
  }

console.log('\n### Ranked drivers of the sweet-minus-native delta, epoch C (paired over tasks)\n');
for (const harness of ['codex', 'opencode', 'claude-code']) {
  const sw = cellRows(R, { epoch: 'C', harness, form: 'tab' }), na = cellRows(R, { epoch: 'C', harness, form: 'native' });
  const tasks = [...new Set(na.map(r => r.taskId))];
  const per = tasks.map(t => {
    const S = sw.filter(r => r.taskId === t), N = na.filter(r => r.taskId === t);
    const TS = M(S, r => r.turns), TN = M(N, r => r.turns);
    const CS = M(S, r => r.ctxIntegral / Math.max(1, r.turns)), CN = M(N, r => r.ctxIntegral / Math.max(1, r.turns));
    const guide = M(S, r => r.firstTurnIn) - M(N, r => r.firstTurnIn);
    return {
      guide$: guide * (TS + TN) / 2 * P.cache / 1e6 + guide * P.in / 1e6,
      turns$: (TS - TN) * (CS + CN) / 2 * P.cache / 1e6,
      ctx$: (CS - CN - guide) * (TS + TN) / 2 * P.cache / 1e6
        + (M(S, r => r.tokNewIn) - M(N, r => r.tokNewIn) - guide) * P.in / 1e6,
      out$: (M(S, r => r.tokOut) - M(N, r => r.tokOut)) * P.out / 1e6,
      side$: M(S, r => r.sidechainUsd) - M(N, r => r.sidechainUsd),
      base: M(N, r => r.totalUsd),
    };
  });
  const base = mean(per.map(x => x.base));
  const rows = [['instruction-file tax (M± guide, resident every turn)', mean(per.map(x => x.guide$))],
    ['turn count', mean(per.map(x => x.turns$))],
    ['context size, everything but the guide (retrieval payload)', mean(per.map(x => x.ctx$))],
    ['output + reasoning tokens', mean(per.map(x => x.out$))],
    ['sub-agent (sidechain) spend', mean(per.map(x => x.side$))]]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  console.log(`--- ${harness} (native baseline $${base.toFixed(6)}/rollout) ---`);
  for (const [k, v] of rows) console.log(`${v >= 0 ? '+' : ''}${v.toFixed(6)}\t${pct(v, base)}\t${k}`);
  const tot = rows.reduce((a, b) => a + b[1], 0);
  console.log(`= ${tot >= 0 ? '+' : ''}${tot.toFixed(6)}\t${pct(tot, base)}\tsum (measured paired delta ${pct(mean(per.map((x, i) => 0)) + M(sw, r => r.totalUsd) - M(na, r => r.totalUsd), M(na, r => r.totalUsd))})\n`);
}

console.log('### What a lever must move to buy −15% on the epoch-C sweet arm\n');
for (const harness of ['codex', 'opencode', 'claude-code']) {
  const c = cellRows(R, { epoch: 'C', harness, form: 'tab' });
  const base = M(c, r => r.idealUsd) + M(c, r => r.sidechainUsd);
  const target = 0.15 * base;
  const T = M(c, r => r.turns);
  const ctxTokPerDollar = 1 / ((T / 2) * P.cache / 1e6 + P.in / 1e6);   // a token added mid-trajectory
  const outTokPerDollar = 1 / (P.out / 1e6);
  const turnCost = M(c, r => r.ctxIntegral / Math.max(1, r.turns)) * P.cache / 1e6 + M(c, r => r.tokOut / Math.max(1, r.turns)) * P.out / 1e6;
  console.log(`${harness}: $${base.toFixed(6)}/rollout, target saving $${target.toFixed(6)}`);
  console.log(`   via context alone: −${(target * ctxTokPerDollar).toFixed(0)} tokens of payload (≈${(target * ctxTokPerDollar / 1.45).toFixed(0)} gutter-line-equivalents, `
    + `${pct(target * ctxTokPerDollar, M(c, r => r.tokNewIn))} of everything the arm ingests)`);
  console.log(`   via output alone:  −${(target * outTokPerDollar).toFixed(0)} output tokens (${pct(target * outTokPerDollar, M(c, r => r.tokOut))} of the arm's output)`);
  console.log(`   via turns alone:   −${(target / turnCost).toFixed(1)} turns of ${T.toFixed(1)} (${pct(target / turnCost, T)})`);
}

console.log('\n### claude-code: three cost conventions for the same cell');
for (const [run, arm, form] of [['fp-claudecode-tab-20260826', 'native', 'native'], ['fp-claudecode-tab-20260826', 'sweet', 'tab'],
  ['fp-claudecode-none-20260826', 'sweet', 'none'], ['fp-claudecode-pipe-20260826', 'sweet', 'pipe']]) {
  const c = R.filter(r => r.ok && r.run === run && r.arm === arm);
  const main = c.reduce((a, r) => a + r.realizedUsd, 0), side = c.reduce((a, r) => a + r.sidechainUsd, 0);
  const aband = c.reduce((a, r) => a + (r.abandonedUsd || 0), 0);
  console.log(`${form}\tn=${c.length}\trow-matched main $${main.toFixed(6)} + sidechain $${side.toFixed(6)} = $${(main + side).toFixed(6)}`
    + ` ($${((main + side) / c.length).toFixed(6)}/rollout); abandoned duplicate invocations $${aband.toFixed(6)}`
    + `; every-dollar-spent $${(main + side + aband).toFixed(6)} ($${((main + side + aband) / c.length).toFixed(6)}/rollout)`);
}
