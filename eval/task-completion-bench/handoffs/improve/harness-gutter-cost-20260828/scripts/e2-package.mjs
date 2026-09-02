// e2-package.mjs — assemble the deliverable JSON: per-rollout components + the cell,
// paired, driver and census tables. Turn-level arrays stay in /tmp/fp-inv/e2/rollout-costs.json.
import fs from 'node:fs';
import { load, cellRows, mean, bootCI, REPAIR } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const M = (rs, f) => mean(rs.map(f));
const P = { in: 0.10, cache: 0.01, out: 0.60 };
const rollouts = R.map(r => { const { turnIn, turnOut, turnCached, ...rest } = r; return rest; });

const cells = [];
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }); if (!c.length) continue;
      cells.push({ epoch, harness, form, n: c.length, tasks: new Set(c.map(x => x.taskId)).size,
        solved: c.filter(x => x.resolved).length,
        realizedUsd: M(c, r => r.realizedUsd), idealUsd: M(c, r => r.idealUsd),
        breakPricedUsd: M(c, r => r.breakPricedUsd), sidechainUsd: M(c, r => r.sidechainUsd),
        inclusiveUsd: M(c, r => r.totalUsd),
        ingestUsd: M(c, r => r.ingestUsd), residentUsd: M(c, r => r.residentUsd), outputUsd: M(c, r => r.outputUsd),
        turns: M(c, r => r.turns), calls: M(c, r => r.calls),
        tokNewIn: M(c, r => r.tokNewIn), tokResent: M(c, r => r.tokResent), tokOut: M(c, r => r.tokOut),
        contextTurnIntegral: M(c, r => r.ctxIntegral), firstTurnIn: M(c, r => r.firstTurnIn),
        cacheHitRatio: M(c, r => r.cacheHitRatio), cacheMissTurns: M(c, r => r.cacheMissTurns),
        toolBytes: M(c, r => r.toolBytes), editCalls: M(c, r => r.editCalls),
        editFails: c.reduce((a, r) => a + r.editFails, 0), rolloutsWithEditFail: c.filter(r => r.editFails > 0).length,
        delegatingRollouts: c.filter(r => (r.delegates || 0) > 0).length,
        pollCalls: M(c, r => r.pollCalls), callsAfterFirstEdit: M(c.filter(r => r.callsAfterFirstEdit != null), r => r.callsAfterFirstEdit),
        abandonedRerunUsd: c.reduce((a, r) => a + (r.abandonedUsd || 0), 0),
        abandonedRerunRollouts: c.filter(r => (r.abandonedAttempts || 0) > 0).length });
    }

const paired = [];
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, form] of [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']]) {
    const sw = cellRows(R, { epoch, harness, form }), na = cellRows(R, { epoch, harness, form: 'native' });
    if (!sw.length || !na.length) continue;
    const tasks = [...new Set(na.map(r => r.taskId))].filter(t => sw.some(r => r.taskId === t));
    const per = tasks.map(t => {
      const S = sw.filter(r => r.taskId === t), N = na.filter(r => r.taskId === t);
      const TS = M(S, r => r.turns), TN = M(N, r => r.turns);
      const CS = M(S, r => r.ctxIntegral / Math.max(1, r.turns)), CN = M(N, r => r.ctxIntegral / Math.max(1, r.turns));
      const guide = M(S, r => r.firstTurnIn) - M(N, r => r.firstTurnIn);
      return { taskId: t, solvedSweet: S.filter(r => r.resolved).length, solvedNative: N.filter(r => r.resolved).length,
        reps: [S.length, N.length],
        d_realizedUsd: M(S, r => r.realizedUsd) - M(N, r => r.realizedUsd),
        d_inclusiveUsd: M(S, r => r.totalUsd) - M(N, r => r.totalUsd),
        d_ingestUsd: M(S, r => r.ingestUsd) - M(N, r => r.ingestUsd),
        d_residentUsd: M(S, r => r.residentUsd) - M(N, r => r.residentUsd),
        d_outputUsd: M(S, r => r.outputUsd) - M(N, r => r.outputUsd),
        d_sidechainUsd: M(S, r => r.sidechainUsd) - M(N, r => r.sidechainUsd),
        d_turns: TS - TN, d_calls: M(S, r => r.calls) - M(N, r => r.calls),
        d_contextTurnIntegral: M(S, r => r.ctxIntegral) - M(N, r => r.ctxIntegral),
        d_firstTurnIn: guide, d_toolBytes: M(S, r => r.toolBytes) - M(N, r => r.toolBytes),
        native_inclusiveUsd: M(N, r => r.totalUsd),
        attr_guideUsd: guide * (TS + TN) / 2 * P.cache / 1e6 + guide * P.in / 1e6,
        attr_turnsUsd: (TS - TN) * (CS + CN) / 2 * P.cache / 1e6,
        attr_contextRestUsd: (CS - CN - guide) * (TS + TN) / 2 * P.cache / 1e6
          + (M(S, r => r.tokNewIn) - M(N, r => r.tokNewIn) - guide) * P.in / 1e6,
        attr_outputUsd: (M(S, r => r.tokOut) - M(N, r => r.tokOut)) * P.out / 1e6,
        attr_sidechainUsd: M(S, r => r.sidechainUsd) - M(N, r => r.sidechainUsd) };
    });
    const ds = per.map(x => x.d_inclusiveUsd), base = mean(per.map(x => x.native_inclusiveUsd));
    const [lo, hi] = bootCI(ds);
    paired.push({ harness, epoch, form, tasks: tasks.length, perTask: per,
      mean_d_inclusiveUsd: mean(ds), pct: mean(ds) / base * 100,
      bootstrapCI95pct: [lo / base * 100, hi / base * 100],
      attribution: { guideUsd: mean(per.map(x => x.attr_guideUsd)), turnsUsd: mean(per.map(x => x.attr_turnsUsd)),
        contextRestUsd: mean(per.map(x => x.attr_contextRestUsd)), outputUsd: mean(per.map(x => x.attr_outputUsd)),
        sidechainUsd: mean(per.map(x => x.attr_sidechainUsd)) } });
  }

const census = JSON.parse(fs.readFileSync('/tmp/fp-inv/e2/census.json', 'utf8'));
const out = {
  generated: new Date().toISOString(),
  method: 'every rollout re-priced from its own transcript; per-turn usage -> costFromTurns identity',
  price: P, model: 'openai/gpt-5.6-luna via OpenRouter',
  validation: {
    codex: 'ideal max |error| $0.000001 vs rows.json idealCostUsd (410 rows)',
    opencode: 'ideal max |error| $0.000001 vs rows.json idealCostUsd (491 rows)',
    'claude-code': 'realized main-only max |error| $0.000000 vs rows.json costRealizedMainOnlyUsd (342/342 rows carrying it)',
  },
  cells, paired, census, rollouts,
};
fs.writeFileSync('/tmp/fp-inv/e2/02-cost-decomposition.json', JSON.stringify(out));
console.log('rollouts', rollouts.length, 'cells', cells.length, 'paired', paired.length,
  'bytes', fs.statSync('/tmp/fp-inv/e2/02-cost-decomposition.json').size);
