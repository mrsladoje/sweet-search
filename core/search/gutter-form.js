// Per-harness line-number gutter form for agent-facing code output.
//
// WHY THE FORM DEPENDS ON THE HARNESS (decided 2026-09-02, supersedes the
// 2026-08-28 "N<TAB> everywhere" decision)
// ----------------------------------------------------------------------
// The delimiter is not a solve lever: at 66 rollouts per cell every form lands
// within 3 rollouts of every other on every harness (FRESH-POOL-RESULTS.md §1).
// It IS a correctness and cost question, and the answer differs per harness
// because each harness owns a different edit tool:
//
//   claude-code  `N<TAB>`  Claude Code's Edit is an exact-string anchor and its
//                          prompt tells the model to strip "line number + tab",
//                          so tab matches the format the Edit workflow expects.
//                          A carried tab fails LOUDLY there (Edit rejects it).
//                          The gutter itself is the validated cost lever on this
//                          harness; the six-task anchor edge for tab did not
//                          replicate at 66 rollouts, so tab rests on format match.
//   opencode     `N:`      Opencode's edit seeks context with four whitespace-
//                          tolerant passes, so no delimiter can leak into an
//                          anchor — but under `N<TAB>` it silently wrote one
//                          extra tab into tab-indented files (7 of 132 rollouts,
//                          0 of 265 under other forms, p=0.0004). A colon cannot
//                          be mistaken for indentation, and it keeps the line
//                          numbers the agent uses for range reads.
//   codex        (none)    Same four-pass seek, same silent tab carry, and codex
//                          truncates every tool output at ~2,500 tokens, so the
//                          gutter is pure token cost there (none 8.66 tok/line,
//                          tab 10.11, pipe/colon 11.04). Unnumbered matched
//                          native's solve count (41 of 66) at the cheapest price.
//   anything else `N<TAB>` The historically validated default.
//
// HOW THE HARNESS IS FOUND, cheapest signal first. The ss-* wrappers are a fresh
// process per call and every millisecond on that path is measured, so nothing
// below spawns a process on the hot path:
//   1. `SS_READ_GUTTER=tab|pipe|colon|none` — explicit, free. The bench runners
//      pin this per harness so a measured run never detects anything; it is
//      also how an A/B arm or a user forces one form. `auto`/unset → detect.
//   2. Environment markers the harnesses set for their tool subprocesses — free:
//      CLAUDECODE / CLAUDE_CODE_ENTRYPOINT (claude-code), CODEX_SANDBOX* (codex,
//      sandboxed runs only), OPENCODE (opencode, when set).
//   3. Process ancestry: walk up and classify each ancestor's executable
//      (`claude`, `codex`, `opencode`, or their npm entry points).
//        Linux  — /proc reads, ~0.1 ms, exact, done every time.
//        macOS  — needs one `ps` per level (~1.7 ms each), so the answer is
//                 CACHED per user+project in the temp dir and re-validated for
//                 ~20 µs with a zero-signal kill() on the harness pid. Only the
//                 first call of a session pays the walk.
// The result is memoised per process and exported into process.env so every
// child this process spawns (the resident daemon, a maintainer) inherits the
// SAME form without re-detecting — a daemon detaches from its parent and would
// otherwise lose the ancestry signal.
//
// KNOWN LIMIT of the macOS cache: two DIFFERENT non-Claude harnesses open on the
// same project at the same time share one cache entry, so the second one sees
// the first one's form until the first exits. Claude Code never hits this (it
// resolves from its env marker), and the bench never does (pinned env).
import path from 'node:path';
import os from 'node:os';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const GUTTER_FORMS = Object.freeze({
  tab: '\t',
  pipe: '| ',
  colon: ':',
  none: '',
});

export const HARNESS_DEFAULT_FORM = Object.freeze({
  'claude-code': 'tab',
  opencode: 'colon',
  codex: 'none',
});

export const DEFAULT_FORM = 'tab';
export const MAX_ANCESTRY_DEPTH = 12;
export const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function truthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

// Classify one process by its executable. `args` is the full command line,
// `comm` the kernel's short name (Linux only). Pure; unit-tested.
export function classifyProcess({ comm = '', args = '' } = {}) {
  const argv0 = String(args).trim().split(/\s+/)[0] || String(comm);
  const base = path.basename(argv0).toLowerCase();
  const hay = `${args} ${comm}`.toLowerCase();
  if (base === 'claude' || /@anthropic-ai\/claude-code|\/claude-code\/cli\.js/.test(hay)) return 'claude-code';
  if (base === 'codex' || base.startsWith('codex-') || /@openai\/codex/.test(hay)) return 'codex';
  if (base === 'opencode' || /\/opencode\/bin\/opencode|opencode-ai/.test(hay)) return 'opencode';
  return null;
}

// Classify from environment markers only. Pure; unit-tested.
export function detectHarnessFromEnv(env = process.env) {
  if (truthy(env.CLAUDECODE) || truthy(env.CLAUDE_CODE_ENTRYPOINT)) return 'claude-code';
  if (Object.keys(env).some(k => k.startsWith('CODEX_SANDBOX'))) return 'codex';
  if (truthy(env.OPENCODE)) return 'opencode';
  return null;
}

function readProcessLinux(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const open = stat.indexOf('(');
  const close = stat.lastIndexOf(')');
  const comm = stat.slice(open + 1, close);
  const ppid = Number(stat.slice(close + 2).split(' ')[1]);
  let args = '';
  try { args = readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0').filter(Boolean).join(' '); } catch { /* kernel thread or gone */ }
  return { ppid, comm, args };
}

function readProcessPs(pid) {
  const out = execFileSync('ps', ['-o', 'ppid=,args=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = out.trim().match(/^(\d+)\s+([\s\S]*)$/);
  return m ? { ppid: Number(m[1]), comm: '', args: m[2] } : null;
}

export function defaultReadProcess() {
  return process.platform === 'linux' ? readProcessLinux : readProcessPs;
}

// Walk up the process tree. Returns { harness, pid, top }: `pid` is the harness
// process when one was found, `top` the highest ancestor reached otherwise (the
// stable process a negative result can be cached against).
// `readProcess(pid) -> { ppid, comm, args } | null` is injectable for tests.
export function findHarnessAncestor({ pid = process.pid, readProcess = null, maxDepth = MAX_ANCESTRY_DEPTH } = {}) {
  const read = readProcess || defaultReadProcess();
  let cur = pid;
  let top = pid;
  const seen = new Set();
  for (let depth = 0; depth < maxDepth && cur > 1 && !seen.has(cur); depth++) {
    seen.add(cur);
    let info;
    try { info = read(cur); } catch { return { harness: null, pid: null, top }; }
    if (!info) return { harness: null, pid: null, top };
    // Skip ourselves: the wrapper process is never the harness.
    if (depth > 0) {
      top = cur;
      const h = classifyProcess(info);
      if (h) return { harness: h, pid: cur, top };
    }
    cur = Number(info.ppid);
    if (!Number.isFinite(cur)) break;
  }
  return { harness: null, pid: null, top };
}

export function detectHarnessFromAncestry(opts = {}) {
  return findHarnessAncestor(opts).harness;
}

// ---- macOS cache -----------------------------------------------------------

export function harnessCachePath(env = process.env, tmpDir = os.tmpdir()) {
  const project = env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const key = createHash('sha1').update(project).digest('hex').slice(0, 12);
  return path.join(tmpDir, `sweet-search-harness-${uid}-${key}.json`);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

// A cached entry is trusted only while the process it was derived from is still
// alive and the entry is younger than CACHE_MAX_AGE_MS. ~20 µs.
export function readHarnessCache(file, { now = Date.now(), isAlive = processAlive } = {}) {
  let entry;
  try { entry = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!entry || entry.v !== 1 || !Number.isInteger(entry.pid) || entry.pid <= 1) return null;
  if (typeof entry.ts !== 'number' || now - entry.ts > CACHE_MAX_AGE_MS || now < entry.ts) return null;
  if (entry.harness !== null && !(entry.harness in HARNESS_DEFAULT_FORM)) return null;
  if (!isAlive(entry.pid)) return null;
  return entry;
}

export function writeHarnessCache(file, { harness, pid, now = Date.now() }) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ v: 1, harness, pid, ts: now }));
    renameSync(tmp, file);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
  }
}

// Ancestry with the macOS cache in front of it. Linux reads /proc directly.
export function detectHarnessCached({ env = process.env, platform = process.platform, readProcess = null, file = null, now = Date.now(), isAlive = processAlive } = {}) {
  if (platform === 'linux') return findHarnessAncestor({ readProcess }).harness;
  const cacheFile = file || harnessCachePath(env);
  const hit = readHarnessCache(cacheFile, { now, isAlive });
  if (hit) return hit.harness;
  const found = findHarnessAncestor({ readProcess });
  const anchor = found.harness ? found.pid : found.top;
  if (anchor && anchor > 1 && anchor !== process.pid) writeHarnessCache(cacheFile, { harness: found.harness, pid: anchor, now });
  return found.harness;
}

export function normalizeForm(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s in GUTTER_FORMS) return s;
  if (s === 'linenums' || s === 'numbers') return DEFAULT_FORM;
  return null; // '', 'auto', or anything unknown → detect
}

let cached = null;

// Resolve once per process. Returns { form, delimiter, harness, source }.
//   source: 'env-override' | 'env-marker' | 'ancestry' | 'default'
export function resolveGutterForm(env = process.env, { ancestry = null, exportToEnv = true } = {}) {
  if (cached && env === process.env) return cached;
  let form = normalizeForm(env.SS_READ_GUTTER);
  let harness = null;
  let source = 'env-override';
  if (!form) {
    harness = detectHarnessFromEnv(env);
    source = 'env-marker';
    if (!harness) {
      harness = ancestry ? ancestry() : detectHarnessCached({ env });
      source = 'ancestry';
    }
    if (!harness) source = 'default';
    form = HARNESS_DEFAULT_FORM[harness] || DEFAULT_FORM;
  }
  const result = Object.freeze({ form, delimiter: GUTTER_FORMS[form], harness, source });
  if (env === process.env) {
    cached = result;
    // Children (daemon, maintainer) inherit the decision instead of re-detecting
    // from an ancestry they may no longer have.
    if (exportToEnv && !normalizeForm(process.env.SS_READ_GUTTER)) process.env.SS_READ_GUTTER = form;
  }
  return result;
}

export function gutterDelimiter() {
  return resolveGutterForm().delimiter;
}

// Tests only: forget the memoised decision.
export function _resetGutterFormForTests() {
  cached = null;
}
