#!/usr/bin/env node
/**
 * sweet-search PreToolUse hook for `Read`.
 *
 * Plan reference: §4D. Hints — never blocks. Edit workflows legitimately
 * require `Read` before `Edit`, so a hard deny would break tooling. The
 * hint nudges the agent toward `ss-read` (exact range) or `ss-semantic`
 * (when the relevant span is unclear) for code-understanding reads.
 *
 * Claude Code passes the tool invocation as JSON on stdin; we read but
 * don't parse it because the hint is the same regardless of args. Output
 * goes to stderr (Claude Code surfaces `additionalContext` from JSON
 * stdout; for a non-blocking hint, stderr is the lighter-weight channel).
 *
 * Always exits 0 so the Read continues. Installed only with the opt-in
 * `--enforce-tools` flag.
 */

let _drained = '';
process.stdin.on('data', (c) => { _drained += c; });
process.stdin.on('end', () => {
  process.stderr.write(
    '[sweet-search] Tip: prefer `ss-read <file> <start> <end>` for exact ranges, '
    + 'or `ss-semantic <file> "<question>" --max-tokens 800` when the relevant span '
    + 'is unclear. Native `Read` is best for files you already know precisely (e.g. '
    + 'before `Edit`). See AGENTS.md / CLAUDE.md for the full tool-routing tree.\n',
  );
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
// Edge case: no stdin (tested in isolation) — emit hint and exit.
if (process.stdin.isTTY) { process.stdin.emit('end'); }
