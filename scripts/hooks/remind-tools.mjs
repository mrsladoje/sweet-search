#!/usr/bin/env node
/**
 * sweet-search UserPromptSubmit reminder hook.
 *
 * Claude Code surfaces this hook's stdout as additional context on every
 * user prompt. The reminder keeps sweet-search tool selection fresh in
 * the agent's working memory — the largest measured failure mode (May
 * 2026) is the agent drifting back to native `Grep` / `Read` even after
 * sweet-search has provided a `sufficient=YES` pack.
 *
 * Plan reference: §4C. Token cost is intentionally minimal because this
 * fires every prompt; the wins come from avoided re-search loops, not
 * from longer guidance.
 *
 * Installed by `sweet-search init` into `.claude/hooks/sweet-search-remind-tools.mjs`
 * with a `.claude/settings.json` `hooks.UserPromptSubmit` entry that
 * sweet-search owns by filename match. `sweet-search uninstall` removes
 * both the file and the settings entry.
 */

// Tool surface mirrors the shipped M++++ policy (the ss-* tools). Kept only
// for cleanup compatibility with projects initialized by older releases.
const REMINDER = [
  '<sweet-search-reminder>',
  'Use the index-backed ss-* tools for code search/navigation, not raw grep/find/cat:',
  '- Exact symbol/literal/error string:  ss-grep "<regex>" -k 5   (trust the top hit)',
  '- Known symbol, NL underperforms:     ss-find "<query>" --regex "\\b<symbol>\\b" -k 5',
  '- Concept/behavior (no exact symbol): ss-search "<query>"',
  '- Callers/callees/impact of a symbol: ss-trace <symbol>',
  '- Known file, unclear span:           ss-semantic <file> "<query>"',
  '- Known file + line range:            ss-read <file> <start> <end>',
  'STOP searching the instant your evidence answers the query — one confirmed file+symbol is enough;',
  'a second call costs more than it saves. Multi-file flow questions get one follow-up.',
  'Search rules only — if the task asks for a change, apply the edit.',
  '</sweet-search-reminder>',
  '',
].join('\n');

process.stdout.write(REMINDER);
process.exit(0);
