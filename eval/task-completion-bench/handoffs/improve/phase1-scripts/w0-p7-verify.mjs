// Re-derive every quoted figure in W0-P7-GATE-RESULTS.md from the artifacts.
import { readFileSync } from 'node:fs';
const B = '/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve';
const N = JSON.parse(readFileSync(`${B}/p7-20260821/numbers.json`, 'utf8'));
const C = JSON.parse(readFileSync(`${B}/p7-20260821/census.json`, 'utf8')).perRollout;
const D = readFileSync(`${B}/p7-20260821/discriminability.txt`, 'utf8');
const doc = readFileSync(`${B}/W0-P7-GATE-RESULTS.md`, 'utf8');
let ok = 0, bad = 0;
const chk = (label, expected, present = null) => {
  const inDoc = present === null ? doc.includes(String(expected)) : present;
  if (inDoc) { ok++; } else { bad++; console.log(`  MISS  ${label}  expected=${expected}`); }
};
// headline table
for (const [h, key] of [['codex', 'sweet.codex'], ['opencode', 'sweet.opencode'], ['claude-code', 'sweet.claude-code'], ['all', 'sweet.ALL']]) {
  const a = N[key];
  chk(`${h} A`, `${a.A.toFixed(1)}%`); chk(`${h} Abp`, `${a.Abp.toFixed(1)}%`); chk(`${h} half`, `${a.half.toFixed(1)}%`);
  chk(`${h} tot`, `$${a.tot.toFixed(6)}`); chk(`${h} L`, `${a.L}/${a.n}`);
}
for (const [h, key] of [['codex', 'sweetNoDegen.codex'], ['opencode', 'sweetNoDegen.opencode'], ['claude-code', 'sweetNoDegen.claude-code'], ['all', 'sweetNoDegen.ALL']]) {
  const a = N[key]; chk(`noDegen ${h} A`, `${a.A.toFixed(1)}%`); chk(`noDegen ${h} half`, `${a.half.toFixed(1)}%`);
}
for (const [h, key] of [['codex', 'native.codex'], ['opencode', 'native.opencode'], ['claude-code', 'native.claude-code'], ['all', 'native.ALL']]) {
  const a = N[key]; chk(`native ${h} A`, `${a.A.toFixed(1)}%`); chk(`native ${h} L`, `${a.L}/${a.n}`);
}
// fumbles
for (const h of ['codex', 'opencode', 'claude-code']) for (const arm of ['sweet', 'native']) {
  const f = N[`fumble.${h}.${arm}`];
  chk(`fumble ${h}/${arm} cost`, `$${f.cost.toFixed(6)}`); chk(`fumble ${h}/${arm} pct`, `${f.pct.toFixed(1)}%`);
}
// meta
chk('rollouts', N.meta.rollouts); chk('gate0 pass', `${N.meta.gate0pass}/${N.meta.gate0pass}`);
chk('emptyPatch', N.meta.emptyPatch); chk('maxToolInput', N.meta.maxToolInputBytes.toLocaleString('en-US'));
chk('maxOutNonDegen', N.meta.maxOutTokNonDegen.toLocaleString('en-US')); chk('validated', N.meta.validated);
// derived claims
const sweetPost = C.filter(x => x.arm === 'sweet').reduce((a, b) => a + b.realAfter, 0);
const sweetTot = C.filter(x => x.arm === 'sweet').reduce((a, b) => a + b.totalReal, 0);
chk('post/all before L filter', `${(100 * sweetPost / sweetTot).toFixed(1)}%`);
const gapPct = (N['fumble.claude-code.sweet'].cost - N['fumble.claude-code.native'].cost);
chk('fumble sweet-native gap', `$${gapPct.toFixed(4)}`);
const ccDrop = (N['sweet.claude-code'].A - N['sweetNoDegen.claude-code'].A).toFixed(1);
chk('claude degen sensitivity', `${ccDrop}pp`);
const allDrop = (N['sweet.ALL'].A - N['sweetNoDegen.ALL'].A).toFixed(1);
chk('overall degen sensitivity', `${allDrop}pp`);
const codexRoom = (N['sweet.codex'].half - 15).toFixed(1);
chk('codex room over 15', `${codexRoom}pp`);
const nativeVsSweet = `${N['native.ALL'].A.toFixed(1)}%`; chk('native ALL vs sweet', nativeVsSweet);
// discriminability
const fg = D.match(/FALSE GREEN[^:]*: (\d+)/)[1]; chk('false greens', fg);
const green = D.match(/FULL visible suite: (\d+)/i)[1]; chk('green full', green);
const nd = D.match(/reject a wrong patch: (\d+)\/(\d+)/); chk('non-discriminable', `${nd[1]} of ${nd[2]}`);
chk('false-green share of greens', `${Math.round(100 * fg / green)}%`);
// per-task counts quoted
for (const [t, n] of [['codeception', '12/12'], ['bingo', '12/12'], ['dashbitco', '11/12'], ['dart', '10/12'], ['pytask', '8/12'], ['gradethis', '2/12'], ['akinsho', '1/12']]) {
  const m = new RegExp(`${t}[^\\n]*?\\s(\\d+)/(\\d+)\\s+NOT`).exec(D);
  chk(`task ${t}`, `\`${t}\` ${n}`, doc.includes(`\`${t}\` ${n}`) && m && `${m[1]}/${m[2]}` === n);
}
// degen rollouts
const dg = C.filter(x => x.degen);
chk('degen count', N.meta.degen); chk('degen cost native', `$${dg.find(x => x.arm === 'native').totalReal.toFixed(6)}`);
chk('degen cost sweet', `$${dg.find(x => x.arm === 'sweet').totalReal.toFixed(6)}`);
console.log(`\n${ok} checks ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
