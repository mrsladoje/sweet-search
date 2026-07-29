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
import { appendFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRunner, buildAgentEnv, warmupSweet, issuePrompt, computeNetArgs, writeInstructionFile,
  buildTrajectory, gitDiffPatch, verifyIntegrity, teardownRunner, auditEscape, rolloutStateDir,
  spawnWithTimeout, exitReasonFrom, priceFor,
} from './agent-runner-shared.mjs';
import {
  CLAUDE_SYSTEM_OVERRIDE as SWEET_SEARCH_SYSTEM_OVERRIDE,
} from '../../../scripts/install-claude-system-prompt.js';

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
// { toolCalls, answer, resultUsage, numTurns, errors }. IMPORTANT: via the OpenRouter
// Anthropic skin, per-assistant-message usage is ZEROED and result.usage.iterations is
// empty — so the ONLY reliable token counts are the final `result` event's aggregate
// usage (input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens).
export function parseClaudeStream(stdout) {
  const toolCalls = [];         // {id, kind, command, resultText, isError}
  const resultById = new Map(); // tool_use_id → {text, isError}
  const errors = [];
  let answer = '', resultUsage = null, numTurns = 0;
  if (!stdout) return { toolCalls, answer, resultUsage, numTurns, errors };
  for (const line of stdout.split('\n')) {
    const tl = line.trim();
    if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    if (ev.type === 'assistant' && ev.message) {
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
  return { toolCalls, answer, resultUsage, numTurns, errors };
}

// Realized/naive cost from Claude Code's aggregate result usage × our OpenRouter rate.
// cache_read at cache rate (0.1x in), cache_creation at the 1.25x write premium, fresh
// input + output at their rates. idealCost = realized (no per-turn data via the skin, so
// no cache-normalization possible; realized already reflects Claude Code's actual caching).
function claudeCosts(resultUsage, price) {
  const u = resultUsage || {};
  const inTok = u.input_tokens || 0, cRead = u.cache_read_input_tokens || 0;
  const cCreate = u.cache_creation_input_tokens || 0, out = u.output_tokens || 0;
  const realized = (inTok * price.in + cCreate * price.in * 1.25 + cRead * price.cache + out * price.out) / 1e6;
  const naive = ((inTok + cRead + cCreate) * price.in + out * price.out) / 1e6;
  return {
    costRealizedUsd: +realized.toFixed(6), idealCostUsd: +realized.toFixed(6),
    realFromTurnsUsd: +realized.toFixed(6), costNaiveUsd: +naive.toFixed(6),
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
  const { runnerStateDir, binDir, runnerFiles, integrity, jail, broker, integrityStateDir } = setupRunner({
    image, workdir, testScript, rundir, testTimeoutSec: t._testTimeoutSec || 300, netArgs, sweet,
    label, extraBinds, requireBins: ['claude'],
  });

  const env = buildAgentEnv({ rundir, binDir, ssBinDir, sweet, extraEnv: routingEnv, jail });
  if (sweet && ssBinDir) warmupSweet({ ssBinDir, rundir, env, jail });

  // Prompt = the issue ONLY (both arms). CLAUDE.md carries only the benchmark
  // completion frame. Claude auto-loads the sweet arm's verbatim M± from the
  // same unscoped project-rule surface used by production init.
  writeInstructionFile(rundir, 'CLAUDE.md', { sweet: false, mppText });
  if (sweet) {
    const rulesDir = join(rundir, '.claude', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    appendFileSync(join(rulesDir, 'sweet-search.md'), `${mppText.trimEnd()}\n`);
  }
  const prompt = issuePrompt(task.problem_statement);
  const args = [
    '-p', prompt, '--add-dir', rundir,
  ];
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
  const { toolCalls, answer, resultUsage, numTurns, errors } = parsed;

  const { toolCounts, trajectory, stepsToFirstEdit } = buildTrajectory(toolCalls);
  const { finalPatch, patchHunks, patchFiles } = gitDiffPatch(rundir);
  if (toolCounts.edit === 0 && patchHunks > 0) toolCounts.edit = patchFiles;

  const costs = claudeCosts(resultUsage, price);
  const shimTamperedFiles = verifyIntegrity({ integrity, runnerFiles, binDir, integrityStateDir });
  if (shimTamperedFiles.length) console.log(`  [SHIM-TAMPERED ${task.id || ''}] ${shimTamperedFiles.join(', ')} — test signals untrusted`);
  const escapeAudit = auditEscape({ jail, toolCalls, rundir, endMs: Date.now() });
  teardownRunner(runnerStateDir, { jail, broker });

  const calls = toolCalls.length;
  return {
    calls, ss: toolCounts.ss, nativeGrep: toolCounts.nativeGrep, toolCounts,
    patchHunks, patchFiles, finalPatch,
    ...escapeAudit,
    shimTampered: shimTamperedFiles.length > 0, shimTamperedFiles,
    stepsToFirstEdit: stepsToFirstEdit ?? calls, nudges: 0,
    exitReason: exitReasonFrom(r),
    usage: resultUsage || {}, idealTurns: numTurns,
    ...costs,
    wallMs, trajectory, finalAssistantText: answer,
    agentErrors: errors.slice(0, 5), startRetried,
    stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}
