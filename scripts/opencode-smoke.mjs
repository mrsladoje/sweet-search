#!/usr/bin/env node
// Opencode + DeepSeek-V4-Pro smoke/GATE before any vault run. Answers: (1) does --variant max
// engage reasoning (reasoning tokens > 0; we got burned by opencode --variant on Opus = reasoning:0)?
// (2) does ss-* engage for M++? (3) does the opencode agent ESCAPE its repo / touch our answer files?
// Runs 3 probes × {native, M++} via `opencode --pure run`, captures tool commands + reasoning tokens.
//   unset nothing needed (uses DEEPSEEK_API_KEY); node scripts/opencode-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const VARIANT = process.env.VARIANT || 'max';
const IDS = (process.env.IDS || 'java-007,go-002,cpp-006').split(',');

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const byId = new Map((Array.isArray(vault) ? vault : vault.probes).map((p) => [p.id, p]));

// suppress project-level instruction files opencode might walk up to
const MD = [path.join(os.homedir(), '.claude', 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')];
const BAK = '.ocbak';
const suppress = () => { for (const f of MD) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restore = () => { for (const f of MD) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restore();

const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;

function parse(stdout) {
  const toolCalls = []; const text = []; let reasoning = 0, output = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let ev; try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'text' && typeof ev.part?.text === 'string') text.push(ev.part.text);
    else if (ev.type === 'tool_use') toolCalls.push({ tool: ev.part?.tool || 'tool', command: ev.part?.state?.input?.command || '' });
    else if (ev.type === 'step_finish') { const tk = ev.part?.tokens || {}; reasoning += tk.reasoning || 0; output += tk.output || 0; }
  }
  return { toolCalls, answer: text.length ? text[text.length - 1] : '', reasoning, output };
}
function analyze(calls, cwd) {
  let escape = 0, leak = 0; const ex = [];
  for (const c of calls) { const t = c.command || '';
    if (ANSWER.test(t)) { leak++; ex.push('LEAK: ' + t.slice(0, 140)); continue; }
    let esc = false; for (const p of (t.match(ABS) || [])) if (!p.startsWith(cwd)) esc = true;
    const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(cwd)) esc = true;
    if (esc) { escape++; if (ex.length < 3) ex.push('ESC: ' + t.slice(0, 140)); }
  }
  return { escape, leak, ex };
}
const run = (cwd, env, prompt) => new Promise((res) => {
  const args = ['--pure', 'run', '--dir', cwd, '--model', MODEL, '--format', 'json', '--agent', 'build', '--variant', VARIANT, prompt];
  const p = spawn('opencode', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; const t0 = Date.now();
  const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 300000);
  p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => err += d);
  p.on('exit', (code) => { clearTimeout(timer); res({ out, err, code, wallMs: Date.now() - t0 }); });
  p.on('error', (e) => { clearTimeout(timer); res({ out, err: err + e.message, code: -1, wallMs: Date.now() - t0 }); });
});

(async () => {
  console.error(`opencode smoke: model=${MODEL} variant=${VARIANT} ids=${IDS.join(',')}`);
  try {
    suppress();
    for (const id of IDS) {
      const probe = byId.get(id); if (!probe) { console.error('no probe', id); continue; }
      const cwd = resolveRepoCwd(probe, {});
      for (const mode of ['native', 'mpp']) {
        const env = { ...process.env, PATH: mode === 'mpp' ? [SS_BIN, process.env.PATH].join(':') : process.env.PATH, SWEET_SEARCH_PROJECT_ROOT: cwd };
        // production-path injection: opencode reads AGENTS.md as authoritative (like Codex), not a prompt [SYSTEM] block
        const ag = path.join(cwd, 'AGENTS.md'); const had = fs.existsSync(ag); const bak = had ? fs.readFileSync(ag) : null;
        fs.writeFileSync(ag, mode === 'mpp' ? MPP : NATIVE);
        const prompt = `Task: ${probe.query}`;
        let r; try { r = await run(cwd, env, prompt); } finally { if (had) fs.writeFileSync(ag, bak); else { try { fs.unlinkSync(ag); } catch {} } }
        const pr = parse(r.out);
        const a = analyze(pr.toolCalls, cwd);
        const ss = pr.toolCalls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(c.command || ''));
        console.error(`[${mode.padEnd(6)}] ${id.padEnd(11)} calls=${pr.toolCalls.length} ss=${ss} reasoning_tok=${pr.reasoning} out_tok=${pr.output} ${(r.wallMs / 1000).toFixed(0)}s exit=${r.code} escape=${a.escape} leak=${a.leak}`);
        if (a.ex.length) console.error('   ' + a.ex.join('\n   '));
        if (!pr.toolCalls.length && r.code !== 0) console.error('   stderr: ' + r.err.slice(-300));
      }
    }
  } finally { restore(); }
})();
