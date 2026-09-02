// e2-hypo.mjs — the numbered hypothesis tests H1..H12 + the cross-harness gap.
import fs from 'node:fs';
import { load, cellRows, mean, bootCI, REPAIR } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const P = { in: 0.10, cache: 0.01, out: 0.60 };
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

function pairTasks(epoch, harness, form) {
  const sw = cellRows(R, { epoch, harness, form }), na = cellRows(R, { epoch, harness, form: 'native' });
  const tasks = [...new Set(na.map(r => r.taskId))].filter(t => sw.some(r => r.taskId === t));
  return tasks.map(t => ({ t, S: sw.filter(r => r.taskId === t), N: na.filter(r => r.taskId === t) }));
}
const M = (rs, f) => mean(rs.map(f));

console.log('### Additive decomposition of the paired ideal-cost delta (Shapley split of the context integral)\n');
console.log(['harness', 'epoch', 'tasks', 'd_ideal$', 'd_ideal%', '=turns$', '+guide$', '+ctxRest$', '+output$', 'check$',
  'dT', 'C̄_N', 'dC̄', 'dC̄_guide', 'dC̄_rest'].join('\t'));
const decomp = [];
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, form] of [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']]) {
    const prs = pairTasks(epoch, harness, form); if (!prs.length) continue;
    const g = [], parts = [];
    for (const { S, N } of prs) {
      const TS = M(S, r => r.turns), TN = M(N, r => r.turns);
      const CS = M(S, r => r.ctxIntegral / Math.max(1, r.turns)), CN = M(N, r => r.ctxIntegral / Math.max(1, r.turns));
      const guide = M(S, r => r.firstTurnIn) - M(N, r => r.firstTurnIn);
      const dT = TS - TN, dC = CS - CN;
      const turnsTok = dT * (CS + CN) / 2;
      const guideTok = guide * (TS + TN) / 2;
      const restTok = (dC - guide) * (TS + TN) / 2;
      // context tokens are billed: first appearance at $in, every re-send at $cache.
      // Approximate the marginal rate of a context token-turn by the cache rate, and add
      // the one-off ingest of the size change at the input rate.
      const dNewIn = M(S, r => r.tokNewIn) - M(N, r => r.tokNewIn);
      const dOut = M(S, r => r.tokOut) - M(N, r => r.tokOut);
      parts.push({ turns$: turnsTok * P.cache / 1e6, guide$: guideTok * P.cache / 1e6 + guide * P.in / 1e6,
        rest$: restTok * P.cache / 1e6 + (dNewIn - guide) * P.in / 1e6, out$: dOut * P.out / 1e6,
        dT, CN, dC, guide, rest: dC - guide,
        dIdeal: M(S, r => r.idealUsd) - M(N, r => r.idealUsd), NIdeal: M(N, r => r.idealUsd) });
      g.push(M(S, r => r.idealUsd) - M(N, r => r.idealUsd));
    }
    const a = k => mean(parts.map(p => p[k]));
    const row = { harness, epoch, tasks: prs.length, dIdeal: a('dIdeal'), NIdeal: a('NIdeal'),
      turns$: a('turns$'), guide$: a('guide$'), rest$: a('rest$'), out$: a('out$'),
      dT: a('dT'), CN: a('CN'), dC: a('dC'), guide: a('guide'), rest: a('rest') };
    decomp.push(row);
    console.log([harness, epoch, prs.length, row.dIdeal.toFixed(6), pct(row.dIdeal, row.NIdeal),
      row.turns$.toFixed(6), row.guide$.toFixed(6), row.rest$.toFixed(6), row.out$.toFixed(6),
      (row.turns$ + row.guide$ + row.rest$ + row.out$).toFixed(6),
      row.dT.toFixed(2), row.CN.toFixed(0), row.dC.toFixed(0), row.guide.toFixed(0), row.rest.toFixed(0)].join('\t'));
  }
console.log('\n(guide$ = the instruction-file offset priced as ingest-once + resident-every-turn;');
console.log(' turns$ = extra turns at the native mean context; ctxRest$ = every other context-size change;');
console.log(' check$ = the four parts summed, against d_ideal$.)\n');

console.log('### H1 pool composition — per-task delta distribution, epoch C, sweet TAB minus native');
console.log(['harness', 'epoch', 'n', 'mean$', 'median$', 'tasksCheaper', 'tasksDearer', 'top3 dearest share of mean'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, form] of [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']]) {
    const prs = pairTasks(epoch, harness, form); if (!prs.length) continue;
    const ds = prs.map(p => M(p.S, r => r.idealUsd) - M(p.N, r => r.idealUsd));
    const sorted = [...ds].sort((a, b) => b - a);
    const top3 = sorted.slice(0, 3).reduce((x, y) => x + y, 0);
    console.log([harness, epoch, ds.length, mean(ds).toFixed(6), med(ds).toFixed(6),
      ds.filter(x => x < 0).length, ds.filter(x => x > 0).length,
      pct(top3 / ds.length, mean(ds))].join('\t'));
  }

console.log('\n### H2 per-call read size, native vs sweet (bytes per call), and the paired byte delta');
console.log('(see census.json for the full family table; here: native read+grep bytes/call and sweet ss-read bytes/call)');
const cen = JSON.parse(fs.readFileSync('/tmp/fp-inv/e2/census.json', 'utf8'));
for (const c of cen) {
  const nr = c.agg.nativeRead, ng = c.agg.nativeGrep, sr = c.agg['ss-read'];
  console.log([c.harness, c.epoch, c.form, c.n,
    nr ? `nativeRead ${(nr.calls / c.n).toFixed(2)}c @ ${(nr.bytes / nr.calls).toFixed(0)}B = ${(nr.bytes / c.n).toFixed(0)}B/rollout` : '',
    ng ? `nativeGrep ${(ng.calls / c.n).toFixed(2)}c @ ${(ng.bytes / ng.calls).toFixed(0)}B` : '',
    sr ? `ss-read ${(sr.calls / c.n).toFixed(2)}c @ ${(sr.bytes / sr.calls).toFixed(0)}B` : ''].join('\t'));
}

console.log('\n### H4 output tokens: per rollout and per turn');
console.log(['harness', 'epoch', 'form', 'out/rollout', 'out/turn', 'turns'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }); if (!c.length) continue;
      console.log([harness, epoch, form, M(c, r => r.tokOut).toFixed(0),
        (M(c, r => r.tokOut) / M(c, r => r.turns)).toFixed(0), M(c, r => r.turns).toFixed(1)].join('\t'));
    }

console.log('\n### H6 cache-hit ratio and cache-miss turns; concurrency 2 (fp) vs 1 (rp), opencode repair tasks');
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, forms] of [['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }); if (!c.length) continue;
      console.log([harness, epoch, form, 'hit', M(c, r => r.cacheHitRatio).toFixed(4),
        'missTurns/rollout', M(c, r => r.cacheMissTurns).toFixed(3),
        'rolloutsWithMiss', c.filter(r => r.cacheMissTurns > 0).length + '/' + c.length].join('\t'));
    }
const fpRepair = R.filter(r => r.ok && r.harness === 'opencode' && r.run.startsWith('fp-opencode') && r.arm === 'sweet' && REPAIR.has(r.taskId));
const rpRepair = R.filter(r => r.ok && r.repair && r.arm === 'sweet');
console.log(`fp (CONCURRENCY=2, surviving repair-task rollouts) n=${fpRepair.length} hit=${M(fpRepair, r => r.cacheHitRatio).toFixed(4)} miss/rollout=${M(fpRepair, r => r.cacheMissTurns).toFixed(3)} ideal=$${M(fpRepair, r => r.idealUsd).toFixed(6)}`);
console.log(`rp (CONCURRENCY=1, same 11 tasks)                n=${rpRepair.length} hit=${M(rpRepair, r => r.cacheHitRatio).toFixed(4)} miss/rollout=${M(rpRepair, r => r.cacheMissTurns).toFixed(3)} ideal=$${M(rpRepair, r => r.idealUsd).toFixed(6)}`);

console.log('\n### H7 failed-edit retries');
console.log(['harness', 'epoch', 'form', 'n', 'editCalls/rollout', 'failedEdits', 'rolloutsWithFail', '$ideal fail-vs-clean'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }); if (!c.length) continue;
      const f = c.filter(r => r.editFails > 0), cl = c.filter(r => r.editFails === 0);
      console.log([harness, epoch, form, c.length, M(c, r => r.editCalls).toFixed(2),
        c.reduce((a, r) => a + r.editFails, 0), `${f.length}/${c.length}`,
        `$${M(f, r => r.idealUsd).toFixed(6)} vs $${M(cl, r => r.idealUsd).toFixed(6)}`].join('\t'));
    }

console.log('\n### H8 poll turns (codex write_stdin) and recorded wall time');
for (const harness of ['codex'])
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }); if (!c.length) continue;
      console.log([harness, epoch, form, 'poll/rollout', M(c, r => r.pollCalls).toFixed(2),
        'pollBytes/rollout', M(c, r => r.pollBytes).toFixed(0),
        'wallSec/rollout', M(c.filter(r => r.wallSum != null), r => r.wallSum).toFixed(1),
        'ssWallSec/rollout', M(c.filter(r => r.ssWall != null), r => r.ssWall || 0).toFixed(1)].join('\t'));
    }

console.log('\n### H9 verification tail: calls after the first successful edit');
console.log(['harness', 'epoch', 'form', 'firstEditIdx', 'callsAfter', 'calls', 'tailShare'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code'])
  for (const [epoch, forms] of [['A', ['native', 'pipe']], ['B', ['native', 'tab']], ['C', ['native', 'tab', 'none', 'pipe']]])
    for (const form of forms) {
      const c = cellRows(R, { epoch, harness, form }).filter(r => r.firstEditIdx != null); if (!c.length) continue;
      console.log([harness, epoch, form, M(c, r => r.firstEditIdx).toFixed(1), M(c, r => r.callsAfterFirstEdit).toFixed(1),
        M(c, r => r.calls).toFixed(1), pct(M(c, r => r.callsAfterFirstEdit), M(c, r => r.calls))].join('\t'));
    }

console.log('\n### H10 claude-code delegation: paired cost on rollouts where NEITHER arm delegated');
for (const [epoch, form] of [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']]) {
  const prs = pairTasks(epoch, 'claude-code', form);
  const all = [], nod = [];
  for (const { t, S, N } of prs) {
    all.push([M(S, r => r.totalUsd) - M(N, r => r.totalUsd), M(N, r => r.totalUsd)]);
    const S0 = S.filter(r => (r.delegates || 0) === 0), N0 = N.filter(r => (r.delegates || 0) === 0);
    if (S0.length && N0.length) nod.push([M(S0, r => r.realizedUsd) - M(N0, r => r.realizedUsd), M(N0, r => r.realizedUsd), t]);
  }
  const dA = mean(all.map(x => x[0])), bA = mean(all.map(x => x[1]));
  const dN = mean(nod.map(x => x[0])), bN = mean(nod.map(x => x[1]));
  const ci = bootCI(nod.map(x => x[0]));
  console.log(`epoch ${epoch}: inclusive all tasks ${pct(dA, bA)} (n=${all.length}); non-delegating-both main-only ${pct(dN, bN)} (n=${nod.length}) CI [${pct(ci[0], bN)},${pct(ci[1], bN)}]`);
  const sw = cellRows(R, { epoch, harness: 'claude-code', form }), na = cellRows(R, { epoch, harness: 'claude-code', form: 'native' });
  console.log(`   delegating rollouts: sweet ${sw.filter(r => r.delegates > 0).length}/${sw.length}, native ${na.filter(r => r.delegates > 0).length}/${na.length};`
    + ` sidechain $/rollout sweet ${M(sw, r => r.sidechainUsd).toFixed(6)} native ${M(na, r => r.sidechainUsd).toFixed(6)}`);
}

console.log('\n### H11 newly-numbered search surfaces — extra gutter tokens and their price (epoch C sweet TAB)');
for (const harness of ['codex', 'opencode', 'claude-code']) {
  const cC = cen.find(x => x.harness === harness && x.epoch === 'C' && x.form === 'tab');
  const cB = cen.find(x => x.harness === harness && x.epoch === 'B' && x.form === 'tab');
  const c = cellRows(R, { epoch: 'C', harness, form: 'tab' });
  const linesPerRollout = cC.gutLinesSearch / cC.n;
  const tok = linesPerRollout * 1.45;
  const T = M(c, r => r.turns);
  const price = tok * P.in / 1e6 + tok * (T / 2) * P.cache / 1e6;
  console.log(`${harness}: epoch B search lines numbered ${cB ? (cB.gutLinesSearch / (cB.gutLinesSearch + cB.rawLinesSearch) * 100).toFixed(1) : '-'}%, `
    + `epoch C ${(cC.gutLinesSearch / (cC.gutLinesSearch + cC.rawLinesSearch) * 100).toFixed(1)}%; `
    + `${linesPerRollout.toFixed(0)} numbered search lines/rollout = ${tok.toFixed(0)} gutter tokens ≈ $${price.toFixed(6)}/rollout `
    + `(${pct(price, M(c, r => r.idealUsd))} of the sweet arm)`);
}

console.log('\n### cross-harness absolute gap, epoch C native arm');
console.log(['harness', '$ideal', '$incl', 'turns', 'firstTurnIn', 'ctxInt', 'out', 'toolBytes', 'calls', 'sidechain$'].join('\t'));
for (const harness of ['codex', 'opencode', 'claude-code']) {
  const c = cellRows(R, { epoch: 'C', harness, form: 'native' });
  console.log([harness, M(c, r => r.idealUsd).toFixed(6), M(c, r => r.totalUsd).toFixed(6), M(c, r => r.turns).toFixed(1),
    M(c, r => r.firstTurnIn).toFixed(0), M(c, r => r.ctxIntegral).toFixed(0), M(c, r => r.tokOut).toFixed(0),
    M(c, r => r.toolBytes).toFixed(0), M(c, r => r.calls).toFixed(1), M(c, r => r.sidechainUsd).toFixed(6)].join('\t'));
}
