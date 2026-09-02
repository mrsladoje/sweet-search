// e2-paired.mjs — paired per-task sweet-minus-native deltas by component, per epoch/harness,
// with a paired bootstrap CI over tasks and leave-one-task-out sensitivity (H1).
import { load, cellRows, mean, bootCI } from './e2-cells.mjs';
const d = load();
const R = d.rollouts;
const COMP = ['realizedUsd', 'totalUsd', 'ingestUsd', 'residentUsd', 'outputUsd',
  'turns', 'calls', 'ctxIntegral', 'firstTurnIn', 'tokNewIn', 'tokResent', 'tokOut',
  'toolBytes', 'cacheHitRatio', 'editFails', 'callsAfterFirstEdit', 'sidechainUsd', 'delegates'];
const EPOCHS = [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']];
const out = { perTask: {}, summary: [] };
for (const harness of ['codex', 'opencode', 'claude-code']) {
  for (const [epoch, form] of EPOCHS) {
    const sw = cellRows(R, { epoch, harness, form });
    const na = cellRows(R, { epoch, harness, form: 'native' });
    if (!sw.length || !na.length) continue;
    const tasks = [...new Set(na.map(r => r.taskId))].filter(t => sw.some(r => r.taskId === t));
    const rowsT = [];
    for (const t of tasks) {
      const S = sw.filter(r => r.taskId === t), N = na.filter(r => r.taskId === t);
      const rec = { taskId: t, nS: S.length, nN: N.length,
        solvedS: S.filter(r => r.resolved).length, solvedN: N.filter(r => r.resolved).length };
      for (const c of COMP) {
        const f = r => (r[c] == null ? 0 : (typeof r[c] === 'boolean' ? (r[c] ? 1 : 0) : r[c]));
        rec[`S_${c}`] = mean(S.map(f)); rec[`N_${c}`] = mean(N.map(f)); rec[`d_${c}`] = rec[`S_${c}`] - rec[`N_${c}`];
      }
      rowsT.push(rec);
    }
    out.perTask[`${harness}|${epoch}`] = rowsT;
    const s = { harness, epoch, form, tasks: tasks.length };
    for (const c of COMP) {
      const ds = rowsT.map(r => r[`d_${c}`]);
      s[`d_${c}`] = mean(ds);
      s[`N_${c}`] = mean(rowsT.map(r => r[`N_${c}`]));
      if (c === 'realizedUsd' || c === 'totalUsd' || c === 'ctxIntegral' || c === 'turns') {
        const [lo, hi] = bootCI(ds);
        s[`ci_${c}`] = [lo, hi];
        // leave-one-task-out extremes on the pct delta
        const base = mean(rowsT.map(r => r[`N_${c}`]));
        let worst = null, bestv = null;
        for (let i = 0; i < rowsT.length; i++) {
          const sub = rowsT.filter((_, j) => j !== i);
          const p = mean(sub.map(r => r[`d_${c}`])) / mean(sub.map(r => r[`N_${c}`])) * 100;
          if (worst === null || p < worst[1]) worst = [rowsT[i].taskId, p];
          if (bestv === null || p > bestv[1]) bestv = [rowsT[i].taskId, p];
        }
        s[`loo_${c}`] = { drop_min: worst, drop_max: bestv, full: s[`d_${c}`] / base * 100 };
      }
    }
    out.summary.push(s);
  }
}
console.log('=== paired summary: sweet minus native, averaged over tasks ===');
const pc = (dv, nv) => (nv ? (dv / nv * 100).toFixed(1) + '%' : '');
console.log(['harness', 'epoch', 'tasks', 'd$real', 'd$real%', 'CI%', 'd$incl', 'd$incl%',
  'dINGEST', 'dRESIDENT', 'dOUTPUT', 'dturns', 'dcalls', 'dctxInt', 'dctxInt%', 'dfirstIn', 'dtoolBytes', 'dtoolB%'].join('\t'));
for (const s of out.summary) {
  const ci = s.ci_realizedUsd ? `[${pc(s.ci_realizedUsd[0], s.N_realizedUsd)},${pc(s.ci_realizedUsd[1], s.N_realizedUsd)}]` : '';
  console.log([s.harness, s.epoch, s.tasks,
    s.d_realizedUsd.toFixed(6), pc(s.d_realizedUsd, s.N_realizedUsd), ci,
    s.d_totalUsd.toFixed(6), pc(s.d_totalUsd, s.N_totalUsd),
    s.d_ingestUsd.toFixed(6), s.d_residentUsd.toFixed(6), s.d_outputUsd.toFixed(6),
    s.d_turns.toFixed(2), s.d_calls.toFixed(2), s.d_ctxIntegral.toFixed(0), pc(s.d_ctxIntegral, s.N_ctxIntegral),
    s.d_firstTurnIn.toFixed(0), s.d_toolBytes.toFixed(0), pc(s.d_toolBytes, s.N_toolBytes)].join('\t'));
}
console.log('\n=== H1 leave-one-task-out on realized $ delta % (min / max after dropping one task) ===');
for (const s of out.summary) {
  const l = s.loo_realizedUsd;
  console.log(`${s.harness}\t${s.epoch}\tfull ${l.full.toFixed(1)}%\tdrop-${l.drop_min[0]} -> ${l.drop_min[1].toFixed(1)}%\tdrop-${l.drop_max[0]} -> ${l.drop_max[1].toFixed(1)}%`);
}
console.log('\n=== epoch C per-task deltas (sweet TAB minus native), $ realized ===');
for (const harness of ['codex', 'opencode', 'claude-code']) {
  const rows = out.perTask[`${harness}|C`] || [];
  console.log(`--- ${harness} ---`);
  console.log(['task', 'solvedS/N', 'd$real', 'd$incl', 'dINGEST', 'dRESIDENT', 'dOUTPUT', 'dturns', 'dctxInt', 'dtoolBytes', 'dside'].join('\t'));
  for (const r of rows.sort((a, b) => a.d_realizedUsd - b.d_realizedUsd)) {
    console.log([r.taskId, `${r.solvedS}/${r.solvedN}`, r.d_realizedUsd.toFixed(6), r.d_totalUsd.toFixed(6),
      r.d_ingestUsd.toFixed(6), r.d_residentUsd.toFixed(6), r.d_outputUsd.toFixed(6),
      r.d_turns.toFixed(1), r.d_ctxIntegral.toFixed(0), r.d_toolBytes.toFixed(0), r.d_sidechainUsd.toFixed(6)].join('\t'));
  }
}
import fs from 'node:fs';
fs.writeFileSync('/tmp/fp-inv/e2/paired.json', JSON.stringify(out));
