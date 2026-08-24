// NAME-LOCK detection — is a task gated on GUESSING an identifier the maintainer chose?
//
// THE PROBLEM. The hint ladder (HINT-LADDER-RESULTS.md) produced a result no candidate in
// the slate can act on: two of five chronically-unsolved targets flip at NO hint level, a
// full prose specification of the required behaviour included. Their hidden tests import a
// symbol, or a module path, that the reference patch INVENTED:
//
//   bingo-274   packages/bingo-fs/src/isFile.test.ts  ->  import { isFile } from "./isFile.js"
//   http-1114   pkgs/http/test/response_test.dart     ->  response.headersSplitValues
//
// Nothing in either base tree suggests those names. An agent that produces a functionally
// identical fix under any other name FAILS, and no analyzer, index, ranking change or
// certificate can close that gap. Such a task measures a coin flip. Its contribution to any
// candidate's ceiling arithmetic is fiction, and its contribution to a head-to-head is noise
// that no amount of reps removes — a 20x-larger backbone buys 0/10 on one of them.
//
// THE RULE. Locked = the hidden test names the identifier, AND the reference fix introduces
// it, AND the base tree has never heard of it, AND the issue text does not spell it out. The
// last clause is what separates a real lock from a spelled-out request: gradethis-161 solves
// 2/2 everywhere and still shows an invented identifier, because the issue hands it over.
//
// WHERE THIS MAY RUN. It reads GOLD — `test_patch` and `patch` — so it is an analysis OF the
// benchmark and never a product input, and it must never run inside a rollout. It belongs at
// RECRUITMENT, before the seeded draw, where gold is legitimately in scope and where a
// materialized base tree is available. Downstream consumers read the STAMPED `name_locked`
// field instead, which keeps the run-time gate metadata-only and outcome-blind.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['.git', 'node_modules', 'vendor', 'target', 'build', 'dist', '.build',
  'Pods', '__pycache__', 'deps', '_build', 'third_party']);
const IDENT = /\b([A-Za-z_][A-Za-z0-9_]{3,})\b/g;

// Words that carry no ownership: language keywords, test-framework vocabulary, and the
// generic English a test comment is written in. A name-lock claim must survive these being
// removed, or every task looks locked.
export const NOISE = new Set(`
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

/**
 * Every identifier that occurs anywhere in the base checkout. DELIBERATELY GENEROUS: an
 * identifier the agent could have SEEN, under any spelling, in any file, is not "invented",
 * and over-generosity here can only ever make a lock claim harder to sustain.
 */
export function baseVocabulary(dir) {
  const v = new Set();
  for (const f of walk(dir)) {
    let st; try { st = statSync(f); } catch { continue; }
    if (st.size > 1024 * 1024) continue;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(IDENT)) v.add(m[1]);
    // A file's own name is part of the vocabulary too — `isModeExecutable.ts` teaches the
    // `is<Thing>` convention even if the symbol never appears in prose.
    v.add(path.basename(f).replace(/\.[^.]+$/, ''));
  }
  return v;
}

const addedLines = (diff) => String(diff || '').split('\n').filter(l => /^\+[^+]/.test(l)).map(l => l.slice(1));
const identsIn = (lines) => {
  const s = new Set();
  for (const l of lines) for (const m of l.matchAll(IDENT)) if (!NOISE.has(m[1])) s.add(m[1]);
  return s;
};
// A one-word English noun is not an API name. Require a compound shape — camelCase,
// snake_case, or a leading capital — so "comma" and "declared" stop counting as locks.
const looksLikeApiName = (i) => /[a-z][A-Z]|_/.test(i) || /^[A-Z]/.test(i);

/**
 * The name-lock verdict for one task against its materialized base tree.
 * @returns {{locked:string[], relImports:string[], newTestFiles:number, nameLocked:boolean}}
 */
export function nameLockFor(task, baseDir, { vocabulary = null } = {}) {
  const vocab = vocabulary || baseVocabulary(baseDir);
  const testIdents = identsIn(addedLines(task.test_patch));
  const fixIdents = identsIn(addedLines(task.patch));
  const issueText = String(task.problem_statement || '');
  const locked = [...testIdents].filter(i => fixIdents.has(i) && !vocab.has(i)
    && looksLikeApiName(i) && !issueText.includes(i));
  // Module paths the hidden tests import relatively — these are FILE names the agent must
  // choose exactly, which is a stronger lock than a symbol inside an existing file.
  const relImports = [...new Set([...String(task.test_patch || '')
    .matchAll(/^\+.*?from\s+["'](\.\/[^"']+)["']/gm)].map(m => m[1]))];
  const newTestFiles = [...String(task.test_patch || '').matchAll(/^diff --git a\/(\S+)/gm)].length;
  return { locked, relImports, newTestFiles, nameLocked: locked.length > 0 };
}

/** Directory convention for a materialized base tree. */
export const goldenDirFor = (goldenRoot, task) =>
  path.join(goldenRoot, `${String(task.repo).replace('/', '__')}@${task.base_commit}`);

/**
 * Census over a pool. Tasks whose base tree is not materialized are reported as `missing`
 * and are NOT stamped — an absent checkout is an unknown, never a clean bill of health.
 */
export function nameLockCensus(tasks, goldenRoot) {
  const rows = [];
  for (const t of tasks) {
    const dir = goldenDirFor(goldenRoot, t);
    if (!existsSync(dir)) { rows.push({ id: t.instance_id, lang: t.language, missing: true }); continue; }
    rows.push({ id: t.instance_id, lang: t.language, missing: false, ...nameLockFor(t, dir) });
  }
  const examined = rows.filter(r => !r.missing);
  return {
    rows,
    examined: examined.length,
    missing: rows.length - examined.length,
    locked: examined.filter(r => r.nameLocked).length,
    lockedIds: examined.filter(r => r.nameLocked).map(r => r.id),
  };
}
