#!/usr/bin/env node
// NAME-LOCK CENSUS — which tasks are gated on guessing an identifier the maintainer chose?
//
// The hint ladder produced a result no candidate in the slate can act on. Two of the five
// chronically-unsolved targets flip at NO level, including a full prose specification of the
// required behaviour, and reading their hidden tests explains why: the tests import a symbol,
// or a module path, that the reference patch invented.
//
//   bingo-274   packages/bingo-fs/src/isFile.test.ts  ->  import { isFile } from "./isFile.js"
//   http-1114   pkgs/http/test/response_test.dart     ->  response.headersSplitValues
//
// Nothing in either base tree suggests those names. An agent that produces a functionally
// identical fix under any other name fails, and no analyzer, index, ranking change or
// certificate can close that gap. A task like this measures a coin flip, and its ceiling in
// any candidate's arithmetic is fiction.
//
// So: for every task, extract the identifiers its hidden tests reference, keep the ones the
// reference patch ADDS, and ask whether each appears anywhere in the base tree. A task with
// at least one added-and-absent identifier is NAME-LOCKED.
//
// This reads gold (test_patch and patch) and is an analysis OF the benchmark, never a product
// input. It costs $0 and no model call.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const TASKS = process.env.TASKS_FILE || path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json');

const SKIP = new Set(['.git', 'node_modules', 'vendor', 'target', 'build', 'dist', '.build', 'Pods', '__pycache__', 'deps', '_build', 'third_party']);
const IDENT = /\b([A-Za-z_][A-Za-z0-9_]{3,})\b/g;

// Words that carry no ownership: language keywords, test-framework vocabulary, and the
// generic English a test comment is written in. A name-lock claim must survive these being
// removed, or every task looks locked.
const NOISE = new Set(`
import from export const let var function return class extends implements interface type
public private protected static async await yield new this super null true false undefined
void string number boolean object symbol never unknown any then catch finally throw delete
describe context test expect assert should suite before after beforeEach afterEach setUp
tearDown it_ vitest jest mocha chai pytest unittest XCTest testCase given when where
require module exports default package namespace using include define end def do begin
struct enum case switch match while for each break continue if else elif unless
value values key keys item items list array map set dict result results data input output
name names path paths file files line lines text error errors message messages type types
self cls args kwargs options opts config params param arg other actual expected
`.trim().split(/\s+/));

function* walk(dir, d = 0) {
  if (d > 10) return;
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { yield* walk(p, d + 1); continue; }
    if (e.isFile()) yield p;
  }
}

// Every identifier that occurs anywhere in the base checkout. Deliberately generous: an
// identifier the agent could have SEEN, under any spelling, in any file, is not "invented".
function baseVocabulary(dir) {
  const v = new Set();
  for (const f of walk(dir)) {
    let st; try { st = statSync(f); } catch { continue; }
    if (st.size > 1024 * 1024) continue;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    IDENT.lastIndex = 0;
    for (const m of text.matchAll(IDENT)) v.add(m[1]);
    // a file's own name is part of the vocabulary too — `isModeExecutable.ts` teaches the
    // `is<Thing>` convention even if the symbol never appears in prose
    v.add(path.basename(f).replace(/\.[^.]+$/, ''));
  }
  return v;
}

const addedLines = (diff) => String(diff || '').split('\n').filter(l => /^\+[^+]/.test(l)).map(l => l.slice(1));
const identsIn = (lines) => {
  const s = new Set();
  for (const l of lines) { IDENT.lastIndex = 0; for (const m of l.matchAll(IDENT)) if (!NOISE.has(m[1])) s.add(m[1]); }
  return s;
};

const tasks = JSON.parse(readFileSync(TASKS, 'utf8'));
const rows = [];
for (const t of tasks) {
  const dir = path.join(GOLDEN, `${t.repo.replace('/', '__')}@${t.base_commit}`);
  if (!existsSync(dir)) { rows.push({ id: t.instance_id, missing: true }); continue; }
  const vocab = baseVocabulary(dir);
  const testIdents = identsIn(addedLines(t.test_patch));
  const fixIdents = identsIn(addedLines(t.patch));
  // Locked = the hidden test names it, the reference fix introduces it, the base tree has
  // never heard of it, AND THE ISSUE DOES NOT NAME IT EITHER. The last clause is what
  // separates a real lock from a spelled-out request: gradethis solves 2/2 everywhere and
  // still shows an invented identifier, because the issue text hands it to the agent.
  const issueText = String(t.problem_statement || '');
  // A one-word English noun is not an API name. Require a compound shape — camelCase,
  // snake_case, or a leading capital — so "comma" and "declared" stop counting as locks.
  const looksLikeApiName = (i) => /[a-z][A-Z]|_/.test(i) || /^[A-Z]/.test(i);
  const locked = [...testIdents].filter(i => fixIdents.has(i) && !vocab.has(i)
    && looksLikeApiName(i) && !issueText.includes(i));
  // Module paths the hidden tests import relatively — these are file names the agent must
  // choose exactly, which is a stronger lock than a symbol inside an existing file.
  const relImports = [...String(t.test_patch || '').matchAll(/^\+.*?from\s+["'](\.\/[^"']+)["']/gm)].map(m => m[1]);
  const newTestFiles = [...String(t.test_patch || '').matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]);
  rows.push({
    id: t.instance_id, lang: t.language, locked, relImports: [...new Set(relImports)],
    testFiles: newTestFiles.length, f2p: (t.FAIL_TO_PASS || []).length,
  });
}

const w = (s, n) => String(s).padEnd(n);
console.log(w('task', 42) + w('lang', 8) + w('locked', 8) + 'identifiers the hidden test needs and the base tree never mentions');
for (const r of rows) {
  if (r.missing) { console.log(w(r.id, 42) + 'golden checkout absent'); continue; }
  console.log(w(r.id, 42) + w(r.lang, 8) + w(r.locked.length ? 'YES' : '-', 8) + r.locked.slice(0, 8).join(' '));
}
const live = rows.filter(r => !r.missing);
console.log(`\ntasks examined                         ${live.length}`);
console.log(`name-locked (>=1 invented identifier)  ${live.filter(r => r.locked.length).length}`);
console.log(`  of which the test imports it by relative module path (the file name is locked too):`);
for (const r of live.filter(r => r.locked.length && r.relImports.length)) {
  console.log(`    ${w(r.id, 40)} ${r.relImports.join(' ')}`);
}
