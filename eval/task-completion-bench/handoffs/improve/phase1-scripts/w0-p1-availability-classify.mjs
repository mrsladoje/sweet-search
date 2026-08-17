#!/usr/bin/env node
// SLATE-B W0 gate — P1: RECLASSIFY the pinned-source availability probe.
//
// The raw sweep returned SOURCE for 14 of 14 tasks, which is too clean to believe.
// Every image carries a Python toolchain — roughly 1,500 .py and 1,450 .pyc files —
// whatever the task's own language is. The sweep's classifier summed ALL source
// extensions, so that constant baseline alone cleared its threshold and every task
// looked indexable. That error flatters P1, which is the direction a gate must never
// fail in silently.
//
// This reclassifies from the SAVED probe output ($0, no docker) by counting only the
// extensions that belong to each task's declared `language`. The question P1 actually
// needs answered is not "is there any source in this image" but "is THIS task's
// dependency ecosystem readable as source".
//
// Usage: node w0-p1-availability-classify.mjs   (reads /root/w0-p1-availability.json)
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const AVAIL = process.env.AVAIL || '/root/w0-p1-availability.json';
const specs = JSON.parse(readFileSync(path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json'), 'utf8'));
const langOf = new Map(specs.map(t => [t.instance_id, t.language]));

// Extensions that carry READABLE dependency source for each ecosystem, and the
// compiled artefact that would replace it. A language whose deps arrive as the second
// kind needs a decompiler or per-ecosystem extractor — ss-deps cannot just walk it.
// Keys are the EXACT values of the task file's `language` field — checked against
// sorted({t.language}) rather than guessed, because a key that does not match silently
// becomes UNPROBED and quietly drops a task from the denominator.
// Observed set: cpp csharp dart elixir java js lua ocaml php python r swift ts
const ECO = {
  python: { src: ['py'], bin: ['pyc'] },
  js: { src: ['js', 'mjs', 'cjs'], bin: [] },
  ts: { src: ['ts', 'js', 'mjs', 'cjs'], bin: [] },
  ocaml: { src: ['ml', 'mli'], bin: ['cmo', 'cmx'] },
  dart: { src: ['dart'], bin: [] },
  elixir: { src: ['ex', 'exs'], bin: ['beam'] },
  erlang: { src: ['erl'], bin: ['beam'] },
  java: { src: ['java'], bin: ['jar', 'class'] },
  scala: { src: ['scala'], bin: ['jar', 'class'] },
  kotlin: { src: ['kt'], bin: ['jar', 'class'] },
  swift: { src: ['swift'], bin: [] },
  lua: { src: ['lua'], bin: [] },
  r: { src: ['R', 'r'], bin: ['rdb', 'rdx'] },
  ruby: { src: ['rb'], bin: [] },
  php: { src: ['php'], bin: [] },
  go: { src: ['go'], bin: [] },
  rust: { src: ['rs'], bin: [] },
  csharp: { src: [], bin: ['dll', 'nupkg'] },
  cpp: { src: [], bin: [] },     // headers ARE the interface; not covered by this probe
};

const rows = JSON.parse(readFileSync(AVAIL, 'utf8'));
// Fail loudly on a language this map does not know, instead of scoring it UNPROBED and
// letting it vanish from the count.
const unknown = [...new Set(rows.map(r => langOf.get(r.id)).filter(l => l && !(l in ECO)))];
if (unknown.length) {
  console.error(`[classify] no ecosystem entry for: ${unknown.join(', ')} — add it before trusting this map`);
  process.exit(1);
}
const out = [];
for (const r of rows) {
  const lang = langOf.get(r.id) || '?';
  const eco = ECO[lang] || { src: [], bin: [] };
  const get = (kind, ext) => r.byExt?.[`${kind}.${ext}`] || 0;
  const langSrc = eco.src.reduce((a, e) => a + get('SRC', e), 0);
  const langBin = eco.bin.reduce((a, e) => a + get('BIN', e), 0);
  const pyBaseline = get('SRC', 'py');   // the toolchain that contaminated the sweep

  let verdict;
  if (!eco.src.length && !eco.bin.length) verdict = 'UNPROBED';         // probe has no view of this ecosystem
  else if (langSrc >= 50) verdict = 'SOURCE';
  else if (langBin > 0) verdict = 'BINARY';
  else verdict = 'ABSENT';
  // A Python task cannot be separated from the Python toolchain by this probe: its own
  // deps and the baseline share an extension. Flag it rather than pretend otherwise.
  const caveat = (lang === 'python' && verdict === 'SOURCE') ? ' (incl. toolchain baseline)' : '';
  out.push({ id: r.id, lang, verdict, langSrc, langBin, pyBaseline, caveat });
}

console.log('P1 availability, reclassified by the task\'s OWN ecosystem\n');
console.log('task'.padEnd(42) + 'lang'.padEnd(12) + 'verdict'.padEnd(10) + 'own-src  own-bin   py-baseline');
for (const o of out.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.lang.localeCompare(b.lang))) {
  console.log(o.id.padEnd(42) + o.lang.padEnd(12) + o.verdict.padEnd(10)
    + String(o.langSrc).padStart(7) + String(o.langBin).padStart(9) + String(o.pyBaseline).padStart(14) + o.caveat);
}
console.log('\n=== map ===');
for (const v of ['SOURCE', 'BINARY', 'ABSENT', 'UNPROBED']) {
  const h = out.filter(o => o.verdict === v);
  if (h.length) console.log(`${v.padEnd(9)} ${h.length}: ${h.map(x => `${x.id} (${x.lang})`).join(', ')}`);
}
const s = out.filter(o => o.verdict === 'SOURCE').length;
console.log(`\nss-deps could walk dependency SOURCE for ${s}/${out.length} tasks.`);
console.log(`raw sweep claimed 14/14 — the difference is the Python toolchain baseline it counted as task dependencies.`);
