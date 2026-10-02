# Observations — sweet-search vs native retrieval

Things the owner noticed while reading forensic replays. Each entry: the observation, the
evidence, and (when agreed) a possible product change. A product change here is an idea, not a
decision.

Source artifact: [Sweet-search Cost Forensics](https://claude.ai/artifact/XWUTDq4pZ75Pa1CUUrnFbW)
(r3-hard dev, side-by-side replays).

---

## 2026-10-01 — ss-grep should return the full hit line, like `grep -n`

**Status 2026-10-02: SHIPPED on branch obs-loop (d2ec22bd, e9562e93), default ON; opt-out `SS_FIX_GREP_FULLLINE=0`.** Micro-smoke A/B (11 r3-hard dev questions × 2 reps): Codex + Sol cost −8.0%, calls −8.6%, score +1.7 pts; Claude Code + Opus cost −3.4%, calls −5.7%, score +2.1 pts (all CIs cross 0). Traces: fewer and narrower reads; greps with 100+ hits about 2× larger. `core/prompt-optimization/data/obs-loop/TRACES-fl.md`.

**Observation (owner):** We should consider advising in the rules for ss-grep to use the
full-line output, so that we get the full lines for each hit. It might cost more in the first
call, but it will cost less down the line.

**Example — replay `r3hb-grdb-02` (Claude Code + Opus 5.5 medium) in the artifact:**
- Native request 1: `grep -rn "...|..." GRDB` returned 1,728 tok. Every hit was
  `file:line: full source line`, so the agent saw which hit was a definition, a comment, or a call.
  In the next request it read 5 exact `sed` ranges and had all it used (3,387 tok of reads in total).
- Sweet request 0: `ss-grep "willCommit|commitHook|sqlite3_commit_hook|transactionWillCommit" -k 30`
  returned 2,226 tok, but each hit showed only the matched word
  (`TransactionObserver.swift:240: sqlite3_commit_hook (+8 more in this file)`). The agent had no
  line map, so it sent 2 more scoped `ss-grep` calls (1,136 tok), then read one wide 260-line range
  (3,159 tok). Sweet total tool output 11.4k tok vs native 5.1k; cost $0.255 vs $0.118.

**Facts checked in code:**
- `grep -n` adds line numbers; the full line is plain grep's default output. ss-grep already prints
  line numbers. What it lacks is the line text.
- ss-grep has no option for the full line today. The full line is already in each match record
  (`content`, `core/search/search-pattern-ripgrep.js:343`), but the agent formatter prints only the
  matched part (`matchText`, `core/search/grep-output-shaping.js:229`). No commit chose this on
  purpose; the tests set both fields to the same string, so they cannot catch it.

**Recommended product change:** ss-grep returns the full hit line by default (whitespace collapsed,
capped at 140 chars, which the formatter already does). No flag and no rule text: the agent gets the
line map on every call without having to know about an option. Rejected alternative: a flag plus a
rule telling the agent to use it — it adds prompt tokens on every request and depends on the agent
following the rule. Measure with a small dev A/B: tokens of the first grep vs requests and read
tokens saved later.

**Confounder in this example:** the GRDB index followed the `Tests/CustomSQLite/GRDB -> ../..`
symlink loop (97% of indexed files were copies), which inflated sweet's grep output. That is a
separate bug.

---

## 2026-10-01 — Re-test ss-read with no line-number gutter, on Opus 5.5 and GPT-6.1 Sol

**Status 2026-10-02: SHIPPED for Claude Code on obs-loop (d4191021): default gutter `none`** (Codex was already `none`; opencode unchanged). Task micro-smoke, Claude Code + Opus 5.5, 3 tasks × 2 reps per arm (ABBA): 0 edit failures, 0 read-before-edit errors, 0 mis-anchors in both arms; Opus anchors edits on content and takes line numbers from ss-grep. No solve signal (tasks never solved). README line not changed (owner decides).

**Observation (owner):** Removing the gutter is a potential fix. Agents may have misbehaved
without a gutter in July/August for two reasons: (1) the model then was weak (gpt-5.6-luna), and
(2) ss-grep did not yet return the full hit line (the first entry above). With more informative
grep output, edits may be well grounded without a gutter. This needs more tuning and small
micro-smokes on task-completion tasks, on Opus 5.5 and GPT-6.1 Sol through the subscriptions,
because we want to see THEIR behaviour.

**Example — replay `r3h-typedoc-09` (Claude Code + Opus 5.5 medium):** the `N<TAB>` gutter was
657 lines, 2,497 chars (about 700 tokens, 7% of sweet's tool output, about $0.004). Sweet lost on
cost by $0.021 ($0.195 vs $0.174), so the gutter alone did not decide this task. It is a
per-call tax on every ss-read in every task.

**What the earlier evidence says (all of it on gpt-5.6-luna):**
- 2026-08-06 (`48e5402c`): the `N| ` gutter went default-ON, "measured −16% agent cost, no solve
  loss on tuning tasks". That run changed other things at the same time.
- 2026-08-13 (`116ca2b2`): `N| ` → `N<TAB>`, because the space after the pipe leaked into Edit
  anchors (15.4% → 0.0% carried-whitespace anchors, 52 trials).
- 2026-08-28 fresh pool (`91109c3b`, 891 rollouts, TAB / PIPE / NONE × 3 harnesses): no form
  changed solves (all p ≥ 0.72). On Claude Code, NONE was −6.3% cost against TAB; on tab-indented
  files TAB made Claude Code's Edit fail (8 of 61 edits). Codex has shipped NONE since 2026-09-02.
- So the −16% "do not delete the gutter" rule rests on one confounded luna run; the larger later
  luna run did not reproduce a gutter benefit.

**Facts that change on Opus / Sol:**
- Native Claude Code in `bypassPermissions` mode (all our runners) gets a prompt attachment that
  says "read files with cat, head, or sed -n". Native Opus made 0 Read-tool calls in ~320
  retrieval sessions; native Opus in the task bench (held-out, 200 tasks, 2026-09-25) made 62
  Edit and 63 Read calls against 1,386 Bash calls. Native reads raw lines with no gutter and gets
  line anchors from `grep -n`.
- Claude Code's read-before-edit gate is OFF for non-Anthropic models and ON for Anthropic models
  (HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md §1.4). The luna results therefore never measured
  how Opus edits after an ss-read. Gutter or not, this is the first thing a micro-smoke must log.

**Possible product change:** for Claude Code (and later opencode), test NONE against TAB after
the full-line ss-grep fix lands. Micro-smoke on task-completion tasks, Opus 5.5 and GPT-6.1 Sol
via subscription, REPS ≥ 2. Measure: edit anchor failures, Read-before-Edit errors, extra reads
to find line numbers, requests, and cost. Decide per harness.

---

## 2026-10-02 — The rules should list ss-grep's flags in one short line (A/B test first)

**Status 2026-10-02: SHIPPED as rules v3 on obs-loop (88041ff9, ce9f90d0, 6ddefc24); opt-out `SS_FIX_RULES_V2=0`.** v2 (all flags listed) made Opus scope its first grep early: score −6.4% (significant). v3 leads with `-g '!<glob>'` and says "Start broad; scope only after a broad grep shows where": Opus score −2.3% (ns), cost −5.1%, ss tokens −16%; Codex score +3.6% (ns), cost −3.6%. Also fixed: `ss-grep -i -w` returned 0 hits (prefilter literal bug, cea202f2..22fc83e1). `TRACES-rules.md`, `TRACES-rules3.md`.

**Observation (owner):** This deserves an A/B test before we ship it, so it goes here and is not
fixed straight away. Add a short line to the sweet rule file that lists the flags the agent can
use when needed (something like "flags you can use when needed: …"), so it costs few tokens.
The agent then knows the flags exist and how to use them.

**Example — replay `r3hb-drogon-06` (Codex + GPT-6.1 Sol high) in the artifact:**
- The shipped rules show only `ss-grep "<regex>" [-k N]` and say "ONE ss-grep on that literal
  (rarest token…)". ss-grep already supports `-i`, `-w`, `--in <path>` and `-A/-B/-C`
  (`eval/agent-read-workflows/bin/_ss-helpers.mjs`, `GREP_USAGE`), but the agent cannot know that.
- Sweet grepped `\bHEAD\b` (request 0), then `\bHead\b` (request 1): two requests for one search.
  Native ran `rg -n '\bHEAD\b|\bHead\b|\bhead\b'` and then `rg -i` in one call each.
- Sweet then tried to cover every case by hand with `Head|ishead|"head"` (no word boundary). It
  matched `Header` and returned 663 matches (2,327 tok), and a fourth grep was needed to narrow it.
  With `-i -w` known, this is probably one call.
- Native still won with cache luck removed ($0.056 vs sweet $0.072); this pattern is part of the
  remaining gap (2 extra requests).

**Possible product change:** one line in the rules, e.g.
`ss-grep flags when needed: -i (ignore case) -w (whole word) --in <path> -g '<glob>' / -g '!<glob>' (include / exclude) -A/-B/-C N`.

**New capability for this line (decided 2026-10-02, implemented separately, not A/B-gated):**
ss-grep and ss-find take ripgrep-style globs: `-g/--glob '<glob>'` includes, `-g '!<glob>'`
excludes (exclusion wins), plus the grep-habit aliases `--exclude`, `--exclude-dir` and
`--include`. The globs are evaluated on the index paths, so the fast native grep still runs.
Why: in drogon-06 native excluded tests and the outbound client with
`rg -g '!lib/tests/**' -g '!lib/src/HttpClient*'`; ss-grep had only `--in` (include), so sweet's
greps also returned `lib/tests`, `drogon_ctl` and `HttpClientImpl.cc` hits. Agents already know the
`-g '!…'` form, so the rules line needs only `-g '!glob'` to expose it. The A/B test of the rules
line should include this option.
A/B on dev questions per harness: requests per question, greps per question, cost; accuracy must
not drop. Also note the rules say "`ss-grep` is file:line only" — that sentence must change when
the full-line ss-grep output (first entry) lands.

---

## 2026-10-02 — Allow file-name search (find, ls, rg --files); restore only that part of the trimmed harness text

**Status 2026-10-02: SHIPPED with rules v3.** Rules allow `rg --files -g`, `find <dir> -name`, `ls <dir>` (read results with ss-read). Harness halves restored for Claude Code (`find`) and opencode (Glob); the Codex `rg --files` line was DROPPED after the A/B (it triggered `rg --files -g 'AGENTS.md'` in 17/22 rollouts).

**Observation (owner):** Agree with option 1: the rules should allow native file-name search.
Re-add to the harness system prompts the trimmed text that mentioned these tools (find, ls, file
listing), only so that we do not restrict them. This does NOT bring back trimmed text about tools
and retrieval that competes directly with the ss-* tools and does not help the agent in any other
way.

**Example — replay `r3hb-drogon-10` (Codex + GPT-6.1 Sol high):** native's first call,
`rg --files -g '*View*' -g '*csp*' -g '*template*'`, named both gold files for 374 tok. Sweet's
first `ss-search` used the question's words and missed `drogon_ctl/create_view.cc`; ranks 3-14
were noise. Sweet still won this task (CSP in the second query), but it had no way to ask "which
files are named like this?".

**Facts (r282 retrieval runs):**
- No ss-* tool searches file names; all of them search contents.
- Native file-name search is common: Codex native used `rg --files` with a name filter in 47 of
  97 rollouts (never `find` or `ls`). Claude Code native Opus used `ls` in 25 of 97 and `find` in 5
  of 97; Sonnet `ls` 22 of 103, `find` 2 of 103. Sweet arms obey the ban: Claude Code V1b `ls` 2 of
  97, `find` 0; Codex sweet 0 of 194.
- Agents do not use `find` as a content grep: 0 cases of `find … -exec grep` or `find | xargs grep`
  in about 300 native rollouts.
- The ban entered with the P7 gen-3 prompt optimisation (`d579280a`, 2026-05-31) as part of a whole
  prompt; no commit tests that sentence alone. Rule text today: "Reach for raw
  `grep`/`find`/`cat`/`ls` … only for an edit too recent…" and, in the absence rule, "no
  `find`/`ls`/`cat` enumeration".
- What the harness trim removed that touches file-name search:
  - Codex (`scripts/harness-prompts/NOTICE.md`): the line "When you search for text or files, you
    reach first for `rg` or `rg --files`…". Text search competes with ss-grep; `rg --files` does not.
  - opencode (`scripts/harness-prompts/index.js`, `opencodePrompt`): the bullet "When searching for
    text or files, prefer using Glob and Grep tools". Grep competes; Glob does not.
  - Claude Code (`scripts/install-claude-lean-harness.js`, `CLAUDE_CODE_THRIFTY_SONIC=0`): the
    bypass-mode steer "read files with cat, head, or sed -n, search with grep and find". The read and
    grep parts compete with ss-read / ss-grep; `find` does not.

**Possible product change:**
1. Rules: one line that allows file-name search, e.g. "To find files by name or see a directory,
   use `rg --files -g '<glob>'`, `find -name` or `ls`; the ss-* tools search contents, not names."
   Keep the ban on raw `grep` and `cat`. Drop `find`/`ls` from the absence rule.
2. Harness prompts: restore only the file-name half of each trimmed line (Codex `rg --files`,
   opencode Glob, Claude Code `find`), never the text-search or read half.
A/B on dev questions per harness, together with the rules flag line above. Risk to watch: an
unfiltered `ls -R` or `find .` (large output, and it lists `.sweet-search/`).

---

## 2026-10-02 — Chunker: C++/C#/Ruby namespace chunks and the export macro (needs reindex — wait)

**Status 2026-10-02: IMPLEMENTED on branch obs-chunker (940fda49, 305056a1, e51a8a18), NOT merged:** bumps CHUNKING_VERSION 1→2, merge together with the end-of-tuning reindex. GCSN dev MRR@10 86.48% → 86.48% (seed 42, 3,600 q). 0 lost text, 0 overlaps, 0 id collisions on ~2,000 real files.

**Observation (owner):** Fixes C and D change chunk output, so they wait for the end of tuning
(reindex is frozen) and need a GCSN dev MRR check. The search-time label fix (A) and the C/C++
receiver-evidence fix (B) are implemented now.

**Example — replay `r3hb-drogon-10`:** summary lines `HttpViewData.h:29 — drogon (namespace)` and
`OStringStream.h:20 — drogon (namespace)` hide the class inside, and `create_model.h:29-442
[namespace: drogon_ctl]` points the agent at 413 lines.

**Facts (verified on main 2026-10-02 with the real chunker on copied drogon files):**
- C. `namespace_definition` is a chunk boundary (`core/infrastructure/tree-sitter-provider.js:125`,
  label map :293). A large namespace gives a "header" chunk that starts on the `namespace` line; a
  namespace under 2,000 chars becomes one chunk labelled namespace even when it holds one class.
  Same in C# (`namespace App { class Store }`) and Ruby (`module App; class Store`); TypeScript
  `export namespace` only when small. PHP and Rust are correct.
- D. `31a24287` removes export macros (`class DROGON_EXPORT HttpViewData`) for graph entities only
  (`extractSymbols`, tree-sitter-provider.js:967). The chunker calls `parse()` (:927), which keeps
  the macro, so it still labels the class `function: HttpViewData` and adds a phantom one-line chunk
  `class: DROGON_EXPORT`. The wrong symbol also goes into the embedded text (retrieval cost not
  measured).
- Also seen, not measured: a large C++ namespace gives overlapping chunks (29-50, 30-31, 32-54,
  32-32, 33-77), and some chunks' `line_end` disagrees with their text line count.

**Possible product change:**
- C. Make namespace/module wrappers transparent in `recursiveChunk`: chunk the body with the
  namespace as parent info, as for class bodies.
- D. Move the export-macro blanking (`CPP_CLASS_KEY_MACRO`) from `extractSymbols` into `parse()`, so
  the chunker and the graph agree.
Both: GCSN dev MRR before/after, then reindex at the end of tuning.

---

## 2026-10-02 — Chunker: a large function splits into a junk signature chunk and overlapping, reformatted body chunks (needs reindex — wait)

**Status 2026-10-02: IMPLEMENTED on branch obs-chunker with the entry above (same commits, same MRR check); waits for the reindex.**

**Observation (owner):** Put the chunker issue seen in `r3h-dgraph-08` into observations. It
changes chunk output, so it waits for the end of tuning (reindex is frozen) and needs a GCSN dev MRR
check, like fixes C and D above.

**Example — replay `r3h-dgraph-08` (opencode + GPT-6.1 Sol):** the answer sits in
`worker/export.go` `ToExportKvList` (606-694) and `exportInternal` (775-944). Both functions are
over the 2,000-char chunk cap. `ss-semantic worker/export.go "<question>"` returned one span,
943-1007 `[SchemaExportKv]`, which holds four small functions (`SchemaExportKv`, `TypeExportKv`,
`grpcWorker.Export`, `handleExportOverNetwork`). The agent then read the file in three windows.

**Facts (verified on main 54db32bf with the real chunker on the r3-dgraph file; the r282 index
has the same chunks):**
- An oversized named function gives a 600-char header chunk (`tree-sitter-provider.js:1443-1460`,
  606-625 `function: ToExportKvList`), then `recursiveChunk` recurses into the function's children.
- The children `func`, name, parameters and result merge into a junk chunk with one token per line:
  `func\nToExportKvList\n(pk x.ParsedKey, ...)\n(*bpb.KVList, error)` (606-606, 97 chars). The same
  happens for `toJSON` (49 chars) and `exportInternal` (117 chars). It duplicates the header chunk.
- `flushBuffer` builds chunk text by joining sibling node texts with `\n` (:1209-1211), not by
  slicing the source. Body chunks start `{\ne := &exporter{` and gain blank lines; the first line
  loses its indentation. The embedded text is not the code the agent reads.
- The header chunk (606-625) overlaps the body chunks (606-616, 616-662), so the start of every
  large function is indexed twice.
- Body chunks are stored with `type: code`, `name: null`. The parent name reaches the embedded
  header (`parentSymbol`, `core/indexing/ast-chunker.js:158`), but tools that print the stored
  name show no symbol.
- Sibling merge labels a chunk after its first function only (943-1007 `SchemaExportKv`); the other
  names go only into an `# Additional:` embedding header line.

**Possible product change:**
- Do not emit the signature-token buffer when recursing into an oversized function; the header
  chunk already holds the signature.
- Build every chunk's text as one source slice (first node start to last node end), not a `\n`
  join, so the embedded text equals the file text.
- End the header chunk where the first body chunk starts (or start the body after the header), so
  no lines are indexed twice.
- Store the enclosing function as the body chunk's name (for example `ToExportKvList (part 2)`), so
  ss-search and ss-semantic can label it.
Then GCSN dev MRR before/after, and reindex at the end of tuning.
