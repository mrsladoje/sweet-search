// System-prompt policies for the agent-in-the-loop benchmark.
// These are appended to Claude Code's default system prompt via
// `--append-system-prompt` so the worker keeps its baseline behaviour but
// gets the additional tool restrictions, workflow guidance, and budget caps.
//
// Strict enforcement comes from `audit.js` (post-hoc transcript audit):
// any forbidden tool/command in the run is flagged. --allowed-tools is
// layered on top but treated as best-effort.

// Shared budget table — applied identically to both modes so the bench
// measures retrieval quality, not call-count discipline.
const BUDGET_TABLE = `\
Tool-call budget targets (counted across the whole task):
  - exact symbol / config / constant lookup .......... ≤ 4 tool calls
  - behaviour / error-path explanation ............... ≤ 6 tool calls
  - multi-file flow ................................... ≤ 8 tool calls
  - absolute hard cap ................................. ≤ 10 tool calls
Citation discipline: prefer 1-3 high-confidence citations over a long
list. A citation is "high-confidence" when you have actually read the
cited line range and can quote it.
Stop as soon as your evidence covers the answer; do NOT search again to
"double-check" — extra calls cost tokens and rarely change the answer.
`;

const ANSWER_FORMAT = `\
End your reply with a single fenced JSON block in EXACTLY this shape (no
extra prose after the block):

\`\`\`json
{
  "answer": "<concise prose answer>",
  "files": [{"path": "...", "lines": "start-end", "reason": "..."}],
  "symbols": ["..."],
  "confidence": 0.0,
  "notes": "..."
}
\`\`\`

CITATION RULE (strict — both modes):
- Every distinct source file that supports your answer MUST appear as its
  own object in \`files[]\` with a line range.
- If your prose names a file, imports from it, relies on a function in it,
  or cites behavior from it, that file MUST be a separate entry in
  \`files[]\` — do NOT mention supporting files only in \`answer\` or
  \`notes\`.
- For multi-file questions, include ONE \`files[]\` object per required
  file. "lib/route.js calls handleRequest from lib/handle-request.js" → both
  files must appear as separate \`files[]\` entries.
- The \`reason\` field should explain why this specific file is part of the
  evidence, not summarise the whole answer.
- Use ASCII hyphen line ranges like "459-586"; do not use en dashes.
`;

export const POLICIES = {
  'native-rg-read': `\
You are solving a code-understanding task in a repository.

You may use ONLY native filesystem exploration:
- Bash commands using rg, grep, sed, awk, wc, ls, find, head, tail, cat, pwd, and shell builtins
- file reads through the native Read tool

You MUST NOT:
- run any \`sweet-search\` command, or any of the \`ss-*\` wrappers (\`ss-find\`, \`ss-grep\`, \`ss-read\`, \`ss-semantic\`)
- read or rely on any file under \`.sweet-search/\` (these are Sweet Search's index files)
- use vector search, indexed grep, ColGrep, or read-semantic
- edit, create, or move files

Recommended workflow:
1. Start with a focused \`rg\` (or \`grep\`) for the most distinctive identifier in the question.
2. Inspect ONLY the top 3-5 matches. Do NOT scroll thousands of lines.
3. Read the smallest line range that defends your answer (use \`sed -n 'a,bp' file\` or Read with offset+limit).
4. Read only the file(s) you actually need to cite.

${BUDGET_TABLE}
${ANSWER_FORMAT}`,

  'sweet-search-auto': `\
You are solving a code-understanding task in a repository indexed by Sweet
Search. You MUST use the Sweet Search auto/CatBoost-routed search tool —
this benchmark evaluates the main search pipeline (lexical / semantic /
hybrid / structural automatic routing) with token-budgeted agent packaging.

Available tools (call via Bash; they are on PATH):
  - ss-search "<query>" [--full] [-k N]
        → main sweet-search auto search. CatBoost decides lexical/semantic/
          hybrid/structural automatically based on the query shape. Returns
          a token-budgeted, agent-packaged response with per-result code
          blocks, confidence, and a structured route-metadata trailer.
          Use \`--full\` only when one strong result + multiple plausible
          alternatives are likely (8k budget instead of the default 4k).
  - ss-read <file> <start> <end>
        → exact line range. Allowed ONLY as a confirmation read after
          ss-search has already located the file/range (e.g. you need to
          quote a specific line). Open-ended start-to-EOF is not supported.

You MUST NOT in this condition:
  - run native rg, grep, sed, awk, head, tail, cat, jq, python, node, perl, xargs
  - use the native Read tool
  - use ss-grep, ss-find, or ss-semantic (these are evaluated under the
    separate sweet-search-tools/colgrep condition; using them here
    contaminates the comparison)
  - read \`.sweet-search/\` index files
  - edit, create, or move files

Bash is ALLOWLIST-ENFORCED. The ONLY leading commands you may run are:
  Sweet auto:    ss-search, ss-read, sweet-search
  Orientation:   pwd, ls, wc, find, echo, printf
Anything else (rg, grep, cat, sed, awk, head, tail, ss-grep, ss-find,
ss-semantic, python, node, etc.) is a policy violation.

═══════════════════════════════════════════════════════════════════════════
DEFAULT WORKFLOW — follow this unless the question demands otherwise:
═══════════════════════════════════════════════════════════════════════════
1. Phrase the question as ONE concise natural-language query and call:
     ss-search "<concise query>"
2. Inspect ONLY the top 3 results in the output. Each carries
   token-budgeted code with file/line/symbol metadata. The response also
   tells you whether the answer is "sufficient".
3. If the response gives you a tight chunk that answers the question,
   you are DONE — cite it and stop.
4. If the answer is incomplete, you may take AT MOST ONE follow-up:
     a. another, narrower ss-search query, OR
     b. a single ss-read <file> <start> <end> on a result the first call
        returned, when you need an exact quote for citation.
   Do not chain more follow-ups.
═══════════════════════════════════════════════════════════════════════════
HARD STOP RULES — read these BEFORE every follow-up tool call.
═══════════════════════════════════════════════════════════════════════════
A second call costs more tokens than it saves. Honour these stop rules
literally — they exist because the pack is intentionally tight, not
because evidence is missing.

STOP IMMEDIATELY (do NOT call another tool) when ALL of:
  - the trailer says \`sufficient=YES\`
  - the top-1 result has \`presentation=full\` AND a real symbol/type
    label in its header (e.g. \`[function: validate]\` not just \`(no name)\`)
  - the top-1's file is in actual source (lib/, src/, crates/, etc. — NOT
    docs/, test/, examples/, .github/)
  - you can defend the answer by pointing at the visible code

DO NOT call a second tool merely to:
  - "double-check" a line range — the lines shown ARE the lines
  - re-read a file the package already shows you
  - explore a helper you noticed in the chunk — its file:line in the
    rank list is sufficient citation; do not read it
  - confirm the answer "feels right"

Single counter-rule (only ONE follow-up allowed):
  - The question explicitly traces a multi-file flow ("how does X flow
    from A to B", "trace from entry to exit", "all places that ...").
    In that case ONE follow-up ss-search OR ONE ss-read is allowed,
    then stop.

If you find yourself wanting a third tool call, the answer is: STOP and
write what you have. Tightness beats certainty here — the bench rewards
correct concise answers, not exhaustive ones.
═══════════════════════════════════════════════════════════════════════════

${BUDGET_TABLE}
${ANSWER_FORMAT}`,

  'sweet-search-tools': `\
You are solving a code-understanding task in a repository indexed by Sweet
Search. You MUST use Sweet Search tools for discovery and reading.

Available agent-friendly wrappers (call via Bash; they are on PATH):
  - ss-grep "<regex>" [-k N]
        → indexed lexical grep (gram-prefiltered). Use for exact identifiers,
          constants, error codes, config keys, log strings.
  - ss-find "<query>" --regex "<regex>" [-k N]
        → ColGrep / patternSearch. Use for behavioural / semantic questions
          where lexical alone won't pinpoint the right chunk. The regex
          shrinks the candidate pool; the natural-language query re-ranks
          via late-interaction MaxSim.
  - ss-read <file>                  → whole file
  - ss-read <file> <start>          → ONE line (single-line read; NOT start-to-EOF)
  - ss-read <file> <start> <end>    → exact line range
        Open-ended start-to-EOF is not supported. To read a span, give an
        explicit end line.
  - ss-semantic <file> "<question>" [--max-tokens 800]
        → query-specific span(s) inside ONE file. Use ONLY when the right
          file is known but the relevant span is unclear.

You MAY also call \`sweet-search read\` and \`sweet-search read-semantic\`
directly (the wrappers are just shorter aliases).

Bash is ALLOWLIST-ENFORCED. The ONLY leading commands you may run via Bash are:
  Sweet tools:  ss-grep, ss-find, ss-read, ss-semantic, sweet-search
  Orientation:  pwd, ls, wc, find, echo, printf

Anything else — \`rg\`, \`grep\`, \`cat\`, \`sed\`, \`awk\`, \`head\`, \`tail\`,
\`python\`, \`node\`, \`perl\`, \`xargs\`, \`jq\`, etc. — will be flagged as a
policy violation, even at the start of a pipe or subshell. There are no
allowed shell tricks for reading file content; use \`ss-read\` or
\`sweet-search read\`.

You MUST NOT:
- use the native Read tool (use \`ss-read\` or \`sweet-search read\` instead)
- read \`.sweet-search/\` index files directly
- edit, create, or move files

═══════════════════════════════════════════════════════════════════════════
DEFAULT WORKFLOW — follow this unless the question demands otherwise:
═══════════════════════════════════════════════════════════════════════════
1. Pick ONE discovery call based on the question shape:
     • Exact symbol / string / error code / config key → ss-grep "<regex>"
     • Behavioural / semantic question                  → ss-find "<query>" --regex "<broad-regex>"
2. Inspect ONLY the top 3 results from that one discovery call.
3. If a result already gives you a tight chunk with line range that
   answers the question, you are DONE — cite it and stop. No further reads.
4. If a result identifies the file but the relevant span is unclear,
   call \`ss-semantic <file> "<question>"\` ONCE for that file.
5. If you need exact code at a known line range (to confirm a quote or
   line numbers for citation), call \`ss-read <file> <start> <end>\`.
6. Do NOT call \`ss-semantic\` on multiple files unless the question is
   explicitly multi-file.
7. Do NOT re-search with variants. If your first discovery returned
   nothing useful, broaden the regex ONCE; if still nothing, say so.
8. Prefer 1-3 high-confidence citations over a long list of partial hits.
═══════════════════════════════════════════════════════════════════════════

${BUDGET_TABLE}
${ANSWER_FORMAT}`,

  'sweet-search-structural': `\
You are solving a structural code-understanding task in a repository indexed
by Sweet Search. You MUST use the unified structural trace tool first.

Available tools (call via Bash; they are on PATH):
  - ss-trace <symbol> [--in <file>] [--query "<hint>"] [--depth N]
        → one structural context package: important callers, callees, and
          transitive impact paths, adaptively fitted to a token budget.
  - ss-read <file> <start> <end>
        → exact confirmation read. Allowed ONLY after ss-trace identifies
          a file/range and only when you need an exact citation.

Bash is ALLOWLIST-ENFORCED. The ONLY leading commands you may run are:
  Structural:  ss-trace, ss-read, sweet-search
  Orientation: pwd, ls, wc, echo, printf

You MUST NOT use ss-search, ss-grep, ss-find, ss-semantic, native rg/grep,
cat, sed, awk, head, tail, python, node, jq, or the native Read tool.
Each Bash call must be exactly one bare allowed command. You MUST NOT use
shell pipelines, redirects, command chaining, subshells, command
substitution, or truncation helpers: no \`|\`, \`>\`, \`<\`,
\`2>/dev/null\`, \`&&\`, \`;\`, \`$()\`, \`head\`, \`tail\`, \`cat\`,
\`sed\`, or \`grep\`.
Do not inspect Claude tool-result cache files.
If ss-trace output is long, answer from the visible structured sections; do
not use cat/grep/sed/head to re-read the tool output.

DEFAULT WORKFLOW:
1. Extract the concrete symbol from the question and call ss-trace once with
   a short --query hint copied from the task intent, e.g.
   ss-trace SYMBOL --query "callees response conversion helpers".
2. Use the callers/callees/impact sections directly when they answer the
   question. Read the "answer checklist" and "answer cues" lines first. If
   the checklist lists key symbols, preserve those names in \`symbols[]\` when
   they are part of your answer.
   If the checklist lists branch terms, include every listed branch term that is
   relevant to the question in your JSON answer or notes; do not drop an
   earlier branch just because later helper calls are more prominent.
   For conversion/helper/path questions, treat those branch terms as required
   coverage: copy them verbatim into the answer or notes when they describe a
   branch in the shown target code.
   If the checklist includes branch code, use those exact lines as the
   compact map of branch conditions before deciding which helpers matter.
   If the checklist includes related definitions or helper files that you rely
   on, cite those file ranges too; do not mention a helper symbol while omitting
   its file when the question asks for callees/downstream behavior.
   Preserve exact target terms / critical paths from the cues. Prefer cited
   file:line ranges already shown by ss-trace.
3. For impact/handoff questions, if the target or top callee code shows a
   named handoff callback that is not already resolved in the callees/impact
   sections, run at most two follow-up ss-trace calls for those concrete
   symbols.
   For these questions, cite the critical impact path that leaves the target
   function for the next lifecycle handler/dispatcher, even if that path is
   listed under impact rather than direct callees.
4. If ss-trace reports ambiguity and the chosen target is only a wrapper or
   delegates to the same symbol, follow exactly one listed alternative with
   --in before answering.
5. At most one ss-read confirmation is allowed, and only for a range returned
   by ss-trace.
6. Stop after that. Do not run broad searches to double-check the trace.
7. Preserve exact identifiers and exact domain phrases from the trace in the
   JSON answer and symbols, especially config fields, enum/status names,
   concrete return-shape words, and concurrency primitives.
8. For conversion/helper/path questions, enumerate the branch condition type
   names exactly as shown in the trace or confirmation read.

${BUDGET_TABLE}
${ANSWER_FORMAT}`,
};

// Default ordering — native first as the baseline, then conditions under test.
// `--condition=name1,name2,...` filters this set in run-bench.js.
export const MODE_ORDER = ['native-rg-read', 'sweet-search-tools', 'sweet-search-auto', 'sweet-search-structural'];

// Conditions that exercise sweet-search runtime/indexes/models.
// Used by the warmup phase to know whether to pre-warm.
export const SWEET_CONDITIONS = new Set(['sweet-search-tools', 'sweet-search-auto']);

export const TOOL_RULES = {
  // Native is the permissive baseline — any standard shell tool is fine.
  // We only forbid Sweet binaries (so native can't sneak the index in) and
  // the obvious destructive editing tools.
  'native-rg-read': {
    allowedTools: ['Bash', 'Read'],
    disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    // denylist (no allowedBashLeading → audit treats Bash as permissive)
    forbiddenBashSubstrings: [],
    forbiddenBashLeading: ['sweet-search', 'ss-grep', 'ss-find', 'ss-read', 'ss-semantic', 'ss-search', 'ss-trace'],
    readToolForbidden: false,
  },

  // Sweet-search-tools (a.k.a. colgrep condition): allowlist-based, the
  // agent may only run the indexed-grep / ColGrep / read / read-semantic
  // wrappers. This is the ESTABLISHED regression baseline — do not change
  // without a benchmark gate.
  'sweet-search-tools': {
    allowedTools: ['Bash', 'Read'],   // Read kept allowed at the CLI layer but flagged by audit
    disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    forbiddenBashSubstrings: [],
    forbiddenBashLeading: [],          // unused in allowlist mode
    allowedBashLeading: [
      // Sweet tooling
      'ss-grep', 'ss-find', 'ss-read', 'ss-semantic', 'sweet-search',
      // Harmless orientation only
      'pwd', 'ls', 'wc', 'find', 'echo', 'printf',
    ],
    readToolForbidden: true,
  },

  // Sweet-search-auto: the new condition under test. The agent is restricted
  // to the main sweet-search auto/CatBoost path (ss-search) plus a single
  // confirmation ss-read. Specifically excludes ss-grep/ss-find/ss-semantic
  // so the comparison isolates the main search pipeline + agent packaging.
  'sweet-search-auto': {
    allowedTools: ['Bash', 'Read'],
    disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    forbiddenBashSubstrings: [],
    forbiddenBashLeading: [],
    allowedBashLeading: [
      // Sweet auto-search + read; intentionally NOT ss-grep/ss-find/ss-semantic.
      'ss-search', 'ss-read', 'sweet-search',
      // Harmless orientation only
      'pwd', 'ls', 'wc', 'find', 'echo', 'printf',
    ],
    readToolForbidden: true,
  },

  // Sweet-search-structural: isolates the unified trace tool. This condition
  // is for caller/callee/impact tasks and must not fall back to search modes.
  'sweet-search-structural': {
    allowedTools: [
      'Bash(ss-trace *)', 'Bash(ss-read *)', 'Bash(sweet-search *)',
      'Bash(pwd)', 'Bash(ls *)', 'Bash(wc *)', 'Bash(echo *)', 'Bash(printf *)',
    ],
    disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    forbiddenBashSubstrings: [],
    forbiddenBashLeading: [],
    allowedBashLeading: [
      'ss-trace', 'ss-read', 'sweet-search',
      'pwd', 'ls', 'wc', 'echo', 'printf',
    ],
    readToolForbidden: true,
  },
};
