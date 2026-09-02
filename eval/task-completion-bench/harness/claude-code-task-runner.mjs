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
import {
  appendFileSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import { runTestsTelemetry } from './rt-inflight.mjs';
import {
  turnsFromTranscript, sidechainTurnSets, addSidechainCostsChecked,
  selectClaudeMainCosts, aggregateTurn,
} from './claude-code-accounting.mjs';
export {
  turnsFromTranscript, turnsFromTranscriptFile, transcriptMetricsFromFile,
  aggregateUsageFromTurns, recoveredTurnsMatchAggregate, recoveredTurnsCoverAggregate,
  sidechainTurnSets,
  addSidechainCosts, addSidechainCostsChecked, claudeCosts, selectClaudeMainCosts,
} from './claude-code-accounting.mjs';
import { installSedCmds } from './env-ledger.mjs';
import { persistTurns } from './turn-log.mjs';
import { classifyRollout } from './degeneration.mjs';
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

/**
 * Build the invariant Claude CLI argument vector. The CLI accepts one scalar
 * `--append-system-prompt` value: passing the option twice is last-value-wins,
 * which previously dropped the shared pages repair from the sweet arm.
 */
export function buildClaudeCliArgs({ prompt, rundir, sweet, claudeModelId, settingsPath = null }) {
  const appendedSystemPrompt = sweet
    ? `${READ_PAGES_TOOL_NOTE}\n\n${SWEET_SEARCH_SYSTEM_OVERRIDE}`
    : READ_PAGES_TOOL_NOTE;
  return [
    '-p', prompt, '--add-dir', rundir,
    '--append-system-prompt', appendedSystemPrompt,
    // THE PreToolUse READ NORMALIZER IS INERT. IT CANNOT WORK. DO NOT "FIX" IT.
    // (Settled 2026-08-13 by correlating every hook invocation against every Read
    // outcome across all 32 native sessions of screen-v3.)
    //
    //             Read calls   needed normalizing   rejected
    //   hook ran      189              0                0
    //   hook did not  110            110              110
    //
    // Complete separation. Claude Code validates tool arguments against the tool
    // schema BEFORE the PreToolUse stage, so `pages: ""` (99 calls) and
    // `pages: " "` (11 calls) die before a hook can observe them. The hook has
    // never repaired a single input, and no hook ever will. Where it does run it
    // is flawless and irrelevant — 189/189 hook_success on already-valid calls.
    //
    // TWO EARLIER CONCLUSIONS HERE WERE WRONG, both from one unreplicated run:
    //   * "coverage is 33.9%, an activation race" — there is no race, and 557 was
    //     the wrong denominator (299 native main-transcript Read calls).
    //   * "`--settings` made coverage worse, so it is refuted" — void comparison;
    //     both sides measured a quantity that was 0. `--settings` is still NOT
    //     passed, but for want of any reason to pass it, not because it lost.
    //
    // The only layer upstream of the validator is the network transport, and
    // `egress-guard.mjs` deliberately never terminates TLS (no MITM CA in the
    // jail). That property closed the ground-truth-assistance hole; it is not
    // traded for this. The tax is therefore MEASURED AND SUBTRACTED post hoc,
    // never mitigated — see RESULTS-2026-08-13.md §1 and §5.
    //
    // Residual shape: 110 rejections over 32 sessions (3.4 each), front-loaded
    // (median = 2nd Read call). It is NOT self-limiting: only 10 of 32 sessions
    // stop sending an invalid value after the first rejection; 22 keep sending it.
    // It is arm-asymmetric because the sweet arm barely uses this tool, so any run
    // must MEASURE and DISCLOSE it rather than assume it is neutral.
    //
    // READ_PAGES_TOOL_NOTE below is the only lever that works. It is prompt-level,
    // byte-identical across both arms, and gets 189 of 299 calls to a valid value.
    '--model', claudeModelId,
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json', '--verbose',
  ];
}

const CLAUDE_READ_PAGES_HOOK = fileURLToPath(
  new URL('./claude-read-pages-hook.mjs', import.meta.url),
);

/** Install the deterministic Read-input normalizer into one private Claude home. */
export function installClaudeReadPagesNormalizer(claudeHome, visibleHome) {
  const hooksDir = join(claudeHome, 'hooks');
  const installedHook = join(hooksDir, 'normalize-read-pages.mjs');
  const visibleHook = join(visibleHome, '.claude', 'hooks', 'normalize-read-pages.mjs');
  const settingsPath = join(claudeHome, 'settings.json');
  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(CLAUDE_READ_PAGES_HOOK, installedHook);

  let settings = {};
  if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks ??= {};
  const groups = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  if (!groups.some(group => (group?.hooks || []).some(hook =>
    typeof hook?.command === 'string' && hook.command.includes('normalize-read-pages.mjs')))) {
    const quotedHook = `'${visibleHook.replace(/'/g, `'\\''`)}'`;
    groups.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: `node ${quotedHook}`, timeout: 4 }],
    });
  }
  settings.hooks.PreToolUse = groups;
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  // visibleSettings is the IN-JAIL path (claudeHome is bind-mounted at
  // $HOME/.claude), which is what `--settings` must receive.
  const visibleSettings = join(visibleHome, '.claude', 'settings.json');
  return { installedHook, settingsPath, visibleHook, visibleSettings };
}

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
  // Degeneration accounting: every payload the model emitted, and how many
  // output chars the transcript actually retained, so the billed-vs-retained
  // ratio can be computed without a second pass over the session files.
  const payloads = [];
  let retainedOutputChars = 0, billedOutputTokens = 0;
  let billedOutputSource = 'assistant-stream';
  let answer = '', resultUsage = null, numTurns = 0, sessionId = null;
  if (!stdout) {
    return { toolCalls, answer, resultUsage, numTurns, turns, sessionId, errors,
      payloads, retainedOutputChars, billedOutputTokens, billedOutputSource };
  }
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
        turns.push({ in: (mu.input_tokens || 0) + cRead + cCreate, cached: cRead,
          cacheWrite: cCreate, out: mu.output_tokens || 0 });
        billedOutputTokens += mu.output_tokens || 0;
      }
      for (const blk of (ev.message.content || [])) {
        if (blk.type === 'tool_use') {
          const { kind, command } = classifyToolUse(blk.name, blk.input);
          toolCalls.push({ id: blk.id, kind, command, resultText: '', isError: false });
          // Every string the model wrote into a tool argument. Stream parsing
          // happens after the buffered CLI process returns, so this is
          // retrospective detection; it does not intercept tool execution.
          for (const v of Object.values(blk.input || {})) {
            if (typeof v === 'string') { payloads.push(v); retainedOutputChars += v.length; }
          }
          for (const e of (blk.input?.edits || [])) {
            for (const v of Object.values(e || {})) {
              if (typeof v === 'string') { payloads.push(v); retainedOutputChars += v.length; }
            }
          }
        } else if (blk.type === 'text' && typeof blk.text === 'string') {
          retainedOutputChars += blk.text.length;
          if (blk.text.trim()) answer = blk.text;
        } else if (blk.type === 'thinking' && typeof blk.thinking === 'string') {
          retainedOutputChars += blk.thinking.length;
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
  // The final result event is Claude Code's authoritative aggregate. Assistant
  // stream usage is zeroed by some provider skins and can otherwise be partial,
  // so never substitute its sum when the aggregate field is present.
  if (resultUsage && Object.prototype.hasOwnProperty.call(resultUsage, 'output_tokens')) {
    const aggregateOutput = Number(resultUsage.output_tokens);
    if (Number.isFinite(aggregateOutput) && aggregateOutput >= 0) {
      billedOutputTokens = aggregateOutput;
      billedOutputSource = 'result-aggregate';
    }
  }
  return {
    toolCalls, answer, resultUsage, numTurns, turns, sessionId, errors,
    payloads, retainedOutputChars, billedOutputTokens, billedOutputSource,
  };
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
  // ss-* gutter form pinned per harness (core/search/gutter-form.js): claude-code → `N<TAB>`.
  // Pinned so the timed run never pays a process-tree walk; operator env (A/B arm) wins.
  routingEnv.SS_READ_GUTTER = process.env.SS_READ_GUTTER ?? 'tab';

  const netArgs = computeNetArgs(t);
  const label = `${task.id || 'task'}-${arm}`;
  // Claude Code's config + session store, per rollout rather than shared across the run.
  const claudeHome = rolloutStateDir(label, 'claude-home');
  const HOMEDIR = process.env.HOME || '/root';
  installClaudeReadPagesNormalizer(claudeHome, HOMEDIR);
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
  // --- D-4 EMPTY `pages` PARAMETER (2026-08-12) ---
  // Claude Code's Read tool takes an optional `pages` string for PDFs and rejects "" with
  // `Invalid pages parameter: ""`. The backbone here is not a Claude model, and it fills the
  // optional string rather than omitting it: 68 native and 6 sweet Read calls died this way
  // on the 2026-08-11 run, a pure harness-adapter tax that inflated NATIVE's Claude cost.
  // The note is byte-identical for both arms and carries no retrieval or strategy content,
  // so it creates no head-to-head differential — a later native improvement from this fix is
  // a repair of our own defect and must never be reported as a sweet regression.
  // The arm-symmetric PreToolUse hook above performs the actual input normalization; this note
  // keeps the model from repeatedly proposing an argument the hook must remove. Append rather
  // than replace Claude Code's native system prompt so its standard coding-agent and tool
  // behavior remains intact. `buildClaudeCliArgs` deliberately emits ONE append flag,
  // preserving the shared pages note in both arms. bypassPermissions avoids a headless hang.
  const args = buildClaudeCliArgs({ prompt, rundir, sweet, claudeModelId });

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
  // D-6 row telemetry (HANDOFF-SLATE-A-RESIDUE §3.G.2). Fed the tool calls, NOT the
  // trajectory: buildTrajectory truncates results at 600 chars and the verdict footer is the
  // last line a completed run writes, so reading it off the trajectory would under-count.
  const rtTelemetry = runTestsTelemetry(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  // NO patchFiles backfill into toolCounts.edit (PLAN.md §3 B3); patch-derived metrics
  // read patchFiles/patchHunks or preds-*.jsonl.

  // P7 (PLAN.md §3 B1). Per-message usage is real on the direct-Anthropic route and
  // zeroed through the OpenRouter Anthropic skin, so trust it only when it carries
  // tokens; otherwise log the aggregate and leave costContentUsd null.
  // Stream first (direct-Anthropic route); then the session transcript, which keeps the real
  // per-message numbers even when the skin zeroes the stream. Only when BOTH are unusable does
  // this degrade to the aggregate — an honest realized-only row with null breakPriced.
  // If the final aggregate itself is incomplete, every cost stays null and no synthetic
  // turn log is written; absent provider evidence must never become zero usage.
  const transcriptTurns = turnsFromTranscript(claudeHome, sessionId);
  const mainCostSelection = selectClaudeMainCosts({
    streamTurns: turns, transcriptTurns, resultUsage, price,
  });
  const { source: turnSource, turns: realTurns, perTurnReal, costs: mainCosts } = mainCostSelection;
  const persistedTurns = perTurnReal ? realTurns
    : (turnSource === 'aggregate' ? aggregateTurn(resultUsage) : []);
  const turnsFile = persistTurns(label, persistedTurns, {
    task: task.id, arm, harness: 'claude-code', model: apiModel, provider, price,
    source: turnSource,
  });

  // Shared arithmetic with opencode/codex whenever a real distribution exists, so the three
  // harnesses' cost columns come from ONE code path and cannot drift apart.
  // D-2: price every delegated request too. Each subagent transcript is its own context.
  const sideSets = sidechainTurnSets(claudeHome, sessionId);
  // Retrospective, full-rollout classification. Main billed output uses the
  // authoritative final result aggregate; delegated contexts contribute their
  // own transcript payload, retained-character, and output-token accounting.
  // If a sidechain transcript lacks non-zero per-message usage, expose that gap
  // explicitly instead of claiming complete rollout instrumentation.
  const incompleteSidechains = sideSets.filter(s => !s.instrumentationComplete).map(s => s.name);
  const rolloutSignals = {
    payloads: [...parsed.payloads, ...sideSets.flatMap(s => s.payloads)],
    retainedOutputChars: parsed.retainedOutputChars
      + sideSets.reduce((sum, s) => sum + s.retainedOutputChars, 0),
    billedOutputTokens: parsed.billedOutputTokens
      + sideSets.reduce((sum, s) => sum + s.billedOutputTokens, 0),
  };
  const degeneration = {
    ...classifyRollout(rolloutSignals),
    instrumentation: {
      complete: parsed.billedOutputSource === 'result-aggregate' && incompleteSidechains.length === 0,
      mainOutput: parsed.billedOutputSource,
      sidechainTranscripts: sideSets.length,
      incompleteSidechains,
      timing: 'retrospective',
    },
  };
  if (degeneration.degenerate) {
    console.log(`  [degenerate ${task.id || ''} ${arm}] ${degeneration.reasons.join(', ')}`
      + ` — ${degeneration.degeneratePayloads} payload(s), ${degeneration.degenerateChars} chars,`
      + ` billed/retained=${degeneration.billedVsRetainedRatio ?? 'n/a'}x`);
  }
  if (!degeneration.instrumentation.complete) {
    console.log(`  [degeneration-instrumentation ${task.id || ''} ${arm}] INCOMPLETE — main=${parsed.billedOutputSource}`
      + `${incompleteSidechains.length ? ` sidechains=${incompleteSidechains.join(',')}` : ''}`);
  }
  sideSets.forEach((s, i) => persistTurns(`${label}__sidechain-${i}`, s.turns, {
    task: task.id, arm, harness: 'claude-code', model: apiModel, provider, price,
    source: 'transcript-sidechain', sidechainFile: s.name,
  }));
  const costs = addSidechainCostsChecked(mainCosts, sideSets, price);
  if (sideSets.length) {
    console.log(costs.sidechainAccountingComplete
      ? `  [sidechain ${task.id || ''} ${arm}] ${sideSets.length} delegated context(s), `
        + `${sideSets.reduce((a, s) => a + s.turns.length, 0)} turn(s), +$${costs.costSidechainUsd} on top of main $${costs.costRealizedMainOnlyUsd}`
      : `  [sidechain ${task.id || ''} ${arm}] ACCOUNTING INCOMPLETE — inclusive cost unavailable; ${costs.incompleteSidechains.join(',')}`);
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
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0, ...rtTelemetry,
    exitReason: exitReasonFrom(r),
    usage: resultUsage || {}, idealTurns: numTurns,
    degenerate: degeneration.degenerate, degeneration,
    degenerationInstrumentationComplete: degeneration.instrumentation.complete,
    readPagesNormalization: 'pretool-hook-v1',
    sidechainTurns: sideSets.reduce((a, s) => a + s.turns.length, 0),
    ...costs, turnsFile,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
