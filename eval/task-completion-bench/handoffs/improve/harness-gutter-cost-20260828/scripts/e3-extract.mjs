// e3-extract.mjs — per-rollout cost + behaviour + gutter-block extraction over the
// fresh-pool epoch-C runs. READ ONLY. Writes to /tmp/fp-inv/e3/ only.
//
// Emits:
//   rollouts.ndjson  one line per rollout (all three harnesses, sweet + native)
//   blocks.ndjson    one line per gutter-bearing fenced code block on the sweet arm,
//                    carrying the DELIVERED text and its ingest/resident price weights
//
// Conventions honoured (FRESH-POOL-RESULTS Appendix A.6):
//   - turns/ is ignored; every rollout is re-priced from its OWN transcript
//   - a cell with more transcripts than reps keeps the 3 dearest
//   - claude-code cost is never read from rows.json
//   - opencode sweet rows for the 11 repair tasks come from rp-oc-*, not fp-opencode-*
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const OUT = '/tmp/fp-inv/e3';
const PRICE = { in: 0.10, cache: 0.01, out: 0.60 };   // openai/gpt-5.6-luna, USD per 1M
const CLAUDE_SELECT = process.env.CLAUDE_SELECT || 'dearest';
const REPAIR = new Set(readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').filter(Boolean));

// ---------------------------------------------------------------- cost model
function costFromTurns(turns, price = PRICE) {
  let ideal = 0, real = 0, breakPriced = 0, prevIn = 0;
  let newInTot = 0, resentTot = 0, outTot = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);
    const resent = tu.in - newIn;
    const cacheWrite = Math.max(0, Math.min(Number(tu.cacheWrite) || 0, tu.in - (Number(tu.cached) || 0)));
    ideal += (newIn * price.in + resent * price.cache + tu.out * price.out) / 1e6;
    real += ((tu.in - (tu.cached || 0) - cacheWrite) * price.in + cacheWrite * price.in * 1.25
      + (tu.cached || 0) * price.cache + tu.out * price.out) / 1e6;
    const cacheable = tu.in < prevIn ? 0 : Math.min(prevIn, tu.in);
    breakPriced += ((tu.in - cacheable) * price.in + cacheable * price.cache + tu.out * price.out) / 1e6;
    newInTot += newIn; resentTot += resent; outTot += tu.out;
    prevIn = tu.in;
  }
  return { ideal, real, breakPriced, newInTot, resentTot, outTot, T: turns.length };
}

// ------------------------------------------------------------- fs utilities
function walk(dir, pred, out = [], depth = 0) {
  if (depth > 9) return out;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out, depth + 1);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ------------------------------------------------- gutter-block segmentation
// Walk a tool-result text; inside ``` fences that follow an ss-* header, collect the
// body verbatim together with the first line number it was rendered from.
const RE_READ_HDR = /^# ss-read (\S+) \((?:lines (\d+)-(\d+) of (\d+)|(\d+) lines)\)\s*$/;
const RE_HIT_HDR = /^## #\d+ (\S+?):(\d+)-(\d+)/;
const RE_SEM_HDR = /^### (\S+?):(\d+)-(\d+)/;
const RE_SEARCH_HDR = /^# ss-(search|find|semantic)\b/;

function segmentBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  // `### imports` renders its OWN fence before the numbered code fence, so the
  // imports flag must be consumed by exactly one fence and then cleared — an
  // earlier version let it swallow the code block that followed.
  let inFence = false, buf = null, surf = null, start = null, curSurf = null, importsNext = false;
  let fencesOpened = 0, fencesClosed = 0;
  for (const ln of lines) {
    if (!inFence) {
      let m;
      if ((m = ln.match(RE_READ_HDR))) { curSurf = 'ss-read'; start = m[2] ? +m[2] : 1; importsNext = false; continue; }
      if ((m = ln.match(RE_SEARCH_HDR))) { curSurf = 'ss-' + m[1]; start = null; importsNext = false; continue; }
      if ((m = ln.match(RE_HIT_HDR))) { start = +m[2]; if (!curSurf) curSurf = 'ss-search'; importsNext = false; continue; }
      if ((m = ln.match(RE_SEM_HDR))) { start = +m[2]; if (!curSurf) curSurf = 'ss-semantic'; importsNext = false; continue; }
      if (ln.startsWith('### imports')) { importsNext = true; continue; }
      if (ln.startsWith('```')) {
        inFence = true; fencesOpened++; buf = [];
        surf = importsNext ? 'imports' : curSurf; importsNext = false; continue;
      }
    } else {
      if (ln.startsWith('```')) {
        inFence = false; fencesClosed++;
        if (surf && surf !== 'imports' && buf.length) blocks.push({ surf, start, body: buf.join('\n') });
        buf = null; surf = null;
        continue;
      }
      buf.push(ln);
    }
  }
  return { blocks, fencesOpened, fencesClosed, unclosed: fencesOpened - fencesClosed };
}

// A block counts as gutter-bearing when its first line carries the delimiter.
const RE_TAB = /^(\d+)\t/;
const RE_PIPE = /^(\d+)\| /;
function gutterFormOf(body) {
  const first = body.split('\n', 1)[0] || '';
  if (RE_TAB.test(first)) return 'tab';
  if (RE_PIPE.test(first)) return 'pipe';
  return 'none';
}

// ------------------------------------------------------------ codex parsing
function parseCodex(file) {
  const turns = [];
  const calls = [];
  const pending = new Map();
  let text; try { text = readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      // turnsFromRollout (harness/ideal-cost.mjs) emits {in, cached, out} ONLY — no
      // cacheWrite — so realFromTurnsUsd never applies the 1.25x cache-creation
      // surcharge on codex. Matching that exactly keeps this reconstruction
      // comparable with the published codex column.
      turns.push({
        in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
        out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
      });
    } else if (t === 'function_call' || t === 'custom_tool_call') {
      let cmd = '';
      if (t === 'function_call') { try { const a = JSON.parse(p.arguments || '{}'); cmd = a.cmd ?? a.command ?? p.arguments; } catch { cmd = p.arguments || ''; } }
      else cmd = p.input || '';
      if (Array.isArray(cmd)) cmd = cmd.join(' ');
      pending.set(p.call_id, { cmd: String(cmd ?? ''), name: p.name || '' });
    } else if (t === 'function_call_output' || t === 'custom_tool_call_output') {
      const c = pending.get(p.call_id) || { cmd: '', name: '' };
      let out = p.output;
      if (out && typeof out === 'object') out = out.content ?? JSON.stringify(out);
      calls.push({ cmd: c.cmd, name: c.name, out: String(out ?? ''), k: turns.length + 1 });
    }
  }
  return { turns, calls };
}

// --------------------------------------------------------- opencode parsing
function parseOpencode(file) {
  const turns = [];
  const seen = new Map(); const order = [];
  let text; try { text = readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    const tl = line.trim(); if (!tl || tl[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tl); } catch { continue; }
    const p = ev.part || ev.properties?.part || ev;
    const type = ev.type || p.type;
    if (type === 'tool_use' || (p && p.tool && (p.state || p.callID || p.callId))) {
      const st = p.state || {};
      const id = String(p.callID || p.callId || st.callID || `l${order.length}`);
      const prior = seen.get(id);
      if (!prior) order.push(id);
      // opencode puts a FAILED tool's message in state.error and leaves state.output
      // empty; reading only `output` classified 11 real apply_patch seek failures as
      // "other, status=error" with zero bytes to show. The model does see this text.
      const out = (st.output || p.output || st.error || p.error || '');
      seen.set(id, {
        name: p.tool || '', cmd: JSON.stringify(st.input ?? p.input ?? {}),
        out: typeof out === 'string' ? out : JSON.stringify(out || ''),
        isError: (st.status || p.status) === 'error',
        k: prior?.k ?? (turns.length + 1),
      });
    } else if (type === 'step_finish' || type === 'step-finish') {
      const tk = p.tokens || {}; const cache = tk.cache || {};
      const cRead = cache.read || 0, cWrite = cache.write || 0;
      turns.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, cacheWrite: 0, out: (tk.output || 0) + (tk.reasoning || 0) });
    }
  }
  return { turns, calls: order.map(id => seen.get(id)) };
}

// ------------------------------------------------------ claude-code parsing
function parseClaude(file) {
  let text; try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const order = []; const byId = new Map();
  const useTurn = new Map();     // tool_use id -> turn index (1-based over usage turns)
  const useInfo = new Map();
  const results = new Map();
  for (const line of text.split('\n')) {
    const tr = line.trim(); if (!tr || tr[0] !== '{') continue;
    let ev; try { ev = JSON.parse(tr); } catch { continue; }
    const m = ev.message; if (!m) continue;
    if (m.role === 'assistant' && m.id) {
      let g = byId.get(m.id);
      if (!g) { g = { usage: null, best: -1, uses: [], toolIds: new Set() }; byId.set(m.id, g); order.push(m.id); }
      for (const b of (m.content || [])) {
        if (b.type === 'tool_use' && b.id && !g.toolIds.has(b.id)) {
          g.toolIds.add(b.id); g.uses.push(b.id);
          useInfo.set(b.id, { name: b.name, input: b.input });
        }
      }
      const u = m.usage;
      if (u) {
        const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inp = (u.input_tokens || 0) + cached + cw;
        const out = u.output_tokens || 0;
        if (inp + out > g.best) { g.best = inp + out; g.usage = { in: inp, cached, cacheWrite: cw, out }; }
      }
    }
    // tool_result blocks land on user records
    for (const b of (m.content || [])) {
      if (b && b.type === 'tool_result' && b.tool_use_id) {
        let c = b.content;
        if (Array.isArray(c)) c = c.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n');
        results.set(b.tool_use_id, { text: String(c ?? ''), isError: !!b.is_error });
      }
    }
  }
  const turns = []; let ti = 0;
  for (const id of order) {
    const g = byId.get(id);
    if (!g.usage || (!g.usage.in && !g.usage.out)) continue;
    ti++; turns.push(g.usage);
    for (const uid of g.uses) useTurn.set(uid, ti);
  }
  const calls = [];
  for (const id of order) {
    for (const uid of byId.get(id).uses) {
      const inf = useInfo.get(uid) || {};
      const res = results.get(uid) || { text: '', isError: false };
      calls.push({
        name: inf.name || '', cmd: JSON.stringify(inf.input || {}),
        out: res.text, isError: res.isError, k: useTurn.get(uid) || turns.length,
        input: inf.input || {},
      });
    }
  }
  return { turns, calls };
}

// --------------------------------------------------------- behaviour metrics
const RE_SSREAD_CMD = /\bss-read\s+(\S+)(?:\s+(\d+)\s+(\d+))?/g;
const CODEX_TRUNC = 'Warning: truncated output (original token count:';
const EDIT_FAIL_STRINGS = [
  'Failed to find context', 'Failed to find expected lines', 'Unexpected line found',
  'apply_patch verification failed', 'String to replace not found',
  'Found ', 'No changes to make', 'InputValidationError', 'Invalid patch', 'Invalid Patch',
];
function classifyEditFailure(out, name) {
  if (!out) return null;
  if (out.includes('Failed to find context')) return 'seek_context';
  if (out.includes('Failed to find expected lines')) return 'seek_lines';
  if (out.includes('Unexpected line found')) return 'parse';
  if (out.includes('apply_patch verification failed')) return 'seek_context';
  if (out.includes('String to replace not found')) return 'anchor_notfound';
  if (/Found \d+ matches of the string to replace/.test(out)) return 'anchor_ambiguous';
  if (out.includes('No changes to make')) return 'noop';
  if (out.includes('InputValidationError')) return 'input_invalid';
  return null;
}

function analyseRollout(h, form, arm, task, rep, file, parsed, blockSink) {
  const { turns, calls } = parsed;
  const c = costFromTurns(turns);
  const T = turns.length;
  const m = {
    h, form, arm, task, rep, file: basename(file),
    T, calls: calls.length,
    idealUsd: c.ideal, realUsd: c.real, breakUsd: c.breakPriced,
    newInTok: c.newInTot, resentTok: c.resentTot, outTok: c.outTot,
    ssCalls: 0, ssRead: 0, ssSearch: 0, ssGrep: 0, ssFind: 0, ssSemantic: 0, ssTrace: 0,
    nativeReadCalls: 0, nativeGrepCalls: 0, editCalls: 0, editFails: 0, editFailKinds: {},
    truncations: 0, toolOutBytes: 0,
    readInvocations: 0, readWithRange: 0, readWholeFile: 0,
    readLinesDelivered: 0, readWindowSizes: [], distinctFilesRead: 0, rereadBlocks: 0,
    numberedLines: 0, rawCodeLines: 0, blocksBySurface: {},
    fencesOpened: 0, fencesUnclosed: 0,
    gutterWeightSum: 0,
  };
  const filesRead = new Set();
  const readSpans = new Map();   // file -> [[a,b],...]

  for (const call of calls) {
    const cmd = call.cmd || '';
    const name = call.name || '';
    const out = call.out || '';
    m.toolOutBytes += out.length;
    if (out.includes(CODEX_TRUNC)) m.truncations++;

    // --- tool classification (harness-specific surface, sweet ss-* by command text)
    const cmdText = h === 'codex' ? cmd : (() => { try { const o = JSON.parse(cmd); return o.command || o.cmd || cmd; } catch { return cmd; } })();
    const isBashish = h === 'codex' ? true : (name === 'bash' || name === 'Bash');
    if (isBashish) {
      for (const [tool, key] of [['ss-read', 'ssRead'], ['ss-search', 'ssSearch'], ['ss-grep', 'ssGrep'], ['ss-find', 'ssFind'], ['ss-semantic', 'ssSemantic'], ['ss-trace', 'ssTrace']]) {
        const n = (String(cmdText).match(new RegExp('(^|[;&|\\s])' + tool + '\\b', 'g')) || []).length;
        if (n) { m[key] += n; m.ssCalls += n; }
      }
      if (/(^|[;&|\s])(sed|cat|nl|head|tail)\b/.test(String(cmdText))) m.nativeReadCalls++;
      if (/(^|[;&|\s])(grep|rg|ag|find)\b/.test(String(cmdText))) m.nativeGrepCalls++;
    }
    if (name === 'read' || name === 'Read') { m.nativeReadCalls++; }
    if (name === 'grep' || name === 'Grep' || name === 'glob' || name === 'Glob') { m.nativeGrepCalls++; }

    // --- edits
    let isEdit = false;
    if (h === 'codex') isEdit = /apply_patch\s*<<|^\s*apply_patch\b/.test(String(cmdText));
    else if (h === 'opencode') isEdit = ['apply_patch', 'edit', 'write', 'patch'].includes(name);
    else isEdit = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name);
    if (isEdit) {
      m.editCalls++;
      const kind = classifyEditFailure(out, name);
      const failed = kind !== null || (call.isError === true)
        || (h === 'codex' && /Process exited with code [1-9]/.test(out));
      if (failed) { m.editFails++; const kk = kind || 'other'; m.editFailKinds[kk] = (m.editFailKinds[kk] || 0) + 1; }
    }

    // --- ss-read invocation shape (from the COMMAND, so NONE is measurable)
    if (arm === 'sweet') {
      RE_SSREAD_CMD.lastIndex = 0;
      let mm;
      while ((mm = RE_SSREAD_CMD.exec(String(cmdText))) !== null) {
        m.readInvocations++;
        if (mm[2] && mm[3]) { m.readWithRange++; } else { m.readWholeFile++; }
      }
    }

    // --- delivered code blocks
    if (arm === 'sweet' && out.includes('```')) {
      const resid = Math.max(0, T - call.k - 1);
      const weight = T > call.k ? (PRICE.in + PRICE.cache * resid) / 1e6 : 0;
      const seg = segmentBlocks(out);
      m.fencesOpened += seg.fencesOpened; m.fencesUnclosed += seg.unclosed;
      for (const b of seg.blocks) {
        const n = b.body.split('\n').length;
        const gf = gutterFormOf(b.body);
        m.blocksBySurface[b.surf] = (m.blocksBySurface[b.surf] || 0) + 1;
        if (gf === 'none') m.rawCodeLines += n; else m.numberedLines += n;
        if (b.surf === 'ss-read') { m.readLinesDelivered += n; m.readWindowSizes.push(n); }
        blockSink.push({
          id: `${h}|${form}|${arm}|${task}|${rep}`,
          surf: b.surf, start: b.start, n, k: call.k, T, resid, weight,
          gf, body: b.body,
        });
      }
      // header-derived read span bookkeeping for re-read detection
      for (const line of out.split('\n')) {
        const hm = line.match(RE_READ_HDR);
        if (!hm) continue;
        const f = hm[1];
        filesRead.add(f);
        const a = hm[2] ? +hm[2] : 1, bnd = hm[3] ? +hm[3] : (hm[5] ? +hm[5] : 1);
        const prev = readSpans.get(f) || [];
        if (prev.some(([x, y]) => a <= y && bnd >= x)) m.rereadBlocks++;
        prev.push([a, bnd]); readSpans.set(f, prev);
      }
    }
  }
  m.distinctFilesRead = filesRead.size;
  return m;
}

// ------------------------------------------------------------- run inventory
const RUNS = [
  { h: 'codex', form: 'tab', run: 'fp-codex-tab-20260826', arms: ['sweet', 'native'] },
  { h: 'codex', form: 'none', run: 'fp-codex-none-20260826', arms: ['sweet'] },
  { h: 'codex', form: 'pipe', run: 'fp-codex-pipe-20260826', arms: ['sweet'] },
  { h: 'opencode', form: 'tab', run: 'fp-opencode-tab-20260826', arms: ['sweet', 'native'] },
  { h: 'opencode', form: 'none', run: 'fp-opencode-none-20260826', arms: ['sweet'] },
  { h: 'opencode', form: 'pipe', run: 'fp-opencode-pipe-20260826', arms: ['sweet'] },
  { h: 'opencode', form: 'tab', run: 'rp-oc-tab-20260827', arms: ['sweet'], repairOnly: true },
  { h: 'opencode', form: 'none', run: 'rp-oc-none-20260827', arms: ['sweet'], repairOnly: true },
  { h: 'opencode', form: 'pipe', run: 'rp-oc-pipe-20260827', arms: ['sweet'], repairOnly: true },
  { h: 'claude-code', form: 'tab', run: 'fp-claudecode-tab-20260826', arms: ['sweet', 'native'] },
  { h: 'claude-code', form: 'none', run: 'fp-claudecode-none-20260826', arms: ['sweet'] },
  { h: 'claude-code', form: 'pipe', run: 'fp-claudecode-pipe-20260826', arms: ['sweet'] },
];

function transcriptsFor(h, cellDir) {
  if (h === 'codex') return walk(cellDir, p => /rollout-.*\.jsonl$/.test(p)).sort();
  if (h === 'opencode') return walk(cellDir, p => p.endsWith('attempt-1.stdout.ndjson')).sort();
  return walk(cellDir, p => /\/projects\/[^/]+\/[0-9a-f-]{36}\.jsonl$/.test(p));
}
function repOfPath(h, p) {
  if (h === 'claude-code') { const m = p.match(/-r(\d+)-\d+\//); return m ? +m[1] : null; }
  return null;
}
function sidechainsFor(sessionFile) {
  const dir = sessionFile.replace(/\.jsonl$/, '') + '/subagents';
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)); } catch { return []; }
}

const ROWS_CACHE = new Map();
function rowsIndex(run, task, arm) {
  if (!ROWS_CACHE.has(run)) {
    let rows = [];
    try { rows = JSON.parse(readFileSync(join(R, run, 'rows.json'), 'utf8')); } catch { rows = []; }
    ROWS_CACHE.set(run, rows);
  }
  return ROWS_CACHE.get(run).filter(r => r.taskId === task && r.arm === arm);
}

const rollouts = [];
const blocks = [];
for (const cfg of RUNS) {
  const base = join(R, cfg.run, 'agent-state');
  let cells; try { cells = readdirSync(base); } catch { console.error('MISSING', cfg.run); continue; }
  for (const cell of cells) {
    const m = cell.match(/^(.*)-(sweet|native)$/);
    if (!m) continue;
    const [, task, arm] = m;
    if (!cfg.arms.includes(arm)) continue;
    if (cfg.repairOnly && !REPAIR.has(task)) continue;
    // fp-opencode sweet rows for repair tasks are REPLACED by rp-oc-*
    if (cfg.h === 'opencode' && !cfg.repairOnly && arm === 'sweet' && REPAIR.has(task)) continue;
    const files = transcriptsFor(cfg.h, join(base, cell));
    const priced = [];
    for (const f of files) {
      const parsed = cfg.h === 'codex' ? parseCodex(f) : cfg.h === 'opencode' ? parseOpencode(f) : parseClaude(f);
      if (!parsed || !parsed.turns.length) continue;
      const c = costFromTurns(parsed.turns);
      let side = { n: 0, ideal: 0, real: 0, breakPriced: 0, missing: 0 };
      if (cfg.h === 'claude-code') {
        for (const sf of sidechainsFor(f)) {
          const sp = parseClaude(sf);
          if (!sp) continue;
          const sc = costFromTurns(sp.turns);
          side.n++; side.ideal += sc.ideal; side.real += sc.real; side.breakPriced += sc.breakPriced;
        }
      }
      priced.push({ f, parsed, real: c.real, side, mtime: statSync(f).mtimeMs, rep: repOfPath(cfg.h, f) });
    }
    // Which 3 transcripts ARE the 3 reps, when a cell retained a retry (13 of 264 cells).
    //   codex     rows.json names the exact rolloutFile per rep -> authoritative
    //   opencode  rows.json cost is complete and agrees with reconstruction to 1e-6,
    //             so match each row's cost to its transcript
    //   claude    rows.json cost is NOT usable (trap 2), but the project slug carries
    //             the rep (-r<N>-<seq>); keep the dearest transcript per rep
    // The blunt "3 dearest per cell" rule over-charged exactly one cell
    // (bfgroup__b2-259 opencode PIPE, $0.051474 vs the run's own $0.044784).
    let keep;
    if (cfg.h === 'codex') {
      const want = new Set(rowsIndex(cfg.run, task, arm).map(r => r.rolloutFile).filter(Boolean));
      keep = priced.filter(p => want.has(p.f));
      if (keep.length !== 3) keep = priced.slice().sort((a, b) => b.real - a.real).slice(0, 3);
    } else if (cfg.h === 'opencode') {
      const rws = rowsIndex(cfg.run, task, arm).slice().sort((a, b) => a.rep - b.rep);
      const pool = priced.slice();
      keep = [];
      for (const rw of rws) {
        let best = -1, bestD = Infinity;
        pool.forEach((p, i) => { const d = Math.abs(p.real - (rw.costRealizedUsd || 0)); if (d < bestD) { bestD = d; best = i; } });
        if (best >= 0 && bestD < 5e-5) { pool[best].rep = rw.rep; keep.push(pool.splice(best, 1)[0]); }
      }
      if (keep.length !== 3) keep = priced.slice().sort((a, b) => b.real - a.real).slice(0, 3);
    } else if (CLAUDE_SELECT === 'dearest') {
      // The convention the published reconstruction used (trap 5). Reproduces the
      // FRESH-POOL claude-code column to the last digit on TAB, PIPE and all three
      // sidechain totals. CLAUDE_SELECT=rep switches to the slug rule as a robustness check.
      keep = priced.slice().sort((a, b) => (b.real + b.side.real) - (a.real + a.side.real)).slice(0, 3);
    } else {
      const byRep = new Map();
      for (const p of priced) {
        const r = p.rep == null ? -1 : p.rep;
        const cur = byRep.get(r);
        if (!cur || (p.real + p.side.real) > (cur.real + cur.side.real)) byRep.set(r, p);
      }
      keep = [...byRep.values()];
      if (keep.length !== 3) keep = priced.slice().sort((a, b) => (b.real + b.side.real) - (a.real + a.side.real)).slice(0, 3);
    }
    keep.sort((a, b) => a.mtime - b.mtime);
    keep.forEach((p, i) => {
      const rep = p.rep != null ? p.rep : i;
      const rec = analyseRollout(cfg.h, cfg.form, arm, task, rep, p.f, p.parsed, blocks);
      rec.run = cfg.run;
      rec.sidechainCount = p.side.n;
      rec.sideIdealUsd = p.side.ideal; rec.sideRealUsd = p.side.real; rec.sideBreakUsd = p.side.breakPriced;
      rec.transcriptsInCell = priced.length;
      rollouts.push(rec);
    });
  }
}

const SUF = CLAUDE_SELECT === 'dearest' ? '' : '-repsel';
writeFileSync(join(OUT, `rollouts${SUF}.ndjson`), rollouts.map(r => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(OUT, `blocks${SUF}.ndjson`), blocks.map(b => JSON.stringify(b)).join('\n') + '\n');
console.log('rollouts', rollouts.length, 'blocks', blocks.length);
const cells = {};
for (const r of rollouts) {
  const k = `${r.h}|${r.form}|${r.arm}`;
  cells[k] = cells[k] || { n: 0, real: 0, ideal: 0, brk: 0, side: 0 };
  cells[k].n++; cells[k].real += r.realUsd + (r.sideRealUsd || 0);
  cells[k].ideal += r.idealUsd + (r.sideIdealUsd || 0);
  cells[k].brk += r.breakUsd + (r.sideBreakUsd || 0);
  cells[k].side += (r.sideRealUsd || 0);
}
for (const [k, v] of Object.entries(cells).sort()) {
  console.log(k.padEnd(26), 'n=' + String(v.n).padStart(3),
    'real/roll=$' + (v.real / v.n).toFixed(6),
    'ideal/roll=$' + (v.ideal / v.n).toFixed(6),
    'break/roll=$' + (v.brk / v.n).toFixed(6),
    'sideTot=$' + v.side.toFixed(6));
}
