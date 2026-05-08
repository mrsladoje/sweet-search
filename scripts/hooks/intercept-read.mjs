#!/usr/bin/env node
/**
 * sweet-search PreToolUse hook for `Read`.
 *
 * Plan reference: §4D. Hints — never blocks. Edit workflows legitimately
 * require `Read` before `Edit`, so a hard deny would break tooling. The
 * hint nudges the agent toward `ss-read` (exact range) or `ss-semantic`
 * (when the relevant span is unclear) for code-understanding reads.
 *
 * Per Claude Code hook contract for PreToolUse:
 *   - To surface text into the model's context (so the agent sees the hint
 *     and may adjust): stdout JSON with hookSpecificOutput.additionalContext.
 *   - Plain stderr reaches the user only — NOT the model. (We did this in
 *     the first cut and the hint never landed where it mattered.)
 *   - Exit 0 + permissionDecision='allow' → tool runs AND context is
 *     injected. Exit 2 would deny.
 *
 * Reference: https://code.claude.com/docs/en/hooks.md (PreToolUse output).
 *
 * The hint is universal (doesn't depend on which file is being Read), so
 * we drain stdin without parsing it. Always exits 0 — the Read continues.
 */

const HINT = (
  '[sweet-search] Tip: prefer `ss-read <file> <start> <end>` for exact ranges, '
  + 'or `ss-semantic <file> "<question>" --max-tokens 800` when the relevant '
  + 'span is unclear. Native `Read` is best for files you already know precisely '
  + '(e.g. before `Edit`). See AGENTS.md / CLAUDE.md for the full tool-routing tree.'
);

function emitDecision() {
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: HINT,
    },
  };
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

// Claude Code passes the tool invocation as JSON on stdin. We don't parse
// it because the hint is universal. Drain to keep the pipe clean, then
// emit the decision.
let _drained = '';
process.stdin.on('data', (c) => { _drained += c; });
process.stdin.on('end', emitDecision);
process.stdin.on('error', emitDecision);

// Edge case: no stdin attached (running the script standalone for debug).
// `isTTY === undefined` on a piped stdin; truthy when stdin is the terminal.
if (process.stdin.isTTY) {
  emitDecision();
}
