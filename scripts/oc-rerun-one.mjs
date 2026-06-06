#!/usr/bin/env node
/**
 * Surgical single-probe re-runner for the opencode vault/heldout/ood cells — mirrors
 * oc-batch `runOne` VERBATIM (AGENTS.md inject, --pure --variant, parse, USD capture+score,
 * GLM/GPT pricing) and REPLACES the one matching row in oc-${SET}${SUFFIX}-${mode}/rows.json
 * in place. Guards: only overwrites a STALLED/bad row (exit!=0 / score==null / usdError) unless
 * FORCE=1. Does NOT reap (so it can't kill a concurrent run's ss-servers).
 *
 *   PROBE_ID=zig-ood-05 MODE=mpp SET=ood SUFFIX=-glm MODEL=openrouter/z-ai/glm-5.1 VARIANT=high \
 *     PROBES=core/prompt-optimization/data/frozen/p7-langtransfer-probes.json node scripts/oc-rerun-one.mjs
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

const PROBE_ID = process.env.PROBE_ID;
const MODE = process.env.MODE || 'mpp';
const SET = process.env.SET || 'vault';
const SUFFIX = process.env.SUFFIX || '';
const MODEL = process.env.MODEL || 'openrouter/z-ai/glm-5.1';
const VARIANT = process.env.VARIANT || 'high';
const REP = process.env.REP ? Number(process.env.REP) : null;
if (!PROBE_ID) { console.error('PROBE_ID env required'); process.exit(2); }
const PR = /glm/i.test(MODEL) ? { inPerM: 0.98, outPerM: 3.08, cacheReadPerM: 0.182 } : { inPerM: 5, outPerM: 30, cacheReadPerM: 0.5 };
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const PROBE_FILE = process.env.PROBES ? (path.isAbsolute(process.env.PROBES) ? process.env.PROBES : path.join(REPO, process.env.PROBES)) : path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json');
const probes = (() => { const p = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8')); return Array.isArray(p) ? p : (p.probes || []); })();
const probe = probes.find((x) => x.id === PROBE_ID);
if (!probe) { console.error(`probe ${PROBE_ID} not in ${PROBE_FILE}`); process.exit(2); }
const MD = [path.join(os.homedir(), '.claude', 'CLAUDE.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')];
const BAK = '.obak';
const suppressMd = () => { for (const f of MD) { try { if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); } catch { /* */ } } };
const restoreMd = () => { for (const f of MD) { try { if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); } catch { /* */ } } };
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch { /* */ } };
const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
function parse(stdout) {
  const toolCalls = []; const text = []; const tok = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }; let cost = 0;
  for (const line of stdout.split('\n')) { const t = line.trim(); if (!t || t[0] !== '{') continue; let ev; try { ev = JSON.parse(t); } catch { continue; }
    if (ev.type === 'text' && typeof ev.part?.text === 'string') text.push(ev.part.text);
    else if (ev.type === 'tool_use') { const st = ev.part?.state || {}; toolCalls.push({ tool: ev.part?.tool || '', command: st.input?.command || ev.part?.tool || '', input: st.input || {}, output: typeof st.output === 'string' ? st.output : '', isError: st.status === 'error' }); }
    else if (ev.type === 'step_finish') { const k = ev.part?.tokens || {}; tok.input += k.input || 0; tok.output += k.output || 0; tok.reasoning += k.reasoning || 0; tok.cacheRead += k.cache?.read || 0; tok.cacheWrite += k.cache?.write || 0; cost += ev.part?.cost || 0; } }
  return { toolCalls, answer: text.length ? text[text.length - 1] : '', tok, cost };
}
function analyze(calls, cwd) { let escape = 0, leak = 0; for (const c of calls) { const t = c.command || ''; if (ANSWER.test(t)) { leak++; continue; } let esc = false; for (const p of (t.match(ABS) || [])) if (!p.startsWith(cwd)) esc = true; const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(cwd)) esc = true; if (esc) escape++; } return { escape, leak }; }
const ssUsed = (calls) => calls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(c.command || ''));
const naive = (tk) => ((tk.input + tk.cacheRead + tk.cacheWrite) / 1e6) * PR.inPerM + ((tk.output + tk.reasoning) / 1e6) * PR.outPerM;
const runOpencode = (cwd, env, prompt) => new Promise((res) => {
  const p = spawn('opencode', ['--pure', 'run', '--dir', cwd, '--model', MODEL, '--format', 'json', '--agent', 'build', '--variant', VARIANT, prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; const t0 = Date.now(); const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, 300000);
  p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d);
  p.on('exit', (code) => { clearTimeout(timer); res({ out, code, wallMs: Date.now() - t0 }); });
  p.on('error', () => { clearTimeout(timer); res({ out, code: -1, wallMs: Date.now() - t0 }); });
});

(async () => {
  const dir = path.join(RESULTS, `oc-${SET}${SUFFIX}-${MODE}`);
  const f = path.join(dir, 'rows.json');
  const rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  const matches = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.id === PROBE_ID && (REP == null || r.rep === REP));
  if (matches.length !== 1) { console.error(`expected exactly 1 matching row, found ${matches.length} (id=${PROBE_ID} in ${path.relative(REPO, f)})`); process.exit(2); }
  const { r: old, i: idx } = matches[0];
  console.error(`OLD: ${old.id} score=${old.score} exit=${old.exitCode} usdErr=${old.usdError || '-'}`);
  if (!(old.exitCode !== 0 || old.score == null || old.usdError) && process.env.FORCE !== '1') { console.error('OLD row looks VALID — set FORCE=1 to overwrite. Refusing.'); process.exit(3); }

  const cwd = resolveRepoCwd(probe, {});
  const ag = path.join(cwd, 'AGENTS.md'); const had = fs.existsSync(ag); const bak = had ? fs.readFileSync(ag) : null;
  let r;
  try {
    suppressMd();
    console.error(`prewarming ${cwd} + re-running ${PROBE_ID} ${MODE} via opencode (${MODEL} variant=${VARIANT}) ...`);
    prewarm(cwd);
    fs.writeFileSync(ag, MODE === 'mpp' ? MPP : NATIVE);
    const env = { ...process.env, PATH: MODE === 'mpp' ? [SS_BIN, process.env.PATH].join(':') : process.env.PATH, SWEET_SEARCH_PROJECT_ROOT: cwd };
    r = await runOpencode(cwd, env, `Task: ${probe.query}`);
  } finally { if (had) fs.writeFileSync(ag, bak); else { try { fs.unlinkSync(ag); } catch { /* */ } } restoreMd(); }
  const pr = parse(r.out); const a = analyze(pr.toolCalls, cwd);
  const arm = MODE === 'mpp' ? 'ss' : 'native';
  const normCalls = normalizeOpencodeCalls(pr.toolCalls);
  const rawResponse = buildArmResponse(normCalls, arm);
  persistCapture(path.join(RESULTS, `oc-${SET}${SUFFIX}-captures`), { probeId: probe.id, arm, rep: old.rep, model: MODEL, harness: 'opencode', rawResponse, finalAnswer: pr.answer, toolCalls: normCalls });
  const [score, usd] = await Promise.all([judgePanelScore({ probe, answer: pr.answer, panel: JUDGE_PANEL }).then((x) => x.score).catch(() => null), scoreUsdInline(probe, rawResponse, arm)]);
  const row = { id: probe.id, lang: probe.language, stratum: probe.stratum, rep: old.rep, mode: MODE, model: MODEL, harness: 'opencode', score, ...usd, rawLen: rawResponse.length, calls: pr.toolCalls.length, ss: ssUsed(pr.toolCalls), escape: a.escape, leak: a.leak, reasoningTok: pr.tok.reasoning, wallMs: r.wallMs, tokens: pr.tok, costUsd: naive(pr.tok), opencodeCostUsd: pr.cost, exitCode: r.code };
  console.error(`NEW: score=${row.score} USDnoC=${row.USD_noC != null ? row.USD_noC.toFixed(3) : (row.usdError || '?')} calls=${row.calls} ss=${row.ss} exit=${row.exitCode}`);
  if (row.exitCode !== 0 || row.score == null || row.usdError) { console.error('NEW row ALSO failed — leaving file UNCHANGED.'); process.exit(4); }
  rows[idx] = row; fs.writeFileSync(f, JSON.stringify(rows, null, 2));
  console.error(`REPLACED row ${idx} in ${path.relative(REPO, f)}.`);
})();
