# c07 — adversarial verify, MECHANISM lens: REFUTED

**Verdict. Refuted, confidence 0.92.** The cited traces show the codex cut. They do not show
the remedy. The layout's only cost channel is "follow-up requests avoided". I split the 18
truncation-attributable follow-up requests by the class of cut they followed. 16 of 18
followed `ss-read` cuts, where the layout changes nothing. 2 of 18 followed one `ss-search`
cut whose complete rank-1 body is 9,112 characters, so the layout could not have completed
it either. The mechanism therefore removes 0 of 18 follow-ups. The claimed ceiling of
−0.7% (−0.14 requests per rollout) rests on removing 9 of them. The candidate's own kill
condition fires at $0: the complete rank-1 body exceeds the 4,800-character head in 11 of
17 single-command `ss-search` cuts (64.7%), against a kill line of more than 20%. "The model
receives a superset of today's surviving content" is false on a fixed 10,000-byte window:
today's tails hold 2,043 numbered code lines across 31 cut packs and a manifest tail would
displace part of them. "163 lost definition lines become zero" is impossible by
construction, because the middle is still deleted. The accounting half is true and
reproduces, but it is product hygiene with no lever value and is not a prerequisite for a
byte-capped head.

Tags: `[M]` measured (script named), `[C]` read from code, `[I]` inferred, `[carried]` taken
from a sibling report and not re-measured here. Denominators are stated with every rate.
Scripts and logs: `/tmp/wf-slatec/c07-mechanism-v2/` on the evidence box. Nothing under
`results/` was written. HO2 was not opened. No grading log was read. No rollout was launched.

---

## 1. What the cited traces show, re-derived from the raw rollouts

### 1.1 The cut geometry is real, and 190 of the "5,190 head characters" belong to codex `[M]`

Script `/tmp/wf-slatec/c07-mechanism-v2/exhibit.py` opened both exhibits the candidate names.

| exhibit | file | call | preamble codex adds | codex warning lines | sweet stdout kept before marker | marker | sweet stdout kept after marker |
|---|---|---:|---:|---:|---:|---|---:|
| 1 | `fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/.../rollout-2026-08-26T22-28-06-01a04030-…jsonl` | 5 of 20 | 105 chars (`Chunk ID … Original token count: 2773 … Output:`) | 80 chars | **5,000 bytes** | `…273 tokens truncated…` at char 5,185 | **5,000 bytes** |
| 2 | `.../accenture__sfmc-devtools-1974-sweet/.../rollout-2026-08-26T22-30-34-01a04032-…jsonl` | 1 of 12 | 105 chars | 80 chars | **5,000 bytes** | `…3253 tokens truncated…` at char 5,185 | **5,000 bytes** |

So the window sweet controls is exactly 5,000 bytes of head and 5,000 bytes of tail. The
candidate's "5,190 characters kept before the marker" counts 185 characters of codex's own
preamble and warning. The correction is small but it changes the fit arithmetic below: with
243–871 characters of pack header, rank-1 header and imports block ahead of the first code
line (median 342 `[M rank1fit.py]`), the room for a rank-1 body is 4,130–4,757 bytes, not
4,800 characters.

### 1.2 Exhibit 1 is an `ss-read` bundle; the layout is a no-op on it `[M]`

Command (from `codex-cap-x-ss.md` §9, confirmed by the three `# ss-read` block headers in the
output): `ss-read lib/index.js 700 820 && ss-read test/general.test.js 2280 2365 && ss-read
lib/cli.js 120 155`. Head = `lib/index.js` lines 700–808 (109 numbered lines). Tail = the
test file from line 2288, then `lib/cli.js` 120–155 with its `# unread below (156-1275) …
continue:` trailer intact. For `ss-read` the candidate's head section is "the requested span
up to that size". That is what codex already keeps. The exhibit shows the cut. It shows no
way the layout would change what the model received.

### 1.3 Exhibit 2 breaks the candidate's main promise `[M]`

Pack header: `# ss-search: routed=hybrid conf=1.00 budget=8000 used=5074 results=15
subMode=agent_full`, second line `sufficient=unknown`. Rank 1 is
`lib/metadataTypes/AttributeSet.js:19-370 [class: AttributeSet] (full kind=chunk)`, 352 lines.
84 numbered lines reached the model before the marker. The complete body, rendered with the
`N<TAB>` gutter from the golden checkout, is **18,191 characters** — 3.8 times the proposed
4,800-character head. Ranks 2 and 3 are lost with their headers. Ranks 4–15 all arrive in
the tail as one-line `(summary)` headers, which already carry `file:start-end [symbol]` —
the manifest the candidate wants to add. `sufficient=` is already in the head (pack header
line 2) and in the tail (`route=` line). On the candidate's own flagship pack the layout
cannot complete the top-1 body, and its manifest duplicates 12 lines already present, adding
2 (ranks 2 and 3).

---

## 2. The kill condition fires at $0, on the correct denominator `[M]`

Script `/tmp/wf-slatec/c07-mechanism-v2/rank1fit.py` (log `rank1fit.log`, data
`rank1fit.json`). For every truncated envelope in the codex sweet TAB arm whose first block
is an `ss-search` pack, it reads the `## #1 file:A-B` header, loads lines A..B from the golden
checkout (`/root/.ss-eval/golden/<repo>@<base>`), renders them with the gutter and compares
the size with the head. 31 of the forensics' 33 cut packs qualify (the other 2 are not the
first block of their envelope, so no first-command head can hold them).

| population | packs | rank-1 body known | cut begins inside rank 1 | rank-1 body > 4,800 chars | rank-1 body > real head (5,000 − overhead) |
|---|---:|---:|---:|---:|---:|
| all cut `ss-search` packs, pack first | 31 | 31 | 25 | **19/31 = 61.3%** | 20/31 |
| **single-command cuts (the "addressable" set)** | **17** | 17 | 16 | **11/17 = 64.7%** | **12/17 = 70.6%** |
| bundled cuts, pack first | 14 | 14 | 9 | 8/14 | 8/14 |

Rank-1 body sizes in the 17 single-command cuts (characters): 2,942; 4,067; 4,067; 4,072;
4,480; 4,521; 5,534; 8,264; 9,112; 9,112; 9,420; 9,420; 10,256; 16,038; 16,130; 16,130;
19,192. Six fit. Eleven do not.

The candidate's kill line is "more than 6 of the 33 addressable cuts". Even on that
denominator the answer is 11 of 33 (33%). On the right denominator — only `ss-search` packs
have a "top-1 body", and only 17 of the 33 single-command cuts are `ss-search` — it is 11 of
17. `ss-read` (11), `ss-find` (3) and `ss-trace` (2) have no rank-1 body to complete.

The reason is selection: a pack overflows a 10,000-byte window because its top result is
large. The head is sized for the packs that never needed it.

---

## 3. The ceiling arithmetic: internally consistent, mechanically unsupported

### 3.1 The arithmetic itself `[M rows.json, census JSON]`

Codex sweet TAB cell: $0.81379 over 66 rollouts = $0.012330 per rollout; 1,294 requests
(19.6 per rollout); mean request price $0.000629 from `rows.json`, $0.000625 from the raw
`token_count` records. Solved 39/66 sweet, 41/66 native (matches the brief). The candidate's
step "18 follow-ups, remove half = 9 = 0.136 per rollout × $0.000625 = $0.000085 = 0.69%"
is arithmetically right. Delivered tokens cannot change, because the window is fixed, so
requests are the only channel. That much is correct.

### 3.2 Which follow-ups the mechanism can remove: none `[M]`

I split the 18 unique truncation-attributable follow-up requests
(`forensics/scripts-codex-cap-x-ss/codex-cap-x-ss.json`, sweet cases with a class-(a) gap
re-read or class-(c) gap-symbol search within three calls, deduplicated by request turn) by
the class of the cut they followed:

| cut class that produced the follow-up | single-command | `&&` bundle | requests |
|---|---:|---:|---:|
| `ss-read` cut | 7 (`b2-113` r1 turns 33, 35; r0 turns 21, 22, 23; r2 turn 17; `b2-259` r0 turn 18) | 9 (`aiohttp` r1 turn 7; `aws-actions` r1 turn 3; `b2-113` r0 turn 24, r2 turn 19; `moq` r1 turns 15, 17, r0 turns 8, 9; `markup-it` r0 turn 10) | **16** |
| `ss-search` cut | 2 (`devlooped__moq-1262` r1 call 3 → turns 4 and 5) | 0 | **2** |
| total | 9 | 9 | **18** |

- For `ss-read` the layout's head is "the requested span up to that size", which is what
  codex keeps today. The gap stays where it is. `[M ssread-exhibit.log]` On the cascade the
  forensics call Exhibit 3 (`bfgroup__b2-113-sweet` rollout `…23-34-39-01a0406c…`, calls
  32–34), each cut keeps lines 600–712 then 950–1050, 700–820 then 843–950, 1050–1150 then
  1184–1280, and the `# unread below … continue:` trailer is present in every tail. The
  layout would produce the same head, the same gap and the same trailer. The re-reads would
  recur. **16 of 18 follow-ups are outside the mechanism.**
- The one `ss-search` cut with follow-ups (`moq` r1 call 3) has a rank-1 body of 258 lines
  and 9,112 characters `[M rank1fit.log]`. The head cannot hold it. The re-read of
  `MethodExpectation.cs 118-284` overlaps the still-deleted gap. **The remaining 2 of 18 are
  outside the mechanism too.**

So the mechanism-supported request saving is **0 of 18**. The most generous reading, in
which both `ss-search`-cut follow-ups vanish anyway, is 2 of 66 rollouts = 0.03 requests per
rollout = $0.000019 = **0.15% of the cell**. The claimed −0.7% is 4.7 times that generous
bound and infinitely above the strict one. That exceeds the factor-of-two tolerance.

### 3.3 New demand the layout creates `[M + carried]`

The tail names, by `file:start-end`, ranks whose bodies were deleted. Across the 31 packs
that is 10 lost rank headers (8 packs) `[M rank1fit.py]`, 6 in the 17 single-command cuts.
The measured follow rate for the existing `ss-read` continue pointer is 57 of 242 = 23.6%
within three calls, 19 of 69 = 27.5% inside truncated outputs `[M re-derived from the census
JSON pointers array]`. At 23.6%, 10 newly named ranks buy about 2.4 requests per cell, about
+0.18% `[I]`. That is the same size as the generous saving, with the opposite sign. Net: about
0 ± 0.2% of the codex sweet cell. Opencode and claude-code: 0.0, as the candidate says.

---

## 4. "Superset of today's surviving content" is false on a fixed window `[M]`

The window is 5,000 + 5,000 bytes whatever the layout. Anything the tail section adds
displaces bytes that arrive today. `[M rank1fit.py]` Today's tails across the 31 cut packs
hold 386 one-line `(summary)` rank headers (already a manifest of the lower ranks), 24
code-bearing rank headers, and **2,043 numbered code lines** (median about 66 per pack).
`route=` survives in 27 of 31, 17 of 17 single-command. A manifest of `results=` median 16
ranks at about 70 characters each is about 1,100 characters, plus the verdict, route and
continue lines. That displaces roughly 25–35 code lines per truncated pack and adds, per
pack, on average 0.3 rank headers the model does not see today. It is a substitution with a
negative information balance, not a superset. Whether those displaced lower-rank lines ever
mattered is unmeasured on codex. The candidate itself killed the analogous claude-code trim
on exactly this exposure (14 of 68 edited files first seen at rank 6 or lower,
`candidates/harness-adaptive-rendering.md` §2.2) and then rated this layout "solve risk:
low". The two verdicts conflict on the same evidence.

The correctness claims also fail by construction. "25 half-delivered top-1 bodies → 0":
only 6 of the 25 cut-inside-rank-1 bodies fit any head `[M]`; 19 remain half-delivered.
"163 definition lines lost → 0": those lines sit in the deleted middle of `ss-read` gaps;
no layout of head and tail delivers them without a paid follow-up request — which is
register C9's priced trade-off.

---

## 5. The accounting half: true, reproduces, not a lever, not a prerequisite

`[M bvb.py]` Over single-command, single-header `ss-*` results in `fp-claudecode-tab-20260826`
sweet (raw stdout stored): `ss-search` n=181, median rendered-bytes/3.99 ÷ declared `used` =
**1.52** (p10 1.13, p90 3.80); `ss-find` n=77, median **1.57** (p10 1.07, p90 10.70). The
candidate's 1.54 / 1.54 reproduce. The exhibit reproduces: `fp-claudecode-none-20260826`,
`bfgroup__b2-259`, sweet, `r2-38`, subagent `agent-ac81ac4efebab094f.jsonl`, stub `Output too
large (33.2KB)`, persisted file `tool-results/bj8imustj.txt` = **34,044 bytes** with header
`budget=8000 used=1726`; 34,044 / 3.99 ≈ 8,530 tokens = 4.9 times the declared figure.

`[C]` Mechanism: `core/search/context-expander.js:32-35` `estimateTokens` = `text.length /
3.5` over the chunk code only; `tokensUsed += codeTokens` at line 2260, plus trimmed header
tokens (2314), neighbours (2379) and the same-file map (2456). The renderer in
`core/search/search-server.js:640-668` then adds the pack header, every `## #k` rank header,
the `### imports` block and the `N<TAB>` gutter via `numberCodeLines`, none of which are
counted. The under-declaration is real.

Two corrections. First, it books no lever value, as the candidate says; it belongs in the
register's measurement class. Second, it is **not a prerequisite for the layout**: a
byte-capped head is measured on the rendered string at write time, not on the packer's
counter. The coupling "R7 must land first" is unnecessary. Making the tiers bind is a
pack shrink, which the candidate's own §2.2 and register B13 already refuse.

---

## 6. Register adjudication requested by the synthesis (C9)

C9's row says "a general cap-aware renderer is explicitly rejected". c07 argues it is a
layout that "removes nothing". On a fixed 10,000-byte window nothing can be added without
removing something (§4), and the head cap is a budget whenever the rank-1 body overflows it,
which is 11 of 17 single-command cuts (§2). The mechanism is therefore inside the rejected
class in effect, even though it is not C9's design in name. C9's killing facts transfer:
the continue affordance's 23.6% follow rate and the 0-in-480 blind-edit null. c07 is not a
duplicate of C9; it is killed by C9's measurements plus its own kill condition.

---

## 7. Corrections the synthesis must adopt

1. Ceiling: replace "codex −0.7% (−0.14 requests/rollout)" with "**0.0% mechanism-supported;
   at most −0.15% under a generous reading; about +0.18% new continue demand at the measured
   23.6% follow rate; net about 0 ± 0.2% of the codex sweet cell**". Opencode and
   claude-code 0.0 stand.
2. Kill condition: **fired**. Rank-1 body over 4,800 characters in 11 of 17 single-command
   `ss-search` cuts (64.7%); 19 of 31 across all cut packs. Denominator is 17, not 33.
3. Follow-ups: 16 of 18 followed `ss-read` cuts, where the layout is a no-op; the 2 that
   followed an `ss-search` cut sat behind a 9,112-character rank-1 body.
4. Head geometry: sweet controls exactly **5,000 bytes** of head and **5,000 bytes** of tail;
   "5,190 characters" includes 185 characters of codex's preamble and warning lines.
   Overhead before the first rank-1 code line is 243–871 characters (median 342).
5. Delete "superset of today's surviving content": today's tails hold 2,043 numbered code
   lines over 31 cut packs and a manifest tail displaces part of them.
6. Delete "163 definition lines → 0" and "25 half-delivered bodies → 0": the middle is still
   deleted; at most 6 of 25 bodies can be completed.
7. Delete "solve risk: low": the displaced lower-rank exposure is unmeasured on codex and
   killed the sibling claude-code trim in the same document.
8. Exhibits: both named exhibits are `&&` bundles; exhibit 1 is `ss-read` (layout no-op);
   exhibit 2's rank-1 body is 18,191 characters (3.8× the head).
9. Accounting: keep as a measurement/hygiene row (`used=` counts code at 3.5 chars/token
   before headers, imports and gutter; measured ratio 1.52 `ss-search` n=181, 1.57 `ss-find`
   n=77; exhibit 4.9×). It is not a prerequisite for a byte-capped head and books no lever.
10. Keep as a fact: codex cuts a fixed 5,000-byte head and 5,000-byte tail of tool stdout
    (105/105 sweet, 238/238 native at exact 5,000 in the earlier c07 scratch, and both
    exhibits here). The history verifier's finding that this window was 4× larger on
    2026-08-11 at the same `cli_version` is `[carried]`, not re-measured here.

---

## 8. What I could not finish

- I did not replay all 105 envelopes under the three-section rule. I measured the parts that
  decide the verdict instead: rank-1 fit from the goldens for 31 of 33 packs, the follow-up
  class split for all 18 requests, and today's tail composition.
- 2 of the forensics' 33 cut `ss-search` packs were not the first block of their envelope
  and my script skipped them; a first-command head cannot hold them in any case.
- I did not measure on codex whether lower-rank lines that a manifest tail would displace
  were later edited or re-read. That number is `[carried]` from the candidate's claude-code
  screen (14/68).
- I did not re-measure the epoch-A cut geometry; that is the history verifier's result.
- I did not check opencode or claude-code, where the candidate claims 0.0.

---

## Appendix — evidence actually opened

Local repo (`/Users/admin/Projects/sweet-search-private`):
`eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`;
`.../slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`.../slate-c/candidates/harness-adaptive-rendering.md` (§0, §1.1–1.4, §2.2–2.4, C-1, C-4, §4);
`.../slate-c/candidates/DEDUP.md` (c07 entry);
`.../slate-c/forensics/codex-cap-x-ss.md` (whole);
`.../slate-c/forensics/scripts-codex-cap-x-ss/{cx-census.py,codex-cap-x-ss.json}`;
`.../slate-c/verify/c07-history.md`, `c07-measurability.md`;
`.../harness-gutter-cost-20260828/12-truncation-census.md` (§0–3);
`core/search/output-policy.js:56-64`; `core/search/search-server.js:636-668`;
`core/search/context-expander.js:32-35, 2108-2130, 2255-2262`;
`eval/agent-read-workflows/bin/_ss-helpers.mjs:501,803`.

Evidence box (`root@167.233.69.121`, read-only; scratch `/tmp/wf-slatec/c07-mechanism-v2/`):
`results/fp-codex-tab-20260826/rows.json`;
`results/fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/.../rollout-2026-08-26T22-28-06-01a04030-0d43-7062-bfac-05358042a140.jsonl` (call 5);
`.../rollout-2026-08-26T22-30-34-01a04032-4f6f-7b12-b5e5-190431514aaf.jsonl` (call 1);
`results/fp-codex-tab-20260826/agent-state/bfgroup__b2-113-sweet/.../rollout-2026-08-26T23-34-39-01a0406c….jsonl` (calls 32–35);
all 66 `*-sweet` codex rollout files of `fp-codex-tab-20260826` (rank1fit.py);
`/root/.ss-eval/golden/<repo>@<base>` for the 31 rank-1 files;
`results/fp-claudecode-tab-20260826/agent-state/*-sweet/**/*.jsonl` (bvb.py);
`results/fp-claudecode-none-20260826/agent-state/bfgroup__b2-259-sweet/claude-home/projects/-root--ss-eval-runs-r2-38/26998406-a8e3-4e66-b48c-5a629598a91a/{subagents/agent-ac81ac4efebab094f.jsonl,tool-results/bj8imustj.txt}`;
`/tmp/fp-inv/e1/e1_common.py` (golden resolution); prior scratch `/tmp/wf-slatec/c07-mechanism/c07_geometry.log`, `c07_packs.log` (read, cross-checked, not relied on);
`/tmp/wf-slatec/harness-adaptive-rendering/{codex-cut.py,budget-vs-bytes.py}`.

Scripts written (box): `exhibit.py` → `exhibit.log`; `rank1fit.py` → `rank1fit.log`,
`rank1fit.json`; `bvb.py` → `bvb.log`; inline → `ssread-exhibit.log`.
