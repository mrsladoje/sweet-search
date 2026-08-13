#!/usr/bin/env node
// dump-trace.mjs — render a FULL, readable agent transcript for any harness/task/arm/rep.
//
//   node dump-trace.mjs <task> <arm> [--harness codex|opencode|claude-code] [--rep 0|1]
//                       [--max-result N] [--tools-only] [--subagents]
//
//   node dump-trace.mjs dashbitco__nimble_options-43 sweet --harness codex
//   node dump-trace.mjs dart-lang__http-1114 sweet --harness claude-code --subagents
//   node dump-trace.mjs --list                       # list every task
//
// Defaults to FULL untruncated tool results (--max-result 0 = unlimited).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', 'claude-code': 'sb-claudecode-20260811' };

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--tools-only', '--subagents', '--list'].includes(argv[i - 1])));

if (has('list')) {
  const d = path.join(ROOT, 'results', RUNS.codex, 'agent-state');
  console.log([...new Set(fs.readdirSync(d).map(x => x.replace(/-(native|sweet)$/, '')))].sort().join('\n'));
  process.exit(0);
}

const task = pos[0], arm = pos[1] || 'sweet';
const harness = flag('harness', 'codex');
const rep = flag('rep', null);
const MAXR = Number(flag('max-result', '0'));   // 0 = unlimited
const toolsOnly = has('tools-only');
const withSub = has('subagents');
if (!task) { console.error('usage: dump-trace.mjs <task> <arm> [--harness H] [--rep N] [--max-result N] [--tools-only] [--subagents]'); process.exit(1); }

const clip = (s) => { s = String(s ?? ''); return MAXR > 0 && s.length > MAXR ? s.slice(0, MAXR) + `\n  ...[TRUNCATED ${s.length - MAXR} chars — rerun with --max-result 0 for all]` : s; };
const hr = (c = '=') => c.repeat(100);
const cell = path.join(ROOT, 'results', RUNS[harness], 'agent-state', `${task}-${arm}`);
if (!fs.existsSync(cell)) { console.error(`no such cell: ${cell}`); process.exit(1); }
const walk = (d, out = []) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; } for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// ─────────────────────────────── CODEX ───────────────────────────────
function codex() {
  let files = walk(cell).filter(f => /rollout-.*\.jsonl$/.test(f)).sort();
  if (rep !== null) files = files.filter(f => new RegExp(`__r${rep}__`).test(f) || files.indexOf(f) === Number(rep));
  for (const f of files) {
    console.log(`\n${hr()}\nCODEX ${task} / ${arm}   ${path.basename(f)}\n${hr()}`);
    const calls = new Map();
    for (const d of jl(f)) {
      const p = d.payload || {}; const t = d.type, pt = p.type;
      if (t === 'session_meta') { console.log(`[session] cwd=${p.cwd} model=${p.model_provider} cli=${p.cli_version}`); continue; }
      if (t === 'turn_context') { console.log(`[turn_context] model=${p.model} effort=${p.effort}`); continue; }
      if (t === 'event_msg' && pt === 'user_message') { if (!toolsOnly) console.log(`\n${hr('-')}\n>>> USER / ISSUE:\n${p.message}`); continue; }
      if (t === 'event_msg' && pt === 'agent_message') { if (!toolsOnly) console.log(`\n--- ASSISTANT SAYS:\n${p.message}`); continue; }
      if (t === 'response_item' && pt === 'reasoning') { if (!toolsOnly) console.log(`\n--- [reasoning: ENCRYPTED, summary=${JSON.stringify(p.summary)}]`); continue; }
      if (t === 'response_item' && pt === 'message' && !toolsOnly) {
        const txt = (p.content || []).map(c => c.text || '').join('\n');
        console.log(`\n--- ${String(p.role).toUpperCase()} MESSAGE:\n${clip(txt)}`); continue;
      }
      if (t === 'response_item' && pt === 'custom_tool_call') {
        calls.set(p.call_id, p.input);
        // the real shell command is embedded in a JS snippet: tools.exec_command({cmd:"..."})
        const m = String(p.input).match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const cmd = m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : null;
        console.log(`\n${hr('-')}\n>>> TOOL CALL [${p.name}] ${p.call_id}`);
        console.log(cmd ? `  $ ${cmd}` : `  raw input: ${clip(p.input)}`);
        continue;
      }
      if (t === 'response_item' && pt === 'custom_tool_call_output') {
        const txt = Array.isArray(p.output) ? p.output.map(o => o.text || '').join('\n') : String(p.output ?? '');
        console.log(`<<< TOOL RESULT ${p.call_id}:\n${clip(txt)}`);
        continue;
      }
      if (t === 'event_msg' && pt === 'patch_apply_end') console.log(`\n[patch_apply_end success=${p.success}]`);
    }
  }
}

// ─────────────────────────────── OPENCODE ───────────────────────────────
function opencode() {
  let files = walk(cell).filter(f => f.endsWith('attempt-1.stdout.ndjson')).sort();
  if (rep !== null && files[Number(rep)]) files = [files[Number(rep)]];
  for (const f of files) {
    console.log(`\n${hr()}\nOPENCODE ${task} / ${arm}   ${f.split('/').slice(-2)[0]}\n${hr()}`);
    for (const d of jl(f)) {
      const p = d.part || {};
      if (d.type === 'text' && !toolsOnly) { console.log(`\n--- ASSISTANT SAYS:\n${p.text}`); continue; }
      if (d.type === 'tool_use') {
        const st = p.state || {};
        console.log(`\n${hr('-')}\n>>> TOOL CALL [${p.tool}] ${p.callID}  status=${st.status}`);
        console.log(`  input: ${clip(JSON.stringify(st.input, null, 1))}`);
        if (st.output !== undefined) console.log(`<<< TOOL RESULT:\n${clip(typeof st.output === 'string' ? st.output : JSON.stringify(st.output, null, 1))}`);
        continue;
      }
      if (d.type === 'step_finish' && !toolsOnly) console.log(`[step_finish reason=${p.reason} tokens=${JSON.stringify(p.tokens)}]`);
    }
  }
}

// ─────────────────────────── CLAUDE-CODE ───────────────────────────
function claudecode() {
  const all = walk(cell).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  const isSub = f => f.includes('/subagents/');
  let files = all.filter(f => withSub ? true : !isSub(f)).sort();
  if (rep !== null) files = files.filter(f => new RegExp(`--r${rep}--`).test(f));
  for (const f of files) {
    console.log(`\n${hr()}\nCLAUDE-CODE ${task} / ${arm}${isSub(f) ? '   [SUBAGENT / isSidechain]' : ''}\n  ${f.replace(ROOT + '/results/', '')}\n${hr()}`);
    // claude-code streams the SAME assistant message repeatedly, each copy growing.
    // Deduping whole records would drop late-arriving tool_use blocks, so dedupe BLOCKS.
    const seenBlock = new Set(), seenUsage = new Set();
    for (const d of jl(f)) {
      const m = d.message; if (!m) continue;
      const rid = d.requestId || m.id;
      const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      for (const b of blocks) {
        const key = b.type === 'tool_use' ? `tu:${b.id}`
          : b.type === 'tool_result' ? `tr:${b.tool_use_id}`
          : `${b.type}:${String(b.text ?? b.thinking ?? '').slice(0, 120)}`;
        if (seenBlock.has(key)) continue;
        seenBlock.add(key);
        if (b.type === 'text' && String(b.text).trim() && !toolsOnly) console.log(`\n--- ${String(m.role).toUpperCase()}:\n${clip(b.text)}`);
        else if (b.type === 'thinking' && !toolsOnly) console.log(`\n--- [THINKING — readable on this harness]:\n${clip(b.thinking)}`);
        else if (b.type === 'redacted_thinking' && !toolsOnly) console.log(`\n--- [thinking: REDACTED]`);
        else if (b.type === 'tool_use') {
          console.log(`\n${hr('-')}\n>>> TOOL CALL [${b.name}] ${b.id}`);
          const inp = b.input || {};
          console.log(inp.command ? `  $ ${inp.command}` : `  input: ${clip(JSON.stringify(inp, null, 1))}`);
        } else if (b.type === 'tool_result') {
          const c = b.content;
          const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || JSON.stringify(x)).join('\n') : JSON.stringify(c);
          console.log(`<<< TOOL RESULT ${b.tool_use_id}${b.is_error ? ' [ERROR]' : ''}:\n${clip(txt)}`);
        }
      }
      if (m.usage && rid && !seenUsage.has(rid) && !toolsOnly) {
        seenUsage.add(rid);
        console.log(`  [usage in=${m.usage.input_tokens} cw=${m.usage.cache_creation_input_tokens} cr=${m.usage.cache_read_input_tokens} out=${m.usage.output_tokens}]`);
      }
    }
  }
}

({ codex, opencode, 'claude-code': claudecode })[harness]();
