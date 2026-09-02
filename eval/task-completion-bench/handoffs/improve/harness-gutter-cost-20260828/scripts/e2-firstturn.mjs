// e2-firstturn.mjs — separate the fixed harness preamble (system prompt + tool schemas +
// frame) from the per-task issue text, using the same 22 issues run on all three harnesses.
import { load, cellRows, mean } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const M = (rs, f) => mean(rs.map(f));
const nat = {};
for (const h of ['codex', 'opencode', 'claude-code']) {
  const c = cellRows(R, { epoch: 'C', harness: h, form: 'native' });
  nat[h] = {}; for (const t of new Set(c.map(r => r.taskId))) nat[h][t] = M(c.filter(r => r.taskId === t), r => r.firstTurnIn);
}
const tasks = Object.keys(nat.codex);
// firstIn(h,t) = F_h + I_t. Fit by alternating means (two-way additive model, no interaction).
let F = { codex: 0, opencode: 0, 'claude-code': 0 }, I = {};
for (let it = 0; it < 200; it++) {
  for (const t of tasks) I[t] = mean(Object.keys(F).map(h => nat[h][t] - F[h]));
  for (const h of Object.keys(F)) F[h] = mean(tasks.map(t => nat[h][t] - I[t]));
}
const resid = [];
for (const h of Object.keys(F)) for (const t of tasks) resid.push(Math.abs(nat[h][t] - F[h] - I[t]));
console.log('two-way additive fit of the native first-turn prompt, epoch C (22 issues x 3 harnesses)');
console.log(`  mean |residual| = ${mean(resid).toFixed(0)} tokens, max = ${Math.max(...resid).toFixed(0)}`);
const Ivals = tasks.map(t => I[t]).sort((a, b) => a - b);
const shift = Ivals[0];    // pin the smallest issue at 0 so F_h reads as "preamble + smallest issue"
console.log(`  issue text spread: ${(Ivals[0] - shift).toFixed(0)} .. ${(Ivals[Ivals.length - 1] - shift).toFixed(0)} tokens (median ${(Ivals[Math.floor(Ivals.length / 2)] - shift).toFixed(0)})`);
console.log('  fixed harness preamble (system prompt + tool schemas + frame + smallest issue):');
for (const h of Object.keys(F)) console.log(`    ${h}\t${(F[h] + shift).toFixed(0)} tokens`);
console.log('  differences: claude-code − codex = ' + ((F['claude-code'] - F.codex)).toFixed(0)
  + ', codex − opencode = ' + ((F.codex - F.opencode)).toFixed(0));
console.log('\nWhole-rollout cost of the fixed preamble alone (resident every turn + ingested once):');
for (const h of Object.keys(F)) {
  const c = cellRows(R, { epoch: 'C', harness: h, form: 'native' });
  const T = M(c, r => r.turns), pre = F[h] + shift;
  const usd = pre * 0.10 / 1e6 + pre * T * 0.01 / 1e6;
  console.log(`  ${h}\t${pre.toFixed(0)} tok x ${T.toFixed(1)} turns = $${usd.toFixed(6)}/rollout `
    + `(${(usd / (M(c, r => r.idealUsd) + M(c, r => r.sidechainUsd)) * 100).toFixed(1)}% of the arm)`);
}
