#!/usr/bin/env node
/**
 * handcheck-opencode — print chosen rollouts from the normalised trace next to an INDEPENDENT raw read of the
 * opencode store (sqlite3 CLI + JSON1, no shared parsing code) and the runner row. Read-only.
 *   node handcheck-opencode.mjs <cell> <arm>:<id> [<arm>:<id> ...]   [--sessions <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const args = process.argv.slice(2);
const cell = args[0]; const picks = args.slice(1).filter(a => !a.startsWith('--'));
const sessRoot = args.includes('--sessions') ? args[args.indexOf('--sessions') + 1] : path.join(os.homedir(), '.ss-eval/r282');
const PRIV = '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/results';
const rows = fs.readFileSync(path.join(PRIV, `r282-${cell}`, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const tr = fs.readFileSync(path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace', `${cell}.trace.jsonl`), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
const sql = (arm, q) => {
  const d = path.join(tmp, arm); if (!fs.existsSync(d)) { fs.mkdirSync(d); for (const e of ['', '-wal', '-shm']) { const s = path.join(sessRoot, cell, `oc-data-${arm}`, `opencode.db${e}`); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(d, `opencode.db${e}`)); } }
  return execFileSync('sqlite3', ['-readonly', '-separator', '\t', path.join(d, 'opencode.db'), q], { encoding: 'utf8', maxBuffer: 1 << 28 }).trimEnd();
};
const price = cell === 'oc-dsflash41' ? { in: 0.15, cache: 0.003, out: 0.6 } : { in: 2, cache: 0.1, out: 10 };
for (const pick of picks) {
  const [arm, id] = pick.split(':');
  const row = rows.find(r => r.arm === arm && r.id === id);
  const roll = tr.find(r => r.type === 'rollout' && r.arm === arm && r.id === id);
  const reqs = tr.filter(r => r.type !== 'rollout' && r.arm === arm && r.id === id).sort((a, b) => a.req - b.req);
  console.log(`\n================ ${cell} ${arm} ${id}  session ${roll.sessionId}`);
  console.log(`runner row: turns=${row.usage.turns} calls=${row.calls} costRealizedUsd=${row.costRealizedUsd} toolKinds=${JSON.stringify(row.toolKinds)} wallMs=${row.wallMs}`);
  console.log(`trace     : requests=${roll.requests} calls=${roll.calls} costUsdSum=${roll.costUsdSum} reconDiffPct=${roll.reconDiffPct} prefixTokens=${roll.prefixTokens}`);
  // independent raw read: one line per step-finish / tool part in part-id order
  const raw = sql(arm, `select json_extract(data,'$.type'), json_extract(data,'$.tokens.input'), json_extract(data,'$.tokens.cache.read'), json_extract(data,'$.tokens.cache.write'), json_extract(data,'$.tokens.output'), json_extract(data,'$.tokens.reasoning'), json_extract(data,'$.tool'), substr(replace(coalesce(json_extract(data,'$.state.input.command'), json_extract(data,'$.state.input.filePath'), json_extract(data,'$.state.input.pattern'),''),char(10),' '),1,70), length(coalesce(json_extract(data,'$.state.output'), json_extract(data,'$.state.error'),'')) from part where session_id='${roll.sessionId}' and json_extract(data,'$.type') in ('step-finish','tool') order by id`).split('\n').map(l => l.split('\t'));
  const steps = raw.filter(r => r[0] === 'step-finish'); const tools = raw.filter(r => r[0] === 'tool');
  let ok = steps.length === reqs.length && tools.length === reqs.reduce((a, r) => a + r.calls.length, 0);
  let rawCost = 0;
  steps.forEach((s, i) => {
    const [, inp, cr, cw, out, rea] = s.map(Number); const t = reqs[i].tok;
    const same = t.inUncached === inp && t.cacheRead === cr && t.cacheWrite === cw && t.out === out + rea && t.reasoning === rea;
    if (!same) ok = false;
    const c = (inp * price.in + cw * price.in * 1.25 + cr * price.cache + (out + rea) * price.out) / 1e6; rawCost += c;
    console.log(`  req ${i}: raw in=${inp} cacheR=${cr} cacheW=${cw} out=${out} reas=${rea} | trace uncached=${t.inUncached} cacheR=${t.cacheRead} out(incl reas)=${t.out} reas=${t.reasoning} inTotal=${t.inTotal} $${reqs[i].costUsd.toFixed(6)} ${same ? 'OK' : 'DIFF'}`);
    reqs[i].calls.forEach(c2 => console.log(`      call ${c2.tool}${c2.sub ? '/' + c2.sub : ''} argChars=${c2.argChars} resultChars=${c2.resultChars}  "${c2.argText.replace(/\n/g, ' ').slice(0, 70)}"`));
  });
  const flat = reqs.flatMap(r => r.calls);
  tools.forEach((t, i) => { const c2 = flat[i]; const tn = t[6]; const same = Number(t[8]) === c2.resultChars && (tn === c2.tool || (tn === 'bash' && (c2.tool === 'bash' || c2.tool.startsWith('ss-')))); if (!same) { ok = false; console.log(`  TOOL DIFF #${i}: raw ${tn} len ${t[8]} vs trace ${c2.tool} len ${c2.resultChars}`); } });
  console.log(`  raw tool parts (tool:cmd:outLen): ` + tools.map(t => `${t[6]}:${(t[7] || '').slice(0, 40)}:${t[8]}`).join(' | '));
  console.log(`  independent raw cost ${rawCost.toFixed(6)} vs runner ${row.costRealizedUsd} (diff ${(((rawCost - row.costRealizedUsd) / row.costRealizedUsd) * 100).toFixed(3)}%)  => ${ok ? 'MATCH' : 'MISMATCH'}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
