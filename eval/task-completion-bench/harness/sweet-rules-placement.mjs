// SWEET_RULES_PLACEMENT, SWEET ARM ONLY. DEFAULT (since 2026-09-30) = where the product puts the
// rules (`sweet-search init` 2.8.2): 'config' for codex and opencode, 'file' for Claude Code
// (SWEET_RULES_PLACEMENT_DEFAULTS). Unset or empty = that default; SWEET_RULES_PLACEMENT=file is
// the explicit opt-out to the pre-2026-09-30 delivery (rules in AGENTS.md for codex/opencode).
//
// Where the sweet arm's ss-* rules (M±, core/prompt-optimization/data/p7-final/
// sweet-search-system-prompt.md) reach the model:
//   file   — the project instruction file (AGENTS.md for codex and opencode, bracketed by the
//          frame; .claude/rules/sweet-search.md for Claude Code). Every runner is byte-identical
//          to the pre-switch harness. Claude Code's default.
//   system — the harness SYSTEM prompt instead. The instruction file then carries the bench
//          frame only, the same bytes as the native arm's file, so the ONLY difference between
//          the two placements is where the rules sit. The rules text is byte-identical.
//   config — the harness's OWN instruction-config mechanism, outside the repository (codex and
//          opencode only; Claude Code refuses it). The instruction file carries the frame only
//          (native's bytes), as with 'system', and the harness's stock system prompt is NOT
//          touched:
//            opencode  the rules block goes to a file in the runner's PRIVATE state dir (never
//                      the run dir: BENCH_INCLUDE_UNTRACKED=1 would grade a repo file) and its
//                      absolute path to the generated opencode.json `instructions` array
//            codex     -c developer_instructions=<TOML string> (sent as a developer message)
//          This is the product-shaped delivery: no AGENTS.md / CLAUDE.md edit in the user's repo.
//          The codex and opencode default.
// Per harness (each runner documents its own mechanism):
//   codex       model_instructions_file = (trim instructions | stock instructions) + rules
//   opencode    agent.build / general / explore prompts = (trim | stock) prompt + rules
//   Claude Code stock: --append-system-prompt + --append-subagent-system-prompt;
//               CC_HARNESS_TRIM=product: the installed main, general-purpose and Plan agent files
// The native arm never moves anything (it has no rules), whatever the switch says.
//
// Kept in its own module: codex-task-runner.mjs cannot import agent-runner-shared.mjs
// (that module imports it), and all three runners need this.


export const SWEET_RULES_PLACEMENTS = Object.freeze(['file', 'system', 'config']);
// The product's placement per runner (what `sweet-search init` / `--codex` / `--opencode` ship).
export const SWEET_RULES_PLACEMENT_DEFAULTS = Object.freeze({ 'claude-code': 'file', codex: 'config', opencode: 'config' });

/**
 * 'file' | 'system' | 'config'. Native is always 'file'. An unknown value throws on the sweet arm.
 * Unset or empty = the product default for `harness` (SWEET_RULES_PLACEMENT_DEFAULTS); a caller
 * that names no harness (a capture script with its own explicit value) gets 'file'.
 */
export function resolveSweetRulesPlacement({ sweet, env = process.env, harness } = {}) {
  const v = String(env.SWEET_RULES_PLACEMENT ?? '').trim();
  if (!sweet) return 'file';
  if (!v) {
    if (harness === undefined) return 'file';
    const d = SWEET_RULES_PLACEMENT_DEFAULTS[harness];
    if (!d) throw new Error(`SWEET_RULES_PLACEMENT: no default for harness ${harness}`);
    return d;
  }
  if (v === 'file' || v === 'system' || v === 'config') return v;
  throw new Error(`SWEET_RULES_PLACEMENT=${v}: expected file, system or config`);
}

/** 'default' when the sweet arm's placement comes from SWEET_RULES_PLACEMENT_DEFAULTS, else 'env'. */
export function sweetRulesPlacementSource(env = process.env) {
  return String(env.SWEET_RULES_PLACEMENT ?? '').trim() ? 'env' : 'default';
}

/**
 * Row fields. Sweet arm: the effective placement ALWAYS (the default is stamped too, so a row
 * states which delivery it measured) and where it came from ('default' | 'env'). Native: nothing.
 * `sweet` omitted = the pre-2026-09-30 form (stamped only when the rules leave the file).
 */
export function sweetRulesRowFields(placement, { sweet, env = process.env } = {}) {
  if (sweet === undefined) return placement === 'system' || placement === 'config' ? { sweetRulesPlacement: placement } : {};
  return sweet ? { sweetRulesPlacement: placement, sweetRulesPlacementSource: sweetRulesPlacementSource(env) } : {};
}

/** True when the rules leave the instruction file (it then carries the frame only, native's bytes). */
export function sweetRulesOutOfFile(placement) {
  return placement === 'system' || placement === 'config';
}

/**
 * TOML basic string for a `codex -c key=<value>` override. JSON.stringify escapes `"`, `\` and
 * every control character below U+0020 with escapes TOML also defines (\b \t \n \f \r \" \\
 * \uXXXX). TOML also forbids a literal U+007F, so that one is escaped too.
 */
export function tomlBasicString(text) {
  return JSON.stringify(String(text)).replace(/\u007f/g, '\\u007F');
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
