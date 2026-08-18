#!/usr/bin/env node
// GENERAL CLAUSES — the cheap alternative to building any analyzer at all.
//
// The hint ladder asks whether a per-task certificate raises resolution. This asks a harsher
// question: is the certificate even necessary? Each of the three per-task certificates the
// ladder delivers is an instance of a rule that can be stated once, in general, for every
// task — and a general rule costs nothing to ship, needs no parser, no language front end,
// and no per-project semantics, which is exactly what falsifier 3 killed P4's checker on.
//
// If a general clause flips the same target the certificate flips, the analyzer program is
// redundant. If the certificate flips it and the clause does not, the gap between them is
// the real value of building the tool, and it is measurable rather than asserted.
//
// Every clause below is written to be true of any repository. No file name, no symbol, no
// language, nothing bench-specific — so a win here is a product change, not a benchmark fit.
// They go to BOTH arms through the issue text, which keeps this a clean test of the rule
// rather than of sweet's retrieval.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const CLAUSES = {
  // Generalises the NimbleOptions residue certificate.
  G1: `FAMILY COMPLETENESS. If your change adds a member to a family that already exists in
this codebase — one more type, option, flag, error kind, enum case, event, or variant — then
before you edit, find the nearest existing member of that family and list EVERY site where
its name appears. Your change must touch the same set of sites. Registration lists,
validation or dispatch clauses, type declarations and user-facing documentation are each
separate sites, and a new member present at fewer of them than its neighbours is silently
unsupported rather than partly supported.`,

  // Generalises the CodeceptJS public-surface certificate.
  G2: `PUBLIC SURFACE AND EXISTING VOCABULARY. If your change adds something callers will use,
decide two things from the code rather than from the issue text. First, WHERE public members
of that kind are attached in this project, and attach yours the same way — a member added to
a different object, module or layer than its neighbours is not on the public surface even
when it works. Second, WHAT this project already calls the concept: search for an existing
function or module that does the same job internally and reuse its name. An issue reporter
proposing a name is describing a need, not specifying the API; the project's own vocabulary
wins.`,

  // Generalises the Apple mirror/sibling certificate.
  G3: `SYMMETRY AND SIBLINGS. Before you finish, check whether the thing you changed has a
twin or siblings: a send/receive, read/write, encode/decode or get/set counterpart, or a set
of states, cases or branches that the surrounding code treats alike. If the rule you just
applied holds for the twin or for a sibling, apply it there too in the same change. A
one-sided edit to a symmetric structure is the most common way a correct diagnosis turns
into an incomplete fix.`,
  // Added after the first clause screen, which isolated a failure the other three do not
  // touch. On NimbleOptions the exact three-site patch SOLVES; two of the three rollouts
  // that produced it then added a fourth hunk rewriting the error-message generator to keep
  // `:integer` out of an existing list, and broke a test. The same shape cost three of four
  // rollouts at L1. The models are not under-reaching, they are defending code nobody asked
  // them to defend.
  G4: `MINIMAL CHANGE. Make the change the issue asks for and stop. Do not also adjust
neighbouring code to keep existing output, messages or lists looking the way they did before
— that is a guess about what the rest of the system expects, and a wrong guess there breaks
a test your actual change would have passed. If some existing behaviour genuinely must adapt,
let a failing test tell you so first, then adapt only what that test names.`,
};

export const COMBOS = {
  G1: ['G1'], G2: ['G2'], G3: ['G3'], G4: ['G4'],
  GALL: ['G1', 'G2', 'G3'], G14: ['G1', 'G4'],
};

const HEAD = '\n\n=== ENGINEERING CHECKS (apply to any change you make) ===\n';

export function buildTasks(specs, combo) {
  const text = COMBOS[combo].map(k => CLAUSES[k]).join('\n\n');
  return specs.map(t => ({ ...t, problem_statement: `${t.problem_statement || ''}${HEAD}${text}\n` }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.env.SRC
    || '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json';
  const out = process.env.OUT_DIR || '/root/hint-ladder';
  const specs = JSON.parse(readFileSync(src, 'utf8'));
  mkdirSync(out, { recursive: true });
  for (const c of Object.keys(COMBOS)) {
    writeFileSync(path.join(out, `tasks-${c}.json`), JSON.stringify(buildTasks(specs, c), null, 1));
    console.log(`${c.padEnd(5)} ${COMBOS[c].join('+').padEnd(10)} `
      + `${COMBOS[c].reduce((a, k) => a + CLAUSES[k].length, 0)} chars appended to all ${specs.length} tasks`);
  }
}
