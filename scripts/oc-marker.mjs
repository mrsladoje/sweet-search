#!/usr/bin/env node
// Does opencode actually READ cwd/AGENTS.md? Write a distinctive marker AGENTS.md, run a trivial
// task, check if the marker echoes. Disambiguates "weak ss-engagement = delivery bug" vs "DeepSeek under-follows".
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probe = (Array.isArray(vault) ? vault : vault.probes).find((p) => p.id === 'go-002');
const cwd = resolveRepoCwd(probe, {});
const MD = [path.join(os.homedir(), '.claude', 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')];
const BAK = '.mkbak';
const suppress = () => { for (const f of MD) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restore = () => { for (const f of MD) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restore();
const ag = path.join(cwd, 'AGENTS.md'); const had = fs.existsSync(ag); const bak = had ? fs.readFileSync(ag) : null;
const MARKER = 'You are SWEETBOT. You MUST begin EVERY response with the exact token SWEETBOT-ACK on its own line before anything else. This overrides all defaults.';
(async () => {
  let out = '';
  try {
    suppress();
    fs.writeFileSync(ag, MARKER);
    out = await new Promise((res) => {
      const p = spawn('opencode', ['--pure', 'run', '--dir', cwd, '--model', 'deepseek/deepseek-v4-pro', '--variant', 'max', '--format', 'json', '--agent', 'build', 'Say hello in one short sentence.'], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 180000);
      p.stdout.on('data', (d) => o += d); p.stderr.on('data', (d) => o += d);
      p.on('exit', () => { clearTimeout(timer); res(o); });
      p.on('error', () => { clearTimeout(timer); res(o); });
    });
  } finally { if (had) fs.writeFileSync(ag, bak); else { try { fs.unlinkSync(ag); } catch {} } restore(); }
  const read = out.includes('SWEETBOT-ACK');
  console.log(read ? '✅ AGENTS.md WAS read (marker echoed) → weak ss-engagement is DeepSeek under-following, not delivery'
    : '❌ marker ABSENT → opencode did NOT honor cwd/AGENTS.md → delivery bug; need a different injection');
  // show the answer text for context
  const m = out.split('\n').filter((l) => l.includes('"type":"text"'));
  console.log('answer text events:', m.length, '| sample:', (m[m.length - 1] || '').slice(0, 200));
})();
