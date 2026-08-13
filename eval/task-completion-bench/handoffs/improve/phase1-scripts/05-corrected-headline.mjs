// The screen-v3 headline recomputed on the REPAIRED sidechain-inclusive column, under the
// pre-registered cost definition (RESULTS-2026-08-13 §9): main-only + repaired sidechains,
// `pages` tax of $0.035160 removed from native only, with the degenerate sensitivity beside it.
import { readFileSync } from 'node:fs';
const rows = JSON.parse(readFileSync('/tmp/rows-sidechain-repaired-screenv3.json', 'utf8'));
const PAGES_TAX = 0.035160;

const view = (filter, label) => {
  const out = {};
  for (const arm of ['native', 'sweet']) {
    const rs = rows.filter(r => r.arm === arm && filter(r));
    const main = rs.reduce((a, r) => a + (r.idealCostMainOnlyUsd ?? 0), 0);
    const band = {};
    for (const k of ['low', 'mid', 'high']) band[k] = rs.reduce((a, r) => a + (r[`sidechainIdeal_${k}`] || 0), 0);
    out[arm] = { n: rs.length, main, band };
  }
  const line = (k) => {
    const nat = out.native.main - (label.includes('no tax') ? 0 : PAGES_TAX) + out.native.band[k];
    const swe = out.sweet.main + out.sweet.band[k];
    return `${k.toUpperCase().padEnd(5)} native $${nat.toFixed(6)}  sweet $${swe.toFixed(6)}  = ${((swe / nat - 1) * 100).toFixed(2)}%`;
  };
  console.log(`\n-- ${label} (native n=${out.native.n}, sweet n=${out.sweet.n}) --`);
  console.log(`   main-only: native $${(out.native.main - PAGES_TAX).toFixed(6)} (tax removed)  sweet $${out.sweet.main.toFixed(6)}  = ${((out.sweet.main / (out.native.main - PAGES_TAX) - 1) * 100).toFixed(2)}%   <- published headline basis`);
  for (const k of ['low', 'mid', 'high']) console.log('   ' + line(k));
};

view(() => true, 'ALL 32 rollouts per arm, sidechain-inclusive, pages tax removed');
view(r => !r.degenerate, 'degenerate rollouts EXCLUDED (declared sensitivity)');

console.log('\n-- delegation asymmetry --');
for (const arm of ['native', 'sweet']) {
  const rs = rows.filter(r => r.arm === arm);
  const d = rs.filter(r => (r.sidechainCountFixed || 0) > 0);
  console.log(`   ${arm}: ${d.length}/${rs.length} rollouts delegated | sidechain requests known ${d.reduce((a, r) => a + (r.sidechainReqKnown || 0), 0)}, imputed ${d.reduce((a, r) => a + (r.sidechainReqImputed || 0), 0)}`);
}
console.log('\n-- degenerate split --');
for (const arm of ['native', 'sweet']) {
  const rs = rows.filter(r => r.arm === arm && r.degenerate);
  console.log(`   ${arm}: ${rs.length} flagged -> ${rs.map(r => `${r.taskId}/r${r.rep}`).join(', ') || 'none'}`);
}
