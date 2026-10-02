// shell-command-kind.mjs — ONE classifier for the shell commands of every harness runner
// (Claude Code Bash, opencode bash, Codex exec_command, Cursor shellToolCall).
//
// 2026-10-03: Claude Code and opencode matched only the START of the command, so an ss-* call
// inside a compound command (`cd <dir>; ss-grep …`, `cd … && ss-read …`) was counted as `bash`.
// In the 2026-10-02 full-line A/B that hid 28 ss-grep and 81 ss-read calls from `ssCalls`, and
// their output from the retrieval bench's rawResponse (TRACES-fl.md, "Method notes"). Codex had
// the split since 2026-09-29; it moved here unchanged except for two additions that apply to all:
// leading env assignments (`SS_X=1 ss-grep …`) are skipped, and `ss-batch` counts as ss-*.
//
// A command is split on unquoted `;`, `&&`, `||` and newlines (a single `|` stays inside its
// part). The CALL takes the highest-priority kind among its parts
// (test > edit > ss > nativeGrep > nativeRead > bash), so toolCounts stays one count per call.
//
// Rows classified by this module carry TOOL_KIND_VERSION. Never pool `ssCalls`, `toolCounts`,
// `ssDeliveredTokens` or content metrics across rows with and without it.
export const TOOL_KIND_VERSION = 2;

/** Codex wraps commands as `<shell> -lc '<inner>'`; return the inner command. */
export function unwrapShellCommand(cmd) {
  let c = String(cmd || '').trim();
  const m = c.match(/^(?:\S*\/)?(?:ba|z|da|k|fi)?sh\s+-[a-z]*c\s+([\s\S]*)$/);
  if (m) {
    let inner = m[1].trim();
    const q = inner[0];
    if ((q === "'" || q === '"') && inner[inner.length - 1] === q) {
      inner = inner.slice(1, -1);
      if (q === "'") inner = inner.replace(/'\\''/g, "'");      // '\'' is a quote inside '...'
    }
    c = inner.trim();
  }
  return c;
}

/** Split a shell command on unquoted `;`, `&&`, `||` and newlines. A single `|` stays inside. */
export function splitShellCommands(cmd) {
  const s = String(cmd || '');
  const parts = [];
  let cur = '', quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
      if (ch === quote) quote = '';
      cur += ch; continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    const two = s.slice(i, i + 2);
    if (ch === ';' || ch === '\n' || two === '&&' || two === '||') {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      if (two === '&&' || two === '||') i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Drop leading `VAR=value` assignments (`SS_READ_GUTTER=none ss-read …`). */
function stripEnvAssignments(c) {
  let s = c;
  for (let m; (m = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/.exec(s));) s = s.slice(m[0].length);
  return s;
}

const SS_RE = /^(?:\S*\/)?(ss[-_](search|grep|find|read|semantic|trace|batch)|sweet-search)\b/;

/** Kind of ONE simple command (no `;` / `&&` / `||`). */
export function classifyShellPart(part) {
  const c = stripEnvAssignments(String(part || '').trim());
  if (/^(?:\S*\/)?run_tests\b/.test(c)) return 'test';
  if (SS_RE.test(c)) return 'ss';
  if (/\bapply_patch\b/.test(c)) return 'edit';
  if (/^(rg|grep|ag|ack|git grep)\b/.test(c) || /\| *(grep|rg)\b/.test(c)) return 'nativeGrep';
  if (/^(cat|head|tail|nl|bat|less)\b/.test(c) || /^sed\s+(-n|')/.test(c)) return 'nativeRead';
  return 'bash';
}

export const KIND_PRIORITY = ['test', 'edit', 'ss', 'nativeGrep', 'nativeRead', 'bash'];

/** @returns {{ kind: string, parts: string[] }} the call's bucket and one bucket per sub-command. */
export function classifyShellCommand(cmd) {
  const parts = splitShellCommands(unwrapShellCommand(cmd)).map(classifyShellPart);
  if (!parts.length) parts.push('bash');
  const kind = KIND_PRIORITY.find(k => parts.includes(k)) || 'bash';
  return { kind, parts };
}
