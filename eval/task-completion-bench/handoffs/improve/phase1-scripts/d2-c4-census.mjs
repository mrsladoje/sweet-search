// DOCTRINE §2 + §10 — C-4 mechanism census, all three harnesses, sweet arm.
//
// The C-4 mechanism only fires when a file that was ALREADY READ is read again: serving it
// whole on first touch is what collapses the later read. So the census quantity is
// "repeat reads of an already-read file", per rollout, and the tier follows from its size.
//
// Read-only. No model. Writes nothing outside /tmp.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = [
  ['sb-codex-20260811', 'codex'],
  ['sb-opencode-20260811', 'opencode'],
  ['sb-claudecode-20260811', 'claude'],
];
const ARM = 'sweet';

const walk = (d, pred, depth = 0, out = []) => {
  if (depth > 10) return out;
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, pred, depth + 1, out);
    else if (pred(p)) out.push(p);
  }
  return out;
};

// --- read-call extraction, per harness -------------------------------------
// Returns an ordered list of {file, a, b} for every call that delivers file content.
function parseSsRead(cmd) {
  if (!/\bss-read\b/.test(cmd)) return null;
  const m = /\bss-read\b([^\n|;&]*)/.exec(cmd); if (!m) return null;
  const toks = m[1].trim().split(/\s+/).filter(Boolean);
  let file = null, a = null, b = null;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.startsWith('-')) {
      if (/^--(lines|range)$/.test(tk) && toks[i + 1]) {
        const r = /(\d+)\s*-\s*(\d+)/.exec(toks[++i]); if (r) { a = +r[1]; b = +r[2]; }
      }
      continue;
    }
    const c = /^(.*?):(\d+)-(\d+)$/.exec(tk);
    if (c) { file = file || c[1]; a = +c[2]; b = +c[3]; continue; }
    if (!file) { file = tk.replace(/^['"]|['"]$/g, ''); continue; }
    if (/^\d+$/.test(tk)) { if (a == null) a = +tk; else if (b == null) b = +tk; }
  }
  return file ? { file, a, b } : null;
}
const catRe = /\b(?:cat|sed\s+-n|head|tail)\b[^\n|;&]*/;

function readsCodex(dir) {
  const files = walk(path.join(dir, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'));
  const best = [];
  for (const f of files) {
    const seq = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      if (ty !== 'function_call' && ty !== 'custom_tool_call') continue;
      const cmd = String(p.input ?? p.arguments ?? '');
      const r = parseSsRead(cmd);
      if (r) seq.push(r);
    }
    if (seq.length > best.length) best.length = 0, best.push(...seq);
  }
  return best;
}

function readsOpencode(dir) {
  const files = walk(path.join(dir, 'opencode-retained'), p => p.endsWith('attempt-1.stdout.ndjson'));
  const best = [];
  for (const f of files) {
    const seq = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (o.type !== 'tool_use') continue;
      const part = o.part || {}; const inp = part.state?.input || {};
      if (part.tool === 'bash' && inp.command) {
        const r = parseSsRead(String(inp.command)); if (r) seq.push(r);
      } else if (part.tool === 'read' && inp.filePath) {
        seq.push({ file: String(inp.filePath), a: inp.offset ?? null,
          b: inp.offset != null && inp.limit != null ? inp.offset + inp.limit : null });
      }
    }
    if (seq.length > best.length) best.length = 0, best.push(...seq);
  }
  return best;
}

function readsClaude(dir) {
  const files = walk(path.join(dir, 'claude-home', 'projects'), p => p.endsWith('.jsonl'))
    .filter(p => !p.includes('/subagents/'));
  const best = [];
  for (const f of files) {
    const seq = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      for (const b of (o.message?.content || [])) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Bash' && b.input?.command) {
          const r = parseSsRead(String(b.input.command)); if (r) seq.push(r);
        } else if (b.name === 'Read' && b.input?.file_path) {
          seq.push({ file: String(b.input.file_path), a: b.input.offset ?? null,
            b: b.input.offset != null && b.input.limit != null ? b.input.offset + b.input.limit : null });
        }
      }
    }
    if (seq.length > best.length) best.length = 0, best.push(...seq);
  }
  return best;
}

const EXTRACT = { codex: readsCodex, opencode: readsOpencode, claude: readsClaude };

console.log('=== C-4 MECHANISM CENSUS — sweet arm, three matched runs ===');
console.log('mechanism: a file already read in this rollout is read again; whole-file-on-first-touch');
console.log('           collapses that later read. Census quantity = repeat reads.\n');

const totals = {};
for (const [run, h] of RUNS) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'))
    .filter(r => r.arm === ARM);
  let calls = 0, repeats = 0, rolloutsWithRepeat = 0, distinct = 0;
  const perRollout = [];
  for (const r of rows) {
    const dir = path.join(RESULTS, run, 'agent-state', `${r.taskId}-${r.arm}`);
    if (!existsSync(dir)) continue;
    const seq = EXTRACT[h](dir);
    const seen = new Set(); let rep = 0;
    for (const s of seq) {
      const key = s.file.replace(/^\.?\//, '');
      if (seen.has(key)) rep++; else seen.add(key);
    }
    calls += seq.length; repeats += rep; distinct += seen.size;
    if (rep > 0) rolloutsWithRepeat++;
    perRollout.push({ task: r.taskId, rep: r.rep, calls: seq.length, repeats: rep });
  }
  totals[h] = { calls, repeats, rolloutsWithRepeat, rollouts: rows.length, distinct };
  const tier = repeats >= 200 ? '200+  (microsmoke resolves it)'
    : repeats >= 20 ? '20-50 (large proximal effect only)'
      : 'under 10 (UNDECIDABLE by run)';
  console.log(`-- ${h} --`);
  console.log(`   read calls              ${calls}`);
  console.log(`   distinct files read     ${distinct}`);
  console.log(`   REPEAT reads (mechanism fires) ${repeats}   -> tier ${tier}`);
  console.log(`   rollouts with >=1 repeat  ${rolloutsWithRepeat} / ${rows.length}`);
  const top = perRollout.filter(x => x.repeats > 0).sort((a, b) => b.repeats - a.repeats).slice(0, 5);
  console.log(`   heaviest: ${top.map(x => `${x.task}#r${x.rep}(${x.repeats})`).join(', ') || '(none)'}\n`);
}
const sum = Object.values(totals).reduce((a, t) => a + t.repeats, 0);
console.log(`TOTAL repeat-read events across the 204 rollouts (sweet arm): ${sum}`);
console.log(`Per-harness tier is what governs: a pooled figure is not a tier.`);
