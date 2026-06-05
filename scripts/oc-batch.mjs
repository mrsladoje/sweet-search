#!/usr/bin/env node
/**
 * opencode vault batch runner — third harness. opencode + GPT-5.5 (openrouter), --variant high,
 * conc=1, AGENTS.md injection (production path; smoke confirmed 100% ss-engagement, 0 escape).
 * Same v60 vault + resolveRepoCwd as the CC/Codex vaults. Reap-between-batches (CPU), escape-detection,
 * 3-panel judge. Cursor (oc-vault-state.json); 12 batches = 1 rep. native×5 then M++×5.
 *   node scripts/oc-batch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRepoCwd, buildAgentUserPrompt, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { buildArmResponse, normalizeOpencodeCalls, scoreUsdInline, persistCapture } from '../core/prompt-optimization/sweep/usd-capture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const MODEL = process.env.MODEL || 'openrouter/openai/gpt-5.5';
const VARIANT = process.env.VARIANT || 'high';
const BATCH = Number(process.env.BATCH_SIZE || 5);
const SUFFIX = process.env.SUFFIX || ''; // output isolation (e.g. -smoke) so a test run never touches the real oc-vault dataset
const PR = /glm/i.test(MODEL) ? { inPerM: 0.98, outPerM: 3.08, cacheReadPerM: 0.182 } : { inPerM: 5, outPerM: 30, cacheReadPerM: 0.5 }; // GLM-5.1 vs GPT-5.5 rates

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const allProbes = Array.isArray(vault) ? vault : (vault.probes || []);
// IDS subset → enables disjoint-repo sharding (opencode writes AGENTS.md per-repo, so
// parallel shards MUST hold disjoint repos; group ids by language like run-vault-codex.sh).
const IDS = (process.env.IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const probes = IDS.length ? allProbes.filter((p) => IDS.includes(p.id)) : allProbes;
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const STATE = path.join(RESULTS, `oc-vault${SUFFIX}-state.json`);
const CAP_DIR = path.join(RESULTS, `oc-vault${SUFFIX}-captures`); // re-scorable raw tool responses (USD never un-re-scorable)
const MD = [path.join(os.homedir(), '.claude', 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')];
const BAK = '.obak';
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const suppressMd = () => { for (const f of MD) if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); };
const restoreMd = () => { for (const f of MD) if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); };
restoreMd();
// NO_REAP=1 → no-op (parallel shards must not pkill each other's ss-servers mid-call).
const reap = () => { if (process.env.NO_REAP) return; try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch {} try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch {} };
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch {} };

const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
function parse(stdout) {
  const toolCalls = []; const text = []; const tok = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }; let cost = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let ev; try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'text' && typeof ev.part?.text === 'string') text.push(ev.part.text);
    else if (ev.type === 'tool_use') { const st = ev.part?.state || {}; toolCalls.push({ tool: ev.part?.tool || '', command: st.input?.command || ev.part?.tool || '', input: st.input || {}, output: typeof st.output === 'string' ? st.output : '', isError: st.status === 'error' }); }
    else if (ev.type === 'step_finish') { const k = ev.part?.tokens || {}; tok.input += k.input || 0; tok.output += k.output || 0; tok.reasoning += k.reasoning || 0; tok.cacheRead += k.cache?.read || 0; tok.cacheWrite += k.cache?.write || 0; cost += ev.part?.cost || 0; }
  }
  return { toolCalls, answer: text.length ? text[text.length - 1] : '', tok, cost };
}
function analyze(calls, cwd) {
  let escape = 0, leak = 0;
  for (const c of calls) { const t = c.command || '';
    if (ANSWER.test(t)) { leak++; continue; }
    let esc = false; for (const p of (t.match(ABS) || [])) if (!p.startsWith(cwd)) esc = true;
    const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(cwd)) esc = true;
    if (esc) escape++;
  }
  return { escape, leak };
}
const ssUsed = (calls) => calls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(c.command || ''));
const naive = (tk) => ((tk.input + tk.cacheRead + tk.cacheWrite) / 1e6) * PR.inPerM + ((tk.output + tk.reasoning) / 1e6) * PR.outPerM;
const runOpencode = (cwd, env, prompt) => new Promise((res) => {
  const p = spawn('opencode', ['--pure', 'run', '--dir', cwd, '--model', MODEL, '--format', 'json', '--agent', 'build', '--variant', VARIANT, prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; const t0 = Date.now(); const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 300000);
  p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d);
  p.on('exit', (code) => { clearTimeout(timer); res({ out, code, wallMs: Date.now() - t0 }); });
  p.on('error', () => { clearTimeout(timer); res({ out, code: -1, wallMs: Date.now() - t0 }); });
});
async function runOne(probe, mode, rep) {
  const cwd = resolveRepoCwd(probe, {});
  const ag = path.join(cwd, 'AGENTS.md'); const had = fs.existsSync(ag); const bak = had ? fs.readFileSync(ag) : null;
  fs.writeFileSync(ag, mode === 'mpp' ? MPP : NATIVE);
  const env = { ...process.env, PATH: mode === 'mpp' ? [SS_BIN, process.env.PATH].join(':') : process.env.PATH, SWEET_SEARCH_PROJECT_ROOT: cwd };
  let r; try { r = await runOpencode(cwd, env, `Task: ${probe.query}`); } finally { if (had) fs.writeFileSync(ag, bak); else { try { fs.unlinkSync(ag); } catch {} } }
  if (process.env.OC_RAW_DUMP) { try { fs.mkdirSync(path.dirname(process.env.OC_RAW_DUMP), { recursive: true }); fs.writeFileSync(process.env.OC_RAW_DUMP, r.out); } catch {} }
  const pr = parse(r.out); const a = analyze(pr.toolCalls, cwd);
  // USD: build the per-arm raw tool-response, persist (re-scorable), and score.
  const arm = mode === 'mpp' ? 'ss' : 'native';
  const normCalls = normalizeOpencodeCalls(pr.toolCalls);
  const rawResponse = buildArmResponse(normCalls, arm);
  persistCapture(CAP_DIR, { probeId: probe.id, arm, rep, model: MODEL, harness: 'opencode', rawResponse, finalAnswer: pr.answer, toolCalls: normCalls });
  const [score, usd] = await Promise.all([
    judgePanelScore({ probe, answer: pr.answer, panel: JUDGE_PANEL }).then((x) => x.score).catch(() => null),
    scoreUsdInline(probe, rawResponse, arm),
  ]);
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, harness: 'opencode', score, ...usd, rawLen: rawResponse.length, calls: pr.toolCalls.length, ss: ssUsed(pr.toolCalls), escape: a.escape, leak: a.leak, reasoningTok: pr.tok.reasoning, wallMs: r.wallMs, tokens: pr.tok, costUsd: naive(pr.tok), opencodeCostUsd: pr.cost, exitCode: r.code };
}
const append = (mode, rows) => { const d = path.join(RESULTS, `oc-vault${SUFFIX}-${mode === 'mpp' ? 'mpp' : 'native'}`); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'rows.json'); const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; fs.writeFileSync(f, JSON.stringify(prev.concat(rows), null, 2)); };

(async () => {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { rep: 1, offset: 0 };
  if (state.offset >= probes.length) { state.rep += 1; state.offset = 0; }
  const batch = probes.slice(state.offset, state.offset + BATCH);
  console.error(`\n=== oc-batch: rep ${state.rep}, probes ${state.offset + 1}-${state.offset + batch.length}/${probes.length} | ${MODEL} variant=${VARIANT}, opencode, conc=1, AGENTS.md inject ===`);
  console.error('  ' + batch.map((p) => `${p.id}(${p.language})`).join(', '));
  const out = { native: [], mpp: [] };
  try {
    suppressMd(); reap();
    const cwds = [...new Set(batch.map((p) => resolveRepoCwd(p, {})))];
    console.error(`  prewarming ${cwds.length} ss-* server(s)...`); for (const c of cwds) prewarm(c);
    for (const mode of ['native', 'mpp']) {
      for (const probe of batch) {
        const row = await runOne(probe, mode, state.rep);
        out[mode].push(row);
        console.error(`  [${mode.padEnd(6)}] ${row.id.padEnd(15)} score=${row.score} USDnoC=${row.USD_noC != null ? row.USD_noC.toFixed(3) : (row.usdError ? 'ERR' : '–')} g=${row.grounding ?? '–'} calls=${String(row.calls).padEnd(2)} ss=${row.ss} ${(row.wallMs / 1000).toFixed(0)}s $${(row.costUsd || 0).toFixed(3)} escape=${row.escape} leak=${row.leak} exit=${row.exitCode}`);
      }
    }
  } finally { restoreMd(); reap(); }
  append('native', out.native); append('mpp', out.mpp);
  state.offset += batch.length; fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  const sm = (r, f) => mean(r.map(f));
  console.log(`\n--- OC BATCH DONE (rep ${state.rep}, ${state.offset}/${probes.length}) ---`);
  for (const [lbl, r] of [['native', out.native], ['M++   ', out.mpp]]) console.log(`  ${lbl}: acc=${sm(r, (x) => x.score || 0).toFixed(3)} USDnoC=${sm(r, (x) => x.USD_noC || 0).toFixed(3)} g=${sm(r, (x) => x.grounding || 0).toFixed(2)} calls=${sm(r, (x) => x.calls).toFixed(1)} ss=${(100 * r.filter((x) => x.ss).length / Math.max(1, r.length)).toFixed(0)}% $${sm(r, (x) => x.costUsd || 0).toFixed(3)} usdErr=${r.filter((x) => x.usdError).length} escape=${r.reduce((s, x) => s + x.escape, 0)} leak=${r.reduce((s, x) => s + x.leak, 0)}`);
  console.log(`  → M++ vs native: calls ${sm(out.mpp, (x) => x.calls).toFixed(1)} vs ${sm(out.native, (x) => x.calls).toFixed(1)}; NEXT probes ${state.offset >= probes.length ? 1 : state.offset + 1}-${Math.min(state.offset + BATCH, probes.length)}`);
})();
