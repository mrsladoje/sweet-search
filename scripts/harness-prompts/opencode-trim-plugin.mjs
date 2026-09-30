// opencode plugin for the harness trim (OC_HARNESS_TRIM, opencode-task-runner.mjs).
// Edits the DESCRIPTION of built-in tools through the `tool.definition` hook and nothing
// else: parameters and `execute` stay opencode's own, so a trimmed bash call runs exactly
// like an untrimmed one. Self-contained (no imports beyond node:fs) because the runner
// copies it into the rollout's state dir, where no node_modules exist.
//
// options.edits  { <toolID>: [[find, replace], ...] }  — applied in order, every occurrence.
// options.report path of a JSON file rewritten on every hook call:
//                { <toolID>: { applied, missing: [find prefixes], chars } }
//                A missing edit means the pinned opencode text changed; the runner records
//                the report on the row so a half-trimmed rollout is visible.
import { writeFileSync } from 'node:fs';

export default async (_input, options = {}) => {
  const edits = options.edits || {};
  const report = {};
  return {
    'tool.definition': async ({ toolID }, output) => {
      const list = edits[toolID];
      if (!list || typeof output.description !== 'string') return;
      let text = output.description;
      let applied = 0;
      const missing = [];
      for (const [find, replace] of list) {
        if (text.includes(find)) { text = text.split(find).join(replace); applied++; }
        else missing.push(find.slice(0, 60));
      }
      output.description = text;
      report[toolID] = { applied, missing, chars: text.length };
      if (options.report) writeFileSync(options.report, JSON.stringify(report));
    },
  };
};
