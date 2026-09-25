// Rebuilds the sweet-arm Codex instructions from the $0 captures of what codex-cli 0.146.1
// sends as its base prompt, one file per model (the prompt differs by model):
//   gpt-5.5       → `instructions` field      (captures/codex-0.146.1-request-sweet.json)
//   gpt-5.6-luna  → first developer message  (captures/codex-0.146.1-request-luna-base.json;
//                   luna runs in "code mode" and sends no `instructions` field)
// Every change is a DELETION of whole source lines, except one gpt-5.5 sentence that mixed a
// search/read contradiction with a keeper (`edits` below). Nothing is added or paraphrased.
// NOTICE-codex.md in this directory lists each change and why.
//
//   node harness/trim/build-codex-instructions.mjs            # write the files
//   node harness/trim/build-codex-instructions.mjs --check    # exit 1 if a file differs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURES = path.join(HERE, '..', '..', 'handoffs', 'improve', 'harness-prompt-trim', 'captures');

// sha256 pins the reviewed source text; line ranges are 1-based and inclusive.
export const VARIANTS = {
  'gpt-5.5': {
    capture: 'codex-0.146.1-request-sweet.json',
    extract: body => body.instructions,
    sha256: 'c2a980bc28af132eb89e0b4c68ae884043faae83a1afd3fd4889f7e8a1ada7b0', // 21,335 chars
    out: 'codex-0.146.1-instructions-sweet.md',
    delete: [
      [3, 21],    // # Personality, ## Values, ## Interaction Style, ## Escalation
      [25, 25],   // "When you search for text or files, you reach first for `rg` or `rg --files` ..."
      [38, 71],   // ## Frontend guidance, ### Build with empathy, ### Design instructions, dev-server paragraph
      [87, 91],   // ## Special user requests (`date`, code-review stance)
      [109, 127], // ## Formatting rules (TUI rendering, clickable file links)
      [132, 133], // final answer: follow-up suggestions; prose-style line
      [139, 140], // final answer: tone matches personality; creature ban
      [144, 152], // ## Intermediary updates: every bullet but the checklist one ...
      [154, 155], // ... and the edits-preamble and tone bullets
      [36, 36],   // "You let test coverage scale with risk ..." (pushes writing tests; the frame forbids test edits)
      [103, 106], // mid-turn user messages; post-resume sanity check (no user in a headless run)
      [134, 136], // final answer: relay command output, "save/copy this file", code explanations
      [141, 143], // "## Intermediary updates" heading ...
      [153, 153], // ... and its checklist bullet (update_plan is removed by tools.update_plan.enabled=false)
    ],
    edits: [{
      line: 26,
      from: 'You parallelize tool calls whenever you can, especially file reads such as `cat`, `rg`, `sed`, `ls`, `git show`, `nl`, and `wc`. You use',
      to: 'You parallelize tool calls whenever you can. You use',
    }],
  },
  'gpt-5.6-luna': {
    capture: 'codex-0.146.1-request-luna-base.json',
    extract: body => body.input.find(m => m.type === 'message' && m.role === 'developer').content[0].text,
    sha256: 'cbefa6b0bede0e332d957fca70ccacf9f12f4c0ecdf81b819e5cbe1a3b16e265', // 17,730 chars
    out: 'codex-0.146.1-instructions-sweet-gpt-5.6-luna.md',
    delete: [
      [3, 22],    // # Personality, ## Writing style, ## Technical communication
      [35, 38],   // ## Intermediate commentary: the two "send commentary updates" paragraphs ...
      [41, 42],   // ... and "Never praise your plan" (the final-vs-commentary rule is kept)
      [47, 75],   // ### Formatting rules (clickable file links), ### Visualizations
      [78, 78],   // "When you search for text or files, you reach first for `rg` or `rg --files` ..."
      [133, 167], // # Using skills (the skills list itself is dropped by skills.include_instructions=false)
      [29, 30],   // mid-turn user messages (no user in a headless run)
      [82, 82],   // "Avoid blocking sleep or wait calls longer than 60 seconds" (the frame asks for a 300 s run_tests wait)
      [83, 83],   // "Never repurpose `$HOME` ..." — verbatim duplicate of line 124, which stays
      [97, 98],   // request types "Answer, explain, review" and "Diagnose ... Do not implement the fix"
      [100, 100], // request type "Monitor or wait"
      [106, 107], // "A terminal condition such as finish, babysit ..."
      [110, 111], // "When presented with clarifying questions or objections from the user ..."
    ],
    edits: [],
  },
};

export const headerFor = (model) => `<!--
Modified copy of the base instructions that codex-cli 0.146.1 (https://github.com/openai/codex,
Apache-2.0) sends for model ${model}. Changed for the sweet-search task-completion benchmark:
passages deleted${VARIANTS[model].edits.length ? ' and one sentence shortened' : ''}. Change list: NOTICE-codex.md in this directory.
The runner strips this comment; the model never sees it.
-->
`;

export function buildInstructions(model, source) {
  const v = VARIANTS[model];
  const sha = createHash('sha256').update(source).digest('hex');
  if (sha !== v.sha256) throw new Error(`${model}: source sha256 ${sha} is not the reviewed 0.146.1 text — review the edit again`);
  const lines = source.split('\n');
  const drop = new Set();
  for (const [a, b] of v.delete) for (let i = a; i <= b; i++) drop.add(i);
  for (const { line, from, to } of v.edits) {
    if (!lines[line - 1].includes(from)) throw new Error(`${model}: line ${line} no longer contains the edited sentence`);
    lines[line - 1] = lines[line - 1].replace(from, to);
  }
  return lines.filter((_, i) => !drop.has(i + 1)).join('\n').replace(/\n+$/, '') + '\n';
}

export function sourceFor(model) {
  const v = VARIANTS[model];
  return v.extract(JSON.parse(readFileSync(path.join(CAPTURES, v.capture), 'utf8')));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let same = true;
  for (const [model, v] of Object.entries(VARIANTS)) {
    const source = sourceFor(model);
    const header = headerFor(model);
    const text = header + buildInstructions(model, source);
    const out = path.join(HERE, v.out);
    if (process.argv.includes('--check')) {
      const ok = readFileSync(out, 'utf8') === text;
      same &&= ok;
      console.log(`${model}: ${ok ? 'up to date' : 'DIFFERS from the build'}`);
      continue;
    }
    writeFileSync(out, text);
    console.log(`${model}: ${source.length} -> ${text.length - header.length} chars (+${header.length} header, stripped) → ${v.out}`);
  }
  if (!same) process.exit(1);
}
