#!/usr/bin/env node
// Reprice a claude-code run from OpenRouter's OWN billing record.
//
// WHY. Claude Code reaches luna through OpenRouter's Anthropic-compatible skin. In the
// SIDECHAIN (subagent) transcripts that skin writes a `usage` object that is structurally
// present but all zeros/nulls, so per-request usage is unmeasurable there and
// addSidechainCostsChecked correctly nulls the row's inclusive cost rather than publish an
// under-count. But every one of those assistant records carries `message.id` = an OpenRouter
// GENERATION ID, and /api/v1/generation?id=<id> returns the authoritative billed cost and the
// native token split. So the number is not lost, it is one lookup away — and it is the actual
// bill, not a reconstruction.
//
// Arm-symmetric by construction: both arms are priced the same way from the same source.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const RUN = process.argv[2];
const BENCH = '/root/sweet-search-private/eval/task-completion-bench';
const BASE = path.join(BENCH, 'results', RUN, 'agent-state');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('no OPENROUTER_API_KEY'); process.exit(2); }

const idsOf = (file) => {
  const out = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let r; try { r = JSON.parse(t); } catch { continue; }
    if (r.message?.role === 'assistant' && typeof r.message.id === 'string' && r.message.id.startsWith('gen-')) out.add(r.message.id);
  }
  return out;
};

// cell = <task>-<arm>; rep comes from the project slug `-r<rep>-<n>`
const cells = new Map();
for (const dir of execSync(`find ${BASE} -mindepth 1 -maxdepth 1 -type d`).toString().trim().split('\n').filter(Boolean)) {
  const m = /\/(.+)-(native|sweet)$/.exec(dir); if (!m) continue;
  const [, task, arm] = m;
  const projects = path.join(dir, 'claude-home', 'projects');
  let slugs = []; try { slugs = fs.readdirSync(projects); } catch { continue; }
  for (const slug of slugs) {
    const rep = (/-r(\d+)-\d+$/.exec(slug) || [])[1];
    if (rep === undefined) continue;
    const sdir = path.join(projects, slug);
    const key = `${task}|${arm}|${rep}`;
    if (!cells.has(key)) cells.set(key, { main: new Set(), side: new Set() });
    const c = cells.get(key);
    for (const f of fs.readdirSync(sdir)) {
      if (f.endsWith('.jsonl')) for (const id of idsOf(path.join(sdir, f))) c.main.add(id);
      const sub = path.join(sdir, f.replace(/\.jsonl$/, ''), 'subagents');
      if (fs.existsSync(sub)) for (const sf of fs.readdirSync(sub)) {
        if (sf.endsWith('.jsonl')) for (const id of idsOf(path.join(sub, sf))) c.side.add(id);
      }
    }
  }
}

const all = new Set();
for (const c of cells.values()) { for (const i of c.main) all.add(i); for (const i of c.side) all.add(i); }
console.error(`[reprice] ${cells.size} cells, ${all.size} unique generation ids`);

const price = new Map();
const list = [...all];
let done = 0, missing = 0;
for (let i = 0; i < list.length; i += 8) {
  const batch = list.slice(i, i + 8);
  const res = await Promise.all(batch.map(async id => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://openrouter.ai/api/v1/generation?id=${id}`, { headers: { Authorization: `Bearer ${KEY}` } });
        if (r.status === 429) { await new Promise(s => setTimeout(s, 1500 * (a + 1))); continue; }
        const j = await r.json();
        if (j?.data && typeof j.data.total_cost === 'number') return [id, j.data];
        return [id, null];
      } catch { await new Promise(s => setTimeout(s, 800 * (a + 1))); }
    }
    return [id, null];
  }));
  for (const [id, d] of res) { if (d) price.set(id, d); else missing++; }
  done += batch.length;
  if (done % 400 < 8) console.error(`[reprice]   ${done}/${list.length}`);
}
console.error(`[reprice] resolved ${price.size}/${list.size ?? list.length}, unresolved ${missing}`);

const sum = (set, f) => [...set].reduce((t, id) => t + (price.has(id) ? (f(price.get(id)) || 0) : 0), 0);
const rows = [];
for (const [key, c] of cells) {
  const [task, arm, rep] = key.split('|');
  const unresolved = [...c.main, ...c.side].filter(i => !price.has(i)).length;
  rows.push({
    task, arm, rep: +rep,
    mainRequests: c.main.size, delegatedRequests: c.side.size, unresolved,
    mainBilledUsd: +sum(c.main, d => d.total_cost).toFixed(6),
    delegatedBilledUsd: +sum(c.side, d => d.total_cost).toFixed(6),
    inclusiveBilledUsd: +(sum(c.main, d => d.total_cost) + sum(c.side, d => d.total_cost)).toFixed(6),
    nativePromptTokens: sum(c.main, d => d.native_tokens_prompt) + sum(c.side, d => d.native_tokens_prompt),
    nativeCachedTokens: sum(c.main, d => d.native_tokens_cached) + sum(c.side, d => d.native_tokens_cached),
    nativeCompletionTokens: sum(c.main, d => d.native_tokens_completion) + sum(c.side, d => d.native_tokens_completion),
  });
}
rows.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.rep - b.rep);
fs.writeFileSync(`/root/smoke20/${RUN}-openrouter-billed.json`, JSON.stringify(rows, null, 1) + '\n');
console.error(`[reprice] wrote /root/smoke20/${RUN}-openrouter-billed.json`);
for (const arm of ['native', 'sweet']) {
  const s = rows.filter(r => r.arm === arm);
  console.log(`${arm.padEnd(7)} rollouts=${s.length}  main=$${s.reduce((t, r) => t + r.mainBilledUsd, 0).toFixed(4)}`
    + `  delegated=$${s.reduce((t, r) => t + r.delegatedBilledUsd, 0).toFixed(4)}`
    + `  INCLUSIVE=$${s.reduce((t, r) => t + r.inclusiveBilledUsd, 0).toFixed(4)}`
    + `  delegatedRequests=${s.reduce((t, r) => t + r.delegatedRequests, 0)}`
    + `  unresolved=${s.reduce((t, r) => t + r.unresolved, 0)}`);
}
