// Claude Code transcript recovery and inclusive cost accounting.
// Kept separate from the process adapter so provider-accounting invariants can
// be tested without growing the runner beyond the repository's file-size limit.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { costsFromTurns } from './agent-runner-shared.mjs';

export function turnsFromTranscript(claudeHome, sessionId) {
  const file = findSessionFile(claudeHome, sessionId);
  return file ? turnsFromTranscriptFile(file) : [];
}

// <claude-home>/projects/<cwd-slug>/<session-id>.jsonl. Find by session id
// instead of reconstructing Claude's cwd encoding.
function findSessionFile(claudeHome, sessionId) {
  if (!claudeHome || !sessionId) return null;
  let file = null;
  const walk = (dir, depth = 0) => {
    if (file || depth > 4) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (file) return;
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1);
      else if (entry.name === `${sessionId}.jsonl`) file = join(dir, entry.name);
    }
  };
  walk(join(claudeHome, 'projects'));
  return file;
}

export function turnsFromTranscriptFile(file) {
  return transcriptMetricsFromFile(file).turns;
}

/** Recover priced turns and retrospective signals, deduplicated by message id. */
export function transcriptMetricsFromFile(file) {
  const turns = [];
  const payloads = [];
  let retainedOutputChars = 0, billedOutputTokens = 0;
  let assistantMessages = 0, usageMessages = 0;
  let text; try { text = readFileSync(file, 'utf8'); } catch {
    return { turns, payloads, retainedOutputChars, billedOutputTokens,
      assistantMessages, usageMessages, instrumentationComplete: false };
  }
  const seen = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    let event; try { event = JSON.parse(trimmed); } catch { continue; }
    const message = event.message;
    if (!message || message.role !== 'assistant' || !message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    assistantMessages++;
    for (const block of (message.content || [])) {
      if (block.type === 'tool_use') {
        for (const value of Object.values(block.input || {})) {
          if (typeof value === 'string') {
            payloads.push(value);
            retainedOutputChars += value.length;
          }
        }
        for (const edit of (block.input?.edits || [])) {
          for (const value of Object.values(edit || {})) {
            if (typeof value === 'string') {
              payloads.push(value);
              retainedOutputChars += value.length;
            }
          }
        }
      } else if (block.type === 'text' && typeof block.text === 'string') {
        retainedOutputChars += block.text.length;
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        retainedOutputChars += block.thinking.length;
      }
    }
    if (!message.usage) continue;
    const usage = message.usage;
    const cached = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const input = (usage.input_tokens || 0) + cached + cacheWrite;
    const output = usage.output_tokens || 0;
    if (!input && !output) continue;
    usageMessages++;
    billedOutputTokens += output;
    turns.push({ in: input, cached, cacheWrite, out: output });
  }
  return {
    turns, payloads, retainedOutputChars, billedOutputTokens,
    assistantMessages, usageMessages,
    instrumentationComplete: assistantMessages > 0 && usageMessages === assistantMessages,
  };
}

export function aggregateUsageFromTurns(turns) {
  return (turns || []).reduce((sum, turn) => ({
    input_tokens: sum.input_tokens + Math.max(0,
      (Number(turn.in) || 0) - (Number(turn.cached) || 0) - (Number(turn.cacheWrite) || 0)),
    cache_read_input_tokens: sum.cache_read_input_tokens + (Number(turn.cached) || 0),
    cache_creation_input_tokens: sum.cache_creation_input_tokens + (Number(turn.cacheWrite) || 0),
    output_tokens: sum.output_tokens + (Number(turn.out) || 0),
  }), { input_tokens: 0, cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0, output_tokens: 0 });
}

const USAGE_KEYS = ['input_tokens', 'cache_read_input_tokens',
  'cache_creation_input_tokens', 'output_tokens'];

/** Trust a turn sequence only when every category matches the final aggregate. */
export function recoveredTurnsMatchAggregate(turns, resultUsage) {
  if (!Array.isArray(turns) || !turns.length || !resultUsage) return false;
  const recovered = aggregateUsageFromTurns(turns);
  return USAGE_KEYS.every(key => Number.isFinite(Number(resultUsage[key]))
    && recovered[key] === Number(resultUsage[key]));
}

/**
 * The recovered turns account for EVERY token the aggregate reports, and may
 * report more.
 *
 * MEASURED 2026-08-12 (`harness-smoke-20260812`): Claude Code's aggregate
 * `result.usage` omits exactly one served request per rollout — the same
 * ordinal (#7) in a 13-request native rollout and an 8-request sweet rollout.
 * The transcript is a strict SUPERSET; subtracting that one request from the
 * transcript reproduces the aggregate exactly on all four categories in both
 * arms.
 *
 * Treating the aggregate as authoritative therefore drops a billed request, and
 * it does so ASYMMETRICALLY — 4.1% of native's cost versus 11.1% of sweet's on
 * that task. An under-charge that favours one arm is the one error a cost
 * benchmark must never make, so coverage (not exact equality) is what licenses
 * trusting the per-request record.
 *
 * Exact equality is still preferred and tried first; this is the fallback
 * before abandoning per-turn structure altogether, because losing it also loses
 * idealCost and breakPriced — the cache-normalized columns every A/B is read on.
 */
export function recoveredTurnsCoverAggregate(turns, resultUsage) {
  if (!Array.isArray(turns) || !turns.length || !resultUsage) return false;
  const recovered = aggregateUsageFromTurns(turns);
  let strictlyMore = false;
  for (const key of USAGE_KEYS) {
    const reported = Number(resultUsage[key]);
    if (!Number.isFinite(reported)) return false;
    if (recovered[key] < reported) return false;      // the record is incomplete
    if (recovered[key] > reported) strictlyMore = true;
  }
  return strictlyMore;                                 // exact match handled above
}

/** One independently priced context per delegated subagent transcript. */
export function sidechainTurnSets(claudeHome, sessionId) {
  const file = findSessionFile(claudeHome, sessionId);
  if (!file) return [];
  const dir = join(file.replace(/\.jsonl$/, ''), 'subagents');
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .sort((a, b) => a.name < b.name ? -1 : 1)
    .map(entry => ({
      name: entry.name,
      ...transcriptMetricsFromFile(join(dir, entry.name)),
    }));
}

export function addSidechainCosts(mainCosts, sidechainCosts) {
  const sumFields = ['costRealizedUsd', 'idealCostUsd', 'realFromTurnsUsd',
    'breakPricedCostUsd', 'costNaiveUsd', 'costContentUsd', 'contextRewrites', 'idealTurns'];
  const out = { ...mainCosts };
  for (const field of sumFields) {
    if (mainCosts[field] == null) { out[field] = null; continue; }
    const total = sidechainCosts.reduce((sum, cost) => sum + (cost[field] ?? 0), mainCosts[field]);
    out[field] = field === 'contextRewrites' || field === 'idealTurns'
      ? total : +total.toFixed(6);
  }
  out.costRealizedMainOnlyUsd = mainCosts.costRealizedUsd ?? null;
  out.idealCostMainOnlyUsd = mainCosts.idealCostUsd ?? null;
  out.breakPricedCostMainOnlyUsd = mainCosts.breakPricedCostUsd ?? null;
  out.costSidechainUsd = +sidechainCosts
    .reduce((sum, cost) => sum + (cost.costRealizedUsd || 0), 0).toFixed(6);
  out.sidechainCount = sidechainCosts.length;
  return out;
}

/** Inclusive cost is unavailable when any delegated transcript is incomplete. */
export function addSidechainCostsChecked(mainCosts, sideSets, price) {
  const incomplete = (sideSets || [])
    .filter(set => !set.instrumentationComplete || !set.turns?.length)
    .map(set => set.name);
  if (incomplete.length) {
    return {
      ...mainCosts,
      costRealizedMainOnlyUsd: mainCosts.costRealizedUsd ?? null,
      idealCostMainOnlyUsd: mainCosts.idealCostUsd ?? null,
      breakPricedCostMainOnlyUsd: mainCosts.breakPricedCostUsd ?? null,
      costRealizedUsd: null, idealCostUsd: null, realFromTurnsUsd: null,
      breakPricedCostUsd: null, costNaiveUsd: null, costContentUsd: null,
      contextRewrites: null, idealTurns: null, costSidechainUsd: null,
      sidechainCount: sideSets.length,
      sidechainAccountingComplete: false,
      incompleteSidechains: incomplete,
    };
  }
  return {
    ...addSidechainCosts(mainCosts, sideSets.map(set => costsFromTurns(set.turns, price))),
    sidechainAccountingComplete: true,
    incompleteSidechains: [],
  };
}

/** Aggregate-only realized pricing; normalized columns require a turn sequence. */
export function claudeCosts(resultUsage, price, costContentUsd = null) {
  const keys = ['input_tokens', 'cache_read_input_tokens',
    'cache_creation_input_tokens', 'output_tokens'];
  const complete = resultUsage && keys.every(key =>
    Number.isFinite(Number(resultUsage[key])) && Number(resultUsage[key]) >= 0);
  if (!complete) {
    return {
      costRealizedUsd: null, idealCostUsd: null, realFromTurnsUsd: null,
      costNaiveUsd: null, breakPricedCostUsd: null, contextRewrites: null,
      costContentUsd: null,
    };
  }
  const usage = resultUsage;
  const input = Number(usage.input_tokens);
  const cached = Number(usage.cache_read_input_tokens);
  const cacheWrite = Number(usage.cache_creation_input_tokens);
  const output = Number(usage.output_tokens);
  const realized = (input * price.in + cacheWrite * price.in * 1.25
    + cached * price.cache + output * price.out) / 1e6;
  const naive = ((input + cached + cacheWrite) * price.in + output * price.out) / 1e6;
  return {
    costRealizedUsd: +realized.toFixed(6), idealCostUsd: null,
    realFromTurnsUsd: +realized.toFixed(6), costNaiveUsd: +naive.toFixed(6),
    breakPricedCostUsd: null, contextRewrites: null, costContentUsd,
  };
}

export function selectClaudeMainCosts({ streamTurns, transcriptTurns, resultUsage, price }) {
  // 1. exact category parity — the per-request record and the aggregate agree.
  if (recoveredTurnsMatchAggregate(streamTurns, resultUsage)) {
    return { source: 'stream', turns: streamTurns, perTurnReal: true,
      costs: costsFromTurns(streamTurns, price) };
  }
  if (recoveredTurnsMatchAggregate(transcriptTurns, resultUsage)) {
    return { source: 'transcript', turns: transcriptTurns, perTurnReal: true,
      costs: costsFromTurns(transcriptTurns, price) };
  }
  // 2. the record COVERS the aggregate and reports more (the aggregate dropped a
  //    served request). Prefer the transcript here: it is the complete per-request
  //    ledger, and the aggregate's omission is arm-asymmetric. See
  //    recoveredTurnsCoverAggregate for the measurement.
  for (const [source, turns] of [['transcript', transcriptTurns], ['stream', streamTurns]]) {
    if (recoveredTurnsCoverAggregate(turns, resultUsage)) {
      return { source: `${source}-superset`, turns, perTurnReal: true,
        costs: costsFromTurns(turns, price) };
    }
  }
  // 3. no trustworthy per-request record: aggregate only, and the
  //    cache-normalized columns stay null rather than being faked.
  const costs = claudeCosts(resultUsage, price, null);
  return { source: costs.costRealizedUsd == null ? 'unavailable' : 'aggregate',
    turns: [], perTurnReal: false, costs };
}

/** Synthetic aggregate record for persistence, never a turn distribution. */
export function aggregateTurn(resultUsage) {
  const usage = resultUsage || {};
  const cached = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const record = {
    in: (usage.input_tokens || 0) + cached + cacheWrite,
    cached,
    cacheWrite,
    out: usage.output_tokens || 0,
  };
  return (record.in || record.out) ? [record] : [];
}
