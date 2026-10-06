// opencode harness for the task-completion bench: drives `opencode run` (a real
// production coding agent) uncapped, routed to OpenRouter models (Grok 4.5, Muse). Same
// ablation as codex/claude-code:
//   - native arm: vanilla opencode `build` agent (its own bash/edit/read/grep); NO M++, NO ss-*.
//   - sweet arm:  opencode + M++ appended + ss-* wrappers on PATH.
// opencode has NO shell sandbox, so the run_tests shim reaches docker.sock directly and the
// host /etc/hosts net-lockdown governs the agent's egress. Emits the canonical bench row.
//
// NOTE: opencode's `--format json` event schema is not officially documented (reverse-
// engineered). parseOpencodeStream is defensive and is validated/adjusted from a real
// smoke's raw NDJSON before any counted run.
import { classifyShellCommand, TOOL_KIND_VERSION } from './shell-command-kind.mjs';
import { opencodeBatchPrompt, opencodeBatchToolEdits, OPENCODE_GPT_ORIGINAL, OPENCODE_VARIANT_NAMES } from './trim/batch-variants.mjs';
// What `sweet-search init --opencode` ships (single source): conflict3's prompt and tool edits and
// the trim plugin. The benchmark arm OC_HARNESS_TRIM=conflict3+todo3eff3k is built from them.
import {
  OPENCODE_CONFLICT_PROMPT_BULLET as SHIPPED_CONFLICT_PROMPT_BULLET, OPENCODE_FILE_READS_EDIT,
  OPENCODE_TOOL_EDITS as SHIPPED_OPENCODE_TOOL_EDITS, OPENCODE_TRIM_PLUGIN_SOURCE,
} from '../../../scripts/harness-prompts/index.js';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { addSidechainCostsChecked } from './claude-code-accounting.mjs';
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile, sweetRulesBlock,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  costsFromTurns, spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { runTestsTelemetry } from './rt-inflight.mjs';
import { resolveSweetRulesPlacement, sweetRulesRowFields, appendSweetRules } from './sweet-rules-placement.mjs';
import { installSedCmds } from './env-ledger.mjs';
import { persistTurns } from './turn-log.mjs';
import { firstRequestCacheFields } from './cache-warmup.mjs';
import { finalizeProgressModelTurns } from './rt-progress-controller.mjs';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const retainedPath = file => path.relative(BENCH_DIR, file);
export const PINNED_OPENCODE_VERSION = '1.18.4';

export function retainOpencodeAttempt(directory, attempt, result, { secrets = [] } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stdout = path.join(directory, `attempt-${attempt}.stdout.ndjson`);
  const stderr = path.join(directory, `attempt-${attempt}.stderr.txt`);
  const redact = value => {
    let text = String(value || ''), detected = false;
    for (const secret of secrets) if (secret && text.includes(secret)) {
      detected = true; text = text.replaceAll(secret, '[REDACTED]');
    }
    return { text, detected };
  };
  const safeStdout = redact(result?.stdout), safeStderr = redact(result?.stderr);
  writeFileSync(stdout, safeStdout.text, { mode: 0o600 });
  writeFileSync(stderr, safeStderr.text, { mode: 0o600 });
  return {
    stdout: retainedPath(stdout), stderr: retainedPath(stderr),
    secretLeakDetected: safeStdout.detected || safeStderr.detected,
  };
}

function parseResolvedConfig(stdout) {
  const clean = String(stdout || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  try { return JSON.parse(clean); } catch {
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('opencode debug config did not return JSON');
  }
}

function sanitizedConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizedConfig);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /api.?key|token|secret|password|authorization/i.test(key)
      ? '[REDACTED]' : sanitizedConfig(item),
  ]));
}

// `plugins` is the list the runner itself configured (the harness-trim plugin, or none);
// anything else in the resolved config is ambient and fails the preflight.
export function validateMainOpencodePreflight({ version, resolved, plugins = [] }) {
  const versionPattern = new RegExp(`(^|\\D)${PINNED_OPENCODE_VERSION.replaceAll('.', '\\.')}($|\\D)`);
  if (!versionPattern.test(String(version || ''))) {
    throw new Error(`pinned OpenCode ${PINNED_OPENCODE_VERSION} is unavailable`);
  }
  if (!resolved || typeof resolved !== 'object' || !Array.isArray(resolved.plugin)
      || JSON.stringify(resolved.plugin) !== JSON.stringify(plugins)) throw new Error('ambient OpenCode plugin detected');
  return true;
}

// Exact-config preflight: `opencode --version` + `opencode debug config`, then
// validateMainOpencodePreflight on the result. Defect 2026-09-29 (5+ INFRA rows, rising with
// load avg ~20): each unjailed rollout gets a FRESH private XDG_CONFIG_HOME, and opencode
// 1.18.4's first start there installs @opencode-ai/plugin into $XDG_CONFIG_HOME/opencode
// (package.json + node_modules, ~16 s with six rollouts starting together). `debug config`
// only prints after that, so under load it ran past the old fixed 30 s timeout and the row
// became "OpenCode preflight process failed" with no detail. Fix: a longer timeout, and ONE
// retry after a backoff that fires only on a PROCESS-level failure (non-zero exit, signal,
// timeout). The retry reuses the same config dir, so the install is already done. A real
// mismatch (wrong version, ambient plugin, non-JSON config) is never retried: the guarantee
// the preflight exists for is unchanged. Same code path for both arms.
export const OPENCODE_PREFLIGHT_TIMEOUT_MS = 120_000;
export const OPENCODE_PREFLIGHT_ATTEMPTS = 2;
export const OPENCODE_PREFLIGHT_BACKOFF_MS = 5_000;

function preflightProcessDetail(name, result) {
  let tail = String(result.stderr || '').replace(/\u001b\[[0-9;]*m/g, '').trim().slice(-300).replace(/\s+/g, ' ');
  const apiKey = String(process.env.OPENROUTER_API_KEY || '');
  if (apiKey) tail = tail.replaceAll(apiKey, '[REDACTED]');
  return `${name}: exit=${result.exitCode}${result.signal ? ` signal=${result.signal}` : ''}`
    + `${result.timedOut ? ' timedOut' : ''}${result.elapsedMs != null ? ` ${result.elapsedMs}ms` : ''}`
    + `${tail ? ` stderr="${tail}"` : ''}`;
}

export async function runOpencodePreflight({
  spawn = spawnWithTimeout, cwd, env, jail = null, plugins = [],
  timeoutMs = Number(process.env.SS_OC_PREFLIGHT_TIMEOUT_MS) || OPENCODE_PREFLIGHT_TIMEOUT_MS,
  attempts = OPENCODE_PREFLIGHT_ATTEMPTS, backoffMs = OPENCODE_PREFLIGHT_BACKOFF_MS,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log,
} = {}) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const timed = async args => {
      const t0 = Date.now();
      const result = await spawn('opencode', args, { cwd, env, timeoutMs, jail });
      return { ...result, elapsedMs: Date.now() - t0 };
    };
    const versionResult = await timed(['--version']);
    const bad = r => r.exitCode !== 0 || r.timedOut || Boolean(r.signal);
    const configResult = bad(versionResult) ? null : await timed(['debug', 'config']);
    if (bad(versionResult) || bad(configResult)) {
      const detail = bad(versionResult) ? preflightProcessDetail('version', versionResult)
        : preflightProcessDetail('debug config', configResult);
      failures.push(`attempt ${attempt}: ${detail}`);
      if (attempt < attempts) {
        log(`  [opencode-preflight] process failure (${detail}) — retrying in ${backoffMs}ms`);
        await sleep(backoffMs * attempt);
        continue;
      }
      throw new Error(`OpenCode preflight process failed (${failures.join('; ')})`);
    }
    // Content checks: never retried.
    const resolved = parseResolvedConfig(configResult.stdout);
    validateMainOpencodePreflight({ version: versionResult.stdout, resolved, plugins });
    return { resolved, versionResult, configResult, attempts: attempt, processFailures: failures };
  }
  throw new Error('OpenCode preflight process failed (no attempts)');
}

// --- HARNESS TRIM (OC_HARNESS_TRIM) — handoffs/improve/harness-prompt-trim ---
// DEFAULT (since 2026-09-30, SWEET ARM ONLY) = the product: OC_HARNESS_TRIM unset or empty means
// 'conflict3+todo3eff3k' (OC_HARNESS_TRIM_DEFAULT), and SWEET_RULES_PLACEMENT defaults to 'config'
// (the rules in an `instructions` file in the runner's private state dir) — together what
// `sweet-search init --opencode` 2.8.2 writes into .opencode/. The product installs the same prompt
// (built from opencode's gpt-family text) for EVERY model, so the default never refuses a model
// family: a grok, deepseek or minimax rollout gets the shipped prompt too, as a user's would.
// OC_HARNESS_TRIM=0 (+ SWEET_RULES_PLACEMENT=file) is the explicit opt-out to stock opencode; every
// other explicit value keeps its meaning, including the gpt-family-only refusal of the research
// variants. The native arm is stock in every condition. Rows stamp the effective mode (harnessTrim)
// and harnessTrimSource ('default' | 'env').
// Research switch, SWEET ARM ONLY: removes the parts of opencode's OWN request that
// contradict the ss-* rules (Glob/Grep-first, Task-instead-of-search, Read-instead-of-cat,
// bash-only-for-system-commands) or that a headless task never uses. The rules file, the
// frame and AGENTS.md are untouched. Verified at $0 on 1.18.4 (captures in that handoff):
//   prompt   — agent.build.prompt REPLACES the model-family prompt (environment block,
//              AGENTS.md and tools stay). Edited copies of opencode's MIT prompts live in
//              harness/trim/ (NOTICE there); one per family the bench can route here.
//   tools    — tools.<name>: false drops glob and grep (ss-* duplicates whose descriptions
//              push "use the Task tool instead") and skill (no skills in a rollout). task
//              stays: delegation is a real capability.
//   tooldesc — a local plugin's `tool.definition` hook deletes the contradicting passages
//              from the bash, read and task DESCRIPTIONS. Execution stays opencode's built-in
//              tool; only the text the model reads changes. Config cannot do this
//              (tools.bash accepts only a boolean). The plugin writes a report of what it
//              applied; a plugin that fails to load is silently ignored by opencode, so the
//              row carries that report as positive proof.
// Plugin and report live in the runner state dir (outside the rundir: never in the patch;
// eval/ is masked in the jail, so harness/trim/ itself is not readable there).
// Mode values: '0' = off (config, env and argv byte-identical), unset = the product (above), '1' = on (round 1,
// the 2026-09-25 smoke), 'max' = round 1 plus (audit 2026-09-25, same captures dir):
//   subagents — agent.general.prompt = the build prompt (general otherwise gets the UNTRIMMED
//              family prompt, "prefer Glob and Grep"), agent.explore.prompt = opencode's
//              explore prompt minus its Glob/Grep lines (tools the trim disables).
//   todowrite — disabled: Luna spent 22 of 101 turns (smoke) on todo lists that restate the
//              frame's five steps; the claude/muse prompts lose their TodoWrite sections.
//   text     — *-max.txt prompts drop the user-facing channel/format sections and every
//              "ask the user" line (a question ends a headless run); the default prompt drops
//              "search extensively" and README/lint hunting (the frame names run_tests);
//              bash drops its mkdir/quoting walkthrough, git examples and the Git/PR section;
//              edit/write drop the false "Read first" claim (1.18.4 does not enforce it).
const TRIM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trim');
export const OPENCODE_TRIM_PLUGIN = 'opencode-trim-plugin.mjs';
export const OPENCODE_TRIM_REPORT = 'opencode-trim-report.json';
export const OPENCODE_TRIM_DISABLED_TOOLS = Object.freeze(['glob', 'grep', 'skill']);
export const OPENCODE_TRIM_MAX_DISABLED_TOOLS = Object.freeze([...OPENCODE_TRIM_DISABLED_TOOLS, 'todowrite']);
const OPENCODE_TRIM_PROMPTS = Object.freeze({
  default: 'opencode-1.18.4-prompt-default.txt', muse: 'opencode-1.18.4-prompt-muse.txt',
  gpt: 'opencode-1.18.4-prompt-gpt.txt', claude: 'opencode-1.18.4-prompt-claude.txt',
});
const opencodeTrimMaxPrompt = name => `opencode-1.18.4-prompt-${name}-max.txt`;
// [find, replace] pairs per built-in tool. Only fixed text — never the templated parts
// (OS, shell, temp dir, timeout) — so every edit applies on every host.
export const OPENCODE_TRIM_TOOL_EDITS = Object.freeze({
  bash: [
    ['IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\n', ''],
    [' or Grep to search the full content', ''],
    ['  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands,', '  - Avoid using Bash with the `sed`, `awk`, or `echo` commands,'],
    ['    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n', ''],
  ],
  read: [
    ['- Use the grep tool to find specific content in large files or files with long lines.\n', ''],
    ['- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n', ''],
  ],
  // task stays enabled; only its pointers to the disabled glob/grep tools go.
  task: [
    ['use the Read or Glob tool instead of the Task tool', 'use the Read tool instead of the Task tool'],
    ['- If you are searching for a specific class definition like "class Foo", use the Grep tool instead, to find the match more quickly\n', ''],
  ],
});
// OC_HARNESS_TRIM=max: round 1's edits, the avoid-shell bullet removed whole (its Edit/Write
// lines name tools the GPT family does not have; every base prompt already says how to
// edit), and text a rollout never uses. Applied in order, so each find is the text as
// opencode sends it.
export const OPENCODE_TRIM_MAX_TOOL_EDITS = Object.freeze({
  bash: [
    OPENCODE_TRIM_TOOL_EDITS.bash[0],
    ['Before executing the command, please follow these steps:\n\n1. Directory Verification:\n   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location\n   - For example, before running "mkdir foo/bar", first use `ls foo` to check that "foo" exists and is the intended parent directory\n\n2. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt")\n   - Examples of proper quoting:\n     - mkdir "/Users/name/My Documents" (correct)\n     - mkdir /Users/name/My Documents (incorrect - will fail)\n     - python "/path/with spaces/script.py" (correct)\n     - python /path/with spaces/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\n', ''],
    OPENCODE_TRIM_TOOL_EDITS.bash[1],
    ['  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n    - Write files: Use Write (NOT echo >/cat <<EOF)\n    - Communication: Output text directly (NOT echo/printf)\n', ''],
    [' For example, if you need to run "git status" and "git diff", send a single message with two bash tool calls in parallel.', ''],
    [' (e.g., `git add . && git commit -m "message" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.', '.'],
    // second copy of the workdir rule; the first stays at the top
    ['  - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.\n    <good-example>\n    Use workdir="/foo/bar" with command: pytest tests\n    </good-example>\n    <bad-example>\n    cd /foo/bar && pytest tests\n    </bad-example>\n', ''],
    ['\n# Git and GitHub\n- Only commit, amend, push, or create PRs when explicitly requested.\n- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files and never commit secrets.\n- Write a concise commit message that matches the repo style.\n- Do not update git config, skip hooks, use interactive `-i`, force-push, or create empty commits unless explicitly requested.\n- If a commit fails or hooks reject it, fix the issue and create a new commit; do not amend the failed commit.\n- Before creating a PR, inspect status, diff, remote tracking, recent commits, and the diff from the base branch.\n- Review all commits included in the PR, not just the latest commit.\n- Use `gh` for GitHub tasks, including PRs, issues, checks, and releases; return the PR URL when done.\n', ''],
  ],
  read: [
    ...OPENCODE_TRIM_TOOL_EDITS.read,
    ['- This tool can read image files and PDFs and return them as file attachments.\n', ''],
  ],
  task: [
    ...OPENCODE_TRIM_TOOL_EDITS.task,
    [' The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.', ''],
    ['7. If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.\n', ''],
  ],
  // claude/muse/default families only (gpt has apply_patch): 1.18.4 runs an edit or an
  // overwrite without a prior Read (verified by capture), so the claim only pushes a native
  // Read before every ss-read-guided edit.
  edit: [['- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. \n', '']],
  write: [["- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n", '']],
});
// OC_HARNESS_TRIM=v3: round 1's edits with ONE change and three zero-risk cuts (diagnosis
// 2026-09-26, handoffs/improve/harness-prompt-trim). Round 1 deleted the task tool's "class Foo
// -> use the Grep tool instead" line; with glob/grep gone the trimmed arm then delegated searches
// to explore in 5 of 26 rollouts (as-now: 0 of 32), and that subagent spend is off the row
// ledger. v3 keeps the line and names no disabled tool. The cuts: the task result-visibility and
// "use proactively" notes (no listed agent is proactive; a headless run has no user to show a
// result to) and read's image/PDF note (no task reads images).
export const OPENCODE_TRIM_V3_TOOL_EDITS = Object.freeze({
  bash: OPENCODE_TRIM_TOOL_EDITS.bash,
  read: [
    ...OPENCODE_TRIM_TOOL_EDITS.read,
    ['- This tool can read image files and PDFs and return them as file attachments.\n', ''],
  ],
  task: [
    OPENCODE_TRIM_TOOL_EDITS.task[0],
    ['use the Grep tool instead, to find the match more quickly', 'search for it directly instead, to find the match more quickly'],
    [' The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.', ''],
    ['7. If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.\n', ''],
  ],
});

// OC_HARNESS_TRIM=conflict | conflict-noglob (2026-09-27, CONFLICT-ONLY trim, gpt family): the
// UNTRIMMED gpt prompt minus ONLY its "prefer using Glob and Grep tools" bullet (for build and
// the general subagent); grep disabled; explore disabled (its prompt is built on Glob/Grep, as
// in v3); and tool-description edits that remove only text contradicting the ss-* rules or
// naming a disabled tool. Skills, review, frontend, formatting, image/PDF, result-visibility
// and todowrite text all stay. 'conflict' KEEPS glob (only its "use the Task tool instead"
// line goes); 'conflict-noglob' also disables glob — the one axis between the two.
//   Combined with a line: OC_HARNESS_TRIM=<base>+<variant>, base = conflict | conflict-noglob |
//   untrimmed, variant = any opencode variant in trim/batch-variants.mjs (todoall, todo2,
//   todo2eff, ...). The variant edits the base prompt's batching bullet and adds its own
//   tool-description edits. untrimmed+<variant> is exactly batch-<variant> (other mode label).
export const OPENCODE_CONFLICT_PROMPT_BULLET = SHIPPED_CONFLICT_PROMPT_BULLET;
export const OPENCODE_CONFLICT_BASES = Object.freeze(['conflict', 'conflict-noglob', 'conflict2', 'conflict3', 'conflict4', 'untrimmed']);
export const OPENCODE_CONFLICT_TOOL_EDITS = Object.freeze({
  bash: [
    OPENCODE_TRIM_TOOL_EDITS.bash[0],   // "DO NOT use it for ... searching, finding files" — ss-* run through bash
    OPENCODE_TRIM_TOOL_EDITS.bash[1],   // " or Grep to search the full content" — grep is disabled
    // the avoid-list pushes Grep/Read over ss-grep/ss-read; find stays (its Glob line stays)
    ['  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands,', '  - Avoid using Bash with the `find`, `sed`, `awk`, or `echo` commands,'],
    ['    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n', ''],
  ],
  read: [OPENCODE_TRIM_TOOL_EDITS.read[0]],   // "Use the grep tool ..." — grep is disabled
  task: [OPENCODE_TRIM_V3_TOOL_EDITS.task[1]], // "class Foo" -> no disabled Grep tool named; the deterrent stays
  glob: [['- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n', '']],
});
// OC_HARNESS_TRIM=conflict2 (2026-09-29, owner: keep every tool; audit conflict-audit): no tool is
// disabled. Removes only text that steers against the ss-* rules: the Glob/Grep prompt bullet,
// "- especially file reads" in the parallel bullet, the read tool's "read a larger window" line,
// the grep/glob/read pointers that push native search over ss-*, the grep/glob "use the Task tool
// instead" delegation lines; explore stays enabled with its "Use Glob / Use Grep" lines removed.
export const OPENCODE_CONFLICT2_TOOL_EDITS = Object.freeze({
  bash: OPENCODE_CONFLICT_TOOL_EDITS.bash,
  read: [OPENCODE_TRIM_TOOL_EDITS.read[0], ['- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.\n', '']],
  task: OPENCODE_CONFLICT_TOOL_EDITS.task,
  glob: OPENCODE_CONFLICT_TOOL_EDITS.glob,
  grep: [['- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead', '']],
});
export const OPENCODE_CONFLICT2_PROMPT_EDIT = OPENCODE_FILE_READS_EDIT;
// OC_HARNESS_TRIM=conflict3 (owner 2026-09-29): conflict2's text edits, but the grep tool and the
// explore subagent are DISABLED (both duplicate the ss-* retrieval the rules prescribe = conflicts);
// glob stays (lists files by name, no conflict). No grep-description edit (the tool is gone).
// = conflict2's bash/read/task/glob edits (tests/opencode-harness-trim.mjs checks it); defined in the
// product because `sweet-search init --opencode` ships them.
export const OPENCODE_CONFLICT3_TOOL_EDITS = SHIPPED_OPENCODE_TOOL_EDITS;
// OC_HARNESS_TRIM=conflict4 (audit beh-oc-p4): conflict3 + the glob description's "always better to
// speculatively perform multiple searches as a batch" sentence removed (it pulls against the efficiency
// line; its intent is restated there as "send the searches you would try in one turn").
export const OPENCODE_CONFLICT4_TOOL_EDITS = Object.freeze({
  ...OPENCODE_CONFLICT3_TOOL_EDITS,
  glob: [...OPENCODE_CONFLICT3_TOOL_EDITS.glob,
    ['- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.', '']],
});
export const OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS = Object.freeze({
  bash: OPENCODE_TRIM_TOOL_EDITS.bash,   // round 1: also the "File search: Use Glob" line and `find`
  read: OPENCODE_TRIM_TOOL_EDITS.read,   // round 1: also the glob-tool pointer
  task: [OPENCODE_TRIM_TOOL_EDITS.task[0], OPENCODE_TRIM_V3_TOOL_EDITS.task[1]],
});

function opencodeHarnessTrimCombo(m, { apiModel, stateDir, env = process.env }) {
  const [base, variant, ...rest] = m.split('+');
  const expected = `expected ${OPENCODE_CONFLICT_BASES.join(' | ')}[+<variant>] (untrimmed needs a variant); variants: ${OPENCODE_VARIANT_NAMES.join(', ')}`;
  if (rest.length || !OPENCODE_CONFLICT_BASES.includes(base) || (variant !== undefined && !OPENCODE_VARIANT_NAMES.includes(variant))
      || (base === 'untrimmed' && !variant)) throw new Error(`OC_HARNESS_TRIM=${m}: ${expected}`);
  // The shipped combination is model-agnostic, as `init --opencode` is; research combinations stay gpt-only.
  if (m !== OC_HARNESS_TRIM_DEFAULT && opencodePromptFamily(apiModel) !== 'gpt') throw new Error(`OC_HARNESS_TRIM=${m}: gpt family only (model ${apiModel})`);
  if (base === 'untrimmed') {
    const t = opencodeHarnessTrimMode(`batch-${variant}`, { apiModel, stateDir });
    return { ...t, mode: t.mode.replace(`batch-${variant}:`, `${m}:`) };
  }
  if (!stateDir) throw new Error(`OC_HARNESS_TRIM=${m}: stateDir required`);
  const noglob = base === 'conflict-noglob';
  const keepAll = base === 'conflict2';
  const c3 = base === 'conflict3' || base === 'conflict4';
  const c4 = base === 'conflict4';
  const original = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8');
  if (original.split(OPENCODE_CONFLICT_PROMPT_BULLET).length !== 2) throw new Error(`OC_HARNESS_TRIM=${m}: Glob/Grep bullet not found once in the original prompt`);
  const conflictPrompt = original.replace(OPENCODE_CONFLICT_PROMPT_BULLET, '');
  let prompt = variant ? opencodeBatchPrompt(variant, conflictPrompt) : conflictPrompt;
  if (keepAll || c3) {
    if (!prompt.includes(OPENCODE_CONFLICT2_PROMPT_EDIT[0])) throw new Error(`OC_HARNESS_TRIM=${m}: "especially file reads" not found in the prompt`);
    prompt = prompt.split(OPENCODE_CONFLICT2_PROMPT_EDIT[0]).join(OPENCODE_CONFLICT2_PROMPT_EDIT[1]);
  }
  const baseEdits = c4 ? OPENCODE_CONFLICT4_TOOL_EDITS : c3 ? OPENCODE_CONFLICT3_TOOL_EDITS : keepAll ? OPENCODE_CONFLICT2_TOOL_EDITS : noglob ? OPENCODE_CONFLICT_NOGLOB_TOOL_EDITS : OPENCODE_CONFLICT_TOOL_EDITS;
  const lineEdits = (variant && opencodeBatchToolEdits(variant)) || {};
  const clash = Object.keys(lineEdits).filter(k => k in baseEdits);
  if (clash.length) throw new Error(`OC_HARNESS_TRIM=${m}: the variant and the base both edit ${clash.join(', ')}`);
  const edits = { ...baseEdits, ...lineEdits };
  const plugin = [`file://${path.join(stateDir, OPENCODE_TRIM_PLUGIN)}`, { edits, report: path.join(stateDir, OPENCODE_TRIM_REPORT) }];
  return {
    mode: c3 ? `${m}:prompt:gpt+general+noexplore+nogrep+tooldesc` : keepAll ? `${m}:prompt:gpt+general+explore-trim+alltools+tooldesc` : `${m}:prompt:gpt+general+noexplore+${noglob ? 'noglob+' : ''}nogrep+tooldesc`,
    config: {
      plugin: [plugin],
      ...(keepAll ? {} : { tools: noglob ? { glob: false, grep: false } : { grep: false } }),
      agentBuild: { prompt },
      agents: keepAll ? { general: { prompt }, explore: { prompt: readFileSync(path.join(TRIM_DIR, opencodeTrimMaxPrompt('explore')), 'utf8') } }
        : { general: { prompt }, explore: { disable: true } },
    },
    files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8') },
    plugins: [plugin],
    stateEntries: [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT],
  };
}

// Mirror of opencode 1.18.4's model → base prompt choice (`wd` in the binary, keyed on the
// provider model id). null = a family with no trimmed copy; the switch then refuses to run
// rather than trim only half the request.
export function opencodePromptFamily(apiModel) {
  const id = String(apiModel || '');
  if (id.includes('muse-spark')) return 'muse';
  if (id.includes('gpt-4') || id.includes('o1') || id.includes('o3')) return null;
  if (id.includes('gpt')) return id.includes('codex') ? null : 'gpt';
  if (id.includes('gemini-')) return null;
  if (id.includes('claude')) return 'claude';
  if (/trinity|kimi/.test(id.toLowerCase())) return null;
  return 'default';
}

// What `sweet-search init --opencode` ships (scripts/harness-prompts/index.js header): the default.
export const OC_HARNESS_TRIM_DEFAULT = 'conflict3+todo3eff3k';

/** The trim for an OC_HARNESS_TRIM value; unset / empty = OC_HARNESS_TRIM_DEFAULT. `origin` = 'default' | 'env'. */
export function opencodeHarnessTrim(mode = process.env.OC_HARNESS_TRIM, { apiModel, stateDir, env = process.env } = {}) {
  const raw = String(mode ?? '').trim();
  const origin = raw ? 'env' : 'default';
  return { ...opencodeHarnessTrimMode(raw || OC_HARNESS_TRIM_DEFAULT, { apiModel, stateDir, env }), origin };
}

function opencodeHarnessTrimMode(m, { apiModel, stateDir, env = process.env }) {
  if (m === '0') return { mode: null, config: {}, files: {}, plugins: [], stateEntries: [] };
  if (m.includes('+') || OPENCODE_CONFLICT_BASES.includes(m)) return opencodeHarnessTrimCombo(m, { apiModel, stateDir, env });
  // batch-<variant> (batching micro-smoke, trim/batch-variants.mjs): the UNTRIMMED gpt prompt
  // with only its tool-grouping bullet swapped, for the main agent and the general subagent. No
  // tool, description or subagent change: everything else equals trim off.
  if (m.startsWith('batch-')) {
    if (opencodePromptFamily(apiModel) !== 'gpt') throw new Error(`OC_HARNESS_TRIM=${m}: gpt family only (model ${apiModel})`);
    const variant = m.slice('batch-'.length);
    const prompt = opencodeBatchPrompt(variant);
    const edits = opencodeBatchToolEdits(variant);
    if (!edits) return { mode: `${m}:prompt:gpt+general`, config: { agentBuild: { prompt }, agents: { general: { prompt } } }, files: {}, plugins: [], stateEntries: [] };
    // Round-2 variants that also edit a tool description go through the trim plugin (report on the row).
    if (!stateDir) throw new Error(`OC_HARNESS_TRIM=${m}: stateDir required`);
    const plugin = [`file://${path.join(stateDir, OPENCODE_TRIM_PLUGIN)}`, { edits, report: path.join(stateDir, OPENCODE_TRIM_REPORT) }];
    return {
      mode: `${m}:prompt:gpt+general+tooldesc`,
      config: { plugin: [plugin], agentBuild: { prompt }, agents: { general: { prompt } } },
      files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8') },
      plugins: [plugin],
      stateEntries: [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT],
    };
  }
  if (!['1', 'max', 'max-todo', 'max-p1', 'v3'].includes(m)) throw new Error(`OC_HARNESS_TRIM=${m}: expected 0, 1, max, max-todo, max-p1, v3, batch-*, conflict, conflict-noglob or <base>+<variant>`);
  // v3 = round 1 (prompt, glob/grep/skill off, todowrite KEPT) + the general subagent gets the
  // same trimmed prompt (round 1 left it the untrimmed family prompt) + explore disabled (as-now
  // never delegated to it; its prompt names the disabled Glob/Grep) + OPENCODE_TRIM_V3_TOOL_EDITS.
  if (m === 'v3') return opencodeHarnessTrimV3({ apiModel, stateDir });
  // max-todo = max with todowrite KEPT. The 2026-09-26 Luna smoke lost 2 solves under max (3/6 ->
  // 1/6, shorter rollouts, narrower fixes); todowrite removal is max's only behaviour lever, so
  // this isolates it.
  // max-p1 = max-todo but with the ROUND-1 (lighter) model-family prompt, for the main agent and
  // the general subagent: isolates the second-pass prompt cuts from the tool/description cuts.
  const max = m === 'max' || m === 'max-todo' || m === 'max-p1';
  const keepTodo = m === 'max-todo' || m === 'max-p1';
  const round1Prompt = m === 'max-p1';
  const family = opencodePromptFamily(apiModel);
  if (!family) throw new Error(`OC_HARNESS_TRIM: no trimmed opencode prompt for model ${apiModel}`);
  if (!stateDir) throw new Error('OC_HARNESS_TRIM: stateDir required');
  const plugin = [`file://${path.join(stateDir, OPENCODE_TRIM_PLUGIN)}`,
    { edits: max ? OPENCODE_TRIM_MAX_TOOL_EDITS : OPENCODE_TRIM_TOOL_EDITS, report: path.join(stateDir, OPENCODE_TRIM_REPORT) }];
  const readPrompt = file => readFileSync(path.join(TRIM_DIR, file), 'utf8');
  const prompt = readPrompt(max && !round1Prompt ? opencodeTrimMaxPrompt(family) : OPENCODE_TRIM_PROMPTS[family]);
  return {
    mode: max ? `${m}:prompt:${family}+subagents+tools+tooldesc` : `prompt:${family}+tools+tooldesc`,
    config: {
      plugin: [plugin],
      tools: Object.fromEntries((max && !keepTodo ? OPENCODE_TRIM_MAX_DISABLED_TOOLS : OPENCODE_TRIM_DISABLED_TOOLS).map(name => [name, false])),
      agentBuild: { prompt },
      ...(max ? { agents: { general: { prompt }, explore: { prompt: readPrompt(opencodeTrimMaxPrompt('explore')) } } } : {}),
    },
    files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8') },
    plugins: [plugin],
    stateEntries: [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT],
  };
}

function opencodeHarnessTrimV3({ apiModel, stateDir }) {
  const family = opencodePromptFamily(apiModel);
  if (!family) throw new Error(`OC_HARNESS_TRIM: no trimmed opencode prompt for model ${apiModel}`);
  if (!stateDir) throw new Error('OC_HARNESS_TRIM: stateDir required');
  const plugin = [`file://${path.join(stateDir, OPENCODE_TRIM_PLUGIN)}`,
    { edits: OPENCODE_TRIM_V3_TOOL_EDITS, report: path.join(stateDir, OPENCODE_TRIM_REPORT) }];
  const prompt = readFileSync(path.join(TRIM_DIR, OPENCODE_TRIM_PROMPTS[family]), 'utf8');
  return {
    mode: `v3:prompt:${family}+general+noexplore+tools+tooldesc`,
    config: {
      plugin: [plugin],
      tools: Object.fromEntries(OPENCODE_TRIM_DISABLED_TOOLS.map(name => [name, false])),
      agentBuild: { prompt },
      agents: { general: { prompt }, explore: { disable: true } },
    },
    files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8') },
    plugins: [plugin],
    stateEntries: [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT],
  };
}

// --- SWEET_RULES_PLACEMENT=system (sweet-rules-placement.mjs), SWEET ARM ONLY ---
// The rules leave AGENTS.md (which keeps the frame only, native's bytes) and are appended to the
// agent prompts opencode sends as the system prompt. `agent.<name>.prompt` REPLACES the prompt
// opencode would pick (the model-family prompt for build/general, the explore prompt for
// explore); the environment block, AGENTS.md and the tools stay (verified by capture, 1.18.4).
// Every agent that can run in a rollout gets them: build (main), general and explore
// (subagents), each as (trim prompt, or opencode's UNMODIFIED prompt when the trim sets none)
// + rules. An explore the trim disables stays disabled. The unmodified prompts are opencode's own
// text from the $0 captures (MIT, trim/NOTICE-opencode.md), pinned by sha256.
const OC_CAPTURES = path.join(BENCH_DIR, 'handoffs', 'improve', 'harness-prompt-trim', 'captures');
export const OPENCODE_STOCK_PROMPTS = Object.freeze({
  gpt: { file: OPENCODE_GPT_ORIGINAL, sha256: '83a66a46a5febbc21454161d5f053638b22d25d95e09d77b8f6da33debc848ad' },
  default: { capture: 'opencode-1.18.4-request-sweet-trim-off-default.json', sha256: '962fbf3cb3ec659c9a5244425ee2e7bb141ad4428f489a630a7738566880dc6a' },
  claude: { capture: 'opencode-1.18.4-request-sweet-trim-off-claude.json', sha256: '8324e4cf58eb45d4d9d6fd120f5e8da59e0548de48e7e6aefcdfbf2923f40b4e' },
  muse: { capture: 'opencode-1.18.4-request-sweet-trim-off-muse.json', sha256: '9c5323f076a032f305386bfab3220a764f90489e9fa2a4c4796bffe031ce03e8' },
  explore: { capture: 'opencode-1.18.4-request-sweet-trim-off-explore-subagent.json', sha256: '97c4780dea390f347fed0879fb30aaa08c0fc65c8cad0f6c1aec02ca6fd91e13' },
});
/** opencode 1.18.4's unmodified prompt for a model family ('gpt' | 'default' | 'claude' | 'muse') or 'explore'. */
export function opencodeStockPrompt(name) {
  const src = OPENCODE_STOCK_PROMPTS[name];
  if (!src) throw new Error(`no captured opencode 1.18.4 prompt for ${name}`);
  let text;
  if (src.file) text = readFileSync(src.file, 'utf8');
  else {
    // The system message is the prompt, a joining newline, then the environment block.
    const content = JSON.parse(readFileSync(path.join(OC_CAPTURES, src.capture), 'utf8')).messages[0].content;
    const whole = typeof content === 'string' ? content : content.map(p => p.text || '').join('');
    text = whole.slice(0, whole.indexOf('You are powered by the model named') - 1);
  }
  const sha = createHash('sha256').update(text).digest('hex');
  if (sha !== src.sha256) throw new Error(`opencode ${name} prompt sha256 ${sha} is not the pinned 1.18.4 text`);
  return text;
}
/** `trim` (opencodeHarnessTrim's result) with the rules appended to every agent prompt; `rules` null = unchanged. */
export function opencodeRulesInSystem(trim, { rules, apiModel }) {
  if (!rules) return trim;
  const config = trim?.config || {};
  const agents = config.agents || {};
  const stockFamily = () => {
    const family = opencodePromptFamily(apiModel);
    if (!family) throw new Error(`SWEET_RULES_PLACEMENT=system: no captured opencode prompt for model ${apiModel}`);
    return opencodeStockPrompt(family);
  };
  const withRules = text => appendSweetRules(text, rules);
  const explore = agents.explore?.disable ? agents.explore
    : { ...(agents.explore || {}), prompt: withRules(agents.explore?.prompt ?? opencodeStockPrompt('explore')) };
  return {
    ...trim,
    config: {
      ...config,
      agentBuild: { ...(config.agentBuild || {}), prompt: withRules(config.agentBuild?.prompt ?? stockFamily()) },
      agents: {
        ...agents,
        general: { ...(agents.general || {}), prompt: withRules(agents.general?.prompt ?? stockFamily()) },
        explore,
      },
    },
  };
}

// --- SWEET_RULES_PLACEMENT=config (sweet-rules-placement.mjs), SWEET ARM ONLY ---
// The rules leave AGENTS.md (frame only, native's bytes) for opencode's own `instructions`
// config key: the rules block is written to OPENCODE_RULES_FILE in the runner's PRIVATE state
// dir (the dir opencode.json and the trim plugin already live in — bound at the same path in the
// jail, and never part of the graded repo), and its ABSOLUTE path is appended to the config's
// `instructions` array. opencode 1.18.4 loads those files like AGENTS.md ("Instructions from:
// <path>" + content, checked by $0 capture). The agent prompts are NOT touched, so this combines
// with every OC_HARNESS_TRIM base unchanged. `rules` null = the trim object is returned untouched.
export const OPENCODE_RULES_FILE = 'sweet-search-rules.md';
export function opencodeRulesInConfig(trim, { rules, stateDir }) {
  if (!rules) return trim;
  if (!stateDir) throw new Error('SWEET_RULES_PLACEMENT=config: stateDir required');
  const config = trim?.config || {};
  return {
    ...trim,
    config: { ...config, instructions: [...(config.instructions || []), path.join(stateDir, OPENCODE_RULES_FILE)] },
    files: { ...(trim?.files || {}), [OPENCODE_RULES_FILE]: String(rules) },
    stateEntries: [...(trim?.stateEntries || []), OPENCODE_RULES_FILE],
  };
}

// SWEET ARM ONLY — native has no ss-* rules to contradict and keeps opencode's full prompt
// and tools in every condition, whatever the switch says.
export function opencodeArmHarnessTrim({ sweet, env = process.env, apiModel, stateDir } = {}) {
  return opencodeHarnessTrim(sweet ? env.OC_HARNESS_TRIM : '0', { apiModel, stateDir, env });
}

// UNJAILED (SS_ISOLATION=0, e.g. the owner's Mac): the jail's $HOME mask and the ocData bind
// do not exist, so opencode would load the OPERATOR's ~/.config/opencode (plugins, agents,
// MCP servers, AGENTS.md), ~/.opencode, ~/.claude/CLAUDE.md and the ~/.claude + ~/.agents
// skills into the agent, read ~/.local/share/opencode/auth.json, and write its session DB
// there instead of ocData. 1.18.4 takes its config/data/state dirs from XDG_*_HOME and every
// home-relative lookup from OPENCODE_TEST_HOME ?? os.homedir() (verified in the binary and
// by capture). Point all of them at private per-rollout dirs; data/opencode is a link to
// ocData so the session DB lands where the cost reader looks. $HOME itself is untouched, so
// the agent's shell (git, ss-* caches) behaves as in the jail. XDG_CACHE_HOME stays unset:
// ~/.cache/opencode holds only models.json and provider SDKs (read-only in the jail too).
export function opencodeUnjailedEnv({ root, ocData }) {
  const dirs = { config: path.join(root, 'config'), data: path.join(root, 'data'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const link = path.join(dirs.data, 'opencode');
  if (!existsSync(link)) symlinkSync(ocData, link, 'dir');
  return {
    XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state,
    OPENCODE_TEST_HOME: dirs.home,
  };
}

// Runner-enforced hard turn budget (EDIT_THRASHING §7). OpenCode's own loop
// stops at agent.build.maxSteps — no model cooperation involved, which is the
// point: Grok-4.5 ignores mid-task behavioral instructions in every channel
// (TURNFIX results doc §12.5), so the only reliable tail cap is one the runner
// owns. Absent/invalid env → config byte-identical to the pre-cap harness.
export function resolveHardTurnCap(env = process.env) {
  const raw = String(env.SS_HARD_TURN_CAP || '').trim();
  if (!raw) return null;
  const cap = Number(raw);
  if (!Number.isInteger(cap) || cap < 5 || cap > 500) {
    throw new Error('SS_HARD_TURN_CAP must be an integer between 5 and 500');
  }
  return cap;
}

// `trim` is opencodeHarnessTrim's result; off (or absent) it adds nothing, so the config is
// byte-identical to the pre-trim harness.
export function buildMainOpencodeConfig({ env = process.env, trim = null } = {}) {
  const cap = resolveHardTurnCap(env);
  const { plugin = [], tools, agentBuild = {}, agents = {}, instructions } = trim?.config || {};
  const build = { ...(cap ? { maxSteps: cap } : {}), ...agentBuild };
  const agent = { ...(Object.keys(build).length ? { build } : {}), ...agents };
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin,
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}' } } },
    permission: { bash: 'allow', edit: 'allow', write: 'allow', read: 'allow', webfetch: 'deny', websearch: 'deny' },
    ...(tools ? { tools } : {}),
    ...(Object.keys(agent).length ? { agent } : {}),
    ...(instructions?.length ? { instructions } : {}),
  };
}

const classifyShell = (cmd) => classifyShellCommand(cmd).kind;   // shell-command-kind.mjs

// opencode built-in tool name → bucket. `bash` unwraps to the shell command.
function classifyTool(tool, input) {
  const name = String(tool || '').toLowerCase();
  if (name === 'bash' || name === 'shell') return { kind: classifyShell(input?.command || input?.cmd), command: input?.command || input?.cmd || '' };
  if (name === 'edit' || name === 'write' || name === 'patch' || name === 'multiedit') return { kind: 'edit', command: `${name} ${input?.filePath || input?.path || input?.file_path || ''}` };
  if (name === 'read') return { kind: 'nativeRead', command: `read ${input?.filePath || input?.path || ''}` };
  if (name === 'grep' || name === 'glob' || name === 'list') return { kind: 'nativeGrep', command: `${name} ${JSON.stringify(input?.pattern ?? input?.query ?? '')}` };
  return { kind: 'bash', command: `${name} ${JSON.stringify(input || {}).slice(0, 160)}` };
}

// Parse opencode `run --format json` NDJSON. Defensive: the schema is reverse-engineered,
// so it handles both an envelope-with-`part` and a flat event, and both camel/snake keys.
export function parseOpencodeStream(stdout) {
  const calls = new Map();
  const callOrder = [];
  const turns = [];
  const errors = [];
  let answer = '';
  let sessionID = null;
  if (!stdout) return { toolCalls: [], answer, turns, errors, sessionID };
  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    sessionID = sessionID || ev.sessionID || ev.sessionId || ev.session_id || ev.part?.sessionID || null;
    const p = ev.part || ev.properties?.part || ev;
    const type = ev.type || p.type;
    if (type === 'tool_use' || type === 'tool' || (p && p.tool && (p.state || p.callID || p.callId))) {
      const st = p.state || {};
      const { kind, command } = classifyTool(p.tool, st.input || p.input);
      const out = st.output || p.output || '';
      const status = st.status || p.status;
      const callId = String(p.callID || p.callId || st.callID || st.callId || `line-${callOrder.length}`);
      const prior = calls.get(callId);
      if (!prior) callOrder.push(callId);
      calls.set(callId, {
        kind, command,
        resultText: typeof out === 'string' ? out : JSON.stringify(out || '').slice(0, 600),
        isError: status === 'error', modelTurn: prior?.modelTurn ?? (turns.length + 1),
        messageId: p.messageID || p.messageId || p.message_id
          || ev.messageID || ev.messageId || ev.message_id || prior?.messageId || null,
      });
    } else if (type === 'step_finish' || type === 'step-finish') {
      turns.push(opencodeStepFinishTurn(p));
    } else if (type === 'text') {
      if (typeof p.text === 'string' && p.text.trim()) answer = p.text;
    } else if (type === 'error') {
      errors.push(`error: ${String(p.message || p.error || JSON.stringify(p)).slice(0, 300)}`);
    }
  }
  return { toolCalls: callOrder.map(id => calls.get(id)), answer, turns, errors, sessionID };
}

// One model request = one step-finish part, from the stream or from the session DB (same basis).
// cache.write is opencode's prompt-cache-creation count. It is folded into `in` (so the
// context size stays right) AND published separately, so the realized column can charge
// it at the provider's 1.25x creation rate — the same basis claude-code has always used
// (G17). Dropping the separate field puts opencode back on the old, cheaper basis.
export function opencodeStepFinishTurn(p) {
  const tk = p?.tokens || {};
  const cache = tk.cache || {};
  const cRead = cache.read || 0, cWrite = cache.write || 0;
  return { in: (tk.input || 0) + cRead + cWrite, cached: cRead, cacheWrite: cWrite, out: (tk.output || 0) + (tk.reasoning || 0) };
}

// ─── subagent (child-session) spend ────────────────────────────────────────────────────────────
// `opencode run --format json` streams ONLY the main session. A `task` tool call (explore /
// general subagent) runs in a CHILD session (session.parent_id = the caller's session id) whose
// requests and tool calls never reach the stream, so a ledger built from the stream is main-only.
// Found 2026-10-04 (final-run TRACES-oc.md): native delegated to explore in 3 of 30 questions,
// $0.27 off the row ledger; one child alone (composer-07) was $0.148, 2.3x the main session.
// The bench cost definition is sidechain-INCLUSIVE (task-bench preregistration), so the child
// sessions are read back from opencode's session DB (<ocData>/opencode.db) and priced with the
// SAME per-turn function as the main session, each child as its own context.
//
// Pure part: rows of the session DB in, one set per descendant session out (depth-first,
// creation order). Set shape = claude-code-accounting's sidechain sets, so
// addSidechainCostsChecked prices both harnesses one way.
//   db = { sessions: [{ id, parent_id, agent, title, time_created }],
//          messages: [{ session_id, role }], parts: [{ session_id, data }] }  (parts in time order)
export function opencodeChildSessionSets(db, mainSessionID) {
  if (!mainSessionID) return [];
  const kids = new Map();
  for (const s of db.sessions || []) {
    if (!s.parent_id) continue;
    if (!kids.has(s.parent_id)) kids.set(s.parent_id, []);
    kids.get(s.parent_id).push(s);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.time_created ?? 0) - (b.time_created ?? 0) || (a.id < b.id ? -1 : 1));
  const order = [];
  const seen = new Set([mainSessionID]);
  const visit = (id, depth) => {
    for (const s of kids.get(id) || []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id); order.push({ s, depth }); visit(s.id, depth + 1);
    }
  };
  visit(mainSessionID, 1);
  return order.map(({ s, depth }) => {
    const turns = [], toolKinds = {};
    let toolCalls = 0;
    for (const row of db.parts || []) {
      if (row.session_id !== s.id) continue;
      const p = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (p?.type === 'step-finish' || p?.type === 'step_finish') turns.push(opencodeStepFinishTurn(p));
      else if (p?.type === 'tool') {
        toolCalls++;
        const { kind } = classifyTool(p.tool, p.state?.input || p.input);
        toolKinds[kind] = (toolKinds[kind] || 0) + 1;
      }
    }
    const assistantMessages = (db.messages || []).filter(m => m.session_id === s.id && m.role === 'assistant').length;
    return {
      name: s.id, parentId: s.parent_id, agent: s.agent ?? null, title: s.title ?? null, depth,
      turns, toolCalls, toolKinds, assistantMessages, usageMessages: turns.length,
      // Every assistant message is one request and ends in exactly one step-finish. A message
      // without one (aborted / killed mid-request) has unknown usage: fail closed.
      instrumentationComplete: assistantMessages === turns.length,
    };
  });
}

// DB part: read the rows opencodeChildSessionSets needs. Throws when the DB cannot be read; the
// caller must then publish the row as cost-incomplete, never as main-only.
export function readOpencodeChildSessions(dbPath, mainSessionID) {
  if (!mainSessionID) return [];
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const sessions = db.prepare('select id, parent_id, agent, title, time_created from session where parent_id is not null').all();
    const ids = opencodeChildSessionSets({ sessions }, mainSessionID).map(x => x.name);
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    const messages = db.prepare(`select session_id, json_extract(data, '$.role') as role from message where session_id in (${ph})`).all(...ids);
    const parts = db.prepare(`select session_id, data from part where session_id in (${ph}) order by time_created, id`).all(...ids);
    return opencodeChildSessionSets({ sessions, messages, parts }, mainSessionID);
  } finally { db.close(); }
}

// Row cost fields of one opencode rollout: main session + every child session, under the one
// cost definition (costsFromTurns per context, summed by addSidechainCostsChecked). childSets =
// null means the session DB could not be read: the inclusive columns are then null and
// costRealizedLowerBoundUsd carries the main-only figure (the claude-code fail-closed rule).
// Main-only numbers stay on the row (…MainOnly…) for comparison with pre-2026-10-04 rows.
export function opencodeRowCosts({ mainTurns, childSets, price }) {
  const main = costsFromTurns(mainTurns, price);
  const sum = (ts, k) => ts.reduce((a, t) => a + (Number(t[k]) || 0), 0);
  const usageMainOnly = { turns: mainTurns.length, in: sum(mainTurns, 'in'), out: sum(mainTurns, 'out') };
  if (childSets == null) {
    // Every inclusive column null (the same set addSidechainCostsChecked nulls for an incomplete
    // sidechain), main-only columns and the lower bound kept.
    const unread = addSidechainCostsChecked(main, [{ name: 'session-db-unread', turns: [], instrumentationComplete: false }], price);
    return {
      costs: { ...unread, sidechainCount: null, incompleteSidechains: ['session-db-unread'] },
      fields: {
        usage: null, usageMainOnly,
        costRealizedUsd: null, costNaiveUsd: null,
        costRealizedMainOnlyUsd: main.costRealizedUsd, costNaiveMainOnlyUsd: main.costNaiveUsd,
        costRealizedLowerBoundUsd: main.costRealizedUsd, costSidechainUsd: null,
        subagentSessionsRead: false, subagentContexts: null, subagentTurns: null, subagentCalls: null,
        costAccountingComplete: false,
      },
    };
  }
  // A child that never sent a request costs nothing and is no evidence of missing usage.
  const sets = childSets.filter(s => s.assistantMessages > 0 || s.usageMessages > 0);
  const costs = addSidechainCostsChecked(main, sets, price);
  const childTurns = sets.flatMap(s => s.turns);
  const childNaive = sets.reduce((a, s) => a + (s.turns.length ? costsFromTurns(s.turns, price).costNaiveUsd : 0), 0);
  const subagentToolKinds = {};
  for (const s of childSets) for (const [k, n] of Object.entries(s.toolKinds || {})) subagentToolKinds[k] = (subagentToolKinds[k] || 0) + n;
  return {
    costs,
    fields: {
      usage: { turns: mainTurns.length + childTurns.length, in: usageMainOnly.in + sum(childTurns, 'in'), out: usageMainOnly.out + sum(childTurns, 'out') },
      usageMainOnly,
      costRealizedUsd: costs.costRealizedUsd ?? null, costNaiveUsd: costs.costNaiveUsd ?? null,
      costRealizedMainOnlyUsd: main.costRealizedUsd, costNaiveMainOnlyUsd: main.costNaiveUsd,
      costRealizedLowerBoundUsd: costs.costRealizedLowerBoundUsd ?? null,
      costSidechainUsd: costs.costSidechainUsd ?? null,
      costNaiveSidechainUsd: +childNaive.toFixed(6),
      subagentSessionsRead: true,
      subagentContexts: childSets.length,
      subagentAgents: childSets.map(s => s.agent),
      subagentTurns: childTurns.length,
      subagentCalls: childSets.reduce((a, s) => a + s.toolCalls, 0),
      subagentToolKinds,
      costAccountingComplete: costs.sidechainAccountingComplete !== false,
    },
  };
}

/**
 * The stdin text that makes `opencode run` (1.18.4) send the SAME message bytes the argv form
 * sent (2026-09-29; the prompt left argv because `ps` showed it to concurrent rollouts).
 *
 * `opencode run --help` documents only the positional message, so this is read from the pinned
 * 1.18.4 binary's bundled source (the `run` handler):
 *   P = [...message, ...--].map(a => a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a).join(" ")
 *   u = process.stdin.isTTY ? undefined : await Bun.stdin.text()
 *   P = !P ? u : !u ? P : P + "\n" + u          then parts: [{ type: "text", text: P }]
 * So an argv prompt with a space was sent wrapped in double quotes, inner quotes
 * backslash-escaped (the capture handoffs/improve/harness-prompt-trim/captures/
 * opencode-1.18.4-request-sweet-trim-off-gpt.json has the user message `"=== ISSUE ===\n..."`
 * with the quotes), and with no positional the message is stdin verbatim. This returns the
 * argv-form message, so the model's input does not change. Pinned to 1.18.4: re-check on a bump.
 */
export function opencodeRunMessage(prompt) {
  const text = String(prompt ?? '');
  return text.includes(' ') ? `"${text.replace(/"/g, '\\"')}"` : text;
}

// OC_SUBSCRIPTION=openai (opt-in; unset = OpenRouter exactly as before): the model runs on opencode's
// built-in `openai` provider with the operator's ChatGPT login, as the retrieval bench's oc-sol61-high
// cell does (scripts/retrieval-bench-282.mjs ocSeedAuth / ocSyncAuthBack). The master entry in
// ~/.local/share/opencode/auth.json is copied into the rollout's private data dir, and a refreshed entry
// is written back after the rollout: OAuth refresh tokens are single-use (the codex auth-decay trap).
// Only that provider's entry is ever touched. Legs using it run CONCURRENCY=1 (one refresh at a time).
const MASTER_OC_AUTH = path.join(process.env.HOME || '/root', '.local/share/opencode/auth.json');
const readJsonOr = (f, d = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
export function ocSeedAuth(ocData, provider, master = MASTER_OC_AUTH) {
  const entry = readJsonOr(master)?.[provider];
  if (!entry) throw new Error(`OC_SUBSCRIPTION=${provider}: no ${provider} login in ${master} — run: opencode auth login`);
  writeFileSync(path.join(ocData, 'auth.json'), JSON.stringify({ [provider]: entry }, null, 2), { mode: 0o600 });
}
export function ocSyncAuthBack(ocData, provider, master = MASTER_OC_AUTH) {
  const mine = readJsonOr(path.join(ocData, 'auth.json'))?.[provider];
  const all = readJsonOr(master);
  if (!mine || !all || JSON.stringify(all[provider]) === JSON.stringify(mine)) return false;
  if ((mine.expires ?? 0) < (all[provider]?.expires ?? 0)) return false; // master is already newer
  const tmp = `${master}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ ...all, [provider]: mine }, null, 2), { mode: 0o600 });
  renameSync(tmp, master);
  return true;
}

export async function runOpencodeTask(task, {
  arm, apiModel = 'x-ai/grok-4.5', ssBinDir, mppText, image, t, perCallTimeoutMs = 900000,
} = {}) {
  const sweet = arm === 'sweet';
  const rundir = task.repoCheckout;
  const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
  const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');
  const price = priceFor(apiModel);
  const openrouterModel = `openrouter/${apiModel}`;
  const ocSubscription = process.env.OC_SUBSCRIPTION || null;
  if (ocSubscription && !apiModel.startsWith(`${ocSubscription}/`)) throw new Error(`OC_SUBSCRIPTION=${ocSubscription}: MODEL ${apiModel} is not a ${ocSubscription}/ model`);
  const ocModel = ocSubscription ? apiModel : openrouterModel;

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // opencode's own state, per rollout instead of the shared 1.8 GB store (see
  // rolloutStateDir): config + provider SDKs read-only, session DB private and retained.
  const ocData = rolloutStateDir(label, 'opencode-data');
  if (ocSubscription) ocSeedAuth(ocData, ocSubscription);
  const retainedRoot = rolloutStateDir(label, 'opencode-retained');
  const retainedSession = path.join(retainedRoot, `session-${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(retainedSession, { recursive: true, mode: 0o700 });
  const ambientConfigDir = path.join(process.env.HOME || '/root', '.config/opencode');
  const extraBinds = [
    { src: path.join(process.env.HOME || '/root', '.cache/opencode'), dst: path.join(process.env.HOME || '/root', '.cache/opencode'), ro: true },
    { src: ocData, dst: path.join(process.env.HOME || '/root', '.local/share/opencode') },
  ];
  // Inject before runner setup so T0 can fingerprint this harness-owned surface and
  // distinguish it from a later agent modification without retaining it in checkpoints.
  // SWEET_RULES_PLACEMENT (opencode default 'config' = the product): 'config' and 'system' leave
  // AGENTS.md the frame only; the rules go to an `instructions` file (opencodeRulesInConfig) or the
  // agent prompts (opencodeRulesInSystem). Resolved first so a bad value fails before any setup.
  const rulesPlacement = resolveSweetRulesPlacement({ sweet, harness: 'opencode' });
  writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText, rulesPlacement });
  const {
    runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir, controller,
    progressConfig,
  } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, taskId: task.id, arm, extraBinds, extraMasks: [ambientConfigDir], requireBins: ['opencode'],
    injectedFiles: ['AGENTS.md'], installSeds: installSedCmds(t),
  });
  // Per-run opencode config: OpenRouter provider (key via {env:} substitution) + permissive
  // permissions so the headless agent edits/bashes without prompts (the #13851 write-gap
  // mitigation is `build` agent + explicit allow + --auto), and web tools denied (host
  // /etc/hosts lockdown already blocks egress, this stops opencode's own fetch/search).
  // Harness trim (sweet arm only; default = the product, conflict3+todo3eff3k, any model; 0 =
  // stock, adding nothing to config, env or argv).
  let harnessTrim;
  try {
    harnessTrim = opencodeArmHarnessTrim({ sweet, apiModel, stateDir: runnerStateDir });
    harnessTrim = opencodeRulesInSystem(harnessTrim, {
      rules: rulesPlacement === 'system' ? sweetRulesBlock({ mppText }) : null, apiModel,
    });
    // SWEET_RULES_PLACEMENT=config: rules file in the runner state dir + config `instructions`.
    harnessTrim = opencodeRulesInConfig(harnessTrim, {
      rules: rulesPlacement === 'config' ? sweetRulesBlock({ mppText }) : null, stateDir: runnerStateDir,
    });
  } catch (error) {
    teardownRunner(runnerStateDir, { jail, broker });
    throw error;
  }
  for (const [name, text] of Object.entries(harnessTrim.files)) writeFileSync(path.join(runnerStateDir, name), text);
  const ocConfig = path.join(runnerStateDir, 'opencode.json');
  const ocConfigValue = buildMainOpencodeConfig({ trim: harnessTrim });
  const ocConfigText = JSON.stringify(ocConfigValue);
  writeFileSync(ocConfig, ocConfigText);
  const retainedConfig = path.join(retainedSession, 'opencode.generated.json');
  writeFileSync(retainedConfig, ocConfigText + '\n', { mode: 0o600 });

  // PLAN.md §3 B6 (2026-07-30): opencode's bash tool defaults to a 120 s timeout
  // (`bashDefaultTimeoutMs ?? 120000` in the bundle) while the harness gives a suite
  // 300 s and the run_tests requester waits `2*tSec+120` for the broker's baseline+current
  // pair. A 120 s agent-side kill therefore orphans the broker's response on ANY suite over
  // two minutes — which reads as `shimTampered`, forces the policy re-run, and can exclude
  // the task. Raise it above the requester deadline so the harness's own budget is the only
  // thing that can time a test run out. Caller-overridable; opencode ignores the var if a
  // future build drops it, in which case the 120 s default is back and B6 reopens.
  const rtDeadlineSec = 2 * (t._testTimeoutSec || 300) + 120;
  const agentBashTimeoutMs = Number(process.env.SS_AGENT_BASH_TIMEOUT_MS) || (rtDeadlineSec + 60) * 1000;
  // No jail → no masks or binds: give opencode private dirs instead (see opencodeUnjailedEnv).
  // Jailed runs add nothing.
  const unjailedEnv = jail ? {} : opencodeUnjailedEnv({ root: rolloutStateDir(label, 'opencode-home'), ocData });
  const env = buildAgentEnv({
    rundir, binDir, ssBinDir, sweet, jail,
    extraEnv: {
      ...unjailedEnv,
      OPENCODE_CONFIG: ocConfig,
      OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: String(agentBashTimeoutMs),
      // ss-* gutter form pinned per harness (core/search/gutter-form.js): opencode → `N:`.
      // Pinned so the timed run never pays a process-tree walk; operator env (A/B arm) wins.
      SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'none',
    },
  });
  let preflight;
  try {
    const checked = await runOpencodePreflight({ cwd: rundir, env, jail, plugins: harnessTrim.plugins });
    const { resolved } = checked;
    const apiKey = String(process.env.OPENROUTER_API_KEY || '');
    let safeResolved = JSON.stringify(sanitizedConfig(resolved));
    if (apiKey) safeResolved = safeResolved.replaceAll(apiKey, '[REDACTED]');
    const resolvedPath = path.join(retainedSession, 'opencode.resolved.sanitized.json');
    writeFileSync(resolvedPath, safeResolved + '\n', { mode: 0o600 });
    preflight = {
      valid: true, version: PINNED_OPENCODE_VERSION, pluginCount: 0,
      attempts: checked.attempts, processFailures: checked.processFailures,
      resolvedConfigPath: retainedPath(resolvedPath),
      resolvedConfigSha256: createHash('sha256').update(safeResolved).digest('hex'),
    };
  } catch (error) {
    teardownRunner(runnerStateDir, { jail, broker });
    throw new Error(`OpenCode exact-config preflight failed: ${error.message}`);
  }
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). Frame + M± live in AGENTS.md above.
  const prompt = issuePrompt(task.problem_statement);
  // The prompt rides on stdin, never in argv (see spawnWithTimeout). opencodeRunMessage keeps
  // the message the model gets byte-identical to the argv form.
  // OC_VARIANT (opt-in; unset = byte-identical args to before): opencode's reasoning variant
  // (--variant high = reasoning_effort high), as the retrieval bench's oc-sol61-high cell sends it.
  // REASONING is NOT read here — earlier opencode legs passed REASONING=medium with no effect.
  const ocVariant = process.env.OC_VARIANT || null;
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', ocModel, ...(ocVariant ? ['--variant', ocVariant] : []), '--dir', rundir];
  if (ocSubscription === 'openai') delete env.OPENAI_API_KEY; // the subscription login must pay, never a key
  const stdinText = opencodeRunMessage(prompt);

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('opencode', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail, stdinText });
  let r = await spawnOnce();
  const retentionOptions = { secrets: [process.env.OPENROUTER_API_KEY] };
  const rawAttempts = [retainOpencodeAttempt(retainedSession, 1, r, retentionOptions)];
  let parsed = parseOpencodeStream(r.stdout);
  let startRetried = false;
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [opencode-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors[0] ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    rawAttempts.push(retainOpencodeAttempt(retainedSession, 2, r, retentionOptions));
    parsed = parseOpencodeStream(r.stdout);
  }
  const wallMs = Date.now() - t0;
  const ocAuthSynced = ocSubscription ? ocSyncAuthBack(ocData, ocSubscription) : null;
  const { toolCalls, answer, turns, errors } = parsed;
  const progressTurnMap = finalizeProgressModelTurns(progressConfig, toolCalls);

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  // D-6 row telemetry (HANDOFF-SLATE-A-RESIDUE §3.G.2). Fed the tool calls, NOT the
  // trajectory: buildTrajectory truncates results at 600 chars and the verdict footer is the
  // last line a completed run writes, so reading it off the trajectory would under-count.
  const rtTelemetry = runTestsTelemetry(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  const apiKeyLeak = String(process.env.OPENROUTER_API_KEY || '');
  const secretLeakDetected = rawAttempts.some(attempt => attempt.secretLeakDetected)
    || (apiKeyLeak && finalPatch.includes(apiKeyLeak));
  // NO patchFiles backfill into toolCounts.edit (PLAN.md §3 B3): it fired on 9/196 sweet
  // vs 1/197 native rollouts — an asymmetry created by shell-routed edits, not by the
  // arms' actual edit behaviour — and silently made an observed-tool-call counter mean
  // two different things. toolCounts.edit is now strictly "edit-tool calls seen"; every
  // patch-derived metric reads patchFiles/patchHunks here or preds-*.jsonl downstream.

  // Sidechain-inclusive cost (2026-10-04): the stream holds only the main session; a `task`
  // subagent runs in a child session that only the session DB (ocData/opencode.db) records.
  // Unreadable DB → inclusive cost columns null (fail closed), main-only kept.
  let childSets = null;
  try {
    childSets = parsed.sessionID ? readOpencodeChildSessions(path.join(ocData, 'opencode.db'), parsed.sessionID)
      : (turns.length ? null : []);
  } catch (error) {
    console.log(`  [OC-SUBAGENT-COST ${task.id || ''}] session DB unreadable (${error.message}) — cost columns null`);
  }
  const { costs, fields: subagentFields } = opencodeRowCosts({ mainTurns: turns, childSets, price });
  // P7: keep the per-turn array (PLAN.md §3 B1). opencode's step_finish events are the
  // exact per-turn split; without this the next forensics pass is algebraic again.
  const turnsFile = persistTurns(label, turns, {
    task: task.id, arm, harness: 'opencode', model: apiModel, price, source: 'stream',
  });
  // opencode.json is this adapter's own generated config and lives in the runner state
  // dir by design; declare it so the tamper check does not read it as an injected file.
  // The same holds for the trim plugin and its report when the switch is on.
  const shimTamperedFiles = verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir, allowedStateEntries: ['opencode.json', ...harnessTrim.stateEntries] });
  const trimReportPath = path.join(runnerStateDir, OPENCODE_TRIM_REPORT);
  const harnessTrimToolEdits = harnessTrim.mode && existsSync(trimReportPath)
    ? JSON.parse(readFileSync(trimReportPath, 'utf8')) : null;
  if (harnessTrim.mode && harnessTrim.plugins.length && !harnessTrimToolEdits) console.log(`  [HARNESS-TRIM ${task.id || ''}] plugin wrote no report — tool descriptions were NOT trimmed`);
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  // Audit BEFORE teardown: the jail handle carries the wall-clock window that attributes
  // egress denials to this rollout.
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });
  if (secretLeakDetected) throw new Error('secret-leak tripwire fired; retained text was redacted');

  const callsMainOnly = toolCalls.length;
  const calls = callsMainOnly + (Number(subagentFields.subagentCalls) || 0);
  return {
    ...controller,
    rtProgressTurnMapComplete: progressTurnMap.complete,
    openCodePreflight: preflight,
    openCodeConfigPath: retainedPath(retainedConfig),
    openCodeConfigSha256: createHash('sha256').update(ocConfigText).digest('hex'),
    openCodeRawAttempts: rawAttempts,
    openCodeDataDir: retainedPath(ocData),
    openCodeHome: jail ? 'jail-mask' : 'private-xdg',
    // OC_HARNESS_TRIM mode ('conflict3+todo3eff3k:prompt:gpt+general+noexplore+nogrep+tooldesc' =
    // the product default, 'max:prompt:<family>+subagents+tools+tooldesc', ...) or null when off;
    // harnessTrimSource = 'default' | 'env' (sweet only); when on, the
    // plugin's own report of the description edits it applied (null = it never ran).
    harnessTrim: harnessTrim.mode,
    ...(ocVariant ? { ocVariant } : {}),
    ...(ocSubscription ? { ocSubscription, ocModel, ocAuthSynced } : {}),
    ...(sweet ? { harnessTrimSource: harnessTrim.origin } : {}),
    ...(harnessTrim.mode ? { harnessTrimToolEdits } : {}),
    ...sweetRulesRowFields(rulesPlacement, { sweet }),
    secretLeakDetected: false,
    toolKindVersion: TOOL_KIND_VERSION, // shell-command-kind.mjs: never pool ss/toolCounts across versions
    // calls = main + subagent tool calls; ss / nativeGrep / toolCounts stay main-session counts.
    calls, callsMainOnly, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? callsMainOnly, nudges: 0, ...rtTelemetry,
    hardTurnCap: resolveHardTurnCap(),
    budgetExhausted: resolveHardTurnCap() !== null && turns.length >= resolveHardTurnCap(),
    exitReason: exitReasonFrom(r),
    usage: turns.length ? { turns: subagentFields.usage?.turns ?? null } : {},
    usageMainOnly: { turns: turns.length },
    ...costs, turnsFile, ...firstRequestCacheFields(turns),
    sessionID: parsed.sessionID ?? null,
    costNaiveMainOnlyUsd: subagentFields.costNaiveMainOnlyUsd,
    subagentSessionsRead: subagentFields.subagentSessionsRead, subagentContexts: subagentFields.subagentContexts,
    subagentAgents: subagentFields.subagentAgents ?? null, subagentTurns: subagentFields.subagentTurns,
    subagentCalls: subagentFields.subagentCalls, subagentToolKinds: subagentFields.subagentToolKinds ?? null,
    costAccountingComplete: subagentFields.costAccountingComplete,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
