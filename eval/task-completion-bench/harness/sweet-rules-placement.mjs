// SWEET_RULES_PLACEMENT (research switch, default OFF = 'file'), SWEET ARM ONLY.
//
// Where the sweet arm's ss-* rules (M±, core/prompt-optimization/data/p7-final/
// sweet-search-system-prompt.md) reach the model:
//   file   (unset / 'file') — today's delivery: the project instruction file (AGENTS.md for
//          codex and opencode, bracketed by the frame; .claude/rules/sweet-search.md for
//          Claude Code). Every runner is byte-identical to the pre-switch harness.
//   system — the harness SYSTEM prompt instead. The instruction file then carries the bench
//          frame only, the same bytes as the native arm's file, so the ONLY difference between
//          the two placements is where the rules sit. The rules text is byte-identical.
// Per harness (each runner documents its own mechanism):
//   codex       model_instructions_file = (trim instructions | stock instructions) + rules
//   opencode    agent.build / general / explore prompts = (trim | stock) prompt + rules
//   Claude Code stock: --append-system-prompt + --append-subagent-system-prompt;
//               CC_HARNESS_TRIM=product: the installed main, general-purpose and Plan agent files
// The native arm never moves anything (it has no rules), whatever the switch says.
//
// Kept in its own module: codex-task-runner.mjs cannot import agent-runner-shared.mjs
// (that module imports it), and all three runners need this.

export const SWEET_RULES_PLACEMENTS = Object.freeze(['file', 'system']);

/** 'file' | 'system'. Native is always 'file'. An unknown value throws on the sweet arm. */
export function resolveSweetRulesPlacement({ sweet, env = process.env } = {}) {
  const v = String(env.SWEET_RULES_PLACEMENT ?? '').trim();
  if (!sweet) return 'file';
  if (!v || v === 'file') return 'file';
  if (v === 'system') return 'system';
  throw new Error(`SWEET_RULES_PLACEMENT=${v}: expected file or system`);
}

/** Row fields: stamped ONLY when the switch is on, so an off row is byte-identical. */
export function sweetRulesRowFields(placement) {
  return placement === 'system' ? { sweetRulesPlacement: 'system' } : {};
}

/**
 * `base` followed by the rules as their own paragraph. `base` is kept as an exact byte prefix
 * (one blank line is added after it), and the rules keep every byte except trailing
 * whitespace, which ends in exactly one newline.
 */
export function appendSweetRules(base, rules) {
  const b = String(base ?? '');
  const sep = !b ? '' : (b.endsWith('\n\n') ? '' : (b.endsWith('\n') ? '\n' : '\n\n'));
  return `${b}${sep}${String(rules).trimEnd()}\n`;
}
