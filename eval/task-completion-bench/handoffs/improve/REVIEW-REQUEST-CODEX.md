# Review request — sweet-search defect fixes, 2026-08-12

**This is a request for OPINION, not a work order.** Nothing here needs implementing. I want you to
try to break the reasoning. Where you think I am wrong, say so directly — a refuted finding is a
good outcome and several of mine already refuted the brief I was given.

**Read alongside:** [`FIX-REPORT.md`](./FIX-REPORT.md) (full detail),
[`HANDOFF-FIX-SWEET.md`](./HANDOFF-FIX-SWEET.md) (the brief I executed).

---

## 0. Context in one paragraph

**sweet-search** is a local code-retrieval tool exposing `ss-search`, `ss-grep`, `ss-read`,
`ss-find`, `ss-trace`, `ss-semantic` to coding agents. A SWE-bench-shaped benchmark compares a
`sweet` arm (those tools + a fixed instruction prefix) against a `native` arm (grep, file reads,
bash), everything else matched. Three harnesses — `codex`, `opencode`, `claude-code` — all on
`gpt-5.6-luna`, 17 tasks × 2 arms × 2 reps = 204 rollouts recorded 2026-08-11. The goal is for
sweet to be **cheaper and solve more** on all three. I was handed seven claimed defects to fix.

---

## 1. What I concluded

| item | verdict | basis |
|---|---|---|
| 1 — `ss-read` gutter corrupts edit anchors | real; fixed; **confirmed by paid A/B** | 14/20 anchor failures reproduce the off-by-one; A/B 15.4%→0%, p=0.0049 |
| 2 — `ss-grep --in` drops extra scopes | real; fixed | 1 occurrence in 251 calls |
| 3 — directory scopes rejected | real; fixed; **largest exposure in the set** | 10 of 11 directory scopes returned zero matches |
| 4 — `ss-trace` same-file fallback | **REFUTED** | cross-file tracing works; the one fallback was correct |
| 5 — grader tripwire | already shipped | verified |
| 6 — decoding degeneration | built | but direction is **opposite** to the brief |
| 7 — subagent spend off-ledger | already shipped | verified |
| 8 — empty `pages` param | already shipped | verified |

Total spend `$0.346`, all of it the item-1 A/B.

---

## 2. The six things in the brief I found wrong

Please check these hardest — if I am wrong about any, I have misled the project.

1. **Items 5, 7, 8 were already shipped** in commit `ab4f252` before I started. The brief presents
   all three as work to do.
2. **Item 4 does not reproduce.** The brief says `ss-trace` falls back to a same-file scan on
   Python, Lua and TypeScript. Across all 21 recorded `ss-trace` calls: TypeScript
   (`joshuakgoldberg__bingo-274`) returned `fan-in=2` with cross-file callers *and* callees across 4
   packages; Swift returned `fan-in=21`; Python had cross-file **callee** edges. The one Python
   fallback traced `_is_internal_or_hidden_traceback_frame`, a module-private helper whose only
   caller genuinely is in the same file. The fallback is also already announced in the output
   (`core/graph/structural-context-format.js:7-11`), which the brief says it is not.
3. **Item 6's direction is inverted.** The brief says the degeneration instance is on sweet's side
   and "removing it helps sweet". The billed-vs-retained ratio across all 68 claude-code rollouts is
   median 1.11, p90 1.71, p95 2.06, then nothing until 8.27 and 20.62 — exactly two outliers, **one
   per arm, on the same task**. The content limb is 4 native cells vs 2 sweet. Quarantine removes
   `$0.0894` of native spend and `$0.0983` of sweet.
4. **Item 6's stated mechanism is wrong.** The brief attributes the cost to "rejected edit payloads
   of roughly 127,666 bytes". No tool payload in any claude-code rollout exceeds 20KB. The real
   shape is 67,698 output tokens billed against ~11.5KB retained — a 22× billed-vs-retained gap on
   generation that was produced, paid for and discarded. A payload-content scan cannot see it.
5. **Item 1's slate attribution is wrong.** The brief says `SLATE-A-UBER.md` proposes `cat -n`
   padding "without knowing it was already rejected". The strings `cat -n` and `padded` do not
   appear in that file; §231 proposes a tab-aligned gutter, which is what I implemented.
6. **The brief's ranking is wrong.** It calls item 1 "the single best finding" and sequences item 3
   as a small warm-up. By measured exposure item 3 is the largest defect in the set (10 of 11
   directory scopes dead) and needs no paid run to prove.

---

## 3. Item 1 in detail — the one that cost money

**Mechanism.** `ss-read` rendered `N| ` — number, pipe, **one space**. A model rebuilding an
exact-match edit anchor must strip `123| ` (5 chars), not the visually salient `123|` (4). Stripping
4 carries one extra leading space and the harness's edit tool rejects it. sweet does not own that
edit tool, so the fix had to be render-side.

**Full-census replay** (not a sample) over all 204 rollouts: claude-code sweet had 20 anchor
failures across 141 edit calls; **14 match the read reconstructed with `N|` stripped and do NOT
match the true source**, per-line delta exactly +1. Native had 8 failures, none of this kind.

**Remedy chosen: `N<TAB>`, unpadded number, single tab.** The strongest argument was not a-priori —
Claude Code's own `Read` already renders `N<TAB>`, and the native arm shows **19,499 such gutter
lines with zero whitespace-carry failures** against sweet's 15,205 lines of `N| ` with 14. Same
harness, same model, same tasks. The tab-indented worry is refuted by `joshuakgoldberg__bingo-274`,
which reads TAB-indented TypeScript (`5<TAB><TAB>const …`) and landed 4 exact-match edits with
content tabs reproduced verbatim.

**A/B result** — sweet arm only, claude-code only, 4 tasks × 3 reps × 2 variants, one build with an
`SS_READ_GUTTER=pipe|tab` switch so nothing but the delimiter differed, `MAX_TOOL_CALLS=80` matched:

| | control `N\| ` | treatment `N<TAB>` |
|---|---:|---:|
| gutter lines rendered | 6,134 | 6,036 |
| gutter-derived anchors | 39 | 52 |
| **carried gutter whitespace** | **6 (15.4%)** | **0 (0.0%)** |
| edit-anchor tool failures | 10 | 4 |
| solve | 6/12 | 6/12 |

Fisher exact p = 0.0049. Zero control-task regressions (all 12 task×rep pairs identical).

---

## 4. What I actually want your opinion on

These are the places I am least confident. Ranked by how much a wrong answer would cost.

### Q1 — Is the item-1 endpoint legitimate, or a proxy that flatters the fix?

I pre-registered "fraction of gutter-derived edit anchors carrying gutter whitespace" as primary,
explicitly *not* cost or solve. It moved 15.4% → 0%. **But solve was 6/12 in both cells and I cannot
show any downstream effect.**

Is a mechanical endpoint with no demonstrated downstream benefit a real win, or am I dressing up a
tautology — the tab cannot carry a space, so of course the rate is zero? My defence is that the
defect is real (14 measured corrupted anchors, 10 tool failures in control vs 4 in treatment) and
that removing a known corruption source needs no downstream proof to be worth doing. Push on that.

### Q2 — Was the delimiter the right remedy, versus the alternative?

`SLATE-A-UBER.md` offered two: a tab-aligned gutter, or **a gutter-free body plus a separate line
map**. I chose the tab because it is a one-character change that preserves the validated −16%
agent-cost gutter and is empirically de-risked by the native arm. I did not seriously cost the
line-map design. Is that a mistake? The line map would remove per-line prefix tokens entirely, which
could be a cost win the tab cannot deliver.

### Q3 — Item 2: I chose a loud error over making `--in A B` work. Right call?

`--in` is now repeatable (`--in A --in B`) and any leftover bare positional is a usage error naming
both plausible intents. I rejected the greedy alternative because `ss-grep --in a b pat` would make
`b` the regex and `pat` a scope, and an unquoted multi-word pattern would silently become a
directory scope returning a confident "(no matches)" — the same failure class I was removing.

Cost: one retry turn, on ~0.4% of `ss-grep` calls. Is trading a turn for never-wrong correct here,
or is a benchmark that measures cost the wrong place for that trade?

### Q4 — Item 3's absolute-scope rule: sound, or does it over-widen?

For an absolute scope with the project root known, I strip the root and match relatively. With the
root unknown, I match if **some suffix of the scope equals the target's leading segments** (the
scope names an ancestor directory). I restricted that rule to absolute scopes, because applying it
to relative ones would let `a/b/c` match an unrelated `c/d`.

Is the ancestor rule safe for absolute scopes? Can you construct a case where it matches a file the
user did not intend? Note this is a pure post-filter over paths the engine already produced — it can
only remove results, never widen a read — so I believe the blast radius is "wrong results shown",
not "files read that should not be".

### Q5 — Is billed-vs-retained a legitimate exclusion criterion?

The degeneration detector's second limb flags a rollout when billed output tokens far exceed what
the transcript retained (threshold 4.0, chosen to sit inside the empty gap between p95 = 2.06 and
the first outlier at 8.27).

My worry: **am I excluding expensive-but-real work?** A model that thinks hard and discards drafts
is not obviously degenerate. My defence is the bimodality — nothing between 2.48 and 8.27 across 68
rollouts — and that both flagged rollouts are on the same task, one per arm. But the criterion is
inferential, unlike the content limb which reads actual corrupt bytes.

### Q6 — Should the three-view cost be published at all?

Item 6 publishes cost raw / flagged / excluded. Excluding the 8 flagged rollouts moves claude-code
from sweet +2.38% to +0.19% — but removes slightly *more* sweet spend than native, so it hands sweet
nothing.

Is publishing three views clarifying, or is it just adding researcher degrees of freedom to a
comparison that already cannot resolve a difference at n=17? There is a real argument that the
honest move is one view plus a footnote.

### Q7 — Anything I missed entirely?

The brief carried seven items from three prior research sessions that read 204 rollouts. I refuted
one and re-ranked another. If you think the whole framing is off — that these are small correctness
fixes while the actual gap is elsewhere — say so. Prior sessions killed ~30 ideas (see the discard
logs, `SLATE-A-UBER.md` §9 and `SLATE-B-UBER.md` §8); I did not re-derive those and may be
repeating a dead end.

---

## 5. Constraints I worked under, so you can judge whether I respected them

- **$0 unless explicitly authorised.** One A/B was authorised; it cost `$0.346`.
- **The evidence box is read-only.** For the A/B I synced two source files, backed them up first,
  and restored them afterwards md5-verified. No existing file under `results/` was ever modified.
- **HO2 (the frozen held-out set) is never run or inspected.** It was not.
- **Never use `ss-*` to develop sweet-search.** I did not; all analysis used native file tools.
- **Any new ranking signal must be format-gated** (`opts._isAgentFormat`), because ungated it once
  cost −27.57pp on GCSN dev MRR. None of my changes add a ranking signal. Item 3 is an explicit
  user-supplied filter applied only when `--in` is given; the gutter is a renderer, and its existing
  `benchmark`/`raw`/`json` gate is preserved and re-asserted by test. **Please check I am right that
  none of this can touch retrieval measurement.**

---

## 6. Where the evidence lives

- Runs: `results/sb-{codex,opencode,claudecode}-20260811/` on `root@167.233.69.121`
- A/B: `results/gutter-ab-control-20260812/`, `results/gutter-ab-treat-20260812/`
- Transcript reader: `dump-trace.mjs` (beside this file, and `/root/dump-trace.mjs` on the box)
- Code: `core/search/search-read.js` (gutter), `core/search/grep-output-shaping.js` (scopes),
  `eval/task-completion-bench/harness/degeneration.mjs` (detector)
- Tests: `tests/search/read-line-gutter.test.js`, `tests/search/grep-output-shaping.test.js`,
  `tests/unit/ss-argparse.test.js`, `eval/task-completion-bench/tests/degeneration.mjs`

**Reply with opinion only.** If something is wrong, name it and say what evidence would settle it.
