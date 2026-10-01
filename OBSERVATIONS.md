# Observations — sweet-search vs native retrieval

Things the owner noticed while reading forensic replays. Each entry: the observation, the
evidence, and (when agreed) a possible product change. A product change here is an idea, not a
decision.

Source artifact: [Sweet-search Cost Forensics](https://claude.ai/artifact/XWUTDq4pZ75Pa1CUUrnFbW)
(r3-hard dev, side-by-side replays).

---

## 2026-10-01 — ss-grep should return the full hit line, like `grep -n`

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
