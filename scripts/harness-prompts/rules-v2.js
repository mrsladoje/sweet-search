/**
 * Rules v2 (2026-10-02; OBSERVATIONS.md "The rules should list ss-grep's flags in one short line"
 * and "Allow file-name search (find, ls, rg --files)"). Product default ON.
 *
 * What v2 changes, in every shipped sweet-search text:
 *   rules (p7-final/sweet-search-system-prompt.md, which holds the v2 text):
 *     - one line that lists the ss-grep flags;
 *     - one line that allows file-name search (`rg --files`, `find -name`, `ls`);
 *     - `find`/`ls` leave the raw-tool ban and the absence rule (`grep`/`cat` stay banned);
 *     - "`ss-grep` is file:line only" becomes the full-line statement.
 *   Claude Code rules pointer (write-claude-rules.js): `find` leaves the raw-tool sentence.
 *   harness prompts: only the file-name half of each trimmed stock line comes back
 *     Codex `rg --files`, opencode Glob, Claude Code `find`; never the text-search or read half.
 *
 * SS_FIX_RULES_V2=0 restores the old texts byte for byte (the A/B baseline arm). Any other value,
 * or unset, is v2. Every builder takes the env it should read, so an interleaved bench arm with
 * an env overlay gets its own texts.
 */

export const RULES_V2_ENV = 'SS_FIX_RULES_V2';

/** True unless SS_FIX_RULES_V2=0 in `env`. */
export function rulesV2Enabled(env = process.env) {
  return String(env?.[RULES_V2_ENV] ?? '').trim() !== '0';
}

function replaceOnce(text, from, to, label) {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + 1) >= 0) {
    throw new Error(`${label}: text "${from.slice(0, 50)}..." not found exactly once`);
  }
  return text.slice(0, at) + to + text.slice(at + from.length);
}

// ---------------------------------------------------------------------------------------------
// The CLI policy body: [v1 text, v2 text] pairs. The ship file holds v2; =0 applies them reversed.
// ---------------------------------------------------------------------------------------------

export const RULES_V2_GREP_FLAGS_LINE =
  "- `ss-grep` flags when needed: `-i` (ignore case) `-w` (whole word) `--in <path>` `-g '<glob>'` / `-g '!<glob>'` (include / exclude) `-A/-B/-C N`";
export const RULES_V2_FILE_NAMES_LINE =
  "- To find files by name or list a directory, use `rg --files -g '<glob>'`, `find <dir> -name '<glob>'` or `ls <dir>` (one directory; never `ls -R` or an unfiltered `find .`/`rg --files`); the `ss-*` tools search file contents.";

export const RULES_V2_POLICY_EDITS = Object.freeze([
  Object.freeze([
    'Reach for raw `grep`/`find`/`cat`/`ls` or the native reader only for',
    'Reach for raw `grep`/`cat` or the native reader only for',
  ]),
  Object.freeze([
    '`ss-grep` is file:line only;',
    '`ss-grep` prints each hit as `file:line: <full line>`;',
  ]),
  Object.freeze([
    '- `ss-grep "<regex>" [-k N]` — exact literals\n',
    `- \`ss-grep "<regex>" [-k N]\` — exact literals\n${RULES_V2_GREP_FLAGS_LINE}\n`,
  ]),
  Object.freeze([
    '- `ss-read <file> [start] [end]` — a narrow range\n',
    `- \`ss-read <file> [start] [end]\` — a narrow range\n${RULES_V2_FILE_NAMES_LINE}\n`,
  ]),
  Object.freeze([
    'no third synonym, no `find`/`ls`/`cat` enumeration, no native scan.',
    'no third synonym, no `cat` of candidate files, no native scan.',
  ]),
]);

/**
 * The CLI policy text for `env`. `v2Text` is the ship-file text (v2); with SS_FIX_RULES_V2=0 the
 * edits are undone, which yields the old text byte for byte (pinned in tests/init/rules-v2.test.js).
 */
export function policyTextForEnv(v2Text, env = process.env) {
  if (rulesV2Enabled(env)) return v2Text;
  let out = String(v2Text);
  for (const [v1, v2] of [...RULES_V2_POLICY_EDITS].reverse()) out = replaceOnce(out, v2, v1, 'rules v1');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Claude Code pointer rules file (write-claude-rules.js).
// ---------------------------------------------------------------------------------------------

export const CLAUDE_POINTER_V1_SENTENCE = 'Use raw `grep`/`find`/`cat` or the native reader only for a file edited seconds ago.';
export const CLAUDE_POINTER_V2_SENTENCE = 'Use raw `grep`/`cat` or the native reader only for a file edited seconds ago.';

// ---------------------------------------------------------------------------------------------
// Harness prompts: the file-name half of each trimmed stock line.
// ---------------------------------------------------------------------------------------------

// Codex 0.146.1 stock: "When you search for text or files, you reach first for `rg` or
// `rg --files`; …". v2 puts back the files half, in the stock line's place (before the
// parallel-calls line).
export const CODEX_FILE_NAME_LINE = "- When you search for files by name, you reach first for `rg --files -g '<glob>'`.";
// opencode 1.18.4 stock: "When searching for text or files, prefer using Glob and Grep tools
// (they are powered by `rg`)". v2 replaces the removed bullet with its Glob half.
export const OPENCODE_GLOB_BULLET = '- When searching for files by name, prefer using the Glob tool (it is powered by `rg`)\n';
// Claude Code stock bypass-mode steer (off via CLAUDE_CODE_THRIFTY_SONIC=0): "read files with
// cat, head, or sed -n, search with grep and find". v2 puts back the `find` half.
export const CLAUDE_FIND_LINE = '- To find files by name, you can use `find` through the Bash tool.';
// The Claude Code routing override (install-claude-system-prompt.js) says Bash `grep`/`find` advice
// does not apply unless the rules permit it; under v2 it exempts file-name search explicitly, so it
// cannot contradict CLAUDE_FIND_LINE (the V1b pointer file does not repeat the permission).
export const CLAUDE_OVERRIDE_V2_SENTENCE = 'Finding files by name or listing a directory (`find <dir> -name`, `ls <dir>`, `rg --files -g`) is always allowed.';

// opencode tool descriptions (OPENCODE_TOOL_EDITS in index.js). The v1 edits keep `find` in the bash
// tool's avoid-list and its line "File search: Use Glob (NOT find or ls)", which contradict the v2
// rules line; v2 drops `find` from the avoid-list and the "(NOT find or ls)" clause. Glob stays the
// first choice for names (OPENCODE_GLOB_BULLET).
export const OPENCODE_BASH_AVOID_V1 = '  - Avoid using Bash with the `find`, `sed`, `awk`, or `echo` commands,';
export const OPENCODE_BASH_AVOID_V2 = '  - Avoid using Bash with the `sed`, `awk`, or `echo` commands,';
export const OPENCODE_BASH_FILE_SEARCH_V1 = '    - File search: Use Glob (NOT find or ls)\n';
export const OPENCODE_BASH_FILE_SEARCH_V2 = '    - File search: Use Glob\n';

/** Insert `line` before `anchor` (which must occur exactly once) when v2 is on. */
export function insertLineBefore(text, anchor, line, { env = process.env, label = 'rules v2' } = {}) {
  if (!rulesV2Enabled(env)) return text;
  return replaceOnce(text, anchor, `${line}\n${anchor}`, label);
}
