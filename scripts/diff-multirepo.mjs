#!/usr/bin/env node
/**
 * Diff per-query multirepo results between two artifacts.
 *
 * Usage: node scripts/diff-multirepo.mjs <fileA.json> <fileB.json>
 */
import fs from 'node:fs';

const [a, b] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a, 'utf8'));
const B = JSON.parse(fs.readFileSync(b, 'utf8'));
const idxA = new Map(A.results.map(r => [r.query_id, r]));

const flipsP1F = []; // PASS@1 -> FAIL@1
const flipsF1P = []; // FAIL@1 -> PASS@1
const rrUp = [], rrDown = [];

for (const rB of B.results) {
  const rA = idxA.get(rB.query_id);
  if (!rA) continue;
  if (rA.success1 === 1 && rB.success1 === 0) flipsP1F.push({ id: rB.query_id, repo: rB.repo, query: rB.query, before: rA.top[0], after: rB.top[0] });
  if (rA.success1 === 0 && rB.success1 === 1) flipsF1P.push({ id: rB.query_id, repo: rB.repo, query: rB.query, before: rA.top[0], after: rB.top[0] });
  const drr = rB.rr10 - rA.rr10;
  if (drr < -0.05) rrDown.push({ id: rB.query_id, repo: rB.repo, query: rB.query, drr: drr.toFixed(3), before_rr: rA.rr10.toFixed(3), after_rr: rB.rr10.toFixed(3), before_top1: rA.top[0]?.file, after_top1: rB.top[0]?.file });
  if (drr > 0.05) rrUp.push({ id: rB.query_id, repo: rB.repo, query: rB.query, drr: drr.toFixed(3) });
}

console.log(`A=${A.summary.tag} (mrr10=${A.summary.mrr10.toFixed(3)}, s1=${A.summary.s1.toFixed(3)})`);
console.log(`B=${B.summary.tag} (mrr10=${B.summary.mrr10.toFixed(3)}, s1=${B.summary.s1.toFixed(3)})`);
console.log(`\nA→B success@1 flips:`);
console.log(`  PASS→FAIL: ${flipsP1F.length}`);
console.log(`  FAIL→PASS: ${flipsF1P.length}`);
console.log(`\nA→B RR@10 changes (>5pp delta):`);
console.log(`  Improved: ${rrUp.length}`);
console.log(`  Regressed: ${rrDown.length}`);

console.log(`\n=== Top RR regressions (most damaging first) ===`);
rrDown.sort((a, b) => parseFloat(a.drr) - parseFloat(b.drr));
for (const r of rrDown.slice(0, 30)) {
  console.log(`  [${r.repo}] ${r.id} drr=${r.drr}  rrA=${r.before_rr} rrB=${r.after_rr}`);
  console.log(`    Q: ${r.query}`);
  console.log(`    before top1: ${r.before_top1}`);
  console.log(`    after  top1: ${r.after_top1}`);
}

console.log(`\n=== PASS@1 → FAIL@1 (most concerning) ===`);
for (const r of flipsP1F.slice(0, 30)) {
  console.log(`  [${r.repo}] ${r.id} Q: ${r.query}`);
  console.log(`    before top1 file=${r.before?.file} name=${r.before?.name}`);
  console.log(`    after  top1 file=${r.after?.file} name=${r.after?.name}`);
}
