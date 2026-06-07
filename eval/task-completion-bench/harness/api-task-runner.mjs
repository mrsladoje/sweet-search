#!/usr/bin/env node
/**
 * Controlled DeepSeek edit+test agent loop for the task-completion bench.
 *
 * Why a bespoke loop (not SWE-agent) for the pilot: SWE-agent's ACI is its own
 * native retrieval (≠ rg+Read) and M++ was tuned for Claude/Codex/opencode
 * grammars; a bespoke loop gives a FAITHFUL sweet arm + a clean native baseline
 * and full telemetry. SWE-agent is the headline causal harness (later).
 *
 * Ablation: the ONLY changed variable is the retrieval layer.
 *   - native arm: no ss-* on PATH; native policy.
 *   - sweet arm:  ss-* on PATH (invoked via run_bash, exactly like production) +
 *                 M++ (Mpp.md) injected. Native search still allowed (ecological).
 *
 * Tools (OpenAI-style function calling, DeepSeek-direct):
 *   run_bash(command)        - read/explore + run tests; ss-* reachable in sweet arm
 *   read_file(path,a,b)      - confined to the checkout
 *   write_file(path,content) - confined to the checkout (this is how the agent edits)
 *
 * Output: { resolved?, finalPatch, trajectory, toolCounts, usage, costNaive,
 *           costRealized, wallMs, escape, leak, stepsToFirstEdit, exitReason }
 * Grading is SEPARATE (grade/*.mjs) — this only produces the prediction patch.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
// Pricing snapshot (USD per 1M tokens). cache_hit is the discounted input rate.
// Used for cache-naive vs realized cost (P7 convention). Keyed by apiModel so a
// single table covers every provider; cost lookup falls back to a sane default
// when an apiModel is missing.
//   deepseek-*        : api.deepseek.com snapshot, 2026-06-02.
//   minimax/minimax-m3: OpenRouter list price, 2026-06-02.
const PRICES = {
  'deepseek-v4-flash': { in: 0.28, cacheHit: 0.028, out: 0.42 },
  'deepseek-v4-pro':   { in: 0.55, cacheHit: 0.055, out: 1.65 },
  'minimax/minimax-m3': { in: 0.60, cacheHit: 0.06, out: 2.40 },
  // Variance-smoke candidate models (OpenRouter list prices, 2026-06-07).
  'minimax/minimax-m2.7': { in: 0.30, cacheHit: 0.03, out: 1.20 },
  'xiaomi/mimo-v2.5-pro': { in: 0.435, cacheHit: 0.0036, out: 0.87 },
  'z-ai/glm-5.1':         { in: 0.98, cacheHit: 0.182, out: 3.08 },
};
const DEFAULT_PRICE = PRICES['deepseek-v4-pro'];

// --- escape / leak audit (adapted from scripts/audit-escape.mjs for /tmp checkouts) ---
// LEAK = touching answer/test-spec files or peeking at OTHER commits via git
// history. Reading a tracked file at HEAD (`git show HEAD:path`) is NOT a leak;
// only `git log --all/--branches/--remotes`, `reflog`, and `git show <SHA>`
// (a hex commit ref, i.e. potentially the future fix) count.
// Reading a tracked file at HEAD or an existing conftest.py is NOT a leak; only
// git-history peeking at OTHER commits / answer files. (conftest reward-hacking
// is a WRITE, audited in write_file, not here.)
const ANSWER_RE = /(\/gold\/|test_patch|expected_?(files|symbols|output)|\bgit\s+log\b[^\n]*--(all|branches|remotes)|\breflog\b|\bgit\s+show\s+[0-9a-f]{7,40}\b)/i;
const SYSTEM_ABS = /^\/(usr|bin|sbin|opt|etc|lib|var|private|System|Library|Applications|dev|proc|tmp|Users\/[^/]+\/\.(deepseek|cache|local|npm|node|ss-eval))(\/|$)/;
// Hallucinated SWE-bench CONTAINER roots the model assumes it lives in (it now
// sees /testbed in run_tests output and echoes it). These don't exist on the
// host, so a ref is harmless model confusion, NOT a real escape — counted as
// `halluc` separately so the escape metric stays clean.
const CONTAINER_ROOTS = /^\/(testbed|repo|workspace|app|code|src|tests?|home|root|data|project|tmp)(\/|$)/;
function auditCommand(cmd, checkoutDir, checkoutReal) {
  const text = String(cmd || '');
  let escape = 0, leak = 0, halluc = 0; const ex = [];
  if (ANSWER_RE.test(text)) { leak++; ex.push('LEAK:' + text.slice(0, 80)); }
  const fams = [path.resolve(checkoutDir), checkoutReal, '/tmp/ss-eval', '/private/tmp/ss-eval'].filter(Boolean);
  for (const m of text.matchAll(/(?:^|[\s'"=(`])(\/[A-Za-z0-9._/@-]+)/g)) {   // include @ (our checkout dirs are repo@commit)
    const p = m[1];
    if (fams.some(f => p.startsWith(f))) continue;               // checkout family
    if (SYSTEM_ABS.test(p)) continue;                            // harmless system/tmp/home-dotdir
    if (CONTAINER_ROOTS.test(p)) { halluc++; continue; }         // hallucinated container path
    escape++; ex.push('ESC:' + p);
  }
  const cdm = text.match(/\bcd\s+(\/[^\s;&|]+)/);
  if (cdm && !fams.some(f => cdm[1].startsWith(f)) && !SYSTEM_ABS.test(cdm[1])) {
    if (CONTAINER_ROOTS.test(cdm[1])) halluc++; else { escape++; ex.push('ESC-cd:' + cdm[1]); }
  }
  return { escape, leak, halluc, ex };
}

// A bash command that MUTATES a source file (so it counts as an edit, not a read):
// `sed -i`, `tee`, `patch`, or a redirect `>`/`>>` into a code/text file
// (excluding /dev/null and fd redirects like 2>&1).
const MUTATING_BASH = /\bsed\s+-i\b|\btee\b|(^|\s)patch\s|(?<![0-9&])>>?\s*(?!\/dev\/null)['"]?[\w./-]+\.(py|js|ts|tsx|jsx|go|rs|java|rb|c|h|hpp|cpp|cc|kt|php|swift|scala|lua|ex|exs|zig|dart|txt|md|json|ya?ml|toml|cfg|ini)\b/;
function classify(name, cmd) {
  if (name?.startsWith('ss_')) return 'ss';                 // explicit sweet-search tools
  if (name === 'run_tests') return 'test';
  if (name === 'write_file') return 'edit';
  if (name === 'read_file') return 'nativeRead';
  const t = String(cmd || '');
  if (/\bss-(search|find|grep|read|semantic|trace)\b/.test(t)) return 'ss';  // ss-* via bash (also counts)
  if (MUTATING_BASH.test(t)) return 'edit';
  if (/\b(rg|grep|ag|ack|find|fd)\b/.test(t)) return 'nativeGrep';
  if (/\b(cat|head|tail|less|sed|awk)\b/.test(t)) return 'nativeRead';
  return 'bash';
}

// Clean tool-ablation: BOTH arms get the SAME task-completion policy; the only
// difference is whether ss-* tools are available (sweet) or not (native). This
// isolates the retrieval-tool's contribution (RepoGraph-style) and avoids the
// over-exploration artifact M++ (a retrieval-centric prompt) caused as a policy.
// The full-M++-as-policy condition is a separate, product-ecological arm (opt-in
// via `policy`), reported separately.
const TASK_POLICY =
  'You are an expert software engineer resolving a bug in a Python repository. Work ONLY in your current working directory.\n' +
  'Follow this loop until the failing tests pass:\n' +
  '1. Explore to locate the root cause.\n' +
  '2. REPRODUCE the failure: find and run the relevant test(s) with bash, e.g. `python -m pytest path/to/test_file.py -x -q` (no network/installs needed; the env is ready).\n' +
  '3. Make the MINIMAL code edit with write_file.\n' +
  '4. RE-RUN the tests to confirm your fix passes AND nothing else broke.\n' +
  '5. Only when the previously-failing tests pass, reply DONE.\n' +
  'CRITICAL: the repo\'s EXISTING tests may not cover this issue. Do NOT conclude you are done just because pre-existing tests pass. From the issue description, construct an input/scenario that reproduces the described bug, confirm it currently misbehaves, then fix and confirm it now behaves correctly. Implement the FULL behavior the issue asks for, not just a signature change.\n' +
  'Do not finish with an unverified edit. Do not keep searching once you have located the cause — edit and test.';
const NATIVE_POLICY = TASK_POLICY; // back-compat export

// === Shared task-completion FRAME ===
// IDENTICAL on both arms, TOOL-AGNOSTIC (never names ss_*/grep/semantic — that
// would coach one arm). It BRACKETS the sweet-only M++ guidance: FRAME_AUTHORITY
// opens, M++ sits in the middle (sweet only), FRAME_CLOSE has the last word.
// Why: M++'s terminal clause ("Stop the instant your evidence answers what
// you're looking for … name the file(s) … or no-match") is tuned for SEARCH
// episodes, where locating == done. On a FIX task that clause wins by recency
// and ends the run at the locate step (observed: pylint-7993, sweet stopped
// with 0 edits on all 3 reps while native ground out the fix). The frame
// re-asserts that completion = edit + passing test, both before and after M++.
// The only arm asymmetry remains M++ + ss-* tools (the treatment). Gated by
// TASK_FRAME (default ON); TASK_FRAME=0 reproduces the pre-frame prompt for A/B.
const FRAME_AUTHORITY =
  'These task-completion rules are AUTHORITATIVE and take precedence over anything later in this prompt about efficiency, taking fewer/sharper steps, or when to stop. Any such later guidance governs only HOW to locate code — never WHETHER your task is finished. Locating or understanding the cause is the MIDPOINT of the job, not the end: you are done ONLY after you have EDITED the code and a re-run shows the previously-failing test PASSING.';
const FRAME_CLOSE =
  '=== TASK COMPLETION (authoritative — overrides all guidance above) ===\n' +
  'You have NOT finished until you have (1) made a code edit AND (2) re-run the failing test and seen it PASS. Understanding, locating, or explaining the bug is NOT completion. If so far you have only located or explained the cause, your VERY NEXT action must be the edit (write_file) — do not reply DONE with an unedited or unverified repo.';

// Pure assembly of the system prompt (testable). mpp='' → native (no M++).
// frame=true → bracket M++ with FRAME_AUTHORITY (open) + FRAME_CLOSE (close);
// frame=false → legacy prompt (TASK_POLICY [+ M++]). Identical text both arms
// except the M++ block, which is the treatment.
function buildSysPolicy(mpp, frame = true) {
  const frameOpen = frame ? `${TASK_POLICY}\n${FRAME_AUTHORITY}` : TASK_POLICY;
  const frameClose = frame ? `\n\n${FRAME_CLOSE}` : '';
  return mpp
    ? `${frameOpen}\n\n=== Code-search expertise — use the ss_* tools per this guidance (this is your advantage; use it to locate code in fewer, sharper steps) ===\n${mpp}${frameClose}`
    : `${frameOpen}${frameClose}`;
}

// Sweet arm: ss-* exposed as FIRST-CLASS function tools (mirrors the MCP
// deployment) so the model can't "forget" to type them in bash. This is the fix
// for the ss=0 problem — the treatment is now an unmissable tool surface.
const SS_TOOLS = [
  { type: 'function', function: { name: 'ss_search', description: 'sweet-search: hybrid semantic+lexical code search. The BEST first tool to locate where behavior/symbols/logic live — returns ranked code spans with file:line. Prefer this over grep for any "where is / how does X work" question.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'natural-language query' }, k: { type: 'integer' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'ss_trace', description: 'sweet-search call-graph trace for a symbol: returns callers, callees, and impact paths in ONE call. Use to understand how a function connects to the rest of the code.', parameters: { type: 'object', properties: { symbol: { type: 'string' }, in: { type: 'string', description: 'optional file to disambiguate' } }, required: ['symbol'] } } },
  { type: 'function', function: { name: 'ss_grep', description: 'sweet-search indexed regex grep (fast exact-pattern match across the repo).', parameters: { type: 'object', properties: { regex: { type: 'string' }, k: { type: 'integer' } }, required: ['regex'] } } },
  { type: 'function', function: { name: 'ss_semantic', description: 'sweet-search: return only the query-relevant spans WITHIN one file (semantic read — cheaper than reading the whole file).', parameters: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' } }, required: ['path', 'query'] } } },
  { type: 'function', function: { name: 'ss_read', description: 'sweet-search file read (whole file, or a line range with start/end).', parameters: { type: 'object', properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path'] } } },
];
function buildTools(sweet, hasTestEnv) {
  const base = [
    { type: 'function', function: { name: 'run_bash', description: 'Run a read/explore shell command inside the repo (grep, ls, cat). Do NOT use it to write files or run the test suite — use write_file and run_tests for those.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a file (optionally a line range) from the repo.', parameters: { type: 'object', properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Overwrite a file in the repo with new content (your edit).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  ];
  // run_tests is a capability BOTH arms get (verifying a fix is not the retrieval
  // treatment). It runs pytest in the real prepared environment.
  if (hasTestEnv) base.push({ type: 'function', function: { name: 'run_tests', description: 'Run the repository test suite in the REAL prepared environment (all deps installed; your edits are live). Pass pytest arguments, e.g. "tests/test_config.py -k toml" or a test path. Use this to REPRODUCE the failure first and to VERIFY your fix passes before finishing.', parameters: { type: 'object', properties: { args: { type: 'string', description: 'pytest arguments / test path' } }, required: ['args'] } } });
  return sweet ? [...base, ...SS_TOOLS] : base;
}

const SS_BIN_MAP = { ss_search: 'ss-search', ss_trace: 'ss-trace', ss_grep: 'ss-grep', ss_semantic: 'ss-semantic', ss_read: 'ss-read' };
function runSsTool(name, args, { checkoutDir, ssBinDir, timeoutMs = 90000 }) {
  const bin = SS_BIN_MAP[name];
  let argv = [];
  if (name === 'ss_search') argv = [String(args.query || ''), ...(args.k ? ['-k', String(args.k)] : [])];
  else if (name === 'ss_grep') argv = [String(args.regex || ''), ...(args.k ? ['-k', String(args.k)] : [])];
  else if (name === 'ss_trace') argv = [String(args.symbol || ''), ...(args.in ? ['--in', String(args.in)] : [])];
  else if (name === 'ss_semantic') argv = [String(args.path || ''), String(args.query || '')];
  else if (name === 'ss_read') argv = [String(args.path || ''), ...(args.start ? [String(args.start)] : []), ...(args.end ? [String(args.end)] : [])];
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: checkoutDir, PATH: ssBinDir + ':' + process.env.PATH };
  try {
    return execFileSync(path.join(ssBinDir, bin), argv, { cwd: checkoutDir, env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).slice(0, 14000);
  } catch (e) {
    return `[${name} exit=${e.status ?? 1}]\n${(e.stdout || '').slice(0, 10000)}${e.stderr ? '\n[stderr] ' + String(e.stderr).slice(0, 800) : ''}`;
  }
}

function insideCheckout(p, checkoutDir) {
  if (typeof p !== 'string' || !p) return null;               // guard: model called with no path (was a crash)
  const resolved = path.resolve(checkoutDir, p);
  return resolved.startsWith(path.resolve(checkoutDir)) ? resolved : null;
}

function runBash(command, { checkoutDir, ssBinDir, timeoutMs = 120000 }) {
  if (/\b(curl|wget|nc|ssh|scp|npm i|pip install|apt|brew)\b/.test(command) && !/--help/.test(command)) {
    return { stdout: '', stderr: '[blocked] network/install commands are not allowed in the agent loop', code: 126 };
  }
  // The agent edits via write_file; it must NOT mutate git state (that would
  // corrupt the base_commit and the prediction-diff measurement). Read-only git
  // (diff/show/log/status/blame) stays allowed.
  if (/\bgit\s+(checkout|reset|stash|commit|add|rm|clean|apply|restore|revert|switch|merge|rebase|cherry-pick)\b/.test(command)) {
    return { stdout: '', stderr: '[blocked] git state-mutating commands are not allowed; edit files with write_file', code: 126 };
  }
  const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: checkoutDir };
  env.PATH = (ssBinDir ? ssBinDir + ':' : '') + process.env.PATH;
  try {
    const stdout = execSync(command, { cwd: checkoutDir, env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { stdout: stdout.slice(0, 12000), stderr: '', code: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').slice(0, 8000), stderr: (e.stderr || e.message || '').slice(0, 4000), code: e.status ?? 1 };
  }
}

// Extended ladder (~2 min total) so a transient provider/network blip — which
// truncated both sweet arms in the M3 smoke at ~222s — does not kill an arm.
const RETRY_LADDER_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
// Both DeepSeek and OpenRouter expose an OpenAI-compatible
// /chat/completions surface (messages, tools, tool_choice, temperature,
// max_tokens). callModel() routes by provider, keeps a single retry ladder
// (network/429/5xx → retry; other 4xx → fatal), and adds OpenRouter's
// `reasoning` block for reasoning models. max_tokens is 8192 so MiniMax M3's
// reasoning has headroom (DeepSeek tolerates the larger ceiling fine).
function endpointFor(provider) {
  return provider === 'openrouter'
    ? { base: OPENROUTER_BASE, label: 'openrouter' }
    : { base: DEEPSEEK_BASE, label: 'deepseek' };
}
async function callModel({ provider = 'deepseek', apiModel, messages, tools, reasoning = 'standard', apiKey, maxRetries = 8, fetchTimeoutMs = 180000 }) {
  const { base, label } = endpointFor(provider);
  const body = { model: apiModel, messages, tools, tool_choice: 'auto', temperature: 0, max_tokens: 8192 };
  // OpenRouter reasoning models: request STANDARD thinking, i.e. medium effort —
  // never 'high'/max. Both 'standard' and 'medium' map to medium effort.
  if (provider === 'openrouter' && reasoning && reasoning !== 'none') {
    body.reasoning = { effort: 'medium' };
  }
  // Optional OpenRouter provider PIN (e.g. OPENROUTER_PROVIDER_PIN=Mara — the
  // fastest provider for m2.7). Strict pin (allow_fallbacks:false) so we measure
  // ONE provider's latency consistently; the retry ladder absorbs transient 429s.
  // Keep CONCURRENCY low when pinning (the MARA 429-collapse lesson).
  if (provider === 'openrouter' && process.env.OPENROUTER_PROVIDER_PIN) {
    body.provider = { order: [process.env.OPENROUTER_PROVIDER_PIN], allow_fallbacks: false };
  }
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Per-request abort timeout: a hung connection must not block the arm
    // forever (plain fetch has no timeout). On timeout we abort → retry.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), fetchTimeoutMs);
    try {
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
      });
      if (resp.ok) return await resp.json();
      const t = await resp.text().catch(() => '');
      if (resp.status === 429 || resp.status >= 500) lastErr = new Error(`${label} ${resp.status}: ${t.slice(0, 200)}`); // retryable
      else throw new Error(`${label} ${resp.status} fatal: ${t.slice(0, 300)}`);                                          // 4xx → no retry
    } catch (e) {
      if (/fatal/.test(e.message)) throw e;
      lastErr = e; // network/abort/timeout (e.g. "fetch failed", AbortError) → retry
    } finally { clearTimeout(timer); }
    if (attempt < maxRetries) await new Promise(r => setTimeout(r, RETRY_LADDER_MS[Math.min(attempt, RETRY_LADDER_MS.length - 1)]));
  }
  throw lastErr || new Error(`${label}: retries exhausted`);
}

export async function runTask(task, { arm, provider = 'deepseek', apiModel, model = 'deepseek-v4-pro', reasoning = 'standard', maxToolCalls = 60, ssBinDir, mppText, policy, runTests, apiKey, perCallTimeoutMs = 120000 } = {}) {
  // apiModel is the provider's model id (e.g. 'deepseek-v4-pro' for deepseek,
  // 'minimax/minimax-m3' for openrouter). `model` stays as a back-compat alias
  // that also drives the cost lookup / return field when apiModel is omitted.
  const resolvedModel = apiModel || model;
  // Per-provider key resolution: explicit apiKey wins, else the provider's env.
  const resolvedKey = apiKey || (provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.DEEPSEEK_API_KEY);
  if (!resolvedKey) throw new Error(`runTask: ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'DEEPSEEK_API_KEY'} missing`);
  const checkoutDir = task.repoCheckout;
  let checkoutReal = checkoutDir;
  try { checkoutReal = realpathSync(checkoutDir); } catch { /* */ }
  const sweet = arm === 'sweet';
  // Treatment (user-directed): BOTH arms get TASK_POLICY (the fix-it loop); the
  // SWEET arm ADDITIONALLY gets the GEPA-optimized M++ guidance layered on top —
  // that's the moat (it teaches the agent HOW to use ss-* well). Set
  // policy:'tools-only' to drop M++ and measure the tools' marginal value.
  const mpp = sweet && policy !== 'tools-only' ? (mppText || (task.mppPath ? readFileSync(task.mppPath, 'utf8') : '')) : '';
  // FRAME default ON; TASK_FRAME=0 reproduces the pre-frame prompt for A/B.
  const sysPolicy = buildSysPolicy(mpp, process.env.TASK_FRAME !== '0');
  const tools = buildTools(sweet, !!runTests);
  const ssHint = sweet ? ' Sweet-search tools (ss_search, ss_trace, ss_grep, ss_semantic, ss_read) are available — prefer ss_search to locate code.' : '';
  const messages = [
    { role: 'system', content: sysPolicy },
    { role: 'user', content: `You are inside a git repository checked out at your CURRENT WORKING DIRECTORY (run \`pwd\`/\`ls\` to orient). There is NO /testbed, /repo, /workspace, or /home/user — operate ONLY in the current directory.${ssHint}\n\nResolve this issue by editing code so the failing tests pass. Explore to find the cause, make the minimal fix with write_file, then stop and reply DONE.\n\n=== ISSUE ===\n${task.problem_statement}` },
  ];

  const trajectory = [];
  const toolCounts = { ss: 0, nativeGrep: 0, nativeRead: 0, edit: 0, bash: 0, test: 0 };
  const usage = { prompt: 0, completion: 0, cacheHit: 0, cacheMiss: 0, reasoning: 0 };
  let escape = 0, leak = 0, halluc = 0, calls = 0, stepsToFirstEdit = null, exitReason = 'done';
  let nudges = 0;                 // stop-quality nudges injected (capped at 2)
  const MAX_NUDGES = 2;
  const escapeExamples = [];
  const t0 = Date.now();

  for (let turn = 0; turn < maxToolCalls + 4; turn++) {
    let payload;
    try { payload = await callModel({ provider, apiModel: resolvedModel, messages, tools, reasoning, apiKey: resolvedKey }); }
    catch (e) { exitReason = `api_error:${e.message}`; break; }
    const u = payload.usage || {};
    usage.prompt += u.prompt_tokens || 0;
    usage.completion += u.completion_tokens || 0;
    usage.cacheHit += u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
    usage.cacheMiss += u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens || 0) - (u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0));
    usage.reasoning += u.completion_tokens_details?.reasoning_tokens || 0;

    const msg = payload.choices?.[0]?.message || {};
    messages.push(msg);
    const tcs = msg.tool_calls || [];
    if (tcs.length === 0) {
      // Stop-quality guard: don't accept an early stop until the agent has both
      // reproduced (ran run_tests ≥1×) AND made an edit (toolCounts.edit>0).
      // Nudge it back into the verify loop; cap at MAX_NUDGES, then allow stop.
      const verified = (toolCounts.test || 0) > 0 && (toolCounts.edit || 0) > 0;
      if (!verified && nudges < MAX_NUDGES) {
        nudges++;
        const missing = [];
        if ((toolCounts.edit || 0) === 0) missing.push('you have not made any code edit yet (use write_file)');
        if ((toolCounts.test || 0) === 0) missing.push('you have not run the tests yet (use run_tests)');
        messages.push({
          role: 'user',
          content: `Do not stop yet — ${missing.join(' and ')}. First REPRODUCE the failure by running the relevant test(s) with run_tests, then make the minimal fix with write_file, then RE-RUN run_tests to VERIFY the previously-failing test now passes (and nothing else broke). Only reply DONE after you have run_tests passing on a real edit.`,
        });
        continue; // keep looping; do not break on this early stop
      }
      exitReason = 'model_stopped'; break;
    }

    for (const tc of tcs) {
      if (calls >= maxToolCalls) { exitReason = 'max_calls'; break; }
      calls++;
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* */ }
      const name = tc.function.name;
      const kind = classify(name, args.command);
      toolCounts[kind] = (toolCounts[kind] || 0) + 1;
      if (kind === 'edit' && stepsToFirstEdit === null) stepsToFirstEdit = calls;

      let resultText = '';
      if (name === 'run_bash') {
        const a = auditCommand(args.command, checkoutDir, checkoutReal); escape += a.escape; leak += a.leak; halluc += a.halluc;
        if (a.ex.length && escapeExamples.length < 8) escapeExamples.push(...a.ex.slice(0, 8 - escapeExamples.length));
        const r = runBash(args.command, { checkoutDir, ssBinDir: sweet ? ssBinDir : null, timeoutMs: perCallTimeoutMs });
        resultText = `exit=${r.code}\n${r.stdout}${r.stderr ? '\n[stderr] ' + r.stderr : ''}`;
      } else if (name === 'run_tests') {
        resultText = runTests ? await runTests(args.args || '') : '[error] test env not available';
      } else if (name?.startsWith('ss_')) {
        resultText = sweet ? runSsTool(name, args, { checkoutDir, ssBinDir, timeoutMs: perCallTimeoutMs }) : '[error] sweet-search tools not available in this arm';
      } else if (name === 'read_file') {
        const full = insideCheckout(args.path, checkoutDir);
        if (!full || !existsSync(full)) resultText = `[error] cannot read ${args.path}`;
        else { const lines = readFileSync(full, 'utf8').split('\n'); const s = (args.start || 1) - 1, e = args.end || Math.min(lines.length, s + 200); resultText = lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n').slice(0, 12000); }
      } else if (name === 'write_file') {
        const full = insideCheckout(args.path, checkoutDir);
        if (!full) { resultText = `[blocked] write outside checkout: ${args.path}`; escape++; }
        else {
          // Writing a conftest.py is the pytest reward-hack vector (auto-loaded
          // outcome rewriting). Editing existing source files (even pytest's own
          // src/_pytest/*.py that contain pytest_* hook names) is a legit fix —
          // do NOT flag those.
          if (/(^|\/)conftest\.py$/.test(args.path)) { leak++; escapeExamples.push('LEAK-write:' + args.path); }
          mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, args.content); resultText = `wrote ${args.path} (${(args.content || '').length} bytes)`;
        }
      } else resultText = `[error] unknown tool ${name}`;

      trajectory.push({ call: calls, name, kind, input: args.command || args.path || args.query || args.symbol || args.regex || args.args, exit: undefined });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText.slice(0, 12000) });
    }
    if (exitReason === 'max_calls') break;
  }

  // Prediction patch = git diff against base_commit, EXCLUDING .sweet-search/
  // (the ss-* index lives inside the checkout and must never enter the patch).
  let finalPatch = '';
  try { finalPatch = execFileSync('git', ['-C', checkoutDir, 'diff', '--', '.', ':(exclude).sweet-search'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { /* no git */ }

  // Cost lookup keys on the provider's apiModel (resolvedModel); fall back to a
  // sane default so an unlisted model still produces a finite cost.
  const price = PRICES[resolvedModel] || DEFAULT_PRICE;
  const costNaive = (usage.prompt * price.in + usage.completion * price.out) / 1e6;
  const costRealized = (usage.cacheMiss * price.in + usage.cacheHit * price.cacheHit + usage.completion * price.out) / 1e6;

  return {
    taskId: task.id, arm, provider, model: resolvedModel, apiModel: resolvedModel,
    finalPatch, patchFiles: (finalPatch.match(/^diff --git/gm) || []).length,
    patchHunks: (finalPatch.match(/^@@/gm) || []).length,
    calls, toolCounts, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep,
    stepsToFirstEdit, nudges, escape, leak, halluc, escapeExamples, exitReason,
    usage, costNaiveUsd: +costNaive.toFixed(6), costRealizedUsd: +costRealized.toFixed(6),
    wallMs: Date.now() - t0, trajectory,
  };
}

export { NATIVE_POLICY, buildSysPolicy, TASK_POLICY, FRAME_AUTHORITY, FRAME_CLOSE };
