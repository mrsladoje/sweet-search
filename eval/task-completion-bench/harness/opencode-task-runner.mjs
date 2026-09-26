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
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  costsFromTurns, spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { runTestsTelemetry } from './rt-inflight.mjs';
import { installSedCmds } from './env-ledger.mjs';
import { persistTurns } from './turn-log.mjs';
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

// --- HARNESS TRIM (OC_HARNESS_TRIM, default OFF) — handoffs/improve/harness-prompt-trim ---
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
// Mode values: unset/'0' = off (config, env and argv byte-identical), '1' = on (round 1,
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

export function opencodeHarnessTrim(mode = process.env.OC_HARNESS_TRIM, { apiModel, stateDir } = {}) {
  const m = String(mode ?? '').trim();
  if (!m || m === '0') return { mode: null, config: {}, files: {}, plugins: [], stateEntries: [] };
  if (!['1', 'max', 'max-todo', 'max-p1', 'v3'].includes(m)) throw new Error(`OC_HARNESS_TRIM=${m}: expected 0, 1, max, max-todo, max-p1 or v3`);
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
    files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(path.join(TRIM_DIR, OPENCODE_TRIM_PLUGIN), 'utf8') },
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
    files: { [OPENCODE_TRIM_PLUGIN]: readFileSync(path.join(TRIM_DIR, OPENCODE_TRIM_PLUGIN), 'utf8') },
    plugins: [plugin],
    stateEntries: [OPENCODE_TRIM_PLUGIN, OPENCODE_TRIM_REPORT],
  };
}

// SWEET ARM ONLY — native has no ss-* rules to contradict and keeps opencode's full prompt
// and tools in every condition, whatever the switch says.
export function opencodeArmHarnessTrim({ sweet, env = process.env, apiModel, stateDir } = {}) {
  return opencodeHarnessTrim(sweet ? env.OC_HARNESS_TRIM : '0', { apiModel, stateDir });
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
  const { plugin = [], tools, agentBuild = {}, agents = {} } = trim?.config || {};
  const build = { ...(cap ? { maxSteps: cap } : {}), ...agentBuild };
  const agent = { ...(Object.keys(build).length ? { build } : {}), ...agents };
  return {
    $schema: 'https://opencode.ai/config.json',
    plugin,
    provider: { openrouter: { options: { apiKey: '{env:OPENROUTER_API_KEY}' } } },
    permission: { bash: 'allow', edit: 'allow', write: 'allow', read: 'allow', webfetch: 'deny', websearch: 'deny' },
    ...(tools ? { tools } : {}),
    ...(Object.keys(agent).length ? { agent } : {}),
  };
}

function classifyShell(cmd) {
  const c = String(cmd || '').trim();
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace|batch)|sweet-search)\b/.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

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
    sessionID = sessionID || ev.sessionID || ev.sessionId || ev.session_id || null;
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
      const tk = p.tokens || {};
      const cache = tk.cache || {};
      const cRead = cache.read || 0, cWrite = cache.write || 0;
      // cache.write is opencode's prompt-cache-creation count. It is folded into `in` (so the
      // context size stays right) AND published separately, so the realized column can charge
      // it at the provider's 1.25x creation rate — the same basis claude-code has always used
      // (G17). Dropping the separate field puts opencode back on the old, cheaper basis.
      turns.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, cacheWrite: cWrite, out: (tk.output || 0) + (tk.reasoning || 0) });
    } else if (type === 'text') {
      if (typeof p.text === 'string' && p.text.trim()) answer = p.text;
    } else if (type === 'error') {
      errors.push(`error: ${String(p.message || p.error || JSON.stringify(p)).slice(0, 300)}`);
    }
  }
  return { toolCalls: callOrder.map(id => calls.get(id)), answer, turns, errors, sessionID };
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

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // opencode's own state, per rollout instead of the shared 1.8 GB store (see
  // rolloutStateDir): config + provider SDKs read-only, session DB private and retained.
  const ocData = rolloutStateDir(label, 'opencode-data');
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
  writeInstructionFile(rundir, 'AGENTS.md', { sweet, mppText });
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
  // Harness trim (research switch, default OFF, sweet arm only): adds nothing to config,
  // env or argv when off.
  let harnessTrim;
  try {
    harnessTrim = opencodeArmHarnessTrim({ sweet, apiModel, stateDir: runnerStateDir });
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
      SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'colon',
    },
  });
  let preflight;
  try {
    const versionResult = await spawnWithTimeout('opencode', ['--version'], {
      cwd: rundir, env, timeoutMs: 30_000, jail,
    });
    const configResult = await spawnWithTimeout('opencode', ['debug', 'config'], {
      cwd: rundir, env, timeoutMs: 30_000, jail,
    });
    if (versionResult.exitCode !== 0 || versionResult.timedOut
        || configResult.exitCode !== 0 || configResult.timedOut) {
      throw new Error('OpenCode preflight process failed');
    }
    const resolved = parseResolvedConfig(configResult.stdout);
    validateMainOpencodePreflight({ version: versionResult.stdout, resolved, plugins: harnessTrim.plugins });
    const apiKey = String(process.env.OPENROUTER_API_KEY || '');
    let safeResolved = JSON.stringify(sanitizedConfig(resolved));
    if (apiKey) safeResolved = safeResolved.replaceAll(apiKey, '[REDACTED]');
    const resolvedPath = path.join(retainedSession, 'opencode.resolved.sanitized.json');
    writeFileSync(resolvedPath, safeResolved + '\n', { mode: 0o600 });
    preflight = {
      valid: true, version: PINNED_OPENCODE_VERSION, pluginCount: 0,
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
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', openrouterModel, '--dir', rundir, prompt];

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('opencode', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail });
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

  const costs = costsFromTurns(turns, price);
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
  if (harnessTrim.mode && !harnessTrimToolEdits) console.log(`  [HARNESS-TRIM ${task.id || ''}] plugin wrote no report — tool descriptions were NOT trimmed`);
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  // Audit BEFORE teardown: the jail handle carries the wall-clock window that attributes
  // egress denials to this rollout.
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });
  if (secretLeakDetected) throw new Error('secret-leak tripwire fired; retained text was redacted');

  const calls = toolCalls.length;
  return {
    ...controller,
    rtProgressTurnMapComplete: progressTurnMap.complete,
    openCodePreflight: preflight,
    openCodeConfigPath: retainedPath(retainedConfig),
    openCodeConfigSha256: createHash('sha256').update(ocConfigText).digest('hex'),
    openCodeRawAttempts: rawAttempts,
    openCodeDataDir: retainedPath(ocData),
    openCodeHome: jail ? 'jail-mask' : 'private-xdg',
    // OC_HARNESS_TRIM mode ('prompt:<family>+tools+tooldesc', 'max:prompt:<family>+subagents+
    // tools+tooldesc') or null when off; when on, the
    // plugin's own report of the description edits it applied (null = it never ran).
    harnessTrim: harnessTrim.mode,
    ...(harnessTrim.mode ? { harnessTrimToolEdits } : {}),
    secretLeakDetected: false,
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0, ...rtTelemetry,
    hardTurnCap: resolveHardTurnCap(),
    budgetExhausted: resolveHardTurnCap() !== null && turns.length >= resolveHardTurnCap(),
    exitReason: exitReasonFrom(r),
    usage: turns.length ? { turns: turns.length } : {},
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
