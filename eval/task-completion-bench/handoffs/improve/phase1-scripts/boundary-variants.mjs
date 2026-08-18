#!/usr/bin/env node
// M± boundary variants — repair two claims the shipped prompt makes that are false at the
// edge of the index.
//
// The production guide tells the agent, verbatim:
//
//   "Use the `ss-*` tools for all code search and navigation ... otherwise the index covers
//    every file, so a raw scan only re-confirms an `ss-*` result at higher cost, never beats it."
//   "Two empty index probes over the whole codebase are more conclusive than any raw scan or
//    file listing, so state the negative and stop searching: ... no native scan."
//
// Both are true inside the working tree and false outside it. Together they forbid the exact
// move native makes three times more often than sweet: going and reading the installed
// dependency. The recorded census is native 17/102 rollouts against sweet 6/102, and the P1
// gate concluded that supply was never the problem — demand was.
//
// So this is not a new capability. It is a correctness fix to a scope claim, and it costs
// three sentences. If it works, `ss-deps` has to beat it to justify being built at all.
//
// THE LADDER. Each rung repairs one more thing, so a win can be attributed:
//   B1  name the boundary. Does knowing the index ends somewhere suffice?
//   B2  B1 + repair the absence rule, which otherwise still forbids the raw scan B1 implies.
//   B3  B2 + resolve an external blind spot before choosing, hooked onto the `<state_summary>`
//       block the prompt already emits.
//
// Everything else in the file stays byte-identical, so a difference between arms is these
// sentences and nothing else.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SRC = process.env.MPP_SRC
  || '/root/sweet-search-private/core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';
const OUT = process.env.OUT_DIR || '/root/hint-ladder/mpp';

// ---------------------------------------------------------------- the exact spans replaced

const COVERAGE_OLD =
  'Sweet-search indexes the working tree (uncommitted edits too) and searches it faster and cheaper than raw shell. Use the `ss-*` tools for all code search and navigation.';

const COVERAGE_B1 =
  'Sweet-search indexes this project\'s working tree (uncommitted edits too) and searches it faster and cheaper than raw shell. Use the `ss-*` tools for all code search and navigation within it. The index stops at the project boundary: installed dependencies, vendored third-party sources and generated output are not in it, so an `ss-*` search coming back empty over one of those says nothing about whether the code exists.';

const COVERAGE_B2 = COVERAGE_B1
  + ' Read code that lives outside the project with the ordinary shell tools instead.';

const ABSENCE_OLD =
  'Two empty index probes over the whole codebase are more conclusive than any raw scan or file listing, so state the negative and stop searching: no third synonym, no `find`/`ls`/`cat` enumeration, no native scan.';

const ABSENCE_B2 = ABSENCE_OLD
  + ' That settles absence only for code the index covers. When the thing you need would live outside the project — inside an installed dependency, a vendored tree or generated output — two empty index probes settle nothing, and a raw `grep`/`find` over that tree is the correct next step rather than a wasted one.';

const ESCROW_OLD =
  'output a `<state_summary>` block with exactly: (1) one sentence on what you\'ve established, (2) one sentence on your current blind spot.';

const ESCROW_B3 = ESCROW_OLD
  + ' If that blind spot is a fact defined outside this project — a dependency\'s contract, a generated artifact, a third-party behaviour — read that code and resolve it before you choose an implementation. Guessing a contract you could have read is the most expensive guess available to you.';

// ------------------------------------------------------------------------------- variants

// Left alone, the original paragraph goes on to say "the index covers every file" a clause
// later — which now contradicts the boundary sentence we just added. A prompt that argues
// with itself is a confound, not a treatment, so every variant repairs it too.
const EVERYFILE_OLD = 'otherwise the index covers every file,';
const EVERYFILE_NEW = 'otherwise the index covers every project file,';

const VARIANTS = {
  B1: [[COVERAGE_OLD, COVERAGE_B1], [EVERYFILE_OLD, EVERYFILE_NEW]],
  B2: [[COVERAGE_OLD, COVERAGE_B2], [EVERYFILE_OLD, EVERYFILE_NEW], [ABSENCE_OLD, ABSENCE_B2]],
  B3: [[COVERAGE_OLD, COVERAGE_B2], [EVERYFILE_OLD, EVERYFILE_NEW], [ABSENCE_OLD, ABSENCE_B2], [ESCROW_OLD, ESCROW_B3]],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = readFileSync(SRC, 'utf8');
  mkdirSync(OUT, { recursive: true });
  for (const [name, edits] of Object.entries(VARIANTS)) {
    let text = base;
    for (const [from, to] of edits) {
      if (!text.includes(from)) { console.error(`${name}: SPAN NOT FOUND — ${from.slice(0, 60)}...`); process.exit(1); }
      text = text.replace(from, to);
    }
    const f = path.join(OUT, `mpp-${name}.md`);
    writeFileSync(f, text);
    console.log(`${name}  ${text.length - base.length > 0 ? '+' : ''}${text.length - base.length} chars  ${edits.length} span(s)  → ${f}`);
  }
  writeFileSync(path.join(OUT, 'mpp-B0.md'), base);
  console.log(`B0  +0 chars  0 span(s)  → ${path.join(OUT, 'mpp-B0.md')}  (production, unchanged control)`);
}
