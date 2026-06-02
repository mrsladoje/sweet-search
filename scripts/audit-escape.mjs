#!/usr/bin/env node
// AUDIT: did the committed-vault agents (full Claude Code + Codex, native & M++) escape their
// probe repo (cd / absolute path out) or touch our answer files (gold/ frozen/ results/ probe JSONs)?
// Re-runs a probe sample in BOTH configs with command capture and flags escapes/leaks per run.
//   unset ANTHROPIC_API_KEY && node scripts/audit-escape.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { runCodexAgent } from '../core/prompt-optimization/sweep/p7-codex-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE_POLICY = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, and reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const LEAN_CC = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project'];
const GLOBAL_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PROJECT_MD = path.join(REPO, 'CLAUDE.md');
const BAK = '.ccbak';
const suppressMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restoreMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
const reap = () => { try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch {} try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch {} };
restoreMd();

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = (Array.isArray(vault) ? vault : vault.probes);
const byId = new Map(probes.map((p) => [p.id, p]));
const SAMPLE = (process.env.IDS || 'java-007,cpp-006,go-002,python-004,ts-007').split(',');

const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
const cmdText = (c) => (typeof c?.input?.command === 'string' ? c.input.command : (c?.input?.file_path || ((c?.input?.path || '') + ' ' + (c?.input?.pattern || '')) || JSON.stringify(c?.input || {})));
function analyze(calls, repoCwd) {
  let escape = 0, leak = 0; const ex = [];
  for (const c of (calls || [])) {
    const t = cmdText(c);
    const isLeak = ANSWER.test(t);
    let isEsc = false;
    for (const p of (t.match(ABS) || [])) if (!p.startsWith(repoCwd)) isEsc = true;
    const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(repoCwd)) isEsc = true;
    if (isLeak) { leak++; ex.push('  LEAK: ' + t.slice(0, 150).replace(/\n/g, ' ')); }
    else if (isEsc && ex.length < 3) { escape++; ex.push('  ESC : ' + t.slice(0, 150).replace(/\n/g, ' ')); }
    else if (isEsc) escape++;
  }
  return { escape, leak, ex };
}

async function runCC(probe, mode) {
  const cwd = resolveRepoCwd(probe, {});
  const md = path.join(cwd, 'CLAUDE.md'); const had = fs.existsSync(md); const bak = had ? fs.readFileSync(md) : null;
  fs.writeFileSync(md, mode === 'mpp' ? MPP : NATIVE_POLICY);
  process.env.MAX_THINKING_TOKENS = '31999';
  let run; try { run = await runClaudeAgent({ model: 'claude-opus-4-8', prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, projectRoot: cwd, extraPathEntries: mode === 'mpp' ? [SS_BIN] : [], addDirs: [cwd], extraArgs: LEAN_CC, timeoutMs: 240000 }); }
  finally { if (had) fs.writeFileSync(md, bak); else { try { fs.unlinkSync(md); } catch {} } }
  return { calls: run.toolCalls || [], cwd };
}
async function runCdx(probe, mode) {
  const cwd = resolveRepoCwd(probe, {});
  const ag = path.join(cwd, 'AGENTS.md'); const had = fs.existsSync(ag); const bak = had ? fs.readFileSync(ag) : null;
  fs.writeFileSync(ag, mode === 'mpp' ? MPP : NATIVE_POLICY);
  let run; try { run = await runCodexAgent({ model: 'gpt-5.5', prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, sweetSearchBinDir: mode === 'mpp' ? SS_BIN : undefined, reasoningEffort: 'high', provider: 'openrouter', timeoutMs: 240000 }); }
  finally { if (had) fs.writeFileSync(ag, bak); else { try { fs.unlinkSync(ag); } catch {} } }
  return { calls: run.toolCalls || [], cwd };
}

(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  reap(); suppressMd();
  const tally = { 'CC-native': { e: 0, l: 0, n: 0 }, 'CC-mpp': { e: 0, l: 0, n: 0 }, 'Cdx-native': { e: 0, l: 0, n: 0 }, 'Cdx-mpp': { e: 0, l: 0, n: 0 } };
  try {
    for (const id of SAMPLE) {
      const probe = byId.get(id); if (!probe) { console.error('no probe', id); continue; }
      for (const [tag, fn, mode] of [['CC-native', runCC, 'native'], ['CC-mpp', runCC, 'mpp'], ['Cdx-native', runCdx, 'native'], ['Cdx-mpp', runCdx, 'mpp']]) {
        let r; try { r = await fn(probe, mode); } catch (e) { console.error(`  ${tag} ${id} ERROR ${e.message}`); continue; }
        const a = analyze(r.calls, r.cwd);
        tally[tag].n++; if (a.escape) tally[tag].e++; if (a.leak) tally[tag].l++;
        console.error(`[${tag}] ${id.padEnd(12)} calls=${r.calls.length} escape=${a.escape} leak=${a.leak}${a.ex.length ? '\n' + a.ex.join('\n') : ''}`);
      }
      reap();
    }
  } finally { restoreMd(); reap(); }
  console.log('\n=== AUDIT SUMMARY (runs that escaped repo / touched answer files) ===');
  for (const [tag, t] of Object.entries(tally)) console.log(`  ${tag.padEnd(11)}: escaped ${t.e}/${t.n}   leaked ${t.l}/${t.n}`);
  const totL = Object.values(tally).reduce((s, t) => s + t.l, 0);
  console.log(totL ? `\n⚠ ${totL} run(s) TOUCHED ANSWER FILES — committed vaults are contaminated, must re-run isolated.` : '\n✅ 0 answer-file touches — leak did not occur in the committed configs (escape may still exist; see counts).');
})();
