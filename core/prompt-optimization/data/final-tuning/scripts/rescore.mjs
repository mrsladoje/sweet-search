#!/usr/bin/env node
// rescore.mjs <cell> <tag> [--probes <file>] — re-judge ACCURACY of a finished run from its saved
// answers (captures/sweet.<id>.json) with the OpenRouter DeepSeek judge route
// (SS_JUDGE_DEEPSEEK_VIA_OPENROUTER=1), so every comparison after the 2026-10-01 00:50 DeepSeek
// balance exhaustion uses ONE grader. Writes <run dir>/rescore-or.jsonl {id, score, judgesOk}.
// Resumable. Same panel + median as the runner (judgePanelScore, JUDGE_PANEL).
process.env.SS_JUDGE_DEEPSEEK_VIA_OPENROUTER = '1';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const { judgePanelScore, JUDGE_PANEL } = await import(path.join(WT, 'core/prompt-optimization/sweep/gepa-evaluate.mjs'));
const [cell, tag] = process.argv.slice(2);
const pf = (() => { const i = process.argv.indexOf('--probes'); return i >= 0 ? process.argv[i + 1] : null; })();
const files = pf ? [pf] : ['core/prompt-optimization/data/frozen/p7-vault-probes-v60.json', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'];
const probes = new Map(files.flatMap(f => { const raw = JSON.parse(fs.readFileSync(path.resolve(WT, f), 'utf8')); return (Array.isArray(raw) ? raw : raw.probes); }).map(p => [p.id, p]));
const dir = path.join(WT, 'core/prompt-optimization/data/results', `r282-${cell}-${tag}`);
const out = path.join(dir, 'rescore-or.jsonl');
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.judgesOk?.length === 3).map(r => r.id) : []);
const rows = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !r.error && r.exitCode === 0 && !done.has(r.id));
let i = 0, n = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < rows.length) {
    const r = rows[i++];
    const cap = JSON.parse(fs.readFileSync(path.join(dir, 'captures', `${r.arm}.${r.id}.json`), 'utf8'));
    const j = await judgePanelScore({ probe: probes.get(r.id), answer: cap.answer, panel: JUDGE_PANEL }).catch(e => null);
    fs.appendFileSync(out, JSON.stringify({ id: r.id, arm: r.arm, score: j?.score ?? null, judgesOk: j ? j.judges.filter(x => !x.isError).map(x => x.lineage) : [] }) + '\n');
    n++;
  }
}));
console.log(`${cell} ${tag}: rescored ${n} (skipped ${done.size} already complete)`);
