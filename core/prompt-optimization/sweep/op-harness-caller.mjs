/**
 * Phase 7 — opencode harness caller for mutation operators.
 *
 * For all 5 mutation operators (OP-1..OP-5) we route the per-attempt LLM call
 * through opencode + google/gemini-3.1-pro-preview rather than a single-shot
 * direct API call. Empirical evidence from the 2026-05-27 OP-1 harness probe:
 * Gemini DeepThink in the harness ran 11 read-only tool calls to inspect the
 * scoring formula, EAS, Pareto detail and trajectories before producing its
 * mutation. The output matched the direct-API call's structural conclusion
 * (length-discipline edit) but with strictly tighter wording. The user
 * decision: even a marginal improvement justifies the extra latency/cost
 * because mutation runs once per slot per generation. This module is the
 * production path for that.
 *
 * Contract (matches runJudge so the operator runners stay unchanged):
 *   callMutatorHarness({ lineage, model, systemPrompt, userPrompt }) →
 *     { text, isError, raw }
 *
 * Implementation notes:
 *   - We IGNORE `lineage` and `model` from the caller (operators historically
 *     passed `moonshot/kimi-k2.6` or `anthropic-api/claude-sonnet-4-6` here).
 *     The harness always uses google/gemini-3.1-pro-preview via opencode.
 *   - We wrap the operator's system prompt with three additions:
 *       (a) REWRITTEN_PROMPT tag instruction (so we can extract the answer
 *           deterministically from the agentic stream)
 *       (b) repo path hints + read-only investigation suggestions
 *       (c) anti-overfit reminder (60/40 dev/heldout discipline)
 *   - We require GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY → alias) in
 *     the environment because opencode's google provider uses the AI SDK's
 *     own env-var name, not Google's official one.
 *   - We parse opencode's --format json output (JSONL events) and extract the
 *     LAST <REWRITTEN_PROMPT>...</REWRITTEN_PROMPT> block. The agentic stream
 *     may contain the tags multiple times (in tool-call inputs/outputs as
 *     Gemini drafts and refines); the LAST occurrence is the final answer.
 *   - On any error (no tags found, opencode exit ≠ 0, timeout) we surface
 *     `isError: true` so the per-slot retry wrapper can re-attempt.
 *
 * NOT used by TARE adversarial paraphrasing — TARE keeps direct-API for cost.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

export const HARNESS_MODEL = 'google/gemini-3.1-pro-preview';
export const HARNESS_TIMEOUT_MS = 600000; // 10 min — DeepThink + 10+ tool calls

const TAG_INSTRUCTION =
  '\n\n## OUTPUT FORMAT — STRICT (the harness depends on this)\n' +
  'Wrap your FINAL prompt-mutation output in <REWRITTEN_PROMPT>...</REWRITTEN_PROMPT> tags. ' +
  'Everything before the tags is free-form reasoning — use it. Everything inside the tags is what ' +
  'will replace the candidate prompt. Output exactly ONE such block, as the last block of your response. ' +
  'Inside the tags emit ONLY the new prompt text — no preamble, no surrounding code fences, no commentary.';

const HARNESS_INVESTIGATION_HINTS =
  '\n\n## HARNESS INVESTIGATION (read-only, optional)\n' +
  'You are running inside the opencode CLI harness with read-only file access via your built-in ' +
  'tools (Read, Grep, Bash). The repo root is ' + REPO_ROOT + '. You MAY investigate before deciding:\n' +
  '  - core/prompt-optimization/data/p7-dev-probes.json — 40 dev probe definitions\n' +
  '  - core/prompt-optimization/data/results/p7-gen1-20260526-v3/pareto-current.json — full Pareto front + per-probe scores\n' +
  '  - core/prompt-optimization/data/results/p7-gen1-20260526-v3/gepa-trajectory.jsonl — full event stream\n' +
  '  - core/prompt-optimization/sweep/gepa-scoring.mjs + eas.mjs — scoring formula (length penalty, EAS, native-relative)\n' +
  '  - core/prompt-optimization/data/p7-native-baseline-dev-3panel.json — native search baseline\n' +
  '\nInvestigate only if the answer is not already clear from the failure traces you were given. ' +
  'DO NOT modify any file. Investigation is a luxury — most of the time the failure traces in the ' +
  'user prompt are sufficient.';

const ANTI_OVERFIT_CLAUSE =
  '\n\n## ANTI-OVERFITTING DISCIPLINE (HARD CONSTRAINT)\n' +
  'The probes you can inspect come from the DEV split (60% of the benchmark); a HELDOUT split of 40% has ' +
  'been set aside and will validate this prompt later. Do NOT tailor edits to specific probe IDs, individual ' +
  'query phrasings, or single-repo idioms. Edits MUST be GENERAL — improve the underlying reasoning or ' +
  'routing pattern, not the symptom on one query. If a proposed edit would only help one or two probes and ' +
  'could plausibly hurt unseen ones, REJECT it.';

/**
 * Augment the operator's system prompt with harness-aware clauses.
 * Returns the wrapped system text. Pure function (no I/O) so it's testable.
 */
export function augmentSystemForHarness(operatorSystemPrompt) {
  if (typeof operatorSystemPrompt !== 'string') {
    throw new TypeError('augmentSystemForHarness: operatorSystemPrompt must be a string');
  }
  return operatorSystemPrompt + ANTI_OVERFIT_CLAUSE + HARNESS_INVESTIGATION_HINTS + TAG_INSTRUCTION;
}

/**
 * Extract the LAST <REWRITTEN_PROMPT>...</REWRITTEN_PROMPT> block from a
 * full opencode stdout dump. Returns { text, found, allBlocks } where
 * `text` is the trimmed contents of the last block (or '' if none).
 * The agentic stream may contain MULTIPLE blocks (Gemini sometimes drafts
 * the rewrite inside a bash tool-use to inspect it); we always take the
 * LAST one, since by the agentic loop's semantics that is the final answer.
 */
export function extractRewrittenPrompt(stdout) {
  if (typeof stdout !== 'string') return { text: '', found: false, allBlocks: [] };
  const re = /<REWRITTEN_PROMPT>([\s\S]*?)<\/REWRITTEN_PROMPT>/g;
  const blocks = [];
  let m;
  while ((m = re.exec(stdout)) !== null) {
    let body = m[1];
    // Opencode emits JSON-escaped \n inside tool-output strings — unescape if we
    // see the pattern (a literal \n followed by non-whitespace start).
    if (!body.includes('\n') && body.includes('\\n')) {
      body = body.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    blocks.push(body.trim());
  }
  return { text: blocks.length ? blocks[blocks.length - 1] : '', found: blocks.length > 0, allBlocks: blocks };
}

/**
 * Summarise the tool-call activity from an opencode JSONL stream — used to
 * surface observability in the mutation event payload.
 */
export function summariseToolCalls(stdout) {
  if (typeof stdout !== 'string') return { count: 0, tools: {} };
  const tools = {};
  let count = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type !== 'tool_use') continue;
    const name = ev.part?.tool ?? '?';
    tools[name] = (tools[name] ?? 0) + 1;
    count += 1;
  }
  return { count, tools };
}

/**
 * Call mutator harness. Operator-runner-facing signature mirrors runJudge.
 * `lineage` and `model` from the caller are accepted but IGNORED — the
 * harness always uses google/gemini-3.1-pro-preview. The original values
 * are echoed back in `raw.requestedLineage` / `raw.requestedModel` for
 * trajectory observability.
 *
 * `retryHint` (optional) is folded into the user prompt so the second+
 * attempt knows why the prior one failed. Production wrapper passes this
 * automatically; unit tests pass undefined.
 */
export async function callMutatorHarness(req) {
  const { lineage, model, systemPrompt, userPrompt, retryHint, _spawn } = req;
  if (typeof systemPrompt !== 'string') return { text: '', isError: true, raw: { error: 'systemPrompt must be string' } };
  if (typeof userPrompt !== 'string') return { text: '', isError: true, raw: { error: 'userPrompt must be string' } };

  // Bridge GEMINI_API_KEY (our project standard) to GOOGLE_GENERATIVE_AI_API_KEY
  // (the AI SDK env name that opencode's google provider expects).
  const env = { ...process.env };
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY && env.GEMINI_API_KEY) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = env.GEMINI_API_KEY;
  }
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { text: '', isError: true, raw: { error: 'GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY not set' } };
  }

  const fullSystem = augmentSystemForHarness(systemPrompt);
  const fullUser = retryHint
    ? `${userPrompt}\n\n## RETRY HINT (prior attempt failed)\n${retryHint}\nProduce a different output that fixes the above failure.`
    : userPrompt;
  const message = `[SYSTEM]\n${fullSystem}\n\n[USER]\n${fullUser}`;

  const args = ['run', '--model', HARNESS_MODEL, '--format', 'json', message];
  const spawnFn = typeof _spawn === 'function' ? _spawn : spawn;

  const t0 = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let timedOut = false;

  try {
    const child = spawnFn('opencode', args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, HARNESS_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    exitCode = await new Promise((res) => child.on('close', (c) => { clearTimeout(timer); res(c); }));
  } catch (e) {
    return {
      text: '', isError: true,
      raw: { error: e?.message ?? String(e), via: 'opencode-spawn', requestedLineage: lineage, requestedModel: model },
    };
  }

  const wallMs = Date.now() - t0;
  const { text: extracted, found } = extractRewrittenPrompt(stdout);
  const toolCalls = summariseToolCalls(stdout);

  if (timedOut) {
    return {
      text: '', isError: true,
      raw: { error: 'opencode timed out', timeoutMs: HARNESS_TIMEOUT_MS, wallMs, exitCode, toolCalls, requestedLineage: lineage, requestedModel: model, stderrTail: stderr.slice(-1000) },
    };
  }
  if (exitCode !== 0) {
    return {
      text: '', isError: true,
      raw: { error: `opencode exit ${exitCode}`, wallMs, toolCalls, requestedLineage: lineage, requestedModel: model, stderrTail: stderr.slice(-1000) },
    };
  }
  if (!found) {
    return {
      text: '', isError: true,
      raw: { error: 'no <REWRITTEN_PROMPT> block in opencode output', wallMs, toolCalls, requestedLineage: lineage, requestedModel: model, stdoutTail: stdout.slice(-1000) },
    };
  }

  return {
    text: extracted,
    isError: false,
    raw: {
      via: 'opencode-harness',
      model: HARNESS_MODEL,
      wallMs,
      toolCalls,
      requestedLineage: lineage,
      requestedModel: model,
      stdoutBytes: stdout.length,
    },
  };
}
