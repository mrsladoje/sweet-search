#!/usr/bin/env node
// Build the sweet MEMORY-FILE variants for the clause screen.
//
// The ladder appended the clauses to `problem_statement`, which reaches BOTH arms. That
// answered "does the rule help anyone". This appends them to the MPP file instead, which
// `agent-runner-shared.mjs` writes into AGENTS.md / CLAUDE.md only when `sweet` is true —
// the same channel `ss init` ships to a real user. Everything else in the file is
// byte-identical, so a difference between conditions is these clauses and nothing else.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CLAUSES, COMBOS } from './general-clauses.mjs';

const SRC = process.env.MPP_SRC
  || '/root/sweet-search-private/eval/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';
const OUT = process.env.OUT_DIR || '/root/clause-screen/mpp';

// A heading, because this lands in a memory file the agent reads as guidance rather than as
// part of the task. Without one the clauses read as if the issue had asked for them.
const HEAD = '\n\n## Engineering checks — apply to any change you make\n\n';

const VARIANTS = { CG: 'GALL', C14: 'G14' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = readFileSync(SRC, 'utf8');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'mpp-C0.md'), base);
  console.log(`C0   +0 chars  (production, unchanged control)  -> ${path.join(OUT, 'mpp-C0.md')}`);
  for (const [name, combo] of Object.entries(VARIANTS)) {
    const text = COMBOS[combo].map(k => CLAUSES[k]).join('\n\n');
    const out = `${base.trimEnd()}${HEAD}${text}\n`;
    const f = path.join(OUT, `mpp-${name}.md`);
    writeFileSync(f, out);
    console.log(`${name.padEnd(4)} +${out.length - base.length} chars  ${COMBOS[combo].join('+')}  -> ${f}`);
  }
}
