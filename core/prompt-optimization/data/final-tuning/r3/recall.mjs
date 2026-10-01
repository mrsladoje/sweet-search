#!/usr/bin/env node
// r3 secondary metrics (r3-PREREG.md): file recall and symbol recall of each answer, per arm,
// aggregates only (safe for held-out). Positive questions only; negatives reported as the share of
// answers that say "No match found".
//   node r3/recall.mjs <cell> <tag>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const [cell, tag] = process.argv.slice(2);
const probes = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'r3-probes.json'), 'utf8')).probes.map(p => [p.id, p]));
const dir = path.join(WT, 'core/prompt-optimization/data/results', `r282-${cell}-${tag}`);
const rows = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0);
const last = s => String(s).split(/::|\.|#|\//).pop().replace(/[()]/g, '');
const agg = {};
for (const r of rows) {
  const p = probes.get(r.id); if (!p) continue;
  const ans = JSON.parse(fs.readFileSync(path.join(dir, 'captures', `${r.arm}.${r.id}.json`), 'utf8')).answer || '';
  const a = (agg[r.arm] ??= { pos: 0, fileRecall: 0, symRecall: 0, neg: 0, negSaysNone: 0 });
  if (p.expectedNoMatch) { a.neg++; if (/no match found/i.test(ans)) a.negSaysNone++; continue; }
  a.pos++;
  a.fileRecall += p.expectedFiles.filter(f => ans.includes(path.basename(f))).length / p.expectedFiles.length;
  a.symRecall += p.expectedSymbols.length ? p.expectedSymbols.filter(s => ans.includes(last(s))).length / p.expectedSymbols.length : 1;
}
for (const [arm, a] of Object.entries(agg)) console.log(`${cell} ${tag} ${arm}: positives ${a.pos} fileRecall ${(a.fileRecall / a.pos).toFixed(3)} symbolRecall ${(a.symRecall / a.pos).toFixed(3)} | negatives ${a.neg} "No match found" ${(a.negSaysNone / Math.max(1, a.neg)).toFixed(3)}`);
