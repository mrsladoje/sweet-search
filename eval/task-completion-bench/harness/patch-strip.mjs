// Grader-side stripping of agent edits that COLLIDE with the hidden test patch.
//
// WHY. eval.py grades by running, in this exact order (upstream-patches/eval.py,
// run_in_container), under `set -e`:
//     git reset --hard HEAD
//     git apply --3way ... /patches/patch.diff        <- the AGENT's patch
//     git apply --3way ... /patches/test_patch.diff   <- the HIDDEN test patch
//     <test commands>
// If the agent touched a file the hidden patch also touches, the second apply
// either reports "Applied ... with conflicts" and leaves unmerged paths, or fails
// outright — and `set -e` kills the script BEFORE a single test runs. The task then
// scores 0 on a merge mechanic, not on merit. That is what happened to
// redboltz__mqtt_cpp-239 (agent modified test/test_broker.hpp, which the hidden
// patch also modifies) and protofire__solhint-224 (agent CREATED
// test/fixtures/order/ordering-{correct,incorrect}.js at the same paths the hidden
// patch creates).
//
// RULE (narrow, collision-based — NOT a test-glob sweep). Before grading, drop
// from the agent's patch every `diff --git` block that touches a path the hidden
// test patch modifies, creates, deletes or renames. The rest of the agent's patch
// is kept and graded normally. Symmetric across arms by construction: it runs in
// the shared grading path and looks only at paths.
//
// WHY COLLISION AND NOT A TEST GLOB. Measured over the three current populations
// (heldout 200 + multilingual 200 + heldout-reserve 101 = 501 tasks):
//   - GOLD patches touching at least one test-glob path:  4/200 heldout, 2/200
//     multilingual, 2/101 reserve = 8/501 (1.6%). So a blanket "strip everything
//     under test/" would discard part of the LEGITIMATE fix surface on ~1 task in
//     60. Not acceptable as a default. Available behind SS_GRADE_STRIP_TEST_GLOBS=1,
//     default OFF.
//   - GOLD patches sharing ANY path with the hidden test patch: 0/501. The
//     collision rule therefore cannot discard a load-bearing fix on any task in
//     these populations — the two patches are disjoint by construction.
//
// WHY NON-TEST COLLISIONS ARE STRIPPED TOO. Hidden test patches do sometimes touch
// paths that are not test-glob-shaped (21/480 files in heldout, incl. a real source
// file: Sources/MapboxDirections/RouteStep.swift in the reserve set). The rule is
// applied there as well, deliberately: whatever the hidden patch writes to a file
// is the authoritative graded state of that file, so an agent edit to the same path
// is either destroyed by the merge or destroys the grade. Stripping makes the
// outcome deterministic instead of order-dependent, and the 0/501 gold overlap says
// it never costs a real fix.
//
// Kill switch: SS_GRADE_STRIP_COLLISIONS=0 restores the pre-2026-07-30 behavior
// (model_patch passed through verbatim) for re-grading frozen evidence bit-exactly.

/** Default-on; `SS_GRADE_STRIP_COLLISIONS=0` turns the mechanism off. */
export const STRIP_COLLISIONS_ON = process.env.SS_GRADE_STRIP_COLLISIONS !== '0';
/** Default-OFF broad mode: also strip agent blocks whose paths look test-shaped. */
export const STRIP_TEST_GLOBS_ON = process.env.SS_GRADE_STRIP_TEST_GLOBS === '1';

// Only consulted when STRIP_TEST_GLOBS_ON. Deliberately not used by the default path.
export const TEST_GLOB_RE = new RegExp([
  '(^|/)(tests?|spec|specs|__tests__|testdata|test_data|fixtures?|e2e)(/|$)',
  '(^|/)[^/]*[._-](test|spec)s?\\.[A-Za-z0-9]+$',
  '(^|/)test_[^/]*$',
].join('|'), 'i');

/** Unquote a git path (`"a/x\ty"` → `a/x\ty`) and drop the a/ or b/ prefix. */
function normalizePath(raw) {
  let p = String(raw || '').trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] ?? c));
  }
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p || null;
}

/**
 * Split a unified diff into its `diff --git` blocks, preserving bytes exactly:
 * `preamble + blocks.join('')` reconstructs the input.
 */
export function splitDiffBlocks(patch) {
  const text = String(patch || '');
  if (!text) return { preamble: '', blocks: [] };
  const re = /^diff --git .*$/gm;
  const starts = [];
  let m;
  while ((m = re.exec(text)) !== null) starts.push(m.index);
  if (!starts.length) return { preamble: text, blocks: [] };
  const preamble = text.slice(0, starts[0]);
  const blocks = starts.map((s, i) => text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length));
  return { preamble, blocks };
}

/**
 * Every repo-relative path one diff block touches: both sides of the `---`/`+++`
 * headers, `rename from`/`rename to`, and — as a fallback for header-less blocks
 * (pure mode changes, empty new files) — the `diff --git` line itself.
 */
export function blockPaths(block) {
  const text = String(block || '');
  const paths = new Set();
  const add = (raw) => { const p = normalizePath(raw); if (p) paths.add(p); };

  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) add(line.slice(4));
    else if (line.startsWith('+++ ')) add(line.slice(4));
    else if (line.startsWith('rename from ')) add(line.slice(12));
    else if (line.startsWith('rename to ')) add(line.slice(10));
    else if (line.startsWith('@@')) break;   // headers are done; hunk bodies can contain +++/---
  }
  if (paths.size) return paths;

  // Fallback: `diff --git a/P b/P`. Paths may contain spaces, so split on the LAST
  // ` b/` — correct whenever the two sides share a prefix, which git guarantees for
  // non-rename blocks and which renames already handled above.
  const head = text.match(/^diff --git (.*)$/m);
  if (head) {
    const rest = head[1];
    const cut = rest.lastIndexOf(' b/');
    if (cut > 0) { add(rest.slice(0, cut)); add(rest.slice(cut + 1)); }
  }
  return paths;
}

/** Union of every path a whole patch touches. */
export function patchPaths(patch) {
  const out = new Set();
  for (const block of splitDiffBlocks(patch).blocks) for (const p of blockPaths(block)) out.add(p);
  return out;
}

/**
 * Strip from `modelPatch` every block colliding with `testPatch`.
 * @returns {{patch:string, stripped:string[], reasons:Record<string,string>}}
 *   `patch` is byte-identical to the input when nothing is stripped; it can be ''
 *   when everything is stripped (graded as the ordinary zero-hunk case).
 */
export function stripCollidingPaths(modelPatch, testPatch, opts = {}) {
  const enabled = opts.enabled ?? STRIP_COLLISIONS_ON;
  const testGlobs = opts.testGlobs ?? STRIP_TEST_GLOBS_ON;
  const original = String(modelPatch || '');
  if (!enabled || !original) return { patch: original, stripped: [], reasons: {} };

  const collide = patchPaths(testPatch);
  if (!collide.size && !testGlobs) return { patch: original, stripped: [], reasons: {} };

  const { preamble, blocks } = splitDiffBlocks(original);
  const kept = [];
  const reasons = {};
  for (const block of blocks) {
    const paths = [...blockPaths(block)];
    const hits = paths.filter(p => collide.has(p));
    const globHits = testGlobs ? paths.filter(p => !collide.has(p) && TEST_GLOB_RE.test(p)) : [];
    if (!hits.length && !globHits.length) { kept.push(block); continue; }
    for (const p of hits) reasons[p] = 'collides-with-hidden-test-patch';
    for (const p of globHits) reasons[p] = 'test-glob';
  }
  const stripped = Object.keys(reasons).sort();
  if (!stripped.length) return { patch: original, stripped: [], reasons: {} };
  return { patch: preamble + kept.join(''), stripped, reasons };
}
