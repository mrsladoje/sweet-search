#!/usr/bin/env node
// Round 2 of the boundary variants. Round 1 failed and the exposure check said why: three
// progressively stronger sentences produced 0 raw-tool calls in 54 rollouts, against native's
// 18/18. They described an abstract CATEGORY ("installed dependencies, vendored sources,
// generated output") and never named an action, a path, or a trigger — the only vague prose
// in a guide that is otherwise relentlessly concrete.
//
// These three are shorter than what they replace and each ends in something executable.
//
//   V1  the boundary sentence, rewritten to end in a verb with a trigger.
//   V2  V1 + a THREE-WORD scope fix to the absence rule, which currently answers V1's own
//       trigger ("ss-* came back empty") with "no native scan". That prohibition beat three
//       permission sentences 18/18; if it is the binding constraint, only V2 can fire.
//   V3  V1 + a trigger bullet in the section that already tells the agent which tool to open
//       with, written in that section's voice and naming the actual directories.
//
// The prohibitions stay in all three. The failure was never that the agent was blocked — it
// never recognised it was in the situation.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SRC = process.env.MPP_SRC
  || '/root/sweet-search-private/core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';
const OUT = process.env.OUT_DIR || '/root/hint-ladder/mpp';

const COVERAGE_OLD =
  'Sweet-search indexes the working tree (uncommitted edits too) and searches it faster and cheaper than raw shell. Use the `ss-*` tools for all code search and navigation.';
const COVERAGE_NEW = COVERAGE_OLD
  + ' The index doesn\'t contain installed deps, vendored 3rd-party sources or generated output, so if `ss-*` comes back empty, retry with raw `grep`/`find` if you think it exists.';

const EVERYFILE_OLD = 'otherwise the index covers every file,';
const EVERYFILE_NEW = 'otherwise the index covers every project file,';

// Three words. The rule keeps all of its force over the code the index actually holds.
const ABSENCE_OLD = 'Two empty index probes over the whole codebase are more conclusive';
const ABSENCE_NEW = 'Two empty index probes over project code are more conclusive';

// Inserted as a fourth bullet in "Open with the cheapest tool for what you hold", in that
// section's own shape: a situation you can recognise, then one command.
const BULLET_ANCHOR = '\n\nOn `sufficient=YES`, trust the top ranked result outright;';
const BULLET_NEW = '\n- **An imported name that is not in this project** (a library function, a framework hook, a decorator you did not write): it lives in an installed dependency, which is not indexed — one `grep -rn` under the dependency root (`node_modules/`, `.venv/`, `vendor/`, `site-packages/`).'
  + BULLET_ANCHOR;

const VARIANTS = {
  V1: [[COVERAGE_OLD, COVERAGE_NEW], [EVERYFILE_OLD, EVERYFILE_NEW]],
  V2: [[COVERAGE_OLD, COVERAGE_NEW], [EVERYFILE_OLD, EVERYFILE_NEW], [ABSENCE_OLD, ABSENCE_NEW]],
  V3: [[COVERAGE_OLD, COVERAGE_NEW], [EVERYFILE_OLD, EVERYFILE_NEW], [BULLET_ANCHOR, BULLET_NEW]],
};

const base = readFileSync(SRC, 'utf8');
mkdirSync(OUT, { recursive: true });
for (const [name, edits] of Object.entries(VARIANTS)) {
  let text = base;
  for (const [from, to] of edits) {
    if (!text.includes(from)) { console.error(`${name}: SPAN NOT FOUND — ${from.slice(0, 70)}`); process.exit(1); }
    text = text.replace(from, to);
  }
  const f = path.join(OUT, `mpp-${name}.md`);
  writeFileSync(f, text);
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  console.log(`${name}  +${words(text) - words(base)} words  ${edits.length} span(s)  → ${f}`);
}
