/**
 * Shared pieces of the ss-grep allocation replay (docs/SUGGESTED_PLAN.md, Step 0): recorded
 * call parsing, probe loading with the dev / held-out discipline, the metrics, and the
 * probe-clustered paired bootstrap.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_DOSSIERS = path.join(REPO_ROOT, 'core/prompt-optimization/data/final-tuning/forensics/hard-dossiers');
export const DEFAULT_PROBE_FILES = [
  path.join(REPO_ROOT, 'core/prompt-optimization/data/final-tuning/r3/r3-probes.json'),
  path.join(REPO_ROOT, 'core/prompt-optimization/data/final-tuning/r3/r3-hard-probes.json'),
];
export const DEFAULT_REPOS = path.join(REPO_ROOT, 'eval/repos');
export const DEFAULT_OUT = path.join(REPO_ROOT, 'eval/grep-allocation-replay/out');
export const PERMITTED_SETS = new Set(['dev', 'dev-confirm']);

/** POSIX shell words, as Python's shlex.split (posix): in double quotes `\` escapes only `"` and `\`. */
export function shellWords(s) {
  const out = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      cur += s.slice(i + 1, end); i = end; inWord = true;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && (s[j + 1] === '"' || s[j + 1] === '\\')) { cur += s[++j]; continue; }
        cur += s[j];
      }
      if (j >= s.length) throw new Error('unterminated double quote');
      i = j; inWord = true;
    } else if (c === '\\') {
      if (i + 1 < s.length) cur += s[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) { out.push(cur); cur = ''; inWord = false; }
    } else {
      cur += c; inWord = true;
    }
  }
  if (inWord) out.push(cur);
  return out;
}

/**
 * An unscoped ss-grep call from its recorded command, or null (scoped, unparsable, more than
 * one positional). Mirrors the exploratory collector: -i/-w/-F flags, -k (default 20).
 */
export function parseGrepCall(args) {
  let toks;
  try { toks = shellWords(String(args || '')).slice(1); } catch { return null; }
  const pos = [];
  const flags = { i: false, w: false, F: false };
  let k = null;
  let scoped = false;
  let context = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-i' || t === '--ignore-case') flags.i = true;
    else if (t === '-w' || t === '--word-regexp') flags.w = true;
    else if (t === '-F' || t === '--fixed-strings') flags.F = true;
    else if (t === '-k' || t === '--top') { k = /^\d+$/.test(toks[i + 1] || '') ? Number(toks[i + 1]) : null; i++; }
    else if (t === '-A' || t === '-B' || t === '-C') { context = [t, toks[i + 1]]; i++; }
    else if (t === '--in' || t === '-g' || t === '--glob') { scoped = true; i++; }
    else if (t.startsWith('-') && pos.length > 0) { /* ignored option */ }
    else pos.push(t);
  }
  if (pos.length !== 1 || scoped) return null;
  return { pattern: pos[0], flags, k: k || 20, context };
}

/** id -> probe, from every probe file; the probe's own `set` decides what may be replayed. */
export function loadProbes(files = DEFAULT_PROBE_FILES) {
  const byId = new Map();
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    for (const p of doc.probes || doc) byId.set(p.id, { ...p, probeFile: path.basename(file) });
  }
  return byId;
}

/** Every recorded call row of one tool (default ss-grep) in every dossier file (jsonl). */
export function* dossierCalls(dir = DEFAULT_DOSSIERS, tool = 'ss-grep') {
  for (const name of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()) {
    const lines = readFileSync(path.join(dir, name), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.type === 'call' && row.tool === tool) yield { ...row, dossier: name };
    }
  }
}

/** Python-literal list ("['a', 'b']") or array → array of strings. */
export function pyList(value) {
  if (Array.isArray(value)) return value;
  const s = String(value || '').trim();
  if (!s.startsWith('[')) return [];
  return [...s.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map(m => m[1] ?? m[2]);
}

/** Last component of an expected symbol (`Oracle.hasConflict` → `hasConflict`). */
export function symbolKey(name) {
  const parts = String(name).split(/::|\.|#|->/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(name);
}

export function wordIn(name, text) {
  if (!name) return false;
  const re = new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
  return re.test(text);
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Paired, probe-clustered bootstrap of mean(a - b) over calls: calls of one probe move together.
 *
 * @param {Array<{probe: string, value: number|null}>} a
 * @param {Array<{probe: string, value: number|null}>} b - same calls, same order
 * @returns {{diff: number, lo: number, hi: number, n: number, probes: number}}
 */
export function pairedBootstrap(a, b, { reps = 2000, seed = 7 } = {}) {
  const by = new Map();
  for (let i = 0; i < a.length; i++) {
    if (a[i].probe !== b[i].probe) throw new Error('unpaired calls');
    if (a[i].value == null || b[i].value == null) continue;
    if (!by.has(a[i].probe)) by.set(a[i].probe, []);
    by.get(a[i].probe).push(a[i].value - b[i].value);
  }
  const probes = [...by.keys()];
  const all = probes.flatMap(p => by.get(p));
  const rnd = prng(seed);
  const ests = [];
  for (let r = 0; r < reps && probes.length; r++) {
    let sum = 0; let n = 0;
    for (let j = 0; j < probes.length; j++) {
      for (const v of by.get(probes[Math.floor(rnd() * probes.length)])) { sum += v; n++; }
    }
    ests.push(sum / n);
  }
  ests.sort((x, y) => x - y);
  return {
    diff: mean(all),
    lo: ests[Math.floor(0.025 * reps)] ?? NaN,
    hi: ests[Math.floor(0.975 * reps)] ?? NaN,
    n: all.length,
    probes: probes.length,
  };
}

/**
 * Per-call metrics of one rendered body.
 *
 * @param {Array<{file: string, line: number}>} rows - shown hits
 * @param {{gold: Set<string>, matchedFiles: string[], targets: Array<object>}} call
 */
export function callMetrics(rows, call) {
  const shown = new Map();
  for (const r of rows) {
    if (!shown.has(r.file)) shown.set(r.file, new Set());
    shown.get(r.file).add(r.line);
  }
  const goldMatched = call.matchedFiles.filter(f => call.gold.has(f));
  const inclusion = goldMatched.length ? goldMatched.filter(f => shown.has(f)).length / goldMatched.length : null;
  const answerLines = goldMatched.reduce((n, f) => n + (shown.get(f)?.size || 0), 0);
  const targets = call.targets;
  const symHit = targets.length
    ? targets.filter(t => [...(shown.get(t.file) || [])].some(l => l >= t.start && l <= t.end)).length / targets.length
    : null;
  const withDecl = targets.filter(t => t.declLines.length);
  const declHit = withDecl.length
    ? withDecl.filter(t => t.declLines.some(l => shown.get(t.file)?.has(l))).length / withDecl.length
    : null;
  const zeroLineFile = call.matchedFiles.length <= call.k && call.matchedFiles.some(f => !shown.has(f)) ? 1 : 0;
  return { inclusion, answerLines, symHit, declHit, filesShown: shown.size, zeroLineFile };
}

export { mean };
