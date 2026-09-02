#!/usr/bin/env node
// c06_moq_recount.mjs — verify c06 (runtime execution-path certificate) against the recorded moq cells.
// Input: forensics/scripts-wrongfix-facts/data/cells.json (agent patches only; never gold).
// Re-derives: 16 losers / 8 sweet losers per harness; how many losers touched Match.cs or
// ExpressionComparer.cs (the census class behind "13/16"); how many of those also edited
// MethodExpectation.cs (the deciding method); the strict off-path count; per-harness ceiling.
//   node c06_moq_recount.mjs ../forensics/scripts-wrongfix-facts/data/cells.json
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const REPAIRED = new Set(['accenture__sfmc-devtools-1974','aio-libs__aiohttp-8038','awslabs__aws-embedded-metrics-node-21','devlooped__moq-1262','protofire__solhint-224']);
const cells = j.cells.filter(c => !(c.harness === 'opencode' && c.arm === 'sweet' && REPAIRED.has(c.taskId) && c.run.startsWith('fp-')));
const moq = cells.filter(c => c.taskId === 'devlooped__moq-1262');
const losers = moq.filter(c => !c.resolved);
const tag = c => `${c.harness[0]}${c.harness === 'claude-code' ? 'c' : ''}:${c.arm[0]}${c.rep}`;
console.log(`moq cells=${moq.length} solved=${moq.length - losers.length} losers=${losers.length}`);
const H = ['codex', 'opencode', 'claude-code'];
console.log('sweet losers per harness:', H.map(h => `${h}=${losers.filter(c => c.arm === 'sweet' && c.harness === h).length}`).join(' '));
let matchOrEc = [], alsoMe = [], strictOff = [], meOnlySide = [];
for (const c of losers) {
  const f = (c.patchFilesList || []).join(',');
  const me = /MethodExpectation\.cs/.test(f), mt = /Match\.cs/.test(f), ec = /ExpressionComparer\.cs/.test(f);
  if (mt || ec) { matchOrEc.push(tag(c)); if (me) alsoMe.push(tag(c)); }
  if (mt && !ec && !me) strictOff.push(tag(c));          // only Match.cs (+ files not on the equality path)
  if (me) meOnlySide.push(tag(c));
}
console.log(`losers touching Match.cs or ExpressionComparer.cs (census class "13/16"): ${matchOrEc.length} [${matchOrEc.join(' ')}]`);
console.log(`  of those also editing MethodExpectation.cs (the deciding method): ${alsoMe.length} [${alsoMe.join(' ')}]`);
console.log(`losers editing MethodExpectation.cs at all: ${meOnlySide.length} [${meOnlySide.join(' ')}]`);
console.log(`losers whose ONLY equality-path file is Match.cs (strictly off the override path): ${strictOff.length} [${strictOff.join(' ')}]`);
// Ceiling against the fresh-pool cells (brief §1): sweet/native solved per harness.
const cell = { codex: [39, 41], opencode: [41, 41], 'claude-code': [40, 43] };
for (const h of H) {
  const gain = losers.filter(c => c.arm === 'sweet' && c.harness === h).length;
  const [s, n] = cell[h];
  console.log(`${h}: sweet ${s}/66 -> ${s + gain}/66 at 100% flip vs native ${n}/66; delta ${s + gain - n >= 0 ? '+' : ''}${s + gain - n} (bar +-6); at 2/4 rate +${(gain / 2).toFixed(1)}`);
}
