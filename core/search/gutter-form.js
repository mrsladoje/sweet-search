// Per-harness line-number gutter form for agent-facing code output.
//
// WHY THE FORM DEPENDS ON THE HARNESS (decided 2026-09-02, supersedes the
// 2026-08-28 "N<TAB> everywhere" decision; family layer + four inferred
// harnesses + colon fallback added 2026-09-22)
// ----------------------------------------------------------------------
// The delimiter is not a solve lever: at 66 rollouts per cell every form lands
// within 3 rollouts of every other on every harness (FRESH-POOL-RESULTS.md §1).
// It IS a correctness and cost question, and the answer differs per harness
// because each harness owns a different edit tool. The form is therefore a
// property of the edit tool's MATCHER FAMILY, stated directly in code below
// (MATCHER_FAMILY_FORM + HARNESS_PROFILE):
//
//   exact     `N<TAB>`  An exact-string anchor REJECTS a carried delimiter loudly
//                       (the edit fails, the model retries), so the cheapest
//                       gutter wins. Tab is ~0.7 tok/line cheaper than colon.
//   tolerant  `N:`      A whitespace-tolerant seek or a trained apply model never
//                       rejects a stray delimiter, it ABSORBS it. Under `N<TAB>`
//                       opencode silently wrote one extra tab into tab-indented
//                       files (7 of 132 rollouts, 0 of 265 under other forms,
//                       p=0.0004). A colon cannot be mistaken for indentation.
//   clipped   (none)    Tolerant AND the harness clips every tool output (codex,
//                       ~2,500 tokens), so the gutter is pure cost.
//
// The measured harnesses (form validated on the task bench, never change these
// without a new measurement):
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
//
// The inferred harnesses (form derived from the edit tool's source or binary,
// NOT measured on the bench; the deciding test for each is a gutter-prefixed
// read of a TAB-INDENTED file followed by an edit, checked for a leaked
// delimiter):
//
//   cursor       `N:`      Cursor's edit is a two-model APPLY: the frontier model
//                          emits a deliberately lazy sketch ("... existing code
//                          ...") and a separate trained apply model reconciles it
//                          against the whole file with layered exact-then-fuzzy
//                          matching. That is the opencode/codex family, not the
//                          claude-code one — a tolerant matcher never REJECTS a
//                          stray delimiter, it absorbs it. Tab is therefore the
//                          worst form here for the same reason it was on opencode.
//                          Codex's `none` does not transfer: cursor has no output
//                          clip. Inferred from cursor's published apply design.
//   pi           `N<TAB>`  Pi's edit (packages/coding-agent/src/core/tools/edit-
//                          diff.ts) tries an exact indexOf first, then ONE fuzzy
//                          pass that only trims trailing whitespace and folds
//                          smart quotes / dashes / odd spaces (NFKC). Leading
//                          whitespace is preserved, so a carried `12<TAB>` never
//                          matches and the edit fails loudly (getNotFoundError):
//                          exact family. Its read tool prints no line numbers, so
//                          there is no native prefix to match; tab is the cheapest
//                          exact-anchor form. Output cap 2,000 lines / 50 KB, not
//                          codex-tight. Markers PI_CODING_AGENT=true and
//                          AI_AGENT=pi (cli/setup.ts, rpc-entry.ts). npm bin `pi`
//                          behind a node shebang, so ps shows `node …/bin/pi`.
//   devin        `N<TAB>`  Devin CLI's Edit (toolbox::tools::edit in the native
//                          binary, 3000.11.1) "Performs exact string replacements
//                          in files"; not-found and not-unique both fail loudly.
//                          Its Read prompt names the prefix as "spaces + line
//                          number + tab … never include any part of the line
//                          number prefix in old_string": the claude-code shape
//                          verbatim, so tab is the format match as well as the
//                          cheapest form. It sets no marker for its shells (shell
//                          integration was removed in 3000.4.16), so it is found
//                          by ancestry only (`devin`). Cloud sessions (--cloud)
//                          run in a remote VM where our tools are never invoked.
//   grok-build   `N→`      Grok Build's default `search_replace` (implementations/
//                          grok_build/search_replace/mod.rs) "Replace an exact
//                          string in a file"; its only fallback is a Unicode-
//                          confusable pass (smart quotes, dashes, NBSP), off by
//                          default, that never folds a leading digit or tab:
//                          exact family. Its own read_file anchors lines as
//                          `LINE_NUMBER→` and its edit prompt says "match only
//                          what comes after the →", so the arrow IS the prefix
//                          the model is trained to strip — format match, the same
//                          reason claude-code gets tab. The alternative toolsets
//                          stay safe under the arrow: hashline edits anchor on
//                          LINE:HASH, not text, and the codex/opencode ports are
//                          tolerant matchers that cannot read an arrow as
//                          indentation. Shell output is middle-truncated at 40 KB
//                          (DEFAULT_TOOL_OUTPUT_BYTES), not codex-tight. It forces
//                          GROK_AGENT=1 into every agent terminal (util/env.rs)
//                          and GROK_SESSION_ID into stdio MCP servers. Installed
//                          as `grok` (cargo name `xai-grok-pager`). The arrow's
//                          per-line token cost is NOT measured; a single symbol
//                          after the digits, so expected near colon's.
//   deepseek-harness `N:`  dsh's bundled `str_replace_editor` (packages/fs/tool-
//                          str-replace-editor) is an exact indexOf — but
//                          everything is a plugin, and the published patch-apply
//                          (fuzzy context) and hashline plugins swap the matcher.
//                          The form is a property of the user's plugin set, not
//                          of the harness, so it gets the tolerant-safe colon: on
//                          the exact default a carried `N:` fails loudly exactly
//                          as tab would, and under a fuzzy plugin it cannot leak
//                          as indentation. dsh also drives claude-code / codex as
//                          sub-agents; there the nearer harness wins through
//                          ancestry. Markers DSH_SHELL=1 and DSH_SESSION_ID are
//                          rebuilt for every shell call (packages/shell/shell-
//                          env). npm bin `dsh` behind a node shebang.
//   anything else `N:`     The fallback (was `N<TAB>` until 2026-09-22). Exact-
//                          anchor matching is the exception among new harnesses,
//                          so an unknown one is assumed TOLERANT: tab is the one
//                          form that silently corrupts a tab-indented file on
//                          such a matcher, while colon costs at worst one loud
//                          retry on an exact one. The cost asymmetry decides it.
//
// The gutter is applied to the read surface AND to search-result code blocks of
// 15+ lines (search-server.js), so both follow the same per-harness form.
//
// HOW THE HARNESS IS FOUND, cheapest signal first. The ss-* wrappers are a fresh
// process per call and every millisecond on that path is measured, so nothing
// below spawns a process on the hot path:
//   1. `SS_READ_GUTTER=tab|pipe|colon|arrow|none` — explicit, free. The bench
//      runners pin this per harness so a measured run never detects anything;
//      it is also how an A/B arm or a user forces one form. `auto`/unset → detect.
//   2. Environment markers of the MEASURED harnesses — free: CLAUDECODE /
//      CLAUDE_CODE_ENTRYPOINT (claude-code), CODEX_SANDBOX* (codex, sandboxed
//      runs only), OPENCODE (opencode, when set), CURSOR_AGENT / CURSOR_TRACE_ID
//      (cursor).
//   3. Process ancestry: walk up and classify each ancestor's executable
//      (`claude`, `codex`, `opencode`, `cursor-agent`, `pi`, `devin`, `grok`,
//      `dsh`, or their npm entry points).
//        Linux  — /proc reads, ~0.1 ms, exact, done every time.
//        macOS  — needs one `ps` per level (~1.7 ms each), so the answer is
//                 CACHED per user+project in the temp dir and re-validated for
//                 ~20 µs with a zero-signal kill() on the harness pid. Only the
//                 first call of a session pays the walk.
//   4. Environment markers of the INFERRED harnesses — PI_CODING_AGENT (pi),
//      GROK_AGENT / GROK_SESSION_ID (grok-build), DSH_SHELL / DSH_SESSION_ID
//      (deepseek-harness). These sit AFTER ancestry on purpose: the measured
//      harnesses keep their exact detection chain byte for byte, and a marker
//      that leaks into an unrelated session cannot pre-empt the nearest real
//      harness in the process tree (GROK_AGENT=1 is also a user-settable input
//      that puts grok in headless mode, so it lives in dotfiles). The price is
//      one ancestry walk on the first call of a session under these harnesses.
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
  arrow: '→',
  none: '',
});

// Matcher family → form. See the decision block above.
export const MATCHER_FAMILY_FORM = Object.freeze({
  exact: 'tab',
  tolerant: 'colon',
  clipped: 'none',
});

// Harness → { family, form? }. `form` overrides the family form only where the
// harness's own read tool has a native prefix that its edit prompt names (the
// format-match argument), and only within the family's safety envelope.
export const HARNESS_PROFILE = Object.freeze({
  'claude-code': Object.freeze({ family: 'exact' }),
  opencode: Object.freeze({ family: 'tolerant' }),
  codex: Object.freeze({ family: 'clipped' }),
  cursor: Object.freeze({ family: 'tolerant' }),
  pi: Object.freeze({ family: 'exact' }),
  devin: Object.freeze({ family: 'exact' }),
  'grok-build': Object.freeze({ family: 'exact', form: 'arrow' }),
  'deepseek-harness': Object.freeze({ family: 'tolerant' }),
});

// An unknown harness is assumed tolerant: the one assumption that cannot corrupt a file.
export const DEFAULT_FAMILY = 'tolerant';
export const DEFAULT_FORM = MATCHER_FAMILY_FORM[DEFAULT_FAMILY];

// Flat harness → form view, derived from the profiles. This is also the registry
// of valid harness names for the macOS cache.
export const HARNESS_DEFAULT_FORM = Object.freeze(Object.fromEntries(
  Object.entries(HARNESS_PROFILE).map(([harness, p]) => [harness, p.form || MATCHER_FAMILY_FORM[p.family]]),
));

export const MAX_ANCESTRY_DEPTH = 12;
export const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function truthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

// JavaScript runtimes: when argv0 is one of these, the harness name is the
// SCRIPT's basename (`node /opt/homebrew/bin/pi`), not argv0's.
const JS_RUNTIMES = new Set(['node', 'nodejs', 'bun', 'deno']);

// Classify one process by its executable. `args` is the full command line,
// `comm` the kernel's short name (Linux only). Pure; unit-tested.
export function classifyProcess({ comm = '', args = '' } = {}) {
  const argv = String(args).trim().split(/\s+/);
  const argv0 = argv[0] || String(comm);
  const base = path.basename(argv0).toLowerCase();
  const hay = `${args} ${comm}`.toLowerCase();
  if (base === 'claude' || /@anthropic-ai\/claude-code|\/claude-code\/cli\.js/.test(hay)) return 'claude-code';
  if (base === 'codex' || base.startsWith('codex-') || /@openai\/codex/.test(hay)) return 'codex';
  if (base === 'opencode' || /\/opencode\/bin\/opencode|opencode-ai/.test(hay)) return 'opencode';
  // `cursor` alone is the IDE, not the agent CLI, and the IDE is not a harness for
  // our tools — only the agent binary and its npm entry point count.
  if (base === 'cursor-agent' || /\/cursor-agent\b|@cursor\/(cli|agent)/.test(hay)) return 'cursor';
  // The inferred harnesses. pi and dsh are npm bins behind a `#!/usr/bin/env node`
  // shebang, so the process is `node <bin path>`: classify by the script's name.
  const script = JS_RUNTIMES.has(base)
    ? path.basename(argv.slice(1).find((a) => a && !a.startsWith('-')) || '').toLowerCase()
    : '';
  if (base === 'pi' || script === 'pi' || /\/pi-coding-agent\//.test(hay)) return 'pi';
  if (base === 'devin') return 'devin';
  if (base === 'grok' || base === 'xai-grok-pager') return 'grok-build';
  if (base === 'dsh' || script === 'dsh' || /@deepseek-ai\/dsh\b/.test(hay)) return 'deepseek-harness';
  return null;
}

// Classify from environment markers only. Pure; unit-tested.
//   tier 'primary'  — the measured harnesses, consulted BEFORE the ancestry walk
//   tier 'fallback' — the inferred harnesses, consulted AFTER the ancestry walk
//   tier 'all'      — both, primary first (diagnostics and tests)
export function detectHarnessFromEnv(env = process.env, { tier = 'all' } = {}) {
  if (tier !== 'fallback') {
    if (truthy(env.CLAUDECODE) || truthy(env.CLAUDE_CODE_ENTRYPOINT)) return 'claude-code';
    if (Object.keys(env).some(k => k.startsWith('CODEX_SANDBOX'))) return 'codex';
    if (truthy(env.OPENCODE)) return 'opencode';
    if (truthy(env.CURSOR_AGENT) || truthy(env.CURSOR_TRACE_ID)) return 'cursor';
  }
  if (tier !== 'primary') {
    if (truthy(env.PI_CODING_AGENT)) return 'pi';
    if (truthy(env.GROK_AGENT) || truthy(env.GROK_SESSION_ID)) return 'grok-build';
    if (truthy(env.DSH_SHELL) || truthy(env.DSH_SESSION_ID)) return 'deepseek-harness';
  }
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
  // The historical spellings of "N<TAB>", pinned so the fallback flip cannot move them.
  if (s === 'linenums' || s === 'numbers') return 'tab';
  return null; // '', 'auto', or anything unknown → detect
}

let cached = null;

// Resolve once per process. Returns { form, delimiter, harness, source }.
//   source: 'env-override' | 'env-marker' | 'ancestry' | 'default'
// Order: explicit override → primary markers → ancestry → fallback markers → default.
export function resolveGutterForm(env = process.env, { ancestry = null, exportToEnv = true } = {}) {
  if (cached && env === process.env) return cached;
  let form = normalizeForm(env.SS_READ_GUTTER);
  let harness = null;
  let source = 'env-override';
  if (!form) {
    harness = detectHarnessFromEnv(env, { tier: 'primary' });
    source = 'env-marker';
    if (!harness) {
      harness = ancestry ? ancestry() : detectHarnessCached({ env });
      source = 'ancestry';
    }
    if (!harness) {
      harness = detectHarnessFromEnv(env, { tier: 'fallback' });
      source = 'env-marker';
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
