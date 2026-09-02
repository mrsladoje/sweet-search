// e2-headline.mjs — reproduce the published $/rollout table from the rebuilt transcripts,
// on every cost column, and print the component split.
import { load, cellRows, mean, sum } from './e2-cells.mjs';
const d = load();
const R = d.rollouts;
const COLS = ['realizedUsd', 'idealUsd', 'breakPricedUsd', 'totalUsd'];
const rows = [];
for (const harness of ['codex', 'opencode', 'claude-code']) {
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]]) {
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form });
      if (!c.length) continue;
      const o = { epoch, harness, form, n: c.length,
        tasks: new Set(c.map(x => x.taskId)).size,
        solved: c.filter(x => x.resolved).length,
        turns: mean(c.map(x => x.turns)), calls: mean(c.map(x => x.calls)),
        ingest: mean(c.map(x => x.ingestUsd)), resident: mean(c.map(x => x.residentUsd)),
        output: mean(c.map(x => x.outputUsd)),
        side: mean(c.map(x => x.sidechainUsd || 0)),
        tokNewIn: mean(c.map(x => x.tokNewIn)), tokResent: mean(c.map(x => x.tokResent)),
        tokOut: mean(c.map(x => x.tokOut)), ctxInt: mean(c.map(x => x.ctxIntegral)),
        firstIn: mean(c.map(x => x.firstTurnIn)), lastIn: mean(c.map(x => x.lastTurnIn)),
        cacheHit: mean(c.map(x => x.cacheHitRatio)), cacheMiss: mean(c.map(x => x.cacheMissTurns)),
        toolBytes: mean(c.map(x => x.toolBytes)),
        editFails: sum(c.map(x => x.editFails)), rolloutsWithEditFail: c.filter(x => x.editFails > 0).length,
        delegating: c.filter(x => (x.delegates || 0) > 0).length,
        pollCalls: mean(c.map(x => x.pollCalls || 0)),
      };
      for (const col of COLS) o[col] = mean(c.map(x => x[col] ?? 0));
      rows.push(o);
    }
  }
}
const fmt = n => (n == null ? '' : (Math.abs(n) < 1 ? n.toFixed(6) : n.toFixed(2)));
console.log(['epoch', 'harness', 'form', 'n', 'tasks', 'solved', 'turns', 'calls',
  'realized', 'ideal', 'breakPriced', 'inclusive', 'INGEST', 'RESIDENT', 'OUTPUT', 'side'].join('\t'));
for (const r of rows) console.log([r.epoch, r.harness, r.form, r.n, r.tasks, r.solved,
  r.turns.toFixed(1), r.calls.toFixed(1), fmt(r.realizedUsd), fmt(r.idealUsd), fmt(r.breakPricedUsd),
  fmt(r.totalUsd), fmt(r.ingest), fmt(r.resident), fmt(r.output), fmt(r.side)].join('\t'));
console.log('\n--- vs native, per column ---');
console.log(['epoch', 'harness', 'form', 'd_realized%', 'd_ideal%', 'd_break%', 'd_inclusive%'].join('\t'));
for (const r of rows) {
  if (r.form === 'native') continue;
  const nat = rows.find(x => x.epoch === r.epoch && x.harness === r.harness && x.form === 'native');
  if (!nat) continue;
  const p = (a, b) => ((a - b) / b * 100).toFixed(1);
  console.log([r.epoch, r.harness, r.form, p(r.realizedUsd, nat.realizedUsd), p(r.idealUsd, nat.idealUsd),
    p(r.breakPricedUsd, nat.breakPricedUsd), p(r.totalUsd, nat.totalUsd)].join('\t'));
}
console.log('\n--- token / structure ---');
console.log(['epoch', 'harness', 'form', 'newIn', 'resent', 'out', 'ctxInt', 'firstIn', 'lastIn', 'cacheHit', 'cacheMissT', 'toolBytes', 'editFailRollouts', 'delegating', 'poll'].join('\t'));
for (const r of rows) console.log([r.epoch, r.harness, r.form, r.tokNewIn.toFixed(0), r.tokResent.toFixed(0),
  r.tokOut.toFixed(0), r.ctxInt.toFixed(0), r.firstIn.toFixed(0), r.lastIn.toFixed(0),
  r.cacheHit.toFixed(3), r.cacheMiss.toFixed(2), r.toolBytes.toFixed(0),
  `${r.rolloutsWithEditFail}/${r.n}`, `${r.delegating}/${r.n}`, r.pollCalls.toFixed(2)].join('\t'));
