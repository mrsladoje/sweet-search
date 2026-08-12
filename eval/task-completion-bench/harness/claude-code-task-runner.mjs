// Claude Code harness for the task-completion bench: drives `claude -p` (a real
// production coding agent) as the agent loop, uncapped (runs to completion), routed to
// Sonnet 5 via OpenRouter's Anthropic-Messages "skin". Same clean ablation as codex:
//   - native arm: Claude Code + completion frame; NO M++, NO ss-*.
//   - sweet arm:  Claude Code + the same frame + M++ + ss-* wrappers on PATH.
// Claude-specific sweet delivery puts M± in the auto-loaded project rule and adds
// the compact system-priority override; CLAUDE.md carries only the benchmark frame.
// Codex/OpenCode keep their existing AGENTS.md delivery.
// Returns the canonical bench row shape (see codex-task-runner) so grading/metrics match.
import { isZeroCallStartFailure } from './codex-task-runner.mjs';
import { appendFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  spawnWithTimeout, exitReasonFrom, priceFor, costsFromTurns,
} from './agent-runner-shared.mjs';
import { installSedCmds } from './env-ledger.mjs';
import { persistTurns } from './turn-log.mjs';
import {
  CLAUDE_SYSTEM_OVERRIDE as SWEET_SEARCH_SYSTEM_OVERRIDE,
} from '../../../scripts/install-claude-system-prompt.js';

// D-4: shared, arm-symmetric tool-usage note. Kept to the single malformed argument it
// repairs — it names no file, tool strategy or retrieval policy, so neither arm gains
// anything from it beyond not wasting a call on a rejected parameter.
export const READ_PAGES_TOOL_NOTE =
  'Tool argument note: the Read tool\'s `pages` parameter is optional and applies only to PDF '
  + 'files. Omit it entirely for every non-PDF file. Never pass it as an empty string — an empty '
  + '`pages` value is rejected and the read is wasted.';

// Classify a shell command run via Claude Code's Bash tool into a bucket. Claude Code
// passes the raw command (no `bash -lc` wrapper like codex), so match directly.
function classifyShell(cmd) {
  const c = String(cmd || '').trim();
  if (/^run_tests\b/.test(c)) return 'test';
  if (/^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search)\b/.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

// Map a Claude Code tool_use block → {kind, command}. Built-in tools are typed, so the
// tool NAME drives the bucket; Bash unwraps to the shell command.
function classifyToolUse(name, input) {
  switch (name) {
    case 'Bash': return { kind: classifyShell(input?.command), command: input?.command || '' };
    case 'Grep': case 'Glob': return { kind: 'nativeGrep', command: `${name} ${JSON.stringify(input?.pattern ?? input?.query ?? '')}` };
    case 'Read': case 'NotebookRead': return { kind: 'nativeRead', command: `Read ${input?.file_path || input?.path || ''}` };
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return { kind: 'edit', command: `${name} ${input?.file_path || ''}` };
    default: return { kind: 'bash', command: `${name} ${JSON.stringify(input || {}).slice(0, 160)}` };
  }
}

// Parse Claude Code `--output-format stream-json --verbose` NDJSON. Returns
// { toolCalls, answer, resultUsage, numTurns, turns, errors }. IMPORTANT: via the OpenRouter
// Anthropic skin, per-assistant-message usage is ZEROED and result.usage.iterations is
// empty — so the ONLY reliable token counts are the final `result` event's aggregate
// usage (input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens).
//
// `turns` collects per-assistant-message usage ANYWAY (P7 / PLAN.md §3 B1): it is exact
// on the direct-Anthropic route, and the caller checks whether it is all-zero before
// trusting it, so the skin's zeroing degrades to an aggregate turn log rather than to
// silently fabricated per-turn numbers.
export function parseClaudeStream(stdout) {
  const toolCalls = [];         // {id, kind, command, resultText, isError}
  const resultById = new Map(); // tool_use_id → {text, isError}
  const errors = [];
  const turns = [];             // {in = full context incl. cache, cached, out}
  let answer = '', resultUsage = null, numTurns = 0, sessionId = null;
  if (!stdout) return { toolCalls, answer, resultUsage, numTurns, turns, sessionId, errors };
  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    // Every event carries it; needed to find this rollout's session transcript, which is
    // where per-message usage survives the skin's zeroing.
    if (!sessionId && ev.session_id) sessionId = ev.session_id;
    if (ev.type === 'assistant' && ev.message) {
      const mu = ev.message.usage;
      if (mu) {
        const cRead = mu.cache_read_input_tokens || 0, cCreate = mu.cache_creation_input_tokens || 0;
        turns.push({ in: (mu.input_tokens || 0) + cRead + cCreate, cached: cRead, out: mu.output_tokens || 0 });
      }
      for (const blk of (ev.message.content || [])) {
        if (blk.type === 'tool_use') {
          const { kind, command } = classifyToolUse(blk.name, blk.input);
          toolCalls.push({ id: blk.id, kind, command, resultText: '', isError: false });
        } else if (blk.type === 'text' && typeof blk.text === 'string' && blk.text.trim()) {
          answer = blk.text;
        }
      }
    } else if (ev.type === 'user' && ev.message) {
      for (const blk of (ev.message.content || [])) {
        if (blk.type === 'tool_result') {
          const txt = typeof blk.content === 'string' ? blk.content
            : Array.isArray(blk.content) ? blk.content.map(x => x?.text || '').join('') : '';
          resultById.set(blk.tool_use_id, { text: txt, isError: !!blk.is_error });
        }
      }
    } else if (ev.type === 'result') {
      if (typeof ev.result === 'string' && ev.result.trim()) answer = ev.result;
      if (ev.usage) resultUsage = ev.usage;
      if (ev.num_turns != null) numTurns = ev.num_turns;
      if (ev.subtype && ev.subtype !== 'success') errors.push(`result: ${ev.subtype}`);
    }
  }
  for (const tc of toolCalls) {
    const r = resultById.get(tc.id);
    if (r) { tc.resultText = r.text; tc.isError = r.isError; }
  }
  return { toolCalls, answer, resultUsage, numTurns, turns, sessionId, errors };
}

// Per-message usage RECOVERY (2026-08-11). The OpenRouter Anthropic skin zeroes usage on
// the streamed assistant events, but Claude Code's OWN session transcript records the real
// per-response numbers — that is where its final aggregate comes from. Verified against the
// provider: every transcript row's (input + cache_read + cache_creation) equals OpenRouter's
// native_tokens_prompt for the matching generation, and output_tokens equals
// native_tokens_completion (reasoning included, so it must NOT be added again).
//
// Without this the adapter published idealCost = realized and no breakPriced column at all,
// which is cache-lucky and unusable in a cross-harness cost table.
export function turnsFromTranscript(claudeHome, sessionId) {
  const file = findSessionFile(claudeHome, sessionId);
  return file ? turnsFromTranscriptFile(file) : [];
}

// <claude-home>/projects/<cwd-slug>/<session-id>.jsonl — the slug encodes the rundir, so
// find the file by session id rather than reconstructing the encoding.
function findSessionFile(claudeHome, sessionId) {
  if (!claudeHome || !sessionId) return null;
  let file = null;
  const walk = (dir, depth = 0) => {
    if (file || depth > 4) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (file) return;
      if (e.isDirectory()) walk(join(dir, e.name), depth + 1);
      else if (e.name === `${sessionId}.jsonl`) file = join(dir, e.name);
    }
  };
  walk(join(claudeHome, 'projects'));
  return file;
}

/** Per-message usage from one transcript file, in trajectory order. */
export function turnsFromTranscriptFile(file) {
  const turns = [];
  let text; try { text = readFileSync(file, 'utf8'); } catch { return turns; }
  const seen = new Set();   // transcript repeats a message once per content block
  for (const line of text.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    const m = ev.message;
    if (!m || m.role !== 'assistant' || !m.usage || !m.id || seen.has(m.id)) continue;
    const u = m.usage;
    const cRead = u.cache_read_input_tokens || 0, cCreate = u.cache_creation_input_tokens || 0;
    const inTot = (u.input_tokens || 0) + cRead + cCreate, out = u.output_tokens || 0;
    if (!inTot && !out) continue;            // a zeroed row recovers nothing
    seen.add(m.id);
    turns.push({ in: inTot, cached: cRead, out });
  }
  return turns;
}

// --- D-2 SIDECHAIN PRICING (2026-08-12) ---
// Claude Code writes each delegated subagent's conversation to its OWN transcript at
// <session-id>/subagents/agent-*.jsonl, NOT into the main session file. turnsFromTranscript
// stops at the main file, and the CLI's aggregate `result` usage does not include subagents
// either — so every delegated request was billed by the provider and priced at zero here.
// That is an accounting exploit in sweet's favour on any harness where native delegates more:
// native used sidechains in 8/17 Claude cells, sweet in 2/17.
//
// Each subagent is a SEPARATE context with its own growing prefix, so its turns are priced as
// their own sequence and the totals are summed. Folding them into the main sequence would make
// the prefix diff meaningless and corrupt breakPriced/contextRewrites.
export function sidechainTurnSets(claudeHome, sessionId) {
  const file = findSessionFile(claudeHome, sessionId);
  if (!file) return [];
  const dir = join(file.replace(/\.jsonl$/, ''), 'subagents');
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const sets = [];
  for (const e of entries.filter(x => x.isFile() && x.name.endsWith('.jsonl')).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const turns = turnsFromTranscriptFile(join(dir, e.name));
    if (turns.length) sets.push({ name: e.name, turns });
  }
  return sets;
}

// Sum a main-context cost object with each subagent context's own cost object. Main-only
// values are KEPT alongside (…MainOnlyUsd) so the pre-repair ledger stays reproducible from
// the same row — that is the D-2 acceptance check, not a separate derivation.
// A null column stays null: if the main context could not produce breakPriced, the total
// cannot either, and a partial sum would be worse than an honest absence.
export function addSidechainCosts(mainCosts, sidechainCosts) {
  const SUM = ['costRealizedUsd', 'idealCostUsd', 'realFromTurnsUsd', 'breakPricedCostUsd',
    'costNaiveUsd', 'costContentUsd', 'contextRewrites', 'idealTurns'];
  const out = { ...mainCosts };
  for (const k of SUM) {
    if (mainCosts[k] == null) { out[k] = null; continue; }
    let total = mainCosts[k];
    for (const c of sidechainCosts) total += (c[k] ?? 0);
    out[k] = k === 'contextRewrites' || k === 'idealTurns' ? total : +total.toFixed(6);
  }
  out.costRealizedMainOnlyUsd = mainCosts.costRealizedUsd ?? null;
  out.idealCostMainOnlyUsd = mainCosts.idealCostUsd ?? null;
  out.breakPricedCostMainOnlyUsd = mainCosts.breakPricedCostUsd ?? null;
  out.costSidechainUsd = +sidechainCosts.reduce((a, c) => a + (c.costRealizedUsd || 0), 0).toFixed(6);
  out.sidechainCount = sidechainCosts.length;
  return out;
}

// LAST-RESORT cost path: aggregate-only, used solely when neither the stream nor the session
// transcript yielded a turn distribution. Realized/naive from Claude Code's aggregate result
// usage × our OpenRouter rate: cache_read at the cache rate, cache_creation at the 1.25x write
// premium, fresh input + output at their rates.
//
// idealCost = realized here because cache-normalization needs the growing-prefix structure,
// which an aggregate does not have. breakPriced and contextRewrites are NULL for the same
// reason — an absent column is honest; a copy of another column is not. The normal path
// (costsFromTurns, shared with codex/opencode) fills all of them; see turnsFromTranscript.
//
// costNaiveUsd matches the unified §3 B4 definition: EVERY input token — fresh, cached
// and cache-written — charged at the full input rate. costContentUsd (unique context
// charged once) needs the growing-prefix structure and is supplied by the caller only
// when per-turn usage survived the provider route; null is the honest value otherwise,
// never a stand-in from another column.
function claudeCosts(resultUsage, price, costContentUsd = null) {
  const u = resultUsage || {};
  const inTok = u.input_tokens || 0, cRead = u.cache_read_input_tokens || 0;
  const cCreate = u.cache_creation_input_tokens || 0, out = u.output_tokens || 0;
  const realized = (inTok * price.in + cCreate * price.in * 1.25 + cRead * price.cache + out * price.out) / 1e6;
  const naive = ((inTok + cRead + cCreate) * price.in + out * price.out) / 1e6;
  return {
    costRealizedUsd: +realized.toFixed(6), idealCostUsd: +realized.toFixed(6),
    realFromTurnsUsd: +realized.toFixed(6), costNaiveUsd: +naive.toFixed(6),
    breakPricedCostUsd: null, contextRewrites: null,
    costContentUsd,
  };
}

// One synthetic turn record carrying the run aggregate, for the route where per-message
// usage is zeroed. Tagged `source: 'aggregate'` in the log so no analysis mistakes it
// for a turn distribution.
function aggregateTurn(resultUsage) {
  const u = resultUsage || {};
  const cRead = u.cache_read_input_tokens || 0, cCreate = u.cache_creation_input_tokens || 0;
  const rec = { in: (u.input_tokens || 0) + cRead + cCreate, cached: cRead, out: u.output_tokens || 0 };
  return (rec.in || rec.out) ? [rec] : [];
}

export async function runClaudeCodeTask(task, {
  arm, apiModel = 'anthropic/claude-sonnet-5', provider = 'openrouter',
  ssBinDir, mppText, image, t, perCallTimeoutMs = 900000,
} = {}) {
  const sweet = arm === 'sweet';
  const rundir = task.repoCheckout;
  const workdir = t.workdir || `/${t.repo.split('/')[1]}`;
  const testScript = [].concat(t.install_config?.test_cmd || []).join(' && ');
  const claudeModelId = apiModel.replace(/^anthropic\//, '');
  const orSlug = apiModel.includes('/') ? apiModel : `anthropic/${apiModel}`;
  // Price by what we PAY: OpenRouter slug rate for the skin route, direct-model rate for
  // provider=anthropic. Realized cost must reflect the paid rate, not list.
  const price = priceFor(provider === 'anthropic' ? claudeModelId : orSlug);

  // Provider routing. OpenRouter: Claude Code speaks the Anthropic Messages API and
  // OpenRouter exposes a native /v1/messages "skin" that forwards Claude models to
  // Anthropic — set base_url + auth token, blank ANTHROPIC_API_KEY so a stale key can't
  // win precedence, and pin ALL three model slots or the unset ones 404 at startup.
  const routingEnv = provider === 'anthropic'
    ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '' }
    : {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: process.env.OPENROUTER_API_KEY || '',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_DEFAULT_SONNET_MODEL: orSlug,
        ANTHROPIC_DEFAULT_OPUS_MODEL: orSlug,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: orSlug,
      };
  // bypassPermissions as root is refused unless a sandbox is recognized; the real
  // isolation is now the per-rollout jail (mount+pid+net namespaces), so declare it.
  routingEnv.IS_SANDBOX = '1';
  routingEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // Claude Code's config + session store, per rollout rather than shared across the run.
  const claudeHome = rolloutStateDir(label, 'claude-home');
  const HOMEDIR = process.env.HOME || '/root';
  // ~/.claude.json holds onboarding state and Claude Code WRITES to it, so it gets a
  // private seeded COPY rather than a read-only bind of the shared file.
  const claudeJson = join(rolloutStateDir(label, 'claude-conf'), '.claude.json');
  try {
    const src = join(HOMEDIR, '.claude.json');
    if (existsSync(src) && !existsSync(claudeJson)) copyFileSync(src, claudeJson);
  } catch { /* claude will re-onboard */ }
  const extraBinds = [
    // The `claude` on PATH is ~/.local/bin/claude -> ~/.local/share/claude/versions/<v>,
    // a versioned ELF. Masking $HOME left that symlink DANGLING, so exec failed with
    // ENOENT and every rollout recorded calls=0 / agent_error. Bind what it points at.
    { src: join(HOMEDIR, '.local/share/claude'), dst: join(HOMEDIR, '.local/share/claude'), ro: true, required: true },
    { src: claudeJson, dst: join(HOMEDIR, '.claude.json') },
    { src: claudeHome, dst: join(HOMEDIR, '.claude') },
  ];
  // Inject before runner setup so telemetry snapshots the harness-owned bytes.
  writeInstructionFile(rundir, 'CLAUDE.md', { sweet: false, mppText });
  const injectedFiles = ['CLAUDE.md'];
  if (sweet) {
    const rulesDir = join(rundir, '.claude', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    appendFileSync(join(rulesDir, 'sweet-search.md'), `${mppText.trimEnd()}\n`);
    injectedFiles.push('.claude/rules/sweet-search.md');
  }
  const {
    runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir, controller,
  } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, taskId: task.id, arm, extraBinds, requireBins: ['claude'], injectedFiles,
    installSeds: installSedCmds(t),
  });

  const env = buildAgentEnv({ rundir, binDir, ssBinDir, sweet, extraEnv: routingEnv, jail });
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). CLAUDE.md carries only the benchmark
  // completion frame; the sweet arm's verbatim M± lives in its project rule.
  const prompt = issuePrompt(task.problem_statement);
  const args = [
    '-p', prompt, '--add-dir', rundir,
  ];
  // --- D-4 EMPTY `pages` PARAMETER (2026-08-12) ---
  // Claude Code's Read tool takes an optional `pages` string for PDFs and rejects "" with
  // `Invalid pages parameter: ""`. The backbone here is not a Claude model, and it fills the
  // optional string rather than omitting it: 68 native and 6 sweet Read calls died this way
  // on the 2026-08-11 run, a pure harness-adapter tax that inflated NATIVE's Claude cost.
  // The note is byte-identical for both arms and carries no retrieval or strategy content,
  // so it creates no head-to-head differential — a later native improvement from this fix is
  // a repair of our own defect and must never be reported as a sweet regression.
  args.push('--append-system-prompt', READ_PAGES_TOOL_NOTE);
  if (sweet) args.push('--append-system-prompt', SWEET_SEARCH_SYSTEM_OVERRIDE);
  // Append rather than replace Claude Code's native system prompt so its standard coding-agent
  // and tool behavior remains intact. bypassPermissions avoids a headless permission hang.
  args.push(
    '--model', claudeModelId,
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json', '--verbose',
  );

  const t0 = Date.now();
  const spawnOnce = () => spawnWithTimeout('claude', args, { cwd: rundir, env, timeoutMs: perCallTimeoutMs, jail });
  let r = await spawnOnce();
  let parsed = parseClaudeStream(r.stdout);
  let startRetried = false;
  if (isZeroCallStartFailure(r, parsed.toolCalls, parsed.answer)) {
    startRetried = true;
    console.log(`  [claude-retry ${task.id || ''}] 0-call start failure (exit=${r.exitCode}${parsed.errors[0] ? '; ' + parsed.errors[0] : ''}) — relaunching once`);
    r = await spawnOnce();
    parsed = parseClaudeStream(r.stdout);
  }
  const wallMs = Date.now() - t0;
  const { toolCalls, answer, resultUsage, numTurns, turns, sessionId, errors } = parsed;

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  // NO patchFiles backfill into toolCounts.edit (PLAN.md §3 B3); patch-derived metrics
  // read patchFiles/patchHunks or preds-*.jsonl.

  // P7 (PLAN.md §3 B1). Per-message usage is real on the direct-Anthropic route and
  // zeroed through the OpenRouter Anthropic skin, so trust it only when it carries
  // tokens; otherwise log the aggregate and leave costContentUsd null.
  // Stream first (direct-Anthropic route); then the session transcript, which keeps the real
  // per-message numbers even when the skin zeroes the stream. Only when BOTH are empty does
  // this degrade to the aggregate — an honest realized-only row with null breakPriced,
  // never a fabricated turn distribution.
  let turnSource = 'stream';
  let realTurns = turns.some(tu => tu.in > 0 || tu.out > 0) ? turns : [];
  if (!realTurns.length) {
    realTurns = turnsFromTranscript(claudeHome, sessionId);
    if (realTurns.length) turnSource = 'transcript';
  }
  const perTurnReal = realTurns.length > 0;
  const turnsFile = persistTurns(label, perTurnReal ? realTurns : aggregateTurn(resultUsage), {
    task: task.id, arm, harness: 'claude-code', model: apiModel, provider, price,
    source: perTurnReal ? turnSource : 'aggregate',
  });

  // Shared arithmetic with opencode/codex whenever a real distribution exists, so the three
  // harnesses' cost columns come from ONE code path and cannot drift apart.
  const mainCosts = perTurnReal
    ? costsFromTurns(realTurns, price)
    : claudeCosts(resultUsage, price, null);
  // D-2: price every delegated request too. Each subagent transcript is its own context.
  const sideSets = sidechainTurnSets(claudeHome, sessionId);
  sideSets.forEach((s, i) => persistTurns(`${label}__sidechain-${i}`, s.turns, {
    task: task.id, arm, harness: 'claude-code', model: apiModel, provider, price,
    source: 'transcript-sidechain', sidechainFile: s.name,
  }));
  const costs = addSidechainCosts(mainCosts, sideSets.map(s => costsFromTurns(s.turns, price)));
  if (sideSets.length) {
    console.log(`  [sidechain ${task.id || ''} ${arm}] ${sideSets.length} delegated context(s), `
      + `${sideSets.reduce((a, s) => a + s.turns.length, 0)} turn(s), +$${costs.costSidechainUsd} on top of main $${costs.costRealizedMainOnlyUsd}`);
  }
  const shimTamperedFiles = verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir });
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });

  const calls = toolCalls.length;
  return {
    ...controller,
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason: exitReasonFrom(r),
    usage: resultUsage || {}, idealTurns: numTurns,
    sidechainTurns: sideSets.reduce((a, s) => a + s.turns.length, 0),
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
