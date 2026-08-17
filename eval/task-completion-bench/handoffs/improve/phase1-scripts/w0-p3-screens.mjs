#!/usr/bin/env node
// SLATE-B W0 gate — P3 witnesses/finish: SCREEN AND CALL EXTRACTION.
//
// P3's falsifiers need two things the recorded trajectories cannot supply:
//
//   1. FULL test output. `results/<run>/trajectories/*.json` truncates every tool
//      result at 600 characters. An ExUnit assertion diff, a pytest assert-rewrite
//      block or a mocha expected/actual pair does not survive that, and a delta
//      parser fed a truncated screen would fail for a reason that has nothing to do
//      with P3. So this reads each harness's OWN session record, which is complete.
//   2. Every tool call in order, for the ss-oracle trigger census (falsifier 3).
//
// The grading logs under `results/<run>/<arm>/logs/*.txt` are NOT a substitute and
// are deliberately not read here: they are produced AFTER the grader applies the
// hidden test patch, so they contain hidden-test expectations. Using them to build
// or judge a witness would breach P3's own kill condition ("needs hidden/gold
// facts"). Everything below comes only from what the agent saw while it worked.
//
// Three harness formats, one shape out:
//   claude-code  agent-state/<task>-<arm>/claude-home/projects/*__r<N>__*/*.jsonl
//                assistant tool_use blocks + the matching user tool_result blocks
//   codex        agent-state/<task>-<arm>/codex-home/sessions/**/rollout-*.jsonl
//                response_item custom_tool_call / custom_tool_call_output pairs
//   opencode     agent-state/<task>-<arm>/opencode-retained/session-*/attempt-1.stdout.ndjson
//                tool_use parts carrying state.input and state.output
//
// $0: reads recorded artifacts only. No agent runs, no grading, no network, no writes
// outside OUT.
//
// Usage on the box: node w0-p3-screens.mjs > /root/w0-p3-extract.log 2>&1
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const RESULTS = process.env.RESULTS || path.join(BENCH, 'results');
const OUT = process.env.OUT || '/root/w0-p3-screens.json';
const RUNS = (process.env.RUNS || 'sb-codex-20260811,sb-opencode-20260811,sb-claudecode-20260811').split(',');

const harnessOf = (run) => run.includes('codex') ? 'codex' : run.includes('opencode') ? 'opencode' : 'claude-code';
const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
};
const jsonl = (file) => readFileSync(file, 'utf8').trim().split('\n')
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// The run directory name carries the rep: .../runs/<task>__<arm>__r<N>__<seq>
const repFrom = (s) => { const m = /__r(\d)__/.exec(s || ''); return m ? Number(m[1]) : null; };

const asText = (x) => {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(asText).join('\n');
  if (typeof x === 'object') return asText(x.text ?? x.content ?? x.output ?? x.stdout ?? JSON.stringify(x));
  return String(x);
};

// ------------------------------------------------------------------ per harness

function fromClaude(dir) {
  // one project directory per rep; the directory name holds the run path
  const out = [];
  const proj = path.join(dir, 'claude-home/projects');
  if (!existsSync(proj)) return out;
  for (const d of readdirSync(proj)) {
    const rep = repFrom(d.replace(/--/g, '__'));
    if (rep === null) continue;
    const calls = [];
    for (const f of readdirSync(path.join(proj, d)).filter(x => x.endsWith('.jsonl'))) {
      const pend = new Map();
      for (const rec of jsonl(path.join(proj, d, f))) {
        const c = rec.message?.content;
        if (!Array.isArray(c)) continue;
        for (const b of c) {
          if (b.type === 'tool_use') {
            const shell = b.name === 'Bash';
            const cmd = shell ? (b.input?.command ?? '')
              : b.name === 'Read' ? `Read ${b.input?.file_path ?? ''}`
              : b.name === 'Edit' ? `Edit ${b.input?.file_path ?? ''}`
              : b.name === 'Write' ? `Write ${b.input?.file_path ?? ''}`
              : `${b.name} ${JSON.stringify(b.input ?? {}).slice(0, 300)}`;
            pend.set(b.id, { tool: b.name, shell, cmd, out: '' });
            calls.push(pend.get(b.id));
          } else if (b.type === 'tool_result' && pend.has(b.tool_use_id)) {
            pend.get(b.tool_use_id).out = asText(b.content);
          }
        }
      }
    }
    out.push({ rep, calls });
  }
  return out;
}

function fromCodex(dir) {
  const out = [];
  const root = path.join(dir, 'codex-home/sessions');
  for (const f of walk(root).filter(p => /rollout-.*\.jsonl$/.test(p))) {
    const recs = jsonl(f);
    const meta = recs.find(r => r.type === 'session_meta');
    const rep = repFrom(meta?.payload?.cwd);
    if (rep === null) continue;
    const calls = [], pend = new Map(), cellOwner = new Map();
    for (const r of recs) {
      if (r.type !== 'response_item') continue;
      const p = r.payload;
      if (p.type === 'custom_tool_call' || p.type === 'function_call') {
        // Codex does not hand over a command string. `input` is a JS PROGRAM, and the
        // shell command sits inside it as a quoted literal:
        //     const r = await tools.exec_command({cmd:"run_tests","workdir":...})
        // Matching the test regex against that whole program is what made the first
        // run extract ZERO codex screens: `run_tests` is preceded by a quote, not by
        // whitespace. Pull the literal out and unescape it, and mark only that as a
        // shell command. (This is the recorded codex double-escaping hazard.)
        let raw = asText(p.input ?? '');
        if (!raw && p.arguments) { try { const a = JSON.parse(p.arguments); raw = a.command ?? a.cmd ?? p.arguments; } catch { raw = p.arguments; } }
        let cmd = raw, shell = false;
        const m = /exec_command\(\s*\{\s*(?:"cmd"|cmd)\s*:\s*("(?:[^"\\]|\\.)*")/.exec(raw);
        if (m) { try { cmd = JSON.parse(m[1]); shell = true; } catch { cmd = m[1]; shell = true; } }
        else if (/\*\*\* Begin Patch/.test(raw)) cmd = 'apply_patch ' + (/\*\*\* Update File: (\S+)/.exec(raw)?.[1] ?? '');
        // A `wait` is not a command of its own — it collects a previously started
        // cell. Recording it as a call would double-count, and marking it shell
        // would let its retrieved test output register as a second screen.
        let waitCell = null;
        if ((p.name ?? '') === 'wait') {
          try { waitCell = String(JSON.parse(p.arguments ?? raw).cell_id); } catch { waitCell = null; }
        }
        const rec = { tool: p.name ?? 'tool', shell: shell && !waitCell, cmd: asText(cmd), out: '', waitCell };
        if (p.call_id) pend.set(p.call_id, rec);
        calls.push(rec);
      } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
        const rec = pend.get(p.call_id);
        if (!rec) continue;
        rec.out = asText(p.output);
        // Codex runs commands ASYNCHRONOUSLY. `exec` returns only
        //     "Script running with cell ID 3\nWall time 11.0 seconds\nOutput:"
        // and the real stdout arrives later through a `wait` on that cell id. Fifty
        // of the first extraction's codex screens were 61 characters long for exactly
        // this reason — the test output was present in the record but attached to a
        // different call. Stitch it back onto the command that started the cell.
        const started = /cell ID (\d+)/i.exec(rec.out);
        if (started) cellOwner.set(started[1], rec);
        if (rec.waitCell && cellOwner.has(rec.waitCell)) {
          const owner = cellOwner.get(rec.waitCell);
          owner.out = (owner.out + '\n' + rec.out).trim();
        }
      }
    }
    out.push({ rep, calls });
  }
  return out;
}

function fromOpencode(dir) {
  const out = [];
  const root = path.join(dir, 'opencode-retained');
  if (!existsSync(root)) return out;
  for (const d of readdirSync(root)) {
    const nd = path.join(root, d, 'attempt-1.stdout.ndjson');
    if (!existsSync(nd)) continue;
    const recs = jsonl(nd);
    const rep = repFrom(/runs\/[^"\s]*__r\d__\d+/.exec(readFileSync(nd, 'utf8'))?.[0]);
    if (rep === null) continue;
    const calls = [];
    for (const r of recs) {
      if (r.type !== 'tool_use') continue;
      const st = r.part?.state ?? {};
      const inp = st.input ?? {};
      const tool = r.part?.tool ?? 'tool';
      const shell = tool === 'bash';
      // Never let a non-shell tool's serialised arguments be screened for test
      // commands: an opencode `todowrite` whose todo text reads "Run baseline test
      // suite with run_tests" is a plan, not a test run, and counting it inflated the
      // first extraction by four screens on this very task.
      const cmd = inp.command ?? inp.filePath ?? inp.pattern ?? JSON.stringify(inp).slice(0, 300);
      calls.push({ tool, shell, cmd: asText(cmd), out: asText(st.output ?? st.metadata?.output ?? '') });
    }
    out.push({ rep, calls });
  }
  return out;
}

// ------------------------------------------------------------------- extraction

// The canonical suite is invoked through the harness shim `run_tests`. Anything else
// that runs tests directly (mix test, pytest, npm test) is captured too, because an
// agent that bypasses the shim still produced a screen the finish gate would read.
const TEST_CMD = /(^|[\s;&|(])run_tests\b|(^|[\s;&|(])(mix test|pytest|npm (run )?test|yarn test|npx (mocha|jest|codeceptjs)|swift test|dart test|Rscript -e ['"]?testthat|busted|luarocks test|nvim --headless.*Test)/;

const cells = [];
for (const run of RUNS) {
  const H = harnessOf(run);
  const stateRoot = path.join(RESULTS, run, 'agent-state');
  if (!existsSync(stateRoot)) { console.log(`MISSING agent-state: ${run}`); continue; }
  for (const d of readdirSync(stateRoot)) {
    const m = /^(.*)-(native|sweet)$/.exec(d);
    if (!m) { console.log(`  skip unparsed state dir ${d}`); continue; }
    const [, taskId, arm] = m;
    const dir = path.join(stateRoot, d);
    const reps = H === 'claude-code' ? fromClaude(dir) : H === 'codex' ? fromCodex(dir) : fromOpencode(dir);
    for (const { rep, calls } of reps) {
      const screens = calls.map((c, i) => ({ i, ...c })).filter(c => c.shell && TEST_CMD.test(c.cmd));
      cells.push({
        run, harness: H, arm, rep, taskId,
        nCalls: calls.length,
        calls: calls.map((c, i) => ({ i, tool: c.tool, shell: !!c.shell, cmd: c.cmd.slice(0, 400), outLen: c.out.length })),
        screens: screens.map(s => ({ i: s.i, cmd: s.cmd.slice(0, 200), out: s.out })),
      });
    }
  }
}

cells.sort((a, b) => (a.taskId + a.harness + a.arm + a.rep).localeCompare(b.taskId + b.harness + b.arm + b.rep));
writeFileSync(OUT, JSON.stringify(cells));

// -------------------------------------------------------------------- integrity
// A silent under-extraction would flatter every downstream P3 number, so the cell
// count and the per-cell test-call count are both checked against the independently
// recorded trajectories before anything is believed.
console.log(`cells extracted: ${cells.length}`);
console.log(`screens total:   ${cells.reduce((n, c) => n + c.screens.length, 0)}`);
console.log(`empty screens:   ${cells.reduce((n, c) => n + c.screens.filter(s => !s.out.trim()).length, 0)}`);
let checked = 0, mismatch = 0, missingTraj = 0;
for (const c of cells) {
  const tf = path.join(RESULTS, c.run, 'trajectories', `${c.taskId}-${c.arm}-r${c.rep}.json`);
  if (!existsSync(tf)) { missingTraj++; continue; }
  const t = JSON.parse(readFileSync(tf, 'utf8'));
  const nTest = (t.trajectory || []).filter(s => s.kind === 'test').length;
  checked++;
  if (nTest !== c.screens.length) {
    mismatch++;
    console.log(`  MISMATCH ${c.harness} ${c.arm} r${c.rep} ${c.taskId}: trajectory kind=test ${nTest}, extracted ${c.screens.length}`);
  }
}
console.log(`trajectory cross-check: ${checked} compared, ${mismatch} mismatched, ${missingTraj} without a trajectory file`);

// The reverse direction: a cell that exists as a trajectory but produced no session
// record would vanish silently from every P3 denominator.
const have = new Set(cells.map(c => `${c.run}|${c.taskId}|${c.arm}|${c.rep}`));
let absent = 0;
for (const run of RUNS) {
  const td = path.join(RESULTS, run, 'trajectories');
  if (!existsSync(td)) continue;
  for (const f of readdirSync(td)) {
    const m = /^(.*)-(native|sweet)-r(\d)\.json$/.exec(f);
    if (!m) continue;
    const key = `${run}|${m[1]}|${m[2]}|${Number(m[3])}`;
    if (!have.has(key)) { absent++; console.log(`  NO SESSION RECORD: ${run} ${m[2]} r${m[3]} ${m[1]}`); }
  }
}
console.log(`cells with a trajectory but no harness session record: ${absent}`);
console.log(`wrote ${OUT}`);
