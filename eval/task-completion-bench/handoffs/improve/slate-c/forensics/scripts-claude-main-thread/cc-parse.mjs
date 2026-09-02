// cc-parse.mjs — claude-code transcript parser for the slate-c "claude-main-thread" forensics.
// Read-only. One served request = every assistant record sharing message.id (usage-bearing
// record wins, blocks unioned and deduped by tool_use id). tool_result blocks in user records
// are attached to the request that issued the matching tool_use. Nothing is written by this
// module. Prices are the run's registered luna vector.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
export const PRICE = { in: 0.10, cacheWrite: 0.125, cacheRead: 0.01, out: 0.60 }; // $/M, realized
export const PRICE_IDEAL = { newIn: 0.10, resident: 0.01, out: 0.60 };            // $/M, ideal

export const walk = (d, out = []) => {
  let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); }
  return out;
};
export const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export function rowsOf(runId) {
  return JSON.parse(fs.readFileSync(`${ROOT}/results/${runId}/rows.json`, 'utf8'));
}

// Every main transcript of a cell, with its rep (from the project-dir slug) and subagent files.
export function transcriptsOf(runId, task, arm) {
  const cell = path.join(ROOT, 'results', runId, 'agent-state', `${task}-${arm}`);
  if (!fs.existsSync(cell)) return [];
  const all = walk(cell).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  const mains = all.filter(f => !f.includes('/subagents/'));
  return mains.map(f => {
    const m = f.match(/-root--ss-eval-runs-r(\d+)-\d+/);
    const sid = path.basename(f, '.jsonl');
    return { rep: m ? Number(m[1]) : null, file: f, size: fs.statSync(f).size,
      sub: all.filter(x => x.includes(`/${sid}/subagents/`)) };
  }).sort((a, b) => (a.rep - b.rep) || a.file.localeCompare(b.file));
}

export const priceReal = (u) => ((u.inUncached || 0) * PRICE.in + (u.cw || 0) * PRICE.cacheWrite
  + (u.cr || 0) * PRICE.cacheRead + (u.out || 0) * PRICE.out) / 1e6;

const SS_TOOLS = ['ss-search', 'ss-find', 'ss-grep', 'ss-semantic', 'ss-trace', 'ss-read', 'ss-files', 'ss-batch', 'ss-edit'];
export function ssToolsIn(cmd) {
  const s = String(cmd || ''); const hits = [];
  for (const t of SS_TOOLS) {
    const re = new RegExp(`(^|[\\s;&|(\`'"])${t}(\\s|$)`, 'g');
    let m; while ((m = re.exec(s))) hits.push({ tool: t, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.tool);
}
// paths given to ss-read (first positional after the tool name; flags skipped)
export function ssReadPaths(cmd) {
  const out = []; const re = /ss-read\s+((?:--?[A-Za-z][\w-]*(?:\s+\S+)?\s+)*)([^\s;&|'"`]+)/g;
  let m; while ((m = re.exec(String(cmd || '')))) { if (!m[2].startsWith('-')) out.push(m[2]); }
  return out;
}
export function bashCategory(cmd) {
  const s = String(cmd || '');
  const ss = ssToolsIn(s);
  if (ss.length) return ss.includes('ss-read') && !ss.some(t => t !== 'ss-read') ? 'ss-read'
    : ss.every(t => t === 'ss-read' || t === 'ss-search' || t === 'ss-find' || t === 'ss-grep' || t === 'ss-semantic' || t === 'ss-trace' || t === 'ss-files' || t === 'ss-batch')
      ? (ss.includes('ss-read') ? 'ss-mixed' : 'ss-search') : 'ss-other';
  if (/(^|[\s;&|(])run_tests(\s|$)/.test(s)) return 'test';
  if (/(^|[\s;&|(])git\s/.test(s)) return 'git';
  if (/(^|[\s;&|(])(grep|rg|egrep|fgrep|find|cat|sed|head|tail|awk|nl|ls|tree|wc|stat|file)(\s|$)/.test(s)) return 'shell-retrieval';
  if (/(^|[\s;&|(])(python3?|pytest|node|npm|npx|yarn|pnpm|dotnet|mvn|gradle|gradlew|mix|elixir|cargo|go|make|jest|mocha|tsc|ruby|bundle|php|composer|java|javac|swift)(\s|$)/.test(s)) return 'exec';
  return 'bash-other';
}

export function classifyEditError(txt) {
  const t = String(txt || '');
  if (!t) return null;
  if (/has not been read yet/i.test(t)) return 'not-read-gate';
  if (/String to replace not found|old_string.*not found|not found in file/i.test(t)) return 'string-not-found';
  if (/Found \d+ matches of the string/i.test(t)) return 'ambiguous-anchor';
  if (/modified since read|has been modified/i.test(t)) return 'stale-file';
  if (/No changes to make|identical/i.test(t)) return 'no-op';
  if (/InputValidationError|could not be parsed as JSON/i.test(t)) return 'malformed-json';
  if (/File does not exist|ENOENT|no such file/i.test(t)) return 'wrong-path';
  if (/<tool_use_error>|^Error/i.test(t)) return 'other-error';
  return null;
}
export function classifySsError(txt) {
  const t = String(txt || '');
  if (/\[ss-\*\] crash:/.test(t)) return 'crash';
  if (/(^Usage: ss-[a-z]+|\[ss\] unrecognised option|\[ss\] \d+ argument\(s\) not consumed)/m.test(t)) return 'usage';
  if (/\[ss-read\] error:/.test(t)) return 'read-error';
  if (/\[ss-\*\] no Sweet Search index/.test(t)) return 'no-index';
  if (/\[ss-search\] (server error|warm server is not ready)/.test(t)) return 'server-error';
  if (/Command timed out|Command was killed/.test(t)) return 'timeout';
  if (/^\(no matches\)$/m.test(t)) return 'no-matches';
  return null;
}

// Parse one transcript into an ordered list of served requests.
export function parseRequests(file) {
  const recs = jl(file);
  const byId = new Map(); const order = [];
  const toolUseOwner = new Map();   // tool_use id -> request key
  let cwd = null; let prompt = null; let version = null;
  const userTextBytesAfter = new Map(); // request key -> bytes of non-tool_result user text delivered after it
  let lastKey = null;
  for (const d of recs) {
    if (d.cwd && !cwd) cwd = d.cwd;
    if (d.version && !version) version = d.version;
    const m = d.message;
    if (d.type === 'assistant' && m && m.id) {
      const key = m.id;
      let g = byId.get(key);
      if (!g) {
        g = { key, requestId: d.requestId || null, ts: d.timestamp || null, blocks: [], seen: new Set(), usage: null, best: -1, isSidechain: !!d.isSidechain };
        byId.set(key, g); order.push(key);
      }
      for (const b of (m.content || [])) {
        const k = b.type === 'tool_use' ? `tu:${b.id}` : `${b.type}:${String(b.text ?? b.thinking ?? b.data ?? '').slice(0, 200)}`;
        if (g.seen.has(k)) continue; g.seen.add(k);
        g.blocks.push(b);
        if (b.type === 'tool_use') toolUseOwner.set(b.id, key);
      }
      const u = m.usage;
      if (u) {
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0, inU = u.input_tokens || 0, out = u.output_tokens || 0;
        if (inU + cr + cw + out > g.best) { g.best = inU + cr + cw + out; g.usage = { inUncached: inU, cw, cr, out, totalIn: inU + cr + cw }; }
      }
      lastKey = key;
      continue;
    }
    if (d.type === 'user' && m) {
      const c = m.content;
      if (typeof c === 'string') { if (prompt === null) prompt = c; else if (lastKey) userTextBytesAfter.set(lastKey, (userTextBytesAfter.get(lastKey) || 0) + c.length); continue; }
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === 'tool_result') {
          const owner = toolUseOwner.get(b.tool_use_id);
          const cc = b.content;
          const txt = typeof cc === 'string' ? cc : Array.isArray(cc) ? cc.map(x => x.text || '').join('\n') : JSON.stringify(cc ?? '');
          const g = owner ? byId.get(owner) : null;
          if (g) {
            g.results ??= [];
            g.results.push({ id: b.tool_use_id, text: txt, bytes: txt.length, isError: !!b.is_error, structured: d.toolUseResult ?? null, ts: d.timestamp || null });
          }
        } else if (b.type === 'text' && lastKey) {
          userTextBytesAfter.set(lastKey, (userTextBytesAfter.get(lastKey) || 0) + String(b.text || '').length);
        }
      }
    }
  }
  const requests = [];
  let idx = 0; let noUsage = 0;
  for (const key of order) {
    const g = byId.get(key);
    if (!g.usage) { noUsage++; continue; }
    const calls = [];
    let textLen = 0, thinkingLen = 0, redacted = 0, toolInputChars = 0;
    for (const b of g.blocks) {
      if (b.type === 'text') textLen += String(b.text || '').length;
      else if (b.type === 'thinking') thinkingLen += String(b.thinking || '').length;
      else if (b.type === 'redacted_thinking') redacted++;
      else if (b.type === 'tool_use') {
        const input = b.input || {};
        toolInputChars += JSON.stringify(input).length;
        const r = (g.results || []).find(x => x.id === b.id) || null;
        calls.push({ id: b.id, name: b.name, input, result: r ? r.text : null, resultBytes: r ? r.bytes : 0, isError: r ? r.isError : null, structured: r ? r.structured : null });
      }
    }
    requests.push({ idx: idx++, key, requestId: g.requestId, ts: g.ts, usage: g.usage, calls, textLen, thinkingLen, redactedBlocks: redacted, toolInputChars,
      resultBytes: calls.reduce((a, c) => a + (c.resultBytes || 0), 0), userTextBytes: userTextBytesAfter.get(key) || 0, realUsd: priceReal(g.usage) });
  }
  // ideal pricing and ingest per request
  let prevIn = 0;
  for (const r of requests) {
    const ingest = Math.max(0, r.usage.totalIn - prevIn);
    r.ingest = ingest; r.resident = r.usage.totalIn - ingest;
    r.idealUsd = (ingest * PRICE_IDEAL.newIn + r.resident * PRICE_IDEAL.resident + r.usage.out * PRICE_IDEAL.out) / 1e6;
    r.rewrite = r.usage.totalIn < prevIn;
    prevIn = r.usage.totalIn;
  }
  return { file, cwd, version, prompt, requests, noUsage, totalReal: requests.reduce((a, r) => a + r.realUsd, 0), totalIdeal: requests.reduce((a, r) => a + r.idealUsd, 0) };
}

// Purpose of a request from its tool calls.
export function purposeOf(r, isLast) {
  if (!r.calls.length) return isLast ? 'final-answer' : 'text-only';
  const cats = r.calls.map(c => {
    if (c.name === 'Bash') return bashCategory(c.input.command);
    if (c.name === 'Read') return 'Read';
    if (c.name === 'Grep') return 'Grep';
    if (c.name === 'Glob') return 'Glob';
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) return (c.isError || classifyEditError(c.result)) ? 'edit-failed' : 'edit';
    if (['TodoWrite', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'ExitPlanMode', 'AskUserQuestion', 'LSP'].includes(c.name)) return 'meta:' + c.name;
    return 'other:' + c.name;
  });
  return [...new Set(cats)].join('+');
}

// Absolute path normalisation against the rollout cwd.
export function normPath(p, cwd) {
  if (!p) return p;
  let s = String(p).replace(/^['"]|['"]$/g, '');
  if (s.startsWith('/')) return path.normalize(s);
  if (s.startsWith('./')) s = s.slice(2);
  return cwd ? path.normalize(`${cwd.replace(/\/$/, '')}/${s}`) : s;
}

// Match each row of a cell to the transcript whose replayed realized main-thread cost equals
// the row's costRealizedMainOnlyUsd (6-decimal rounding), never "the largest file".
export function matchCell(runId, task, arm, rows) {
  const ts = transcriptsOf(runId, task, arm).map(t => ({ ...t, parsed: parseRequests(t.file) }));
  const out = [];
  for (const row of rows.filter(r => r.taskId === task && r.arm === arm).sort((a, b) => a.rep - b.rep)) {
    const target = row.costRealizedMainOnlyUsd ?? row.costRealizedUsd;
    let best = null, bestD = Infinity;
    for (const t of ts) {
      const d = Math.abs(t.parsed.totalReal - target);
      if (d < bestD) { bestD = d; best = t; }
    }
    const matched = best && bestD < 2e-6;
    let pick = best;
    if (!matched) { // fall back to the rep's own directory, largest transcript, and say so
      const same = ts.filter(t => t.rep === row.rep).sort((a, b) => b.size - a.size);
      pick = same[0] || best;
    }
    out.push({ row, transcript: pick, matchedByCost: !!matched, costDelta: pick ? pick.parsed.totalReal - target : null, candidates: ts.length });
  }
  return out;
}
