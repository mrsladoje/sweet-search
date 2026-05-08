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

const REMINDER = [
  '<sweet-search-reminder>',
  'Pick the narrowest sweet-search tool that fits the question:',
  '- Exact symbol/literal/error code:  ss-grep "<regex>" -k 5',
  '- Behavior + regex anchor:          ss-find "<question>" --regex "<anchor>" -k 5',
  '- Concept search (no obvious lit):  sweet-search "<intent>" --agent',
  '- Callers/callees/impact:           sweet-search "who calls X" --mode structural --agent',
  '- Known file + line range:          ss-read <file> <start> <end>',
  '- Known file, unclear span:         ss-semantic <file> "<question>" --max-tokens 800',
  'STOP after one search when sufficient=YES + presentation=full + symbol/file named.',
  'A second call costs more than it saves. Multi-file flow questions get one follow-up.',
  '</sweet-search-reminder>',
  '',
].join('\n');

process.stdout.write(REMINDER);
process.exit(0);
