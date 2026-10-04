/**
 * Rules v2 switch, SS_FIX_RULES_V2 (2026-10-02; OBSERVATIONS.md "The rules should list ss-grep's
 * flags in one short line" and "Allow file-name search (find, ls, rg --files)"). Product default ON.
 * The default text is the third draft ("v3", after the 2026-10-02 micro-smoke,
 * core/prompt-optimization/data/obs-loop/TRACES-rules.md); the identifiers keep the V2 name.
 *
 * What the default changes, in every shipped sweet-search text:
 *   rules (p7-final/sweet-search-system-prompt.md, which holds the default text):
 *     - one ss-grep flag line that leads with `-g '!<glob>'` and says to start broad (the v2 line
 *       made agents scope their FIRST grep, which likely cost recall);
 *     - one line that allows file-name search (`rg --files`, `find -name`, `ls`) and says to read
 *       a found file with ss-read, not `cat`;
 *     - `find`/`ls` leave the raw-tool ban and the absence rule (`grep`/`cat` stay banned);
 *     - "`ss-grep` is file:line only" becomes the full-line statement.
 *   Claude Code: the rules pointer file drops `find` from its raw-tool sentence; the main agent
 *     gets the `find` half of the trimmed stock steer and an override that exempts file-name search.
 *   opencode: the Glob half of the trimmed stock bullet comes back; the bash tool text stops
 *     discouraging `find`/`ls`.
 *   Codex: nothing (the v2 `rg --files -g` harness line made Sol hunt for AGENTS.md; removed).
 *
 * SS_FIX_RULES_V2=0 restores the old texts byte for byte (the A/B baseline arm). Any other value,
 * or unset, is the default. Every builder takes the env it should read, so an interleaved bench
 * arm with an env overlay gets its own texts.
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
  "- `ss-grep` flags when needed: `-g '!<glob>'` excludes paths (tests, vendored, generated), `-g '<glob>'` / `--in <path>` scopes, `-i`, `-w`, `-A/-B/-C N`. Start broad; scope only after a broad grep shows where.";
export const RULES_V2_FILE_NAMES_LINE =
  "- To find files by name or list a directory, use `rg --files -g '<glob>'`, `find <dir> -name '<glob>'` or `ls <dir>` (one directory; never `ls -R` or an unfiltered `find .`/`rg --files`); read what you find with `ss-read`, not `cat`. The `ss-*` tools search file contents.";

export const RULES_V2_POLICY_EDITS = Object.freeze([
  Object.freeze([
    'Reach for raw `grep`/`find`/`cat`/`ls` or the native reader only for',
    'Reach for raw `grep`/`cat` or the native reader only for',
  ]),
  Object.freeze([
    '`ss-grep` is file:line only;',
    '`ss-grep` prints the path of each file once, then its hits as `line:<full line>`;',
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
