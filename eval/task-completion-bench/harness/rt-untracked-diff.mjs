// BENCH_INCLUDE_UNTRACKED=1 — put the files the agent CREATED into the agent's patch.
//
// THE DEFECT. Every place that turns the agent's working tree into a patch runs
// `git diff HEAD`: the run_tests shim (rt-shim-runtime.mjs), the graded patch
// (agent-runner-shared.gitDiffPatch, and the inline copy in codex-task-runner.mjs), and
// the API runner with its sr-mode run_tests. `git diff HEAD` reports tracked files only.
// A file the agent creates and never `git add`s is invisible to all of them, so run_tests
// applies a patch without it ("Cannot find module") and the grader never sees it. Both
// arms are affected the same way: this is a validity fix, never a sweet win.
//
// THE MECHANISM. The untracked, non-ignored files are marked intent-to-add (`git add -N`)
// in a TEMPORARY COPY of the index (GIT_INDEX_FILE), and `git diff HEAD` runs against that
// copy. Git then renders each new file as an ordinary `new file mode` diff, in the same
// format and path order as the tracked hunks. The real index is never written, so the
// agent's own `git status` / `git diff` mean exactly what they meant before.
//
// WHAT NEVER ENTERS THE PATCH, in three layers:
//   1. `--exclude-standard`: .gitignore, .git/info/exclude (where dep-materialise.mjs puts
//      node_modules and .venv) and the global excludes file.
//   2. HARNESS_UNTRACKED_EXCLUDES below plus the caller's own pathspec excludes: the
//      injected instruction files, the .claude/ harness files and runner/CLI state dirs.
//   3. The pre-agent BASELINE: every untracked file that already existed when the run_tests
//      shim was written. That is after every runner injects its files and before the agent
//      starts, so a harness file this list forgot is still dropped.
// Plus guards on what is left: no symlinks or other non-regular files, no binary files (a
// `Binary files differ` stanza without --binary data makes `git apply` reject the WHOLE
// patch, which would lose the agent's tracked edits too), a per-file and a total byte cap,
// and a file-count cap. Over the count cap NO untracked file is included: hundreds of new
// files is the signature of build output that is not ignored, not of a source fix.
//
// OFF (the default) every function here reduces to the exact `git diff` call each site
// made before, so the output is byte-identical to the pre-switch harness.
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdtempSync, openSync, readSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The switch. Read by the HOST, never inside the jail; the shims receive it through their cfg. */
export function includeUntrackedFromEnv(env = process.env) {
  return env.BENCH_INCLUDE_UNTRACKED === '1';
}

/**
 * Untracked paths that are harness-owned in at least one runner. Pathspecs match a leading
 * directory, so `.claude` covers .claude/rules/sweet-search.md, .claude/agents/*,
 * .claude/settings.json and .claude/sweet-search-harness.json. Applied to UNTRACKED files
 * only; the tracked part of every diff keeps the exclusions it had.
 */
export const HARNESS_UNTRACKED_EXCLUDES = Object.freeze([
  '.sweet-search', 'CLAUDE.md', 'AGENTS.md', '.c3-handoff.md',
  '.claude', '.codex', '.opencode', '.cursor',
]);

export const UNTRACKED_LIMITS = Object.freeze({
  maxFiles: 200,                     // over this, include none (build-output signature)
  maxFileBytes: 1024 * 1024,         // a larger file is skipped on its own
  maxTotalBytes: 4 * 1024 * 1024,    // files past this total are skipped, in path order
});

const BINARY_PROBE_BYTES = 8000;     // git's own heuristic: a NUL in the first 8000 bytes
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

const git = (rundir, args, { env, maxBuffer = DEFAULT_MAX_BUFFER } = {}) =>
  execFileSync('git', ['-C', rundir, ...args], {
    encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'ignore'],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });

const toExclude = (p) => (String(p).startsWith(':') ? String(p) : `:(exclude)${p}`);

/** Every untracked, non-ignored path, sorted. Used for the pre-agent baseline. */
export function listUntracked(rundir, { excludes = HARNESS_UNTRACKED_EXCLUDES } = {}) {
  const raw = git(rundir, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...excludes.map(toExclude)],
    { maxBuffer: 64 * 1024 * 1024 });
  return String(raw).split('\0').filter(Boolean).sort();
}

function looksBinary(abs) {
  const buf = Buffer.alloc(BINARY_PROBE_BYTES);
  const fd = openSync(abs, 'r');
  try { return buf.subarray(0, readSync(fd, buf, 0, BINARY_PROBE_BYTES, 0)).includes(0); }
  finally { closeSync(fd); }
}

/**
 * The untracked files that may enter the patch, after every exclusion and guard.
 * @returns {{files:string[], skipped:{path:string,reason:string}[], aborted:string|null}}
 */
export function selectUntracked(rundir, {
  excludes = [], baseline = null, limits = UNTRACKED_LIMITS, list = null,
} = {}) {
  const pathspecs = [...new Set([...excludes, ...HARNESS_UNTRACKED_EXCLUDES])];
  const all = list ? list.slice().sort() : listUntracked(rundir, { excludes: pathspecs });
  const pre = new Set(Array.isArray(baseline) ? baseline : []);
  const created = all.filter(p => !pre.has(p));
  if (created.length > limits.maxFiles) {
    return { files: [], skipped: [], aborted: `too many untracked files (${created.length} > ${limits.maxFiles})` };
  }
  const files = [], skipped = [];
  let total = 0;
  for (const rel of created) {
    const abs = path.join(rundir, rel);
    let st;
    try { st = lstatSync(abs); } catch { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
    if (!st.isFile()) { skipped.push({ path: rel, reason: 'not-regular' }); continue; }
    if (st.size > limits.maxFileBytes) { skipped.push({ path: rel, reason: 'file-too-large' }); continue; }
    if (total + st.size > limits.maxTotalBytes) { skipped.push({ path: rel, reason: 'total-size-cap' }); continue; }
    try { if (looksBinary(abs)) { skipped.push({ path: rel, reason: 'binary' }); continue; } }
    catch { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
    total += st.size;
    files.push(rel);
  }
  return { files, skipped, aborted: null };
}

/**
 * `git diff [base] -- <pathspecs>` for the agent's tree, optionally with its new files.
 *
 * `includeUntracked:false` runs EXACTLY `git -C <rundir> diff [base] -- <pathspecs>` and
 * nothing else; a failure yields '' just as every call site's try/catch did.
 * `includeUntracked:true` adds the selected untracked files through a temporary index.
 * Any failure on that path falls back to the tracked-only diff and says why in `untracked`.
 *
 * @returns {{diff:string, untracked:null|{files:string[], skipped:object[], aborted:string|null, error?:string}}}
 */
export function benchGitDiff(rundir, {
  pathspecs = ['.'], base = 'HEAD', includeUntracked = false, baseline = null,
  limits = UNTRACKED_LIMITS, maxBuffer = DEFAULT_MAX_BUFFER,
} = {}) {
  const args = ['diff', ...(base ? [base] : []), '--', ...pathspecs];
  const trackedOnly = () => { try { return git(rundir, args, { maxBuffer }); } catch { return ''; } };
  if (!includeUntracked) return { diff: trackedOnly(), untracked: null };

  let sel;
  try {
    const excludes = pathspecs.filter(p => String(p).startsWith(':'));
    sel = selectUntracked(rundir, { excludes, baseline, limits });
  } catch (e) {
    return { diff: trackedOnly(), untracked: { files: [], skipped: [], aborted: null, error: `list failed: ${short(e)}` } };
  }
  if (!sel.files.length) return { diff: trackedOnly(), untracked: sel };

  let tmp = null;
  try {
    const realIndex = path.resolve(rundir, git(rundir, ['rev-parse', '--git-path', 'index']).trim());
    tmp = mkdtempSync(path.join(tmpdir(), 'bench-untracked-'));
    const index = path.join(tmp, 'index');
    copyFileSync(realIndex, index);
    // Literal pathspecs: an agent-chosen file name must never be read as pathspec magic.
    for (let i = 0; i < sel.files.length; i += 100) {
      git(rundir, ['add', '--intent-to-add', '--', ...sel.files.slice(i, i + 100)],
        { env: { GIT_INDEX_FILE: index, GIT_LITERAL_PATHSPECS: '1' } });
    }
    const diff = git(rundir, args, { env: { GIT_INDEX_FILE: index }, maxBuffer });
    return { diff, untracked: sel };
  } catch (e) {
    return { diff: trackedOnly(), untracked: { ...sel, files: [], error: `temp-index diff failed: ${short(e)}` } };
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
}

const short = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 160);

// ---- pre-agent baseline, host process only --------------------------------------------
// writeRunTestsShim records the baseline once per rollout attempt (after injection, before
// the agent). The shim reads it from its cfg; the graded-patch builders, which run later in
// this same process with only the rundir in hand, read it from here.
const baselines = new Map();

/** Snapshot and remember the untracked set of a rundir. Returns it, or null when unlistable. */
export function recordUntrackedBaseline(rundir) {
  let names = null;
  try { names = listUntracked(rundir); } catch { names = null; }
  baselines.set(path.resolve(rundir), names);
  return names;
}

export function untrackedBaselineFor(rundir) {
  return baselines.get(path.resolve(rundir)) ?? null;
}
