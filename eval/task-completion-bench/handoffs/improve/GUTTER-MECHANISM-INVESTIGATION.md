# Read-gutter delimiter — per-harness mechanism, from the traces

**Date:** 2026-08-26. **Scope:** the nine 2026-08-24/25 runs behind
[`GUTTER-AB-RESULTS.md`](./GUTTER-AB-RESULTS.md). **Method:** read-only over the
traces and the deployed binaries on the evidence box. No rollout was launched, nothing
under `results/` was changed. **Scripts:**
[`phase1-scripts/gutter-mechanism/`](./phase1-scripts/gutter-mechanism/) (they ran from
`/tmp/gutter-inv/` on the box and import each other from there).

Every claim below is tagged. **[M]** = measured in a trace or a binary. **[C]** = read
from a tool contract (source or the deployed binary). **[I]** = inferred.

---

## 0. Verdict

**The tab-versus-pipe story survives on claude-code only, and even there it cost no
rollout in this run. On codex and opencode the delimiter has no mechanism in the traces.
The +3 rollouts per harness are inside noise. Two aggregate claims in the A/B report were
census artefacts.**

1. **"Codex never produces an anchor failure" is false.** [M] The census script never
   counted codex edits: its codex branch has no edit logic
   (`phase1-scripts/gutter-cross-report.mjs:40`). Codex edits are shell heredocs
   (`apply_patch <<'PATCH'` inside `exec_command`), and they fail under every delimiter:
   3/25 TAB, 2/24 PIPE, 3/29 NONE, and 7/27 on native.
2. **Every codex and opencode failure is a body-text or hunk-order error. None is
   gutter whitespace.** [M][C] Both harnesses seek context with four passes (exact,
   trailing-trim, full-trim, unicode-normalise). A leaked leading space cannot fail them.
   No failed patch contained gutter residue (0 of 26 failed calls).
3. **On claude-code the pipe carry is real but rare.** [M][C] The Edit prompt tells the
   model to strip "line number + tab". Under PIPE, one edit in 105 carries exactly +1
   space. The 2026-08-11 census, re-run today, finds 14 of 19 located sweet whitespace
   failures were exactly +1, and 0 of 4 native ones. All three 2026-08-25 indentation
   failures sat in rollouts that still resolved.
4. **Only ss-read carries a gutter in the benchmark.** [M] The wrappers write ss-search,
   ss-find and ss-semantic code raw (`eval/agent-read-workflows/bin/_ss-helpers.mjs:731`,
   `:440`, `:843`). 27–36% of delivered code lines are un-gutted in every condition, and
   5–10% of edits anchor on them. "A delimiter change is already global" is true of the
   core library, not of what the agent received.
5. **All three harnesses ran the same model**, `openai/gpt-5.6-luna` (every `rows.json`).
   [M] The harness differences are tool contracts and prompts, not model differences.

**Noise arithmetic** (two-sided Fisher exact, n = 18 per cell): codex TAB 10/18 vs PIPE
13/18, p = 0.49; opencode 11/18 vs 14/18, p = 0.47; claude-code 11/18 vs 12/18, p = 1.00;
pooled TAB 32/54 vs PIPE 39/54, p = 0.22. The in-flight fresh-rotation run is the right
instrument for the resolution question. This document answers the mechanism question.

---

## 1. What each harness is, from primary sources

| harness | deployed version | model | read surface the harness itself provides | edit surface the model used | context matching |
|---|---|---|---|---|---|
| claude-code | 2.1.218 (`/root/.local/share/claude/versions/2.1.218`) | gpt-5.6-luna | `Read` → `N<TAB>content`, unpadded [M] | `Edit(old_string)` — 63 to 105 calls per cell | exact substring; only fallback is `\uXXXX` escape swapping [C] |
| codex | codex-cli 0.146.1 (OpenRouter, `wire_api = "responses"`) | gpt-5.6-luna | none; the model runs `sed -n`, `cat`, `nl` [M] | `exec_command` with `apply_patch <<'PATCH'` heredoc — 24 to 29 per cell [M] | 4-pass seek from a moving line index [C] |
| opencode | 1.18.4 | gpt-5.6-luna | `read` → `N: content` [M] | `apply_patch(patchText)` — 29 to 33 per cell; the fuzzy `edit` tool was called 0 times [M] | TypeScript port of codex's seek, same 4 passes [C] |

### 1.1 claude-code `Edit` [C]

Strings in the deployed binary:

- Prompt: *"Strip the Read line prefix (line number + tab) before matching."* and *"preserve
  the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line
  number prefix format is: … Everything after that is the actual file content to match.
  Never include any part of the line number prefix in the old_string or new_string."*
- Uniqueness: *"The edit will FAIL if `old_string` is not unique in the file."* Error:
  *"Found ${g} matches of the string to replace, but replace_all is false."*
- Not found: *"String to replace not found in file."* The trace variant adds *"(note: Edit
  also tried swapping \uXXXX escapes and their characters; neither form matched …)"*, which
  is the only tolerance the tool has. No whitespace normalisation exists.
- Raw `Read` output in a native trace [M]: `'1\t#\' Grade code against a solution\n2\t#\'…'`
  (`rb-claudecode-20260824/agent-state/rstudio-education__gradethis-161-native/…`).

So the model is trained and instructed on `N<TAB>`. The sweet arm's ss-read under TAB
matches that declared prefix byte for byte. Under PIPE the model must improvise a
stripping rule the harness never taught it.

### 1.2 codex `apply_patch` [C]

- Grammar compiled into the binary: `change_line: ("+" | "-" | " ") /(.*)/ LF`. The
  streaming parser rejects any other first character: *"Unexpected line found in update
  hunk … Every line should start with ' ' (context line), '+' (added line), or '-' (removed
  line)"*. An empty line is accepted as empty context.
- `seek_sequence` (codex-rs/apply-patch/src/seek_sequence.rs) runs four passes in order:
  exact; `trim_end` on both sides; `trim` on both sides; then unicode punctuation and
  space normalisation. It searches forward from the current index.
- `file_update.rs` applies chunks in order with a **moving `line_index`**. A `@@` header
  is located first; then the old lines. Errors: *"Failed to find context '…' in …"* and
  *"Failed to find expected lines in …:\n…"*. Both strings are present in the 0.146.1
  binary.
- On this box the model never received an `apply_patch` function tool. Its
  `base_instructions` (in `session_meta`) say *"Use the `apply_patch` tool to edit files …
  {"command":["apply_patch","*** Begin Patch\n…"]}"* and every edit in the traces is an
  `exec_command` heredoc [M]. The contract is the same seek either way.
- Output wrapper [M]: `Chunk ID / Wall time / Process exited with code N / Original token
  count: N / Output:`. Over ~2,500 tokens the output is truncated middle-out:
  *"Warning: truncated output (original token count: 2910)"* and inline
  `…410 tokens truncated…` (§5.3).

### 1.3 opencode `apply_patch` and `edit` [C]

- `packages/opencode/src/patch/index.ts` `seekSequence`: exact → `trimEnd` → `trim` →
  `normalizeUnicode(trim)`. Same error strings as codex, prefixed
  `apply_patch verification failed: Error:` (present in the 1.18.4 binary). The parser
  treats an unprefixed line as context.
- `edit` tool: nine fuzzy replacers (line-trimmed, whitespace-normalised, indentation-
  flexible, block-anchor, …). **Never called in these runs** (0 of 18 rollouts per cell).
- Prompt strings in the binary: *"Contents are returned with each line prefixed by its
  line number as `<line>: <content>`"* and *"The line number prefix format is: line number
  + colon + space (e.g., `1: `). … Never include any part of the line number prefix in the
  oldString or newString."* Raw native `read` output in a trace [M]:
  `<content>\n1: #' Grade code against a solution\n2: #'…`.

So opencode's own declared prefix is delimiter-plus-space, the same shape as `N| `, and
its edit path forgives leading whitespace anyway.

---

## 2. The census had two defects

**2.1 Codex edits were never counted.** [M] `gutter-cross-report.mjs` sets `isEdit` and
`edits++` only in the opencode and claude branches. The codex branch (line 40) records
call arguments and scans outputs for gutter lines, nothing else. "0/0 edits" meant
"unmeasured". The corrected counter treats an `exec_command` whose `cmd` starts with or
contains `apply_patch <<` as an edit and classifies its output.

**2.2 Edit-level rates are inflated by retries inside one rollout.** [M] The claude-code
PIPE figure 8/105 comes from three transcripts; NONE's 8/71 from five; TAB's 1/63 from
one. Rollouts-with-failure (TAB 1/18, PIPE 3/20, NONE 5/19; p = 0.61 and 0.18 against TAB)
is the honest unit, and it is inside noise.

## 3. Corrected numbers, six tasks, sweet arm

Transcripts include retried attempts (claude-code PIPE has 20 for 18 rollouts, NONE 19).

| harness / condition | edit calls | failed calls | rollouts with ≥1 failure | what the failures were |
|---|---:|---:|---:|---|
| codex TAB | 25 | 3 | 2 | 1 comment re-wrap (underscore), 1 hunk-order / ambiguous context, 1 body paraphrase (gradethis) |
| codex PIPE | 24 | 2 | 2 | 2 comment re-wrap (underscore) |
| codex NONE | 29 | 3 | 3 | 2 comment re-wrap (underscore), 1 dropped roxygen indent (gradethis) |
| codex native | 27 | 7 | 6 | 3 comment re-wrap, 1 docstring re-wrap, 2 body paraphrase, 1 hunk-order |
| opencode TAB | 32 | 3 | 3 | 2 docstring re-wrap (pytask), 1 hunk-order (gradethis) |
| opencode PIPE | 33 | 2 | 2 | 2 comment re-wrap / paraphrase (underscore) |
| opencode NONE | 29 | 3 | 2 | 1 comment re-wrap, 1 hunk-order, 1 body paraphrase |
| opencode native | 30 | 3 | 3 | 2 comment re-wrap, 1 roxygen interior whitespace |
| claude-code TAB | 63 | 1 | 1 | 1 anchor on text the agent had inserted earlier |
| claude-code PIPE | 105 | 8 (+10 other) | 3 | 2 decoding garbage, 3 own-insert anchors, 1 comment re-wrap, **1 exact +1 space, 1 +2 space** |
| claude-code NONE | 71 | 8 (+2 other) | 5 | 1 garbage (zero-width joiner), 5 roxygen transcription, 2 own-insert anchors |
| claude-code native | 84 | 1 (+1 other) | 1 | 1 body error |

"Other" on claude-code: seven *"No changes to make: old_string and new_string are exactly
the same"* (a loop on pytask) and five *"InputValidationError … could not be parsed as
JSON"* on 32–65 KB Edit inputs. Neither is delimiter-related.

**Gutter residue inside a failed hunk or `old_string`: 0 of all failures, every
condition.** [M] The model always strips the number; the question is only what it does
with the character after it.

---

## 4. Mechanism per harness, with the bytes

### 4.1 claude-code — the story survives, smaller than the aggregate suggests

**Mechanism [C]+[M].** The harness declares the prefix as *"line number + tab"* and renders
`N<TAB>` itself. Under TAB the sweet arm's ss-read output is byte-identical in shape to
the harness's own `Read`, and the trained stripping rule applies. Under PIPE the model
improvises, and sometimes strips `35|` rather than `35| `.

**The clean case [M].** `gx-cc-pipe-20260825/agent-state/rstudio-education__gradethis-161-sweet/claude-home/projects/-root--ss-eval-runs-r2-10/78fdb3c7-cbc0-4ffb-a436-0684a6ad5fb4.jsonl`:

- most recent read of the region, via `ss-read` under PIPE:
  `'35|       res <- detect_mistakes('` (6 content spaces after `35| `)
- on disk, `R/detect_mistakes.R:35`: `'      res <- detect_mistakes('` (6 spaces)
- attempted `old_string` line 1: `'       res <- detect_mistakes('` (**7 spaces**) — the
  exact signature of stripping `35|` and keeping the delimiter's space; every line of the
  seven-line anchor is +1.
- the preceding attempt in the same transcript was +2 on every line (8 spaces). A third
  +2 case sits in transcript `f5f1138d` (`"` please rewrite with `"` line, 14 spaces
  attempted against 12 on disk, last shown as a `+`-prefixed diff line inside an Edit
  result). The +2 cases cannot be tied to one mechanical strip; they are inflation after
  mixed exposure (pipe gutter from ss-read, `+` diff lines and `cat -n` tabs from Edit
  results). Both transcripts resolved (rows: gradethis rep2, `resolved=true`, `f2p=1`).

**The 2026-08-11 evidence, re-verified today [M].** `d7-whitespace-origin.mjs` re-run
read-only over `sb-claudecode-20260811` + `screen-v3-20260812`: 23 located whitespace
mismatches; sweet 19, native 4. Sweet indent deltas: 6→7 ×6, 10→11 ×3, 4→5 ×3, 12→13 ×1,
8→9 ×1 = **14 exactly +1**; native deltas are +2 and +4 only. All 19 sweet regions were
"never shown exactly", because ss-read showed them as `N| `. The original claim stands.

**What the other PIPE failures were [M].** Two identical decoding-garbage anchors
(`…“}]} ખા̈ડા? invalid JSON quote…`); three anchors on text the agent had itself inserted
earlier in the transcript (`absent.py`: `allow_partial_matching = …`, `partial_match <-
function`, and the `"` please rewrite` line); one roxygen re-wrap (`glue_pipe` — the model
joined a wrapped comment line; this is the only PIPE failure inside an unresolved rollout,
rep0, and the same error type appears under NONE).

**NONE is not a control for "no gutter is fine" [M].** Its eight not-found failures are
one zero-width-joiner corruption, two own-insert anchors, and five transcriptions of a
roxygen block shown by ss-read *without* a gutter: `"#' known correct answer."` attempted
against `"#'   known correct answer."` on disk, and `"…matches a"` attempted against
`"…matches"` (re-wrap). Four transcripts of gradethis carry them. Whether an un-numbered
read makes prose comments harder to copy is not decidable at n = 5 in one task.

**Resolution [M].** TAB 11, PIPE 12, NONE 10 of 18. The rollouts that lost were not the
rollouts with indentation failures.

### 4.2 codex — the story does not survive; here is the one that does

**Whitespace cannot be the mechanism [C].** Pass three of `seek_sequence` compares
`line.trim()` to `pattern.trim()`. A context line with one extra leading space matches on
that pass. A tab-indented file with a `N<TAB>` gutter is also harmless: the model must
strip the number to build a `" "`-prefixed context line at all, and 0 of 26 failed patches
contained residue.

**What actually fails [M].** Two things, equal across TAB, PIPE and NONE:

1. **Memorised-comment re-wrap.** `underscore.js:457-459` on disk is
   ```
     // Counts instances of an object that group by a certain criterion. Pass
     // either a string attribute to count by, or a function that returns the
     // criterion.
   ```
   Every harness and both arms emit the comment as two lines, joining "the criterion." onto
   line 458 — codex sweet TAB (`rb-codex-20260825/…/rollout-2026-08-25T11-04-46-01a03898-…`,
   call `call_ne9iyM7FpuWGnnfK5z3xrMgL`), PIPE ×2, NONE ×2, native ×3, opencode PIPE ×2,
   NONE ×1, native ×2. In the TAB case the exact bytes had been on screen through ss-read
   (`457\t  // Counts instances…`) and were not copied. This is the model's memory of a
   different underscore.js release winning over the read.
2. **Hunk order and ambiguous context.** apply_patch applies hunks from a moving index.
   In `rb-codex-20260825/…/rollout-2026-08-25T11-19-33-01a038a5-…` (gradethis, TAB) the
   detect_mistakes.R patch places its chunks at base lines `[1], [38|247|252], [176], [193],
   [10|13|27], [38|247|252], [377], [38|247|252], [377]` — a chunk at line 10 after one at
   193, and a one-line context `        env = env,` that exists at 38, 247 and 252. The
   tool reports *"Failed to find expected lines"* although the text is in the file
   (`order.py`). The same shape appears in codex native (1 patch) and opencode
   (`user <- call_standardise_formals` at 272 after a chunk at 313).

**Why the resolution table moved anyway [M].** The three TAB losses that PIPE recovered
are underscore rep1 (the countBy hunk failed and the model did not retry: `f2p=0.5`,
`hunks=1`) and gradethis rep0 and rep2. Under PIPE the two underscore rollouts with the
same failure retried and resolved; gradethis had no failures at all. Under NONE gradethis
rep0 failed with twelve failing chunks. Retry-after-failure is model stochasticity; there
is no delimiter signal in it.

**A real codex-only difference, measured [M].** codex truncates every tool output over a
fixed cap: over 665 `exec_command` outputs the largest untruncated was 2,459 tokens and the
smallest truncated 2,511; `config.toml` sets no limit; the model's own `max_output_tokens`
(4,000–20,000 in the calls) does not bind. Truncation is middle-out with the line numbers
jumping, e.g. `194\t        maybeAnnotateSource(…410 tokens truncated…l);` then `227\t  }`.
ss-read outputs truncated per condition: TAB 12/84, PIPE 11/89, NONE 6/65 (p = 0.45 TAB vs
NONE). **The follow-on hypothesis — the model then edits the missing middle from memory —
was checked at $0 and is nearly dead:** of the never-shown codex anchors, 0 of 4 (TAB) and
0 of 2 (PIPE) fall inside a truncated span; NONE's 3 of 6 is a file-level match because
NONE has no line numbers to locate the gap (`trunc_overlap.py`).

### 4.3 opencode — no mechanism, and the harness's own prefix is `N: `

Same seek as codex [C], same failure types [M] (pytask docstring re-wrap ×2 under TAB, the
underscore comment ×3, hunk order ×2, one paraphrase, one roxygen interior-space case on
native). Rates: 3/32, 2/33, 3/29, native 3/30.

The pytask swing (TAB 0/3 → PIPE 3/3 → NONE 1/3) has no edit-failure behind it under PIPE
[M] (`traj.py`): the PIPE rollouts shipped 4–5-hunk patches, two of them after reading the
whole file with opencode's native `read`; the TAB rollouts shipped 1–2-hunk patches after
`ss-read` windows and whole-file reads alike. Teleport went the other way (TAB 2/3, PIPE
and NONE 0/3) with zero edit failures in any condition. These are task-level swings at
n = 3, not a delimiter effect.

---

## 5. Surface coverage, the 15-line threshold, and truncation

### 5.1 Which surfaces number lines [M][C]

| surface | renderer in the benchmark | gutter | share of delivered code lines, 13-task sweet runs |
|---|---|---|---|
| ss-read | `_ss-helpers.mjs:592` → shared `numberCodeLines` | yes, ≥ 15 lines | codex 15,360 · opencode 18,632 · claude 20,146 lines numbered |
| ss-search hits | `_ss-helpers.mjs:731` writes `${r.code}` raw | **no** | codex 7,876 · opencode 6,556 · claude 9,272 lines un-numbered |
| ss-find hits | `_ss-helpers.mjs:440` writes `${r.code}` raw | **no** | 62 · 67 · 133 |
| ss-semantic spans | `_ss-helpers.mjs:843` writes `${span.text}` raw | **no** | 517 · 265 · 156 |
| ss-grep | `renderGrepBody` → `path:line: text` | grep form | 1,131 · 1,489 · 1,406 |
| Edit / apply_patch result snippets | harness | claude `cat -n` tab; opencode diff | — |

The core library does number search hits (`core/search/search-server.js:657`, used only by
the HTTP route at `:1101`) and semantic spans (`core/search/search-read-semantic.js:880`),
both with the same ≥ 15 rule. The benchmark wrappers bypass both. Result: **36% (codex),
27% (opencode), 33% (claude) of delivered code lines carry no gutter in every condition**,
and 131 of the codex ss-search hit blocks were ≥ 15 lines. An ss-search sample from
`rb-codex-20260825/…/akinsho__nvim-bufferline.lua-173-sweet` confirms the raw form.

### 5.2 How often the agent edits from an un-numbered or short span [M]

Provenance = the most recent prior tool output containing the anchor's first line
(`provenance.py`, six tasks, sweet):

| harness / condition | anchored on ss-read ≥ 15 | on ss-read < 15 | on ss-search / find / semantic (raw) | never shown by any output |
|---|---:|---:|---:|---:|
| codex TAB / PIPE / NONE | 46 / 42+7 / 71 | 0 / 0 / 2 | 8 / 7 / 0 | 4 / 2 / 5 |
| opencode TAB / PIPE / NONE | 58 / 64+1 / 68 | 1 / 1 / 0 | 7 / 11 / 4 | 5 / 9 / 2 |
| claude TAB / PIPE / NONE | 36 / 57 / 38 | 0 / 3 / 2 | 8 / 11 / 10 | 9 / 23 / 13 |

Sub-15 ss-read blocks are 2–4% of all ss-read outputs (codex 4 of 197, opencode 4 of 212,
claude 9 of 243 in the 13-task runs) and at most three anchored edits per cell. Mixed
gutter and no-gutter output is the **norm**, not the exception: every rollout that used
both ss-search and ss-read saw both forms. With three indentation-inflation failures in
total, no correlation between mixing and failure can be established at this n.

**The threshold is unmeasured, not defended.** [M] It arrived with the gutter itself in
`7160f47` (2026-08-05, "N| gutter >=15 lines") and the only rationale is the code comment
"short reads don't need it and the prefix is pure token cost". The −16% cost win in
`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` measured the lever, never the threshold. At
these volumes it is immaterial either way.

### 5.3 What else differs between what codex and claude-code receive [M]

| | codex | opencode | claude-code |
|---|---|---|---|
| tool-output cap | ~2,500 tokens, middle-out, always on (68 truncations in the 13-task sweet run) | none observed | `BASH_MAX_OUTPUT_LENGTH` 30,000 chars, marker `[… N lines truncated] …`; 0 hit |
| output envelope | Chunk ID / wall time / exit code / token count header | plain | plain |
| harness read surface used in sweet arm | `sed -n` 23, `nl` 11 calls (13 tasks) | native `read` 5 | native `Read` 5 |
| edit feedback | `Success. Updated the following files:` | unified diff of the change | `cat -n` snippet with `N<TAB>` |
| instruction file | AGENTS.md | AGENTS.md | CLAUDE.md |

The M± memory text and the frame say nothing about line numbers, prefixes or copying
(`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`,
`harness/agent-runner-shared.mjs`). The only prefix instructions the model ever sees are
the harnesses' own.

### 5.4 Token cost of each gutter [M]

Exact `o200k_base` counts over 2,000 lines of the four golden files that carried the
failures (`underscore.js`, `grade_code.R`, `detect_mistakes.R`, `traceback.py`), 100-line
windows:

| form | tokens per line | overhead per line | ratio to no gutter |
|---|---:|---:|---:|
| none | 8.66 | — | 1.000 |
| `N<TAB>` (shipped) | 10.11 | +1.45 | 1.167 |
| `N\| ` (pipe) | 11.04 | +2.38 | 1.275 |
| `N: ` (opencode's own) | 11.04 | +2.38 | 1.275 |
| padded `cat -n` | 12.11 | +3.45 | 1.398 |

Codex's own count on the one identical read that ran in all three conditions
(`ss-read R/grade_code.R 1 220`): none 1,393, tab 1,533 (+10%), pipe 1,575 (+13%). Against
the codex cap, a plain read crosses 2,500 tokens at about 289 lines, tab at 247, pipe at
226. The tab is the cheapest gutter by 0.93 tokens per line, which is 14,000 tokens per
13-task sweet run on codex.

---

## 6. Which claims a trace supports, and which are contract reading

| claim | basis |
|---|---|
| codex edits fail 3/25, 2/24, 3/29, 7/27; census counted none | [M] `census.py` |
| all codex/opencode failures are body text or hunk order; 0 gutter residue | [M] `forensics.py`, `order.py` |
| seek is whitespace-tolerant on both, so +1 space cannot fail them | [C] `seek_sequence.rs`, `patch/index.ts`, strings in both binaries |
| claude-code strips `N<TAB>` because its prompt says so | [C] binary strings; [I] that the instruction causes the behaviour |
| +1 carry exists under PIPE (1 of 105 today; 14 of 19 on 2026-08-11) | [M] `78fdb3c7…jsonl`; `d7.mjs` re-run |
| the +2 cases are mechanically unexplained | [M] bytes; [I] "inflation after mixed exposure" |
| resolution deltas are noise | [M] counts; [I] Fisher at n = 18 |
| search/find/semantic hits are un-numbered | [M] wrapper source and trace samples |
| codex caps tool output at ~2,500 tokens, middle-out | [M] 665 outputs bracket 2,459/2,511; no config override |
| truncation → edit-from-memory is nearly dead | [M] 0 of 6 never-shown anchors in a truncated span |
| token cost per gutter form | [M] tiktoken over golden files |
| same model on all harnesses | [M] rows.json |
| pytask/teleport swings are task variance | [M] storylines; [I] "variance" |

---

## 7. Proposals, ranked by expected effect per unit of risk

Each has the mechanism, the surfaces touched, the cheapest falsifier, and the result that
kills it. The dispatch point for any per-harness choice already exists:
`SS_READ_GUTTER` is read once at module load in `core/search/search-read.js:673`, every
wrapper sources `_ss-env.sh`, and the three task runners own the shim environment. A
fourth value (`colon`) is a one-line enum change. In production, `init` already writes
per-harness files (CLAUDE.md / AGENTS.md) and can set the same variable.

**R1 — Keep `N<TAB>` on claude-code; keep it everywhere until a mechanism appears.**
Mechanism: matches the harness's declared prefix; cheapest form by 0.93 tokens per line;
the two whitespace-tolerant harnesses cannot be hurt by it. Surfaces: none change.
Falsifier: the in-flight fresh rotation, with its pre-registered bar (PIPE − TAB ≥ +6 of
75). Kill: the rotation clears the bar on codex or opencode **and** the traces of that run
show a mechanism (gutter residue in failed hunks, or +1 carries under TAB). A bar cleared
without a mechanism is a reason to re-check the ledger, not to ship pipe.

**R2 — Number ss-search, ss-find and ss-semantic blocks in the wrappers through the
shared renderers.** Mechanism: 27–36% of delivered code is un-numbered and 5–10% of edits
anchor on it; the model then has no line numbers to target a range read or an edit span.
Surfaces: `_ss-helpers.mjs:440`, `:731`, `:843` (route through `renderAgentSearchResponse`
and the semantic formatter, which already apply the ≥ 15 rule). Cost: about 8,600 lines ×
1.45 tokens ≈ 12,500 tokens per 13-task sweet run, roughly 320 tokens per rollout.
Falsifier: claude-code, the same six tasks × 3 reps, counting rollouts-with-anchor-failure
and edits anchored on search hits. Kill: no drop in failures anchored on search hits
(baseline codex TAB 3 of 4 ss-search-anchored chunks, claude 0 of 5) or cost per rollout up by more than 3%.

**R3 — Replace the edit-failure census.** Mechanism: process. The corrected counter
(`census.py`) counts codex heredocs, classifies the harness error strings, and reports
rollouts-with-failure beside edit-level rates. Surfaces: `phase1-scripts/`. Falsifier:
none needed; it is a bug fix. Kill: none.

**R4 — On opencode, try `N: ` only if the rotation replicates.** Mechanism: it is the
prefix opencode's own prompt declares, so the trained stripping rule applies. Expected
anchor effect ≈ 0 because apply_patch forgives whitespace; token cost equals pipe. Surface:
the `GUTTER_DELIMITER` enum. Falsifier: the fresh rotation first; then `N: ` vs `N<TAB>`
on the 25 rotation tasks × 3 reps, opencode only. Kill: rotation PIPE − TAB < +6, or the
colon arm not beating tab by the same +6 bar.

**R5 — Drop the 15-line threshold.** Mechanism: consistency; every read gets numbers.
Effect ≈ 0 (2–4% of reads, ≤ 3 anchored edits per cell); cost ≤ 300 tokens per 13-task run.
Surfaces: `search-read.js:701`, `search-server.js:657`, `search-read-semantic.js:880`,
`_ss-helpers.mjs:592`. Falsifier: bundle with R2; no separate run. Kill: none.

**R6 — Codex: keep rendered ss-read under the cap.** Mechanism: middle-out truncation
deletes the lines the model later edits. Surfaces: `cmdRead` in `_ss-helpers.mjs` (the
parked `SS_READ_WINDOW` tier, or a split-with-continue-trailer above ~230 lines under
codex). **Already nearly dead at $0:** 0 of 6 never-shown anchors under TAB/PIPE sat in a
truncated span. Remaining falsifier: re-render NONE's 3 file-level hits with line numbers
to see whether any sits in a gap. Kill: fewer than 1 in 10 never-shown anchors in a gap,
which is the current reading.

**R7 — apply_patch harnesses: no render-side lever exists.** The dominant failure is a
memorised-comment re-wrap (9 of 15 codex-arm failures, 7 of 11 opencode) and out-of-order
or ambiguous hunks (2 of 5 codex gradethis failures, 2 of 3 on opencode). A prompt clause ("hunks in file
order; anchor on code lines, not comment lines") is the only candidate and the clause
graveyard (`project_clause_candidate_dead`) argues against it. Falsifier at $0 first: the
share of failed patches that are out-of-order across the 13-task runs. Kill: below one
third, or a 6 × 3 clause A/B that does not halve failed patches.

**What not to do.** Do not ship `N| ` to codex or opencode on the six-task evidence. The
tab has no mechanism against it on those harnesses, the pipe has none for it, and the
pipe costs 0.93 tokens per line more.

---

## 8. Reproduction

Box: `root@167.233.69.121`, results under
`/root/sweet-search-private/eval/task-completion-bench/results/<RUN>/`. Scripts in
[`phase1-scripts/gutter-mechanism/`](./phase1-scripts/gutter-mechanism/); copy them to
`/tmp/gutter-inv/` on the box (they import each other from that path) and run:

- `census.py` — edits, failures, error classes, ss-read block sizes and gutter form per
  run/arm (`--all` for 13 tasks)
- `forensics.py` — every failed edit: anchor vs golden base vs the read that showed it
- `provenance.py` — which surface and gutter form each edit anchored on; rollouts with
  failures
- `surfaces.py` — code lines per surface and gutter form, sub-15 blocks, truncation markers
- `codex_trunc.py`, `codex_tok.py`, `cap_and_samples.py` — codex cap, truncation shape,
  token counts, ss-search sample, claude PIPE failure → outcome mapping
- `order.py` — hunk positions in the base file for text-exists failures
- `absent.py` — whether an absent-from-base anchor was the agent's own earlier insert
- `traj.py` — tool-call storylines for the pytask cells
- `trunc_overlap.py` — never-shown anchors vs truncated spans
- `rows_dump.py` — per-rollout outcomes and the model field

Tool contracts: `codex-rs/apply-patch/src/{seek_sequence,file_update,streaming_parser}.rs`
(openai/codex, main), `packages/opencode/src/patch/index.ts` and `tool/apply_patch.ts`
(sst/opencode, dev), and the strings in the deployed binaries listed in §1. Token counts:
`tiktoken` `o200k_base` in a scratch venv over the golden files.
