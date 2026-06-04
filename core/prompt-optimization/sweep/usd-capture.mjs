/**
 * Harness-agnostic USD capture + scoring — the ONE place every vault runner
 * (bare-API, Claude Code, opencode, codex; any model, any provider) turns a
 * finished agent run into (a) a persisted raw-tool-response capture and (b) the
 * USD / USD_noC tool-response-usefulness scores.
 *
 * USD scores the RAW TOOL RESPONSE bytes, which are harness-independent — so it
 * MUST be captured for every run on the vault, not just bare-API. The capture
 * file is the re-scorable artifact: once written, USD can be re-scored forever
 * without re-running the agent (the lesson from the first Sonnet-CC run, which
 * stored only score/calls/usage and was un-re-scorable).
 *
 * Each runner does two things:
 *   1. normalize its native tool-call+result shape into `normalizedCalls`
 *      (bare-API already has {name,input,result:{content,isError}}; Claude Code
 *       has separate toolCalls[] + toolResults[] joined by id → use
 *       `normalizeClaudeCalls`; opencode/codex provide their own adapters).
 *   2. call `buildArmResponse` + `persistCapture` + `scoreUsdInline`.
 *
 * `buildArmResponse` is byte-identical to the original ba-batch implementation for
 * the bare-API toolset (Bash+Read); it ADDS Grep/Glob handling for the native arm
 * so Claude Code's built-in search tools are not silently dropped from the native
 * rawResponse. Symmetry note (the §5d red-team ship-blocker): chrome-stripping +
 * artifact-filtering happen later in `toRJudge(rawResponse, arm)` and are applied
 * identically to both arms; this module only assembles the per-arm byte stream
 * from each arm's designated toolset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toRJudge, usdPanelScore, scoreUSD, composeUSD, computeRubricHash, USD_PARAMS } from './usd-metric.mjs';
import { judgePanelScore, JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } from './gepa-evaluate.mjs';
import { runJudge } from '../../../eval/agent-read-workflows/judge-runner.js';

const SS_CMD_RE = /\bss-(search|find|semantic|trace|grep|read)\b/;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack|find)\b/;

/**
 * Build the per-arm raw tool-response byte stream from normalized tool calls.
 * @param {Array<{name:string,input:object,result:{content:string,isError?:boolean}}>} toolCalls
 * @param {'ss'|'native'} arm
 * @returns {string}
 */
export function buildArmResponse(toolCalls, arm) {
  const blocks = [];
  for (const tc of toolCalls || []) {
    const result = tc.result?.content;
    if (typeof result !== 'string' || !result.trim()) continue;
    const cmd = String(tc.input?.command || '');
    const fp = tc.input?.file_path || '';
    const name = tc.name;
    if (arm === 'ss') {
      // ss arm = the M++ toolset: ss-* (invoked via Bash) + file Reads.
      if (name === 'Bash' && SS_CMD_RE.test(cmd)) blocks.push(result);
      else if (name === 'Read') blocks.push(`${fp}\n${result}`);
    } else if (name === 'Bash' && NATIVE_SEARCH_RE.test(cmd)) {
      blocks.push(`$ ${cmd}\n${result}`);
    } else if (name === 'Read') {
      blocks.push(`${fp}\n${result}`);
    } else if (name === 'Grep' || name === 'Glob') {
      // Claude Code built-in native search tools (never fires for bare-API, which
      // has no Grep/Glob tool → byte-identical to the original ba-batch output there).
      blocks.push(`$ ${name} ${JSON.stringify(tc.input || {})}\n${result}`);
    } else if (name === 'Bash') {
      blocks.push(`$ ${cmd}\n${result}`);
    }
  }
  return blocks.join('\n\n');
}

/**
 * Join Claude Code's separate toolCalls[]+toolResults[] (linked by tool_use id)
 * into the normalized {name,input,result:{content,isError}} shape buildArmResponse
 * + the capture writer expect. Requires claude-runner's toolResults to carry `text`.
 */
export function normalizeClaudeCalls(toolCalls, toolResults) {
  const byId = new Map((toolResults || []).map((r) => [r.id, r]));
  return (toolCalls || []).map((tc) => {
    const r = byId.get(tc.id);
    const content = r && typeof r.text === 'string' ? r.text : '';
    return { name: tc.name, input: tc.input, result: { content, isError: r ? !!r.isError : null } };
  });
}

/**
 * Codex tool calls are shell `command_execution`s (parseCodexAgentStream now attaches
 * `result.content` = aggregated_output). Map them to the Bash shape buildArmResponse
 * expects, so ss-* / native-search / read classification works uniformly.
 */
export function normalizeCodexCalls(toolCalls) {
  return (toolCalls || []).map((tc) => ({
    name: 'Bash',
    input: { command: tc.input?.command ?? (typeof tc.name === 'string' ? tc.name : '') },
    result: tc.result || { content: '', isError: null },
  }));
}

/**
 * opencode emits named tool parts (bash/read/grep/glob/list/...). Map the tool name to
 * the canonical buildArmResponse names and pull the result text. `calls` is the array of
 * {tool, input, output, isError} the opencode parser collects per completed tool part.
 */
const OC_TOOL_NAME = { bash: 'Bash', read: 'Read', grep: 'Grep', glob: 'Glob', list: 'Glob' };
export function normalizeOpencodeCalls(toolCalls) {
  return (toolCalls || []).map((tc) => {
    const name = OC_TOOL_NAME[String(tc.tool || '').toLowerCase()] || 'Bash';
    const input = name === 'Read'
      ? { file_path: tc.input?.filePath || tc.input?.path || tc.input?.file_path || '' }
      : { command: tc.input?.command || (tc.input ? JSON.stringify(tc.input) : '') };
    return { name, input, result: { content: typeof tc.output === 'string' ? tc.output : '', isError: !!tc.isError } };
  });
}

/**
 * Score USD on a built rawResponse. Mirrors ba-batch.scoreUsdInline:
 * grounding-judge ∥ USD-dimensions-panel (independent reads of R_judge), then the
 * deterministic scoreUSD composition. USD_noC is the VALID variant (signal_purity→1).
 * Never throws: a USD failure returns {usdError} and must not break the moat row.
 */
export async function scoreUsdInline(probe, rawResponse, arm) {
  try {
    const rJudge = toRJudge(rawResponse, arm);
    const needUsdPanel = !probe.expectedNoMatch && !!rJudge.trim();
    const [panelCorrectness, panel] = await Promise.all([
      judgePanelScore({ probe, answer: rJudge, panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
      needUsdPanel
        ? usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError }).then((r) => r.panel).catch(() => [])
        : Promise.resolve([]),
    ]);
    const sc = scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, rubricHash: computeRubricHash(USD_PARAMS) });
    const usdNoC = probe.expectedNoMatch
      ? sc.USD
      : composeUSD({ g: sc.grounding, signalPurity: 1, content: sc.content, purity_ratio: sc.purity_ratio }, USD_PARAMS);
    return { USD: sc.USD, USD_noC: usdNoC, grounding: sc.grounding, content: sc.content, content_noD3: sc.content_noD3, purity_ratio: sc.purity_ratio, signal_purity: sc.signal_purity, usdTokens: sc.total_tokens };
  } catch (e) {
    return { usdError: e.message };
  }
}

/**
 * Persist the re-scorable capture: `${capDir}/${probeId}.${arm}.rep${rep}.json`.
 * `harness` tags provenance so cross-harness USD analysis can group/compare.
 */
export function persistCapture(capDir, { probeId, arm, rep, model, harness, rawResponse, finalAnswer, toolCalls }) {
  try {
    fs.mkdirSync(capDir, { recursive: true });
    fs.writeFileSync(
      path.join(capDir, `${probeId}.${arm}.rep${rep}.json`),
      JSON.stringify({
        probeId, arm, rep, model, harness, rawResponse,
        finalAnswer: finalAnswer || '',
        toolCalls: (toolCalls || []).map((t) => ({ name: t.name, input: t.input, isError: t.result?.isError ?? null })),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
