#!/usr/bin/env node
// p1-codexcap.mjs — direct census of codex's tool-output cap using codex's OWN
// "Original token count: N" field and the "Warning: truncated output" marker.
import fs from 'node:fs';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function outputs(file) {
  const out = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const l of txt.split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t !== 'function_call_output' && t !== 'custom_tool_call_output') continue;
    let body = p.output; if (typeof body !== 'string') body = JSON.stringify(body || '');
    try { const j = JSON.parse(body); if (j && typeof j.output === 'string') body = j.output; } catch {}
    out.push(body);
  }
  return out;
}

const cells = [
  ['A native', r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'native'],
  ['A sweet',  r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'sweet'],
  ['B native', r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'native'],
  ['B sweet',  r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'sweet'],
  ['C native', r => r.harness === 'codex' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'native'],
  ['C sweetTAB', r => r.harness === 'codex' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'sweet'],
];
console.log('cell | rollouts | outputs | withOrigTok | truncMarker | trunc/rollout | rolloutsWithTrunc | producedTok/rollout | deliveredTok/rollout(cap=2500) | deletedTok/rollout | deleted% | bytes/rollout | B/tok(delivered)');
const CAP = 2500;
const store = {};
for (const [lbl, pred] of cells) {
  const rs = rows.filter(pred);
  let nR = 0, nOut = 0, withTok = 0, truncN = 0, rollTrunc = 0, produced = 0, delivered = 0, bytes = 0, deliveredBytes = 0;
  const maxTruncTok = []; const minTruncTok = [];
  let largestUntrunc = 0, smallestTrunc = 1e9;
  for (const r of rs) {
    if (!r.transcript || !fs.existsSync(r.transcript)) continue;
    nR++; let anyT = false;
    for (const body of outputs(r.transcript)) {
      nOut++; bytes += body.length;
      const m = body.match(/Original token count:\s*(\d+)/);
      const isT = /Warning: truncated output/.test(body);
      if (isT) { truncN++; anyT = true; }
      if (!m) continue;
      withTok++;
      const n = +m[1];
      produced += n;
      delivered += isT ? Math.min(n, CAP) : n;
      if (isT) { if (n < smallestTrunc) smallestTrunc = n; } else { if (n > largestUntrunc) largestUntrunc = n; }
    }
    if (anyT) rollTrunc++;
  }
  const del = produced - delivered;
  store[lbl] = { nR, produced: produced / nR, delivered: delivered / nR, deleted: del / nR };
  console.log(`${lbl} | ${nR} | ${nOut} | ${withTok} | ${truncN} | ${(truncN / nR).toFixed(2)} | ${rollTrunc}/${nR} | ${Math.round(produced / nR)} | ${Math.round(delivered / nR)} | ${Math.round(del / nR)} | ${(100 * del / produced).toFixed(1)}% | ${Math.round(bytes / nR)} | -`);
  console.log(`     largest UNtruncated original token count=${largestUntrunc}; smallest TRUNCATED=${smallestTrunc === 1e9 ? 'n/a' : smallestTrunc}`);
}

console.log('\n--- the 02 claim: "deletes ~10,505 of native 26,302 (40%) and ~2,357 of sweet 15,558 (15%)" ---');
console.log(`  my direct census, epoch C: native produced=${Math.round(store['C native'].produced)} deleted=${Math.round(store['C native'].deleted)} (${(100 * store['C native'].deleted / store['C native'].produced).toFixed(1)}%)`);
console.log(`                              sweet  produced=${Math.round(store['C sweetTAB'].produced)} deleted=${Math.round(store['C sweetTAB'].deleted)} (${(100 * store['C sweetTAB'].deleted / store['C sweetTAB'].produced).toFixed(1)}%)`);
console.log('  02 derived "reached the context" by subtraction newIn-firstTurn-output; my figure is codex own counts minus the cap.');

// the subtraction 02 used
for (const [lbl, pred] of cells) {
  const rs = rows.filter(pred).filter(r => r.transcript && fs.existsSync(r.transcript));
  if (!rs.length) continue;
  const sub = mean(rs.map(r => r.ingestTok - r.firstIn - r.outTok));
  console.log(`  ${lbl}: 02's subtraction (ingestTok - firstTurn - output) = ${Math.round(sub)} tok/rollout`);
}

// epoch A replay: what the epoch B/C cap would have deleted from epoch A's own outputs
console.log('\n--- epoch A counterfactual inputs ---');
for (const [lbl, pred] of [['A native', cells[0][1]], ['A sweet', cells[1][1]]]) {
  const rs = rows.filter(pred).filter(r => r.transcript && fs.existsSync(r.transcript));
  let overBytes = 0, overTokEst = 0, nR = 0, nOver = 0, totBytes = 0;
  for (const r of rs) {
    nR++;
    for (const body of outputs(r.transcript)) {
      totBytes += body.length;
      if (body.length > 10214) { overBytes += body.length - 10214; nOver++; }
    }
  }
  console.log(`  ${lbl}: rollouts=${nR} outputs over 10,214B=${nOver} over-cap bytes/rollout=${Math.round(overBytes / nR)} total tool bytes/rollout=${Math.round(totBytes / nR)}`);
}
