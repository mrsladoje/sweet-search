export async function runCodexAgent({ prompt, systemAppend, model, cwd, sweetSearchBinDir, reasoningEffort = 'low', timeoutMs = 240000 }) {
  const { spawn } = await import('node:child_process');
  const merged = systemAppend ? `[SYSTEM]\n${systemAppend}\n\n[USER]\n${prompt}` : prompt;
  const codexModel = (!model || /instant/i.test(model)) ? 'gpt-5.5' : model;
  const args = [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    '--json',
    '-c', `model_reasoning_effort="${reasoningEffort}"`,
    '-m', codexModel,
  ];
  if (cwd) args.push('-C', cwd);
  args.push(merged);
  const env = { ...process.env };
  if (sweetSearchBinDir) env.PATH = [sweetSearchBinDir, env.PATH].filter(Boolean).join(':');
  if (cwd) env.SWEET_SEARCH_PROJECT_ROOT = cwd;

  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const proc = spawn('codex', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch { /* noop */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* noop */ } }, 2000).unref();
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ stdout, stderr: stderr + err.message, exitCode: -1, timedOut }); });
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 0, timedOut }); });
  });

  const { toolCalls, answer, usage } = parseCodexAgentStream(r.stdout);
  return {
    toolCalls,
    finalResultText: answer,
    finalAssistantText: answer,
    usage,
    modelUsed: codexModel,
    wallMs: Date.now() - t0,
    isError: r.exitCode !== 0 || r.timedOut,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    stderrPreview: codexRunPreview({ stdout: r.stdout, stderr: r.stderr, isError: r.exitCode !== 0 || r.timedOut }),
  };
}

export function extractCodexErrorMessages(stdout) {
  const messages = [];
  const seen = new Set();
  if (!stdout) return messages;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    const msg = codexErrorMessage(ev);
    if (msg && !seen.has(msg)) {
      seen.add(msg);
      messages.push(msg);
    }
  }
  return messages;
}

function codexErrorMessage(ev) {
  if (ev.type === 'error' && typeof ev.message === 'string') return ev.message;
  if (ev.type === 'turn.failed' && typeof ev.error?.message === 'string') return ev.error.message;
  if (ev.type === 'item.completed' && ev.item?.type === 'error' && typeof ev.item.message === 'string') {
    return ev.item.message;
  }
  return null;
}

function codexRunPreview({ stdout, stderr, isError }) {
  const parts = [];
  const stderrText = typeof stderr === 'string' ? stderr.trim() : '';
  if (stderrText) parts.push(stderrText);
  const messages = extractCodexErrorMessages(stdout);
  if (messages.length) parts.push(...messages);
  if (isError && !messages.length && stdout) parts.push(stdout.slice(-2000).trim());
  return parts.filter(Boolean).join('\n').slice(-4000);
}

export function parseCodexAgentStream(stdout) {
  const toolCalls = [];
  let answer = '';
  let usage = null;
  if (!stdout) return { toolCalls, answer, usage };
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'item.completed' && ev.item) {
      const it = ev.item;
      if (it.type === 'command_execution') {
        toolCalls.push({ name: it.command || 'command', input: { command: it.command, exit_code: it.exit_code } });
      } else if (it.type === 'agent_message' && typeof it.text === 'string' && it.text) {
        answer = it.text;
      }
    } else if (ev.type === 'turn.completed' && ev.usage) {
      usage = ev.usage;
    }
  }
  return { toolCalls, answer, usage };
}
