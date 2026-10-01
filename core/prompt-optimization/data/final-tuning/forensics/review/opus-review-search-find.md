# Adversarial review — ss-search / ss-find output changes (A1, A2, A3, B1, B2, sufficiency split, B6)

Reviewer: Opus 5.5, independent. Date: 2026-10-01. Read-only. No code edited, no run started, no held-out or HO2 data opened.

## Conclusion

Test only A1 and A2, after two small revisions. Add one cleanup that the fix list missed. Do not test A3, B1 or B2 as built. Do not spend runs on the sufficiency-drop switch or on B6.

The main reason is the model mix. On the current target models, these changes save almost nothing on tasks. Claude Code + Opus called ss-search 35 times and ss-find 4 times in 492 task rollouts. The replay puts all of Bundle A at 0.04% of Opus rollout cost. The large savings (7–11% of amplified tool tokens) come only from gpt-5.6-luna. Luna is not a target model. Sonnet, Sol and DeepSeek have no task-bench data at all. On the retrieval bench (all target models), ss-search is 7.6–12.9% of cost. There, A1 + A2 can save about 1–2% of cost. That is below every detectable effect (MDE 7–26%). So these changes can only be shipped as "no harm, smaller output". They need a non-inferiority test, not a cost test.

| Change | Verdict | Evidence that the removed part is unused | Saving on target models | Main risk |
|---|---|---|---|---|
| A1 drop score, kind tag, budget header, confidence line, `route=`/`shown-full:` trailers | **SHIP-TO-TEST** (revise: keep a one-line query header) | Strong for score, tag, budget, trailers (0 mentions in 1,363 post-call texts) | Retrieval ≈ 0.7–1.3% of cost; Opus tasks ≈ 0.03% | Chained commands lose their output boundary; bench parsers lose route data |
| Keep compact `# sufficient=YES` | **SHIP-TO-TEST** (inside A) | Not applicable (kept) | — | None found |
| `SS_FIX_DROP_SUFFICIENCY=1` | **REJECT** (not worth a run) | Weak and contested | 0.07% (Luna) to 0.23% (Opus) of ss-search chars | Removes a shipped lever with weak positive evidence |
| A2 one-line summaries + dedupe | **SHIP-TO-TEST** (revise the dedupe rule) | Strong (99.9% of second lines restate the header) | Luna 14–20% of ss-search chars; Opus 1.3% | Big enclosing spans swallow method pointers |
| A3 omit code already shown | **REVISE** (do not test as built) | Strong that repeats exist on Luna; zero repeats on Opus | Opus 0.00%; Luna 2–4.7% of amplified tokens (replay overstates the build by about one third) | Wrong "already shown" across sub-agents, after compaction, after piped reads |
| B1 summary cap 3–5 + `-k` as cap | **REJECT** the summary cap; **NEED-DATA** for `-k` alone | Weak; contradicted by TRIED-LEVERS 1.10 and r282 rank use | Opus 0; Luna ≈ 1 point of amplified tokens after A2 | Loses a later-used, first-seen file pointer in 5–11% of Luna calls |
| B2 one entry per file | **REVISE** | Mixed | Opus ≈ 0 (3 of 35 calls); Luna ≈ 5–6% of ss-search chars | Built version does not do what the description claims |
| B6 fold ss-find into `ss-search --regex` | **REJECT** for now (not built) | Weak for target models | Opus ≈ 0 (4 ss-find calls) | V2 (tool pruning) cost Codex −1.9 pt accuracy (significant) |
| NEW: drop the `### imports` block when its lines are inside the shown code | **SHIP-TO-TEST** (add to A) | Exact duplication, no loss | Opus 9.5% of ss-search chars; Luna ≈ 1.2% | None found |

## 1. What the evidence can and cannot say

- **Opus data is one task.** 30 of 35 Opus ss-search calls are svgr-10, a "write a new plugin" task. All 4 Opus ss-find calls are the same query on one task. I read all 39 Opus calls with their next 4 calls. Opus does the same thing after `sufficient=YES`, `no` and `unknown`: it reads sibling plugin files. That is correct behaviour for a new-code task. So "Opus read more files after `sufficient=YES` in 94%" is a task effect. It says nothing about the verdict line.
- **"Rank 3 used 0 of 27 times (Opus)" is also a svgr artifact.** On r282 (retrieval, target models), Opus used rank 3 in 45% of calls and ranks 6+ in 19% (lenient rule). DeepSeek used ranks 6+ in 22% (`r282-TRACE-ANALYSIS.md` §5).
- **Luna dominates the share numbers.** 1,021 of 1,056 ss-search calls and 331 of 335 ss-find calls are Luna. Luna asks `-k 8`/`-k 10` in 63% of calls. Opus averages 3.4 entries per output. A tail cut that matters for Luna does nothing for Opus.
- **"Unused" means "not visibly used".** Opus thinking is empty and Codex thinking is encrypted. I searched the visible text after all 1,363 ss-search/ss-find calls. Nobody mentions `score`, `budget`, `route` or `shown-full`. `sufficient` appears 6 times; the cases I read use it in its plain English sense ("insufficient", "seems sufficient"). This is strong evidence for the metadata lines. It is weak evidence for anything the agent can use silently (paths, ranges, symbols, rank order).
- **Dollar size.** Replay (`REPLAY.md` §1): Bundle A (A1+A2+A3+A4) is $0.00008 per Opus rollout (0.04% of cost). It is $0.0004–$0.0024 per Luna rollout. These changes are hygiene. They are not a cost lever on the target models.

## 2. Per change

### A1 — drop score, presentation/kind tag, budget header, confidence line, trailers

**Verdict: SHIP-TO-TEST, with one revision. Evidence: strong (except sufficiency, handled below).**

- I confirm the swarm claim. No post-call text in any harness mentions score, budget, route or shown-full. The `(preview kind=…)` tag is also safe to drop. Partial previews carry their own elision marker in 201 of 291 cases. The 90 without a marker are mostly Markdown/README extracts.
- Saving: 9–11% of ss-search and 8–11% of ss-find characters (replay). On Opus tasks this is 0.28% of amplified tokens.
- **Risk 1 — output boundaries.** A1 deletes the `# ss-search: …` and `# ss-find: …` lines. These lines are the only separator between chained ss-* outputs in one shell command. 131 of 1,349 commands chain ss-search/ss-find with another ss-* call. Without the header, an ss-search that returns only summary lines prints bare `path:a-b symbol (kind)` lines. These look like ss-grep hits from the call before. An empty result prints only `(no matches)`, with no query echo. The forensic splitter (`build_dossiers.py`) and `ss_parse.py` also split on these headers. Future forensics of treatment runs would break.
- **Risk 2 — bench data loss.** Under A1, ss-search exits before it prints the route trailer. The trailer is the only record of route, confidence and verdict per call. ss-trace moves its meta line to stderr; ss-search drops it. Write the ss-search meta to stderr as well.
- **Revision.** Keep a one-line header: `# ss-search: N results for "<query>"` (and the regex for ss-find). Cost: about 30–60 chars per call. Drop routed, conf, budget, used and subMode.
- **Implementation check.** It matches the description. One stale point: `FIXES-IMPL.md` still tells the editor to delete the rules sentence "On `sufficient=YES`, trust the top ranked result…". Commit 5000cdec keeps the YES line, so that rules edit must NOT be applied. 5000cdec has no unit test and no doc update.

### Sufficiency split — compact `# sufficient=YES` vs `SS_FIX_DROP_SUFFICIENCY=1`

**Verdict: keep the compact YES line (part of A). REJECT a separate keep-vs-drop A/B.**

- The compact line is 17 characters on 20–24% of Luna calls and 56% of Opus calls. Dropping it saves 0.07% (Luna) to 0.23% (Opus) of ss-search/ss-find characters. No benchmark can see that.
- So the A/B would only test behaviour. The prior evidence is weak but points the other way. TRIED-LEVERS 1.19: the verdict cut calls on two smoke tasks (−55%, −56%). TRIED-LEVERS 4.9: the trust line gave −4.8% ideal cost on 10 Codex tasks. The verdict is also calibrated: after `YES` the fix file is in the list with code in 88% of first calls; after `no`, the fix file is rank 1 in only 23% (`first-search.md` §3).
- The rules text reads the verdict. Removing it means a rules edit too, which is a second variable.
- Cheaper alternative: also keep `# sufficient=no` (20 chars on 14% of calls). opencode agents opened the rank-1 path in 55% of calls after YES and 7% after no. The built A1 deletes the `no` signal. I cannot prove the agent reads it, so this is optional.
- Counter-example to note: in `hsmoke-claudecode-luna-20260926-1525-L1/smooth-code__svgr-10/r0#13` ss-find printed `sufficient=YES` for a regex aimed at `node_modules` (not indexed). The results were unrelated. A false YES exists; the verdict quality is a separate lever (first-search proposal 6).

### A2 — one-line summaries and dedupe of covered entries

**Verdict: SHIP-TO-TEST, after a rule change. Evidence: strong for the one-line form; medium for the dedupe rule.**

- The one-line form is sound. 99.9% of summary second lines restate the header (STATS C1). The build keeps `path:start-end` (the replay kept only `path:line`). Agents take read windows from that range (Codex reader, 10 of 53 calls).
- **Defect in the dedupe rule.** An earlier entry "covers" a later summary entry when the span is inside it, or when the file and symbol match. Any earlier entry counts, including a summary entry with a huge span. I replayed the rule on all 1,355 outputs. It drops 1,460 summary entries. In 170 of them the covering entry is 150+ lines and the dropped entry is less than a third of it. Examples: `src/parser/Parser.ts:3005-3011 check` dropped under `Parser.ts:101-3257 Parser` (a class summary); `deserializeHtml.js:263-273 onclosetag` under `parse 137-288`. In at least 6 cases the agent later used the dropped symbol by name. Elsewhere the drops look safe: most "used" drops are exact duplicates.
- **Revision.** (a) Let only an entry that shows code, or an identical span, cover a later entry. (b) Drop the same-symbol rule. The replay row `A2-span-only` saves nearly the same (4.06% vs 4.14% of amplified tokens on Claude Code Luna). The same-symbol rule also drops distinct blocks with generic names (`it`, `RuleTester`, `<anonymous:decorator>`).
- Optional: keep `#N` on summary lines (about 4 chars). The rules say "the winner is often rank 2-3"; A2 removes rank numbers from summary entries only.
- Saving on target models: Opus 1.3% of ss-search chars. The V3 replay on r282 (Codex, Opus, DeepSeek) gave −9.1% of ss-search chars, about −1% of cost.

### NEW — drop the `### imports` block when the code already shows those lines

**Verdict: SHIP-TO-TEST (add to Bundle A). Evidence: exact, no information loss.**

- When a code block starts at line 1, the imports block repeats the first lines of that block word for word.
- Measured on all outputs: these fully duplicated blocks are 9.5% of Opus ss-search characters (23 of 35 calls). That is more than A1 saves on Opus (9.1%). On Luna they are 1.0–1.3%.
- Three readers proposed it (ss-search Claude Code tier A, Codex #6, first-search #7). The fix list left it out.

### A3 — omit code already shown to the same thread

**Verdict: REVISE. Do not test the built version. Evidence: strong that repeats exist on Luna; no benefit on Opus.**

- **No upside on the main target.** On Claude Code + Opus, 0.0% of ss-search/ss-find code was shown before (STATS C2). The replay saving is 0.00%.
- **The key is wrong for sub-agents.** The replay keyed the ledger per (rollout, thread). The build keys it per session: `CLAUDE_CODE_SESSION_ID` on Claude Code, `opencode-<OPENCODE_PID>` on opencode. `FIXES-IMPL.md` states that a Claude Code sub-agent shares the session id; I did not verify this myself. opencode runs sub-agents in the same process, so the PID key is shared for sure. In the 16 rollouts with sub-agents, I counted ss-search/ss-find code blocks whose span was shown only in a different thread: 67 blocks (73k chars) on Claude Code Luna, 10 (18k chars) on opencode. The same-thread repeats there were 100 blocks (218k) and 6 (6k). With a shared key, the later of each cross-thread pair prints "already shown above" to a thread that never saw it. This also hits the parent: the parent sees only the sub-agent's summary, not its code. The replay's large ss-find saving on Claude Code Luna (34%) comes mostly from sub-agent threads, which is exactly where the key fails. The rules tell agents to delegate to sub-agents, so this path is not rare in the product.
- **Other false omissions.** (1) After context compaction, the ledger still counts code the model no longer holds (window: 30 calls). (2) A read piped through `head` or `grep` is recorded as fully shown. Opus piped 11 ss-* outputs and Claude Code persisted 2 large ss-* results as 2 KB previews. (3) A long ss-read cut by Codex's output cap (about 10k chars) is still recorded in full if it is under 256 lines.
- **The replay overstates the build.** The build omits only complete `full` blocks; previews always print. Restricted to full blocks, my re-count gives ss-search 4.0–4.4% of characters on Codex/opencode Luna, against 6.3–6.6% for any block. So expect about two thirds of the replay figure.
- **The pointer is weak.** "(lines a-b already shown above)" does not say where. Codex's existing ss-read text says how many calls ago.
- **Revision.** (a) Key the ledger per thread, or turn A3 on only where a per-thread id exists (Codex `CODEX_THREAD_ID`). (b) Omit only when the earlier display is recent (for example within 8 calls) and was not piped. (c) Print the source and a re-read command: `(lines a-b shown by ss-read 3 calls ago — ss-read <file> a b)`. (d) Keep A3 out of Bundle A; give it its own switch.

### B1 — summary cap 3–5 and `-k` as a real cap

**Verdict: REJECT the summary cap. NEED-DATA for "`-k` as a real cap" alone. Evidence for the cut: weak and contradicted.**

- **This is a dead lever again.** TRIED-LEVERS 1.10: hiding rank 6+ was killed because 14 of 68 edited files (20.6%) first appeared at rank 6 or lower. TRIED-LEVERS 1.9: the $0 screen found "no cheap mass to drop". The first-search reader also advises against it: summary lines gave the first used path in 13% of successes.
- **My replay of the built rule** (after A2; "loss" = a dropped file not elsewhere in the output, opened within the next 8 calls, and not seen earlier in the thread):

| harness (Luna) | calls | cap 3: calls losing such a pointer | cap 5 | `-k` cap only |
|---|---|---|---|---|
| Claude Code | 308 | 31 (10.1%) | 19 (6.2%) | 5 (1.6%) |
| Codex | 331 | 38 (11.5%) | 24 (7.3%) | 11 (3.3%) |
| opencode | 616 | 70 (11.4%) | 29 (4.7%) | 15 (2.4%) |
| Opus (Claude Code) | 39 | 0 | 0 | 0 |

  This is an upper bound: the agent could have found some files another way. In my own reading of 12 random Luna calls, cap 3 dropped a later-used pointer in 3. Example: `hsmoke-claudecode-luna-20260926-1525-L1/joshuakgoldberg__bingo-271/r0#5`, rank 8 names `logRerunSuggestion`, the function the fix is about; the agent read its test file next.
- **The saving after A2 is small.** A2 already makes each tail entry about one line (15–20 tokens). The replay difference A+B(cap 5) minus A minus B7 is about 1 point of amplified tokens on Luna and 0 on Opus.
- **"`-k` as a real cap" is a different question.** It honours what the agent asked for. It loses fewer pointers (1.6–3.3%). Its saving is not measured. Agents may answer by asking for a larger `-k`.

### B2 — one entry per file

**Verdict: REVISE. Evidence: mixed. The build does not match the description.**

- The fix list says B2 "frees code slots" and fixes "fix file only as summary (10%)". The build only deletes code. A later same-file entry becomes `also in this file: sym (l.N)`, and its packed code is not printed. The freed budget is not given to another file (`FIXES-IMPL.md`: "the pack budget is not re-spent"). So a fix file that sat at rank 4 as a summary stays a summary.
- What it removes: later same-file code blocks appear in 21–28% of Luna ss-search calls, 5.2–6.3% of characters. On Opus, 3 of 35 calls.
- Risk: the rules say "scan the rest of the pack (lower ranks, the `same file:` line) … the winner is often rank 2-3". B2 deletes same-file rank-2/3 code, the case where rank 1 is the wrong sibling (3 Claude Code Luna cases). After such a drop, agents read an overlapping range within 8 calls in 11–30% of cases. That read happens anyway. I found no edit anchored on dropped code (0 cases).
- **Revision.** Either (a) call B2 "compression", keep the line range in `also in this file:` (`sym l.120-140`), and test it as such; or (b) build real slot reallocation in the packer, gated on agent format as the repository rules require. Then test (b) on the retrieval dev sets, because it changes which code is shown.

### B6 — fold ss-find into `ss-search --regex`

**Verdict: REJECT for now (not built). Evidence for the fold on target models: weak; evidence against: medium.**

- Opus made 4 ss-find calls in 492 task rollouts (one query). On r282, ss-find is 2–6% of calls and 1.8–3.2% of cost.
- V2 (`SS_VARIANT_PRUNE3`, which removed ss-find, ss-semantic and ss-trace) cost Codex −1.9 pt accuracy (significant). The ss-find crash bug was in the base arm of that run, so the harm figure is, if anything, conservative.
- ss-find has one job that no other tool does: `--regex '.*' --in <dir>`, a directory-scoped semantic search (23 calls). `ss-search` has no `--in`.
- Cheaper alternative: A1 + A2 (revised) on ss-find; zero-result diagnostics; and the B5 rules change "exact token → ss-grep + narrow ss-read". B5 is a rules edit and needs its own retrieval A/B. The rules text was optimised as a whole (GEPA), and "prefer ss-find" lines have died before (TRIED-LEVERS 4.18).

## 3. Implementation findings (branch `ft-fixes`)

1. A2 coverage rule: any earlier entry covers, including large summary spans; the same-symbol rule is on (`core/search/agent-output-fixes.js`, `selectEntries`).
2. A3 key is per session, not per thread (`resolveThreadKey`); a shared `OPENCODE_PID` and (per `FIXES-IMPL.md`) a shared Claude Code session id give cross-thread omissions.
3. A1 exits ss-search before the route trailer; route/verdict data are lost for the bench (`_ss-helpers.mjs`, `if (FIX.bundleA) process.exit(0)`).
4. A1 removes the query/regex echo; chained and empty outputs become ambiguous.
5. B2 does not re-spend the freed budget; the description says it does.
6. 5000cdec: `SS_FIX_DROP_SUFFICIENCY` is parsed with `=== '1'`; the other switches accept `1/true/on/yes`. No unit test; `FIXES-IMPL.md` switch table and rules advice still describe the older A1.
7. All switches live in the bench wrapper only. The shipped Rust CLI and MCP server print their own output. A bench win must be ported and byte-compared to the wrapper output before release (same-path parity rule).

## 4. Required tests

Run on dev splits only. Report held-out only once, at the milestone, as aggregates.

1. **$0 gates first.** (a) Unit tests for the compact verdict line and the revised A2 rule. (b) Re-run the replay with build semantics: per-session key, full blocks only, revised A2. (c) Byte-identical output with all switches off (already done on 35 calls).
2. **Bundle A' (A1 with query header + compact verdict + A2 revised + imports dedupe; A3 off).**
   - Retrieval: r282 train or r3 dev. Codex/Sol interleaved; Opus A-B-A; 78 pairs per cell.
   - Primary: accuracy non-inferiority, margin −2 pt.
   - Guard: calls and turns within +10% (Opus has compensated for smaller output before: TRIED-LEVERS 1.5).
   - Report delivered ss-search/ss-find tokens (expect −20 to −30% on Luna-style calls, −10 to −20% on Opus). Report cost, but do not decide on it: the expected 1–2% is far below the 7–26% MDE.
   - Task guard: Opus, 10 dev tasks × 2, interleaved (as for V1b): solves not lower, ss-* call share stable.
   - Add the new 20 long dev tasks × 3 harnesses on one target model (Sol or DeepSeek). This is the only way to learn whether Luna's tail-heavy use pattern holds on target models.
3. **A3 (after the revision), own switch.** Long dev tasks on Codex first. Trace metrics: (a) share of omission lines followed within 2 turns by a read of the same lines (bar: under 10%); (b) omissions in sub-agent threads (bar: 0); (c) omissions after a compaction event (bar: 0).
4. **"`-k` as a real cap" (if wanted).** $0 replay of first-seen pointer loss on r282 traces of target models, then a task guard. Do not test the summary cap.
5. Do not pool runs across fff75887 (ss-find crash fix) or across any change of `SS_FIX_*` semantics.

## 5. How I checked

- Read: `SYNTHESIS.md`, `STATS.md`, `REPLAY.md`, the five swarm reports and their label files, the rules text, `r282-TRACE-ANALYSIS.md`, `TRIED-LEVERS.md` §1–4, `STATE.md` decisions, `FIXES-IMPL.md`, `agent-output-fixes.js`, and the `_ss-helpers.mjs` diff (`final-tuning...ft-fixes`).
- Calls read by eye: all 39 Opus ss-search/ss-find calls with their next 4 calls (3 with full output), 12 Luna calls drawn at random (seed 42, 2 per harness × tool), the two zlint calls cited above, and the 11 first-search labels that claim sufficiency use (checked against their evidence text; all 11 are coincidence of YES with a correct rank 1, not proof of use).
- Scripts over `dossiers.jsonl` (all 1,363 ss-search/ss-find calls): metadata mentions after each call; preview elision; duplicated imports; A2 drops and later use; B1 pointer loss; B2 same-file code; A3 cross-thread and full-block-only repeats; compound commands; verdict line size. Scripts are in my scratchpad only. Heuristics: "used" = path or symbol in the next 8 calls of the same thread; it over-counts use.
