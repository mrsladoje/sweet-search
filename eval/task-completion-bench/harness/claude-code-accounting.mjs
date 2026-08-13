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

/**
 * Recover priced turns and retrospective signals, MERGED by message id.
 *
 * ONE SERVED REQUEST IS WRITTEN AS MANY RECORDS — one per content block, all sharing
 * `message.id` (2.46 blocks per request measured over 2,877 requests, 2026-08-13). Reading
 * only the first record per id is wrong in two ways at once:
 *
 *   1. USAGE. The first record is often a `redacted_thinking` block whose usage is all
 *      zeros while a later record for the SAME id carries the real numbers. Keeping the
 *      first therefore DROPPED the whole request from `turns`, and one dropped delegated
 *      request nulls the row's entire inclusive cost via addSidechainCostsChecked. On the
 *      two retained claude runs that lost 76 of 235 and 67 of 156 delegated requests —
 *      under-charging the arm that delegates most, which was native by 3 to 1.
 *   2. CONTENT. `payloads` and `retainedOutputChars` saw one block per request, an 6.6x
 *      under-count, which inflates the billed-vs-retained ratio the degeneration detector
 *      reads.
 *
 * Taking the usage-bearing record is EXACT, not an estimate: across 1,939 ids carrying more
 * than one non-zero record, ZERO disagreed on any token category, and no id was ever reused
 * or interleaved. A request whose every record is zeroed is genuinely unrecoverable and is
 * still excluded, so `instrumentationComplete` keeps failing closed on it.
 *
 * `repeatedToolUseBlocks` is a tripwire. The writer is append-only today — 0 duplicate
 * blocks in 7,078 — so unioning blocks cannot double-count. If a future Claude Code writes
 * CUMULATIVE records instead, tool_use ids will repeat and this counter goes positive
 * rather than the character totals silently doubling.
 */
export function transcriptMetricsFromFile(file) {
  const turns = [];
  const payloads = [];
  let retainedOutputChars = 0, billedOutputTokens = 0;
  let assistantMessages = 0, usageMessages = 0, repeatedToolUseBlocks = 0;
  let text; try { text = readFileSync(file, 'utf8'); } catch {
    return { turns, payloads, retainedOutputChars, billedOutputTokens,
      assistantMessages, usageMessages, repeatedToolUseBlocks,
      instrumentationComplete: false };
  }
  // Pass 1 — group every record by message id, in first-seen order.
  const order = [];
  const byId = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    let event; try { event = JSON.parse(trimmed); } catch { continue; }
    const message = event.message;
    if (!message || message.role !== 'assistant' || !message.id) continue;
    let group = byId.get(message.id);
    if (!group) {
      group = { blocks: [], usage: null, best: -1, toolUseIds: new Set() };
      byId.set(message.id, group);
      order.push(message.id);
    }
    for (const block of (message.content || [])) {
      if (block.type === 'tool_use' && block.id) {
        if (group.toolUseIds.has(block.id)) { repeatedToolUseBlocks++; continue; }
        group.toolUseIds.add(block.id);
      }
      group.blocks.push(block);
    }
    const usage = message.usage;
    if (!usage) continue;
    const cached = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const input = (usage.input_tokens || 0) + cached + cacheWrite;
    const output = usage.output_tokens || 0;
    // The record that actually reports tokens wins; every record that reports any agrees.
    if (input + output > group.best) {
      group.best = input + output;
      group.usage = { in: input, cached, cacheWrite, out: output };
    }
  }
  // Pass 2 — emit one turn per served request, with that request's whole content.
  for (const id of order) {
    const group = byId.get(id);
    assistantMessages++;
    for (const block of group.blocks) {
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
    const usage = group.usage;
    if (!usage || (!usage.in && !usage.out)) continue;
    usageMessages++;
    billedOutputTokens += usage.out;
    turns.push(usage);
  }
  return {
    turns, payloads, retainedOutputChars, billedOutputTokens,
    assistantMessages, usageMessages, repeatedToolUseBlocks,
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

/**
 * Claude Code's project-dir slug encodes the rundir path, replacing `/`, `.` and `_` with `-`.
 * Two rundir shapes exist and BOTH must resolve, because retained runs keep the old one:
 *   pre-2026-08-13  `<task>__<arm>__r<rep>__<n>`  ->  `…-runs-<task>--<arm>--r<rep>--<n>`
 *   current         `r<rep>-<n>`                  ->  `…-runs-r<rep>-<n>`
 * The current shape is short and ARM-BLIND on purpose — see makeRunDir in run-pilot.mjs. It
 * stopped the agent reading its own arm out of its working directory, and it removed ~40
 * characters the model had to transcribe whenever a tool wanted an absolute path.
 */
export function repOfSlug(slug) {
  const m = /--r(\d+)--\d+$/.exec(String(slug))     // long form, retained runs
         || /-r(\d+)-\d+$/.exec(String(slug));      // short arm-blind form
  return m ? +m[1] : null;
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
