// DOCTRINE §10 — C-9's re-census, on POST-FIX data.
//
// The question is NOT "what is 70% coverage worth". It is: what edit failures REMAIN after
// C-1 shipped? C-1 removed the corrupted-anchor class (15.4% -> 0.0%, then 0 of 184).
// If the post-fix residual is near zero, C-9 is closed because C-1 ate it.
//
// So this splits every post-fix failed edit by CAUSE, and tests each failed anchor for
// gutter residue directly -- the C-1 signature -- rather than assuming it is gone.
//
// Read-only over both claude-code runs. No model.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = process.argv.slice(2);
if (!RUNS.length) RUNS.push('sb-claudecode-20260811', 'screen-v3-20260812');

const transcripts = root => {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
};

// --- the C-1 signature: did the agent quote a line-number gutter into its anchor? ---
// ss-read renders `N<TAB>`. Other renderings seen historically: `N| `, `N  ` (padded), `N: `.
const GUTTER = [
  [/^[ \t]*\d+\t/m, 'tab-gutter (ss-read shape)'],
  [/^[ \t]*\d+\s*\|/m, 'pipe-gutter'],
  [/^[ \t]*\d+ {2,}\S/m, 'padded-gutter'],
  [/^[ \t]*\d+: /m, 'colon-gutter'],
];
const gutterHit = s => { for (const [re, name] of GUTTER) if (re.test(s)) return name; return null; };

// --- cause classification, in the doctrine's vocabulary -------------------------
function cause(msg, oldStr, tool) {
  if (/File does not exist|no such file|ENOENT/i.test(msg)) return 'wrong-path';
  if (/EISDIR|is a directory/i.test(msg)) return 'wrong-path';
  if (/has not been read yet|Read the file first|must read/i.test(msg)) return 'unread-file';
  if (/File has been modified|modified since read|changed since/i.test(msg)) return 'stale-address';
  if (/Found \d+ matches|not unique|multiple/i.test(msg)) return 'sub-symbol-ambiguity';
  if (/old_string and new_string are exactly the same|No changes to make/i.test(msg)) return 'no-op-edit';
  if (/could not be parsed as JSON|InputValidationError/i.test(msg)) return 'malformed-call';
  if (/String to replace not found|not found in file/i.test(msg)) {
    return gutterHit(oldStr) ? 'ANCHOR-CORRUPTION' : 'stale-address';
  }
  return 'other';
}

// Can C-9 -- naming an enclosing symbol instead of quoting text -- plausibly fix this?
const C9_ADDRESSABLE = new Set(['stale-address', 'sub-symbol-ambiguity', 'ANCHOR-CORRUPTION']);

const grand = { byCause: new Map(), byArm: {}, gutter: [], all: [] };

for (const RUN of RUNS) {
  const root = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(root)) { console.log(`(skip ${RUN}: no agent-state)`); continue; }
  const fails = [];
  let editCalls = { native: 0, sweet: 0 };
  for (const f of transcripts(root)) {
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const byId = new Map();
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') {
          byId.set(b.id, { name: b.name, input: b.input });
          if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) editCalls[arm]++;
        }
        if (b.type === 'tool_result') {
          const txt = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
          if (!b.is_error && !/^Error|error:/i.test(txt)) continue;
          const call = byId.get(b.tool_use_id) || {};
          if (!/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name || '')) continue;
          const oldStr = call.input?.old_string ?? call.input?.edits?.[0]?.old_string ?? '';
          const c = cause(txt, String(oldStr), call.name);
          fails.push({ run: RUN, task, arm, tool: call.name, cause: c,
            gutter: gutterHit(String(oldStr)),
            file: String(call.input?.file_path || ''),
            oldStr: String(oldStr), msg: txt.slice(0, 120).replace(/\n/g, ' ') });
        }
      }
    }
  }
  console.log(`\n=== ${RUN} — POST-C-1 FAILED EDITS ===`);
  console.log(`edit-family calls: native ${editCalls.native}, sweet ${editCalls.sweet}`);
  console.log(`failed edits: ${fails.length}  (native ${fails.filter(f => f.arm === 'native').length}, sweet ${fails.filter(f => f.arm === 'sweet').length})\n`);
  const tab = new Map();
  for (const f of fails) {
    const k = `${f.cause}|${f.arm}`;
    tab.set(k, (tab.get(k) || 0) + 1);
    grand.byCause.set(f.cause, (grand.byCause.get(f.cause) || 0) + 1);
    if (f.gutter) grand.gutter.push(f);
    grand.all.push(f);
  }
  const causes = [...new Set(fails.map(f => f.cause))].sort();
  console.log(`  ${'cause'.padEnd(24)} native  sweet   C-9 can address?`);
  for (const c of causes) {
    console.log(`  ${c.padEnd(24)} ${String(tab.get(`${c}|native`) || 0).padStart(5)}  ${String(tab.get(`${c}|sweet`) || 0).padStart(5)}   ${C9_ADDRESSABLE.has(c) ? 'yes' : 'NO'}`);
  }
}

console.log('\n\n================ THE DOCTRINE QUESTION ================\n');
console.log('Q1. Is the C-1 anchor-corruption class absent from post-fix runs?\n');
if (!grand.gutter.length) {
  console.log(`    YES. ${grand.all.length} failed edits across both post-fix claude runs, and`);
  console.log(`    ZERO carry a line-number gutter in the failed anchor. Four gutter shapes were`);
  console.log(`    tested (tab, pipe, padded, colon), not just ss-read's own.`);
} else {
  console.log(`    NO. ${grand.gutter.length} of ${grand.all.length} failed anchors still carry gutter residue:`);
  for (const g of grand.gutter) console.log(`      ${g.run} ${g.arm} ${g.task} [${g.gutter}] ${g.oldStr.slice(0, 80).replace(/\n/g, '\\n')}`);
}

console.log('\nQ2. What is the post-fix residual, and how much of it can C-9 name?\n');
const addressable = grand.all.filter(f => C9_ADDRESSABLE.has(f.cause));
const swAddr = addressable.filter(f => f.arm === 'sweet');
console.log(`    total failed edits, both arms, both runs : ${grand.all.length}`);
console.log(`    C-9-addressable by cause                 : ${addressable.length}  (sweet ${swAddr.length})`);
console.log(`    NOT addressable (wrong path, no-op, malformed, unread) : ${grand.all.length - addressable.length}`);
console.log('');
for (const [c, n] of [...grand.byCause].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(3)}  ${c.padEnd(24)} ${C9_ADDRESSABLE.has(c) ? '-> C-9' : ''}`);
}

console.log('\nQ3. The error the doctrine names: scoring against the ORIGINAL 20 anchor failures.\n');
console.log(`    The original C-9 evidence base was 20 anchor failures on the PRE-C-1 run.`);
console.log(`    The post-fix anchor-derived residual (stale-address + ambiguity) is ${grand.all.filter(f => f.cause === 'stale-address' || f.cause === 'sub-symbol-ambiguity').length}.`);
console.log(`    Scoring C-9 against 20 rather than that number overstates it by`);
console.log(`    ${(20 / Math.max(1, grand.all.filter(f => f.cause === 'stale-address' || f.cause === 'sub-symbol-ambiguity').length)).toFixed(1)}x.`);

console.log('\n--- every post-fix failed edit, for audit ---');
for (const f of grand.all) {
  console.log(`  ${f.run.slice(0, 12).padEnd(12)} ${f.arm.padEnd(6)} ${f.cause.padEnd(22)} ${f.file.split('/').slice(-2).join('/').padEnd(28)} | ${f.msg.slice(0, 70)}`);
}
