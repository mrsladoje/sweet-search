# E1 — Edit-mechanism census on the fresh pool

**Scope.** All 12 fresh-pool runs (epoch C), both arms, all three gutter forms.
264 cells, 792 rollouts, 2,002 edit calls, 2,793 anchors, 14,249 anchor lines.
**Method.** Read-only over the retained traces and the golden checkouts on the evidence box.
No rollout was launched. Nothing under `results/` was written.
**Scripts.** `scripts/e1_common.py`, `e1-census.py`, `e1-surfaces.py`, `e1-residue.py`,
`e1-extras.py` (copies ran from `/tmp/fp-inv/e1/` on the box).
**Per-case evidence.** `01-edit-mechanisms.json` (207 failed-edit cases, 20 carry cases,
every read-surface count, every repo indentation profile).

Tags: **[M]** measured in a trace, a row file or a golden checkout. **[C]** read from a tool
contract or source. **[I]** inferred. No web sources were used.

---

## 0. Verdict

**The gutter delimiter has a real, byte-level mechanism on claude-code, and this run finds a
form of it that no earlier pass reported: under `N<TAB>` the model carries the gutter TAB
into the anchor whenever the file is itself tab-indented. [M]** The delimiter is then
invisible, because it is the same character as the file's own indent. 8 of 61 claude
`Edit` calls on tab-indented repos carried it under sweet TAB, against 0 of 62 under PIPE
(`p = 0.0029`). The mirror image also holds: under PIPE the model carries the delimiter's
space, and that fires only in space-indented files — 6 of 144 against 0 of 195 under TAB
(`p = 0.0055`). **`NONE` is the only form that cannot carry anything, and it carried
nothing: 0 of 269 edits.** [M]

**Three further results.**

1. **Gutter residue is zero everywhere.** [M] Not one of 14,249 anchor lines across 2,002
   edit calls began with `^\d+\t`, `^\d+\| ` or `^\d+: `. The model always removes the
   number. The only question is what it does with the character after it.
2. **The carry costs turns and dollars, not solves.** [M] The 20 carry cases cost `$0.0327`
   of whole-episode spend across three cells. `devlooped__moq-1262`, where 14 of them sit,
   resolves **0 of 3 on claude-code in every condition** — native, TAB, NONE and PIPE alike.
3. **The same carry fires on claude-code's OWN `Read` tool.** [M] 6 of the 20 cases are on
   the native arm, which never calls `ss-read`. Native `Read` renders `N<TAB>` too. This is a
   harness-format defect, not a sweet-only defect, and switching `ss-read` to another
   delimiter would not remove it from the native surface.

**Codex and opencode show no delimiter mechanism at all.** [M] Their `apply_patch` seek
trims whitespace on pass three, so a one-character carry cannot fail them, and no failed
hunk in any form contained one. Opencode sweet TAB recorded **0 failed edits in 123
`apply_patch` calls** — the cleanest cell in the run.

---

## 1. Item 1 — who edits, how often, and how it fails

### 1.1 The edit surface each harness actually uses [M]

| harness | edit mechanism | share of edit calls | never used |
|---|---|---:|---|
| claude-code | `Edit` (`old_string`/`new_string`) | 1,019 of 1,055 (96.6%) | `MultiEdit`, `NotebookEdit` |
| claude-code | `Write` (whole file) | 20 of 1,055 (1.9%) | — |
| claude-code | Bash `python - <<PY` rewrite | 15 of 1,055 (1.4%) | — |
| claude-code | Bash `sed -i` | 1 of 1,055 (0.1%) | — |
| codex | `exec_command` with `apply_patch <<'PATCH'` | 480 of 480 (100%) | `sed -i`, `cat > file`, `git apply` |
| opencode | `apply_patch(patchText)` | 467 of 467 (100%) | `edit`, `write`, `patch`, `multiedit` |

Codex never received an `apply_patch` function tool; every edit is a shell heredoc. [M]
Opencode's nine fuzzy `edit` replacers were called **zero** times, exactly as in the
2026-08-25 runs. [M]

### 1.2 Per harness × arm × gutter form [M]

66 rollouts per cell, every denominator complete. "anchor fails" counts only the five
anchor-location error strings; the rest are no-ops, oversized JSON inputs and parse errors.
"retried" = a later edit call on the same file; "retry OK" = that retry succeeded.

| cell | edit calls | per rollout | failed | fail rate | anchor fails | rollouts ≥1 fail | rollouts ≥1 anchor fail | retried | retry OK | solved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude native | 323 | 4.89 | 54 | 16.7% | 24 | 18/66 | 11/66 | 54 | 30 | 43/66 |
| claude sweet **TAB** | 256 | 3.88 | 47 | 18.4% | 15 | 19/66 | 7/66 | 39 | 17 | 40/66 |
| claude sweet NONE | 270 | 4.09 | 40 | 14.8% | 12 | 15/66 | 6/66 | 31 | 20 | 41/66 |
| claude sweet PIPE | 206 | 3.12 | 26 | 12.6% | 9 | 16/66 | 6/66 | 22 | 15 | 39/66 |
| codex native | 124 | 1.88 | 9 | 7.3% | 8 | 7/66 | 7/66 | 9 | 8 | 41/66 |
| codex sweet **TAB** | 112 | 1.70 | 8 | 7.1% | 6 | 5/66 | 5/66 | 10 | 7 | 39/66 |
| codex sweet NONE | 124 | 1.88 | 4 | 3.2% | 4 | 2/66 | 2/66 | 4 | 4 | 41/66 |
| codex sweet PIPE | 120 | 1.82 | 4 | 3.3% | 4 | 4/66 | 4/66 | 4 | 4 | 42/66 |
| opencode native | 117 | 1.77 | 3 | 2.6% | 3 | 3/66 | 3/66 | 3 | 3 | 41/66 |
| opencode sweet **TAB** | 123 | 1.86 | **0** | 0.0% | 0 | 0/66 | 0/66 | 0 | 0 | 41/66 |
| opencode sweet NONE | 106 | 1.61 | 7 | 6.6% | 7 | 6/66 | 6/66 | 7 | 6 | 39/66 |
| opencode sweet PIPE | 121 | 1.83 | 4 | 3.3% | 4 | 4/66 | 4/66 | 4 | 4 | 38/66 |

**The `solved` column reproduces `FRESH-POOL-RESULTS.md` §1 exactly, 12 cells of 12.** [M]
That is the validation of the whole pipeline: the 3-dearest-transcript rule and the
rep assignment recover the published solve matrix without being told it.

**Rollouts-with-failure is the honest unit and it is flat.** Claude 19/16/15 for
TAB/PIPE/NONE against native's 18 (`TAB vs PIPE p = 0.69`). Only opencode separates at all:
TAB 0/66 against NONE 6/66, `p = 0.028` — and that is TAB looking **best**, in the opposite
direction to the 2026-08-25 six-task result.

### 1.3 Error tags from the harness error strings [M]

One failed call can carry more than one tag, so rows sum above the failed-call count.

| cell | anchor not found | ambiguous (`Found N matches`) | no-op (`old == new`) | JSON too large | apply_patch parse | file not found | other |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude native | 24 | 12 | 14 | 3 | — | 1 | 0 |
| claude sweet TAB | 15 | 11 | 13 | 6 | — | 0 | 2 |
| claude sweet NONE | 12 | 5 | 16 | 6 | — | 1 | 0 |
| claude sweet PIPE | 9 | 9 | 4 | 3 | — | 1 | 0 |
| codex native | 8 (`expected lines`) | — | — | — | 0 | 0 | 1 |
| codex sweet TAB | 4 (`expected lines`) | — | — | — | 3 | 1 | 0 |
| codex sweet NONE | 4 | — | — | — | 0 | 0 | 0 |
| codex sweet PIPE | 4 | — | — | — | 0 | 0 | 0 |
| opencode native | 3 | — | — | — | 0 | 0 | 0 |
| opencode sweet NONE | 7 | — | — | — | 0 | 0 | 0 |
| opencode sweet PIPE | 4 | — | — | — | 0 | 0 | 0 |
| opencode sweet TAB | 0 | — | — | — | 0 | 0 | 0 |

Claude's `ap-verification` column does not exist; codex and opencode have no `no-op` or
`ambiguous` class, because `apply_patch` reports a single seek failure instead.

### 1.4 Forensic anchor classes, against the golden base file [M]

All 22 goldens are present, so every failed anchor was diffed against the real base. The
unit here is a failed-ANCHOR record, not a failed call: one `apply_patch` call can carry
several hunks. 207 records in total.

| cell | text exists in base (hunk order / ambiguity) | body text differs | whitespace +1 | whitespace other | absent from base | empty anchor | decoding garbage | unclassified | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude native | 22 | 14 | **5** | 0 | 8 | 3 | 1 | 1 | 54 |
| claude sweet TAB | 23 | 1 | **11** | 1 | 3 | 6 | 0 | 0 | 45 |
| claude sweet NONE | 14 | 13 | **0** | 0 | 6 | 6 | 0 | 1 | 40 |
| claude sweet PIPE | 11 | 5 | **4** | 0 | 1 | 3 | 0 | 2 | 26 |
| codex native | 3 | 5 | 0 | 0 | 1 | 0 | 0 | 0 | 9 |
| codex sweet TAB | 2 | 5 | 0 | 0 | 3 | 1 | 0 | 0 | 11 |
| codex sweet NONE | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| codex sweet PIPE | 1 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 4 |
| opencode native | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| opencode sweet NONE | 4 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 7 |
| opencode sweet PIPE | 1 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 4 |
| opencode sweet TAB | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Every whitespace failure in the run is on claude-code.** [M] Codex and opencode produce
none, in any form, in either arm. That is the contract working: pass three of
`seek_sequence` compares `line.trim()` to `pattern.trim()`. [C]

### 1.5 Retry behaviour and what a failure costs [M]

A failure is priced two ways, and both are stated because the honest number is between them.

- **Lower bound — one extra request.** The retry turn's own ideal price. Without the failure
  the model would not have needed that round trip.
- **Upper bound — the whole episode.** Every turn from the failing call to the successful
  retry. This includes reading and testing the model would have done anyway.

| cell | failures | retried | retry succeeded | one extra request | share of cell | whole episode | share of cell | turns between (sum) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| claude native | 54 | 54 | 30 | `$0.05590` | 4.17% | `$0.18048` | 13.45% | 96 |
| claude sweet TAB | 47 | 39 | 17 | `$0.14433` | **11.31%** | `$0.20609` | 16.15% | 89 |
| claude sweet NONE | 40 | 31 | 20 | `$0.10656` | 8.82% | `$0.23443` | 19.41% | 90 |
| claude sweet PIPE | 26 | 22 | 15 | `$0.05547` | 5.13% | `$0.10047` | 9.28% | 35 |
| codex native | 9 | 9 | 8 | `$0.00777` | 0.96% | `$0.02496` | 3.09% | 16 |
| codex sweet TAB | 8 | 10 | 7 | `$0.00834` | 1.03% | `$0.02122` | 2.62% | 17 |
| codex sweet NONE | 4 | 4 | 4 | `$0.00298` | 0.37% | `$0.01214` | 1.50% | 13 |
| codex sweet PIPE | 4 | 4 | 4 | `$0.00300` | 0.36% | `$0.01317` | 1.57% | 16 |
| opencode native | 3 | 3 | 3 | `$0.00248` | 0.42% | `$0.00835` | 1.41% | 6 |
| opencode sweet TAB | 0 | 0 | 0 | `$0` | 0% | `$0` | 0% | 0 |
| opencode sweet NONE | 7 | 7 | 6 | `$0.00422` | 0.75% | `$0.01435` | 2.53% | 11 |
| opencode sweet PIPE | 4 | 4 | 4 | `$0.00218` | 0.38% | `$0.00687` | 1.19% | 9 |

**Edit failure is a claude-code cost line and nowhere else.** [M] It is 4–11% of a
claude-code cell on the lower bound and under 1.6% of a codex or opencode cell. The
tokens behind the claude sweet TAB figure are 59,266 newly-sent input, 6,480,456 re-sent
prefix and 225,590 output. Re-sent prefix dominates, which is the same resident-context tax
that drives the whole benchmark.

**Retries often fail again on claude-code.** [M] TAB 17 of 39 retries succeeded, NONE 20 of
31, PIPE 15 of 22, native 30 of 54. Codex and opencode retry successfully 36 of 41 times across their eight cells. The claude-code `Edit` tool has one tolerance — swapping
`\uXXXX` escapes — and no whitespace normalisation at all. [C]

**Escalation is visible.** [M] After repeated `Edit` failures on `moq`, the model fell back
to a Python rewrite and that failed too:

```
python3 - <<'PY'
from pathlib import Path
p=Path('src/Moq/Match.cs')
s=p.read_text()
old='this.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);'
assert s.count(old)==1
...
→ Exit code 1 / AssertionError
```
(`fp-claudecode-tab-20260826`, `devlooped__moq-1262-sweet`.)

---

## 2. Item 2 — gutter residue, the carry mechanism, and provenance

### 2.1 Residue: zero, everywhere [M]

Every line of every `old_string` and every `apply_patch` hunk was tested against
`^\d+\t`, `^\d+\| ` and `^\d+: `.

| cell | edit calls | anchors | anchor lines | `^N<TAB>` | `^N\| ` | `^N: ` |
|---|---:|---:|---:|---:|---:|---:|
| claude native | 323 | 305 | 1,822 | 0 | 0 | 0 |
| claude sweet TAB | 256 | 248 | 1,377 | 0 | 0 | 0 |
| claude sweet NONE | 270 | 264 | 1,784 | 0 | 0 | 0 |
| claude sweet PIPE | 206 | 202 | 1,470 | 0 | 0 | 0 |
| codex native | 124 | 251 | 1,102 | 0 | 0 | 0 |
| codex sweet TAB | 112 | 208 | 833 | 0 | 0 | 0 |
| codex sweet NONE | 124 | 246 | 1,116 | 0 | 0 | 0 |
| codex sweet PIPE | 120 | 199 | 860 | 0 | 0 | 0 |
| opencode native | 117 | 240 | 1,021 | 0 | 0 | 0 |
| opencode sweet TAB | 123 | 237 | 992 | 0 | 0 | 0 |
| opencode sweet NONE | 106 | 194 | 880 | 0 | 0 | 0 |
| opencode sweet PIPE | 121 | 199 | 992 | 0 | 0 | 0 |

**14,249 anchor lines, 0 residue.** [M] The 2026-08-26 finding is confirmed at eight times
the sample size. The number is never left in.

### 2.2 The carry: what the model does with the character after the number [M]

For every failed anchor the census finds the most recent tool output that showed the
region, then tests three strips of the shown bytes:

- **clean strip** — remove `\d+` and the whole delimiter. Correct.
- **digits-only strip** — remove `\d+`, keep the delimiter. Under TAB this adds one TAB.
- **digits + glyph strip** — remove `\d+` and the `|` or `:`, keep the trailing space. Under
  PIPE and COLON this adds one SPACE.

A strip only counts when it differs from the clean strip, so an un-gutted block cannot
match all three.

| cell | anchor is a faithful clean copy | **CARRY: delimiter kept** | **CARRY: space kept** | first line clean, later lines diverge | no signature | never shown | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| claude native | 11 | **3 + 3 first-line** | 0 | 20 | 4 | 13 | 54 |
| claude sweet TAB | 19 | **7 + 1 first-line** | 0 | 6 | 4 | 8 | 45 |
| claude sweet NONE | 12 | 0 | 0 | 9 | 1 | 18 | 40 |
| claude sweet PIPE | 7 | 0 | **1 + 5 first-line** | 8 | 1 | 4 | 26 |
| codex (all 4 cells) | 6 | 0 | 0 | 3 | 5 | 14 | 28 |
| opencode (all 4 cells) | 2 | 0 | 0 | 5 | 4 | 3 | 14 |

**20 carry cases in the run. All 20 are on claude-code.** [M] Full per-case evidence is in
`01-edit-mechanisms.json` under `gutter_carry_cases`.

### 2.3 The mechanism, with the bytes

**TAB carry — the delimiter hides inside a tab-indented file.** [M]
`fp-claudecode-tab-20260826/agent-state/devlooped__moq-1262-sweet/…/r0-74`, `src/Moq/Match.cs`:

```
ss-read showed :  '245\t\t\t\tthis.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);'
Edit old_string:  '\t\t\t\tthis.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);'
on disk        :  '\t\t\tthis.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);'
```
The file has **three** tabs of indent. The gutter adds a fourth. The model removed `245`
and kept every tab. Nothing in the rendered line marks where the gutter ends and the code
begins, because both are the same character.

**The same bytes on the NATIVE arm, from claude-code's own `Read`.** [M]
`fp-claudecode-tab-20260826/agent-state/devlooped__moq-1262-native/…/r1-86`,
`src/Moq/ExpressionComparer.cs`:

```
native Read showed:  '36\t\t\t\tif (x is MemberExpression)'
Edit old_string   :  '\t\t\t\tif (x is MemberExpression)'
on disk           :  '\t\t\tif (x is MemberExpression)'
```

**PIPE carry — the delimiter's space hides inside a space-indented file.** [M]
`fp-claudecode-pipe-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/…/r1-4`,
`lib/cli.js`:

```
ss-read showed :  "772|                 .option('metadata', {"
Edit old_string:  "                 .option('metadata', {"   (17 spaces)
on disk        :  "                .option('metadata', {"   (16 spaces)
```

And on `callstack__react-native-paper-972`, `src/components/Searchbar.js`:

```
ss-read showed :  '135|       clearIcon,'
Edit old_string:  '       clearIcon,'   (7 spaces)
on disk        :  '      clearIcon,'    (6 spaces)
```

**Each form is blind in the opposite place.** [M] Carries split perfectly by the repo's own
indent character:

| form | carries in tab-indented repos | edits there | carries in space-indented repos | edits there |
|---|---:|---:|---:|---:|
| claude sweet TAB | **8** | 61 | 0 | 195 |
| claude sweet PIPE | 0 | 62 | **6** | 144 |
| claude sweet NONE | 0 | 90 | 0 | 180 |
| claude native (`Read` = `N<TAB>`) | **6** | 79 | 0 | 244 |

Fisher exact, two-sided: TAB 8/61 vs PIPE 0/62 in tab-indented repos, **`p = 0.0029`**;
PIPE 6/144 vs TAB 0/195 in space-indented repos, **`p = 0.0055`**. [M]

### 2.4 Exposure: how much of the pool can be hit [M]

Indentation profile of the 22 golden checkouts, code files only:

| repo | tab-indented lines | space-indented lines | tab share |
|---|---:|---:|---:|
| `celestiaorg__nmt-192` | 3,452 | 0 | **1.000** |
| `apigee__registry-961` | 64,521 | 61 | **0.999** |
| `devlooped__moq-1262` | 37,599 | 758 | **0.980** |
| `locationtech__jts-622` | 15,906 | 138,234 | 0.103 |
| `bfgroup__b2-259` | 3,258 | 51,360 | 0.060 |
| `mathnet__mathnet-numerics-1072` | 2,007 | 254,770 | 0.008 |
| the other 16 repos | ≤ 135 each | — | ≤ 0.002 |

**3 of 22 tasks (14%) are exposed to the TAB carry; 19 of 22 are exposed to the PIPE
carry.** [M] By that arithmetic PIPE has the larger exposed surface and TAB the higher
rate inside its exposed surface.

### 2.5 Failure rate split by indentation style [M]

| cell | failed / edits on TAB-indented repos | failed / edits on SPACE-indented repos |
|---|---:|---:|
| claude native | 21/79 (26.6%) | 33/244 (13.5%) |
| claude sweet **TAB** | **32/61 (52.5%)** | 15/195 (7.7%) |
| claude sweet NONE | 20/90 (22.2%) | 20/180 (11.1%) |
| claude sweet PIPE | 7/62 (11.3%) | 19/144 (13.2%) |
| codex sweet TAB | 3/31 | 5/81 |
| codex sweet NONE | 0/27 | 4/97 |
| codex sweet PIPE | 1/25 | 3/95 |
| opencode sweet TAB | 0/23 | 0/100 |
| opencode sweet NONE | 2/26 | 5/80 |
| opencode sweet PIPE | 0/25 | 4/96 |

Claude sweet TAB fails **52.5%** of its edits inside tab-indented repos, against 11.3% for
PIPE there (`p < 0.0001` at edit level). **At the honest rollout unit the same comparison is 6 of 9 against 3 of 9, `p = 0.35`.** [M] The edit-level effect is large and mechanistic. The rollout-level effect
is not measurable at n = 9.

### 2.6 Provenance of every failed anchor [M]

Surface that last showed the region, and its gutter form.

| cell | ss-read | ss-search | ss-find | ss-grep | ss-trace | native Read/read | shell | never shown |
|---|---|---|---|---|---|---|---|---:|
| claude native | — | — | — | — | — | 40 (tab) | 1 (none) | 13 |
| claude sweet TAB | 27 (tab) + 1 (none) | 3 (tab) | — | — | 3 (none) | 2 (tab) | 1 (none) | 8 |
| claude sweet NONE | 17 (none) | — | 2 (none) | — | 1 (none) | 1 (tab) | 1 (none) | 18 |
| claude sweet PIPE | 18 (pipe) | — | — | 1 (pipe) + 1 (none) | 1 (none) | 1 (tab) | — | 4 |
| codex native | — | — | — | — | — | — | 3 `sed`, 1 `cat`, 3 other | 2 |
| codex sweet TAB | 3 (none) | — | — | — | — | — | 1 (none) | 7 |
| codex sweet NONE | — | 1 (`ss-semantic`, none) | — | — | — | — | — | 3 |
| codex sweet PIPE | 1 (none) | — | — | — | — | — | 1 (none) | 2 |
| opencode native | — | — | — | — | — | 2 (colon) | 1 (none) | 0 |
| opencode sweet NONE | 3 (none) | — | — | — | — | 1 (colon) | 1 (none) | 2 |
| opencode sweet PIPE | — | 2 (pipe) | — | — | — | — | 1 (none) | 1 |
| opencode sweet TAB | — | — | — | — | — | — | — | 0 |

Two facts follow. **`ss-search` output is numbered in this run** and one TAB carry anchored
on it (`ba5b4ee` landed 2026-08-26 16:14, before the first rollout at 22:27). [M]
**`ss-trace` is the only sweet surface still un-numbered**, and 5 failed anchors came from
it. [M]

Native `read` on opencode carries its own colon prefix, as the contract says: [M]

```
<content>
280: 
281:         _, _ ->
282:           {:ok, true}
```

---

## 3. Item 3 — read surfaces

### 3.1 Read calls per rollout, by surface [M]

Counting tool calls that contain the surface. Codex and opencode pack several commands into
one envelope, so their counts are not comparable with claude-code's.

| cell | ss-read | ss-grep | ss-search | ss-find | ss-semantic | ss-trace | native Read/read | shell `sed`/`cat`/`nl`/`grep`/`rg`/`head` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| claude native | — | — | — | — | — | — | **18.88** | 7.39 |
| claude sweet TAB | 4.62 | 5.06 | 2.74 | 1.29 | 0.06 | 0.11 | 2.03 | 1.90 |
| claude sweet NONE | 5.36 | 4.23 | 2.15 | 1.65 | 0.17 | 0.21 | 1.08 | 0.65 |
| claude sweet PIPE | 5.09 | 4.38 | 2.42 | 1.20 | 0.24 | 0.26 | 1.86 | 0.71 |
| codex native | — | — | — | — | — | — | — | **7.81** (`sed` 3.05, `rg` 2.68, `cat` 1.41, `nl` 0.65) |
| codex sweet TAB | 4.38 | 2.14 | 1.12 | 0.21 | 0.45 | 0.06 | — | 0.46 |
| codex sweet NONE | 4.12 | 2.08 | 1.30 | 0.35 | 0.36 | 0.08 | — | 0.37 |
| codex sweet PIPE | 4.32 | 2.06 | 1.17 | 0.30 | 0.26 | 0.05 | — | 0.57 |
| opencode native | — | — | — | — | — | — | **9.03** | 0 |
| opencode sweet TAB | 5.73 | 2.85 | 1.52 | 0.52 | 0.09 | 0.09 | 0.27 | 0.02 |
| opencode sweet NONE | 5.59 | 2.92 | 1.67 | 0.47 | 0.32 | 0.20 | 0.39 | 0.02 |
| opencode sweet PIPE | 4.68 | 2.67 | 1.55 | 0.59 | 0.17 | 0.12 | 0.39 | 0.02 |

**Native reads far more often and in smaller pieces on claude-code** (18.9 `Read` calls per
rollout at 3,146 B each) **and far larger pieces on codex** (`sed` 8,127 B, `cat` 8,580 B
per call). [M]

### 3.2 Bytes per call [M]

| cell | ss-read | ss-search | ss-find | ss-grep | native Read/read | `sed` | `cat` | `nl` | `rg` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude native | — | — | — | — | 3,146 | — | — | — | 5,648 |
| claude sweet TAB | 5,333 | 6,389 | 8,149 | 742 | 4,281 | — | — | — | — |
| claude sweet NONE | 4,536 | 6,034 | 7,479 | 861 | 3,116 | — | — | — | — |
| claude sweet PIPE | 4,921 | 6,799 | 9,254 | 1,000 | 3,887 | — | — | — | — |
| codex native | — | — | — | — | — | 8,127 | 8,580 | 5,080 | 5,878 |
| codex sweet TAB | 6,095 | 7,289 | — | 2,320 | — | — | — | — | 1,601 |
| codex sweet NONE | 6,087 | 6,023 | 7,366 | 2,613 | — | — | — | — | — |
| codex sweet PIPE | 6,383 | 6,493 | 7,868 | 2,046 | — | — | — | — | 4,718 |
| opencode native | — | — | — | — | 4,388 | — | — | — | — |
| opencode sweet TAB | 4,965 | 6,241 | 7,704 | 940 | 9,940 | — | — | — | — |
| opencode sweet NONE | 3,832 | 6,275 | 7,991 | 899 | 5,168 | — | — | — | — |
| opencode sweet PIPE | 5,070 | 6,515 | 6,969 | 915 | 4,756 | — | — | — | — |

### 3.3 ss-read: what was asked for against what arrived [M]

`ss-read` invocations are counted inside compound commands, so they exceed the tool-call
count in §3.1.

| cell | invocations | per rollout | whole-file (no range) | ranged | lines requested | blocks delivered | lines delivered | blocks under 15 lines | blocks short of the header range |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude sweet TAB | 418 | 6.33 | 0 | 418 | 52,094 | 414 | 42,183 | 15 | 1 |
| claude sweet NONE | 492 | 7.45 | 18 | 474 | 53,975 | 472 | 46,065 | 14 | 3 |
| claude sweet PIPE | 456 | 6.91 | 5 | 451 | 49,924 | 439 | 40,659 | 10 | 0 |
| codex sweet TAB | 542 | 8.21 | 23 | 519 | 62,785 | 478 | 41,544 | 46 | **65** |
| codex sweet NONE | 484 | 7.33 | 0 | 484 | 63,276 | 436 | 43,037 | 37 | **62** |
| codex sweet PIPE | 530 | 8.03 | 0 | 530 | 67,219 | 486 | 42,662 | 40 | **90** |
| opencode sweet TAB | 438 | 6.64 | 0 | 438 | 64,342 | 417 | 46,577 | 17 | 0 |
| opencode sweet NONE | 395 | 5.98 | 0 | 395 | 51,936 | 385 | 42,441 | 16 | 0 |
| opencode sweet PIPE | 358 | 5.42 | 1 | 357 | 51,428 | 346 | 40,364 | 8 | 0 |

**Whole-file reads are rare** — 47 of 4,113 `ss-read` invocations across all sweet cells
(1.1%). The agent asks for a range almost always. [M]

**"Short of the header range" is a codex-only defect and PIPE makes it worse.** [M] The
header declares `lines A-B`, and the fenced body arrives with fewer lines because codex
truncated it. 90 blocks under PIPE, 65 under TAB, 62 under NONE.

### 3.4 Re-reads [M]

| cell | read targets | same file read again | overlapping range read again |
|---|---:|---:|---:|
| claude native | 1,250 | 496 (39.7%) | 389 (31.1%) |
| claude sweet TAB | 552 | 190 (34.4%) | 123 (22.3%) |
| claude sweet NONE | 563 | 189 (33.6%) | 137 (24.3%) |
| claude sweet PIPE | 579 | 205 (35.4%) | 126 (21.8%) |
| codex native | 792 | 296 (37.4%) | 198 (25.0%) |
| codex sweet TAB | 554 | 207 (37.4%) | 152 (27.4%) |
| codex sweet NONE | 485 | 180 (37.1%) | 123 (25.4%) |
| codex sweet PIPE | 558 | 215 (38.5%) | 151 (27.1%) |
| opencode native | 596 | 127 (21.3%) | not measurable (no range in the call) |
| opencode sweet TAB | 456 | 124 (27.2%) | 62 (13.6%) |
| opencode sweet NONE | 421 | 107 (25.4%) | 43 (10.2%) |
| opencode sweet PIPE | 384 | 99 (25.8%) | 43 (11.2%) |

Sweet halves the number of read targets on claude-code and re-reads the same overlapping
region 22% of the time against native's 31%. [M] The gutter form does not move it.

### 3.5 Codex middle-out truncation [M]

| cell | truncated calls | per rollout | tokens before truncation (sum) | median deleted span | largest deleted span | by surface |
|---|---:|---:|---:|---:|---:|---|
| codex native | **238** | 3.61 | 1,205,123 | 1,861 | 45,998 | `sed` 107, `cat` 61, `rg` 61, `nl` 9 |
| codex sweet TAB | 105 | 1.59 | 371,179 | 749 | 4,329 | `ss-read` 70, `ss-search` 25, `ss-grep` 5, `ss-find` 3, `ss-trace` 2 |
| codex sweet NONE | 100 | 1.52 | 383,827 | 771 | 13,096 | `ss-read` 60, `ss-search` 23, `ss-find` 10, `ss-grep` 4, `ss-trace` 2, `ss-semantic` 1 |
| codex sweet PIPE | **120** | 1.82 | 445,772 | 869 | 5,253 | `ss-read` 76, `ss-search` 18, `ss-find` 9, `rg` 7, `sed` 6, `ss-grep` 3, `ss-semantic` 1 |
| claude-code, all cells | 0 | 0 | — | — | — | `BASH_MAX_OUTPUT_LENGTH` never hit |
| opencode, all cells | 0 | 0 | — | — | — | no cap observed |

The shape, with the bytes: [M]
`fp-codex-tab-20260826/…/absinthe-graphql__absinthe-998-sweet/…rollout-2026-08-26T22-27-20…jsonl`

```
Original token count: 2937
Warning: truncated output (original token count: 2937)
…
31\tWhen what you're looking for may not exis…437 tokens truncated…pattern (a rule, a
44\thandler, an endpoint), read AT MOST two examples of that pattern, then start writ
```
Line 31 is followed by line 44. Twelve lines are gone and the numbering is the only clue.

**PIPE truncates 14% more codex calls than TAB.** [M] This run measures the delimiter's own
price directly: 19 identical `ss-read <file> <start> <end>` commands ran under two or three
forms, and codex reports its own token count for each.

| comparison | n identical commands | mean ratio |
|---|---:|---:|
| TAB vs NONE | 13 | **1.112** |
| PIPE vs NONE | 6 | **1.128** |
| PIPE vs TAB | 6 | **1.024** |

Example: `ss-read src/build/configure.jam 1 260` → NONE 1,490 tokens, TAB 1,723 (+15.6%).
`ss-read src/Numerics/SpecialFunctions/Stability.cs 1 140` → NONE 1,362, TAB 1,469, PIPE
1,503. [M]

### 3.6 Un-gutted delivered code, after `ba5b4ee` [M]

| cell | gutted code lines | un-gutted code lines | un-gutted share | where the residue is |
|---|---:|---:|---:|---|
| codex sweet TAB | 57,239 | 1,820 | **3.1%** | `ss-search` 751, `ss-read` 499, `ss-trace` 291, `ss-grep` 227, `ss-find` 52 |
| claude sweet TAB | 86,782 | 2,667 | **3.0%** | `ss-search` 988, `ss-trace` 919, `ss-read` 430, `ss-find` 330 |
| opencode sweet TAB | 66,070 | 1,222 | **1.8%** | `ss-search` 511, `ss-find` 278, `ss-read` 270, `ss-trace` 163 |

The 2026-08-26 investigation measured 27–36% of delivered code lines un-numbered. It is now
1.8–3.1%. [M] The remainder is `ss-trace` (never numbered) and blocks under the 15-line
threshold.

---

## 4. Item 4 — verdict per harness

### claude-code — **YES, a delimiter mechanism is present, in both TAB and PIPE**

The tool contract is exact-substring match with one tolerance, `\uXXXX` escape swapping, and
no whitespace normalisation. [C] A one-character carry therefore fails the call. It happens,
in both gutted forms, and each form is blind in a different file style.

Bytes, TAB, sweet arm (`devlooped__moq-1262`, `src/Moq/SetupCollection.cs`):
```
shown  : '47\t\t\t\t\tthis.setups.Add(setup);'      (gutter tab + 4 content tabs)
anchor : '\t\t\t\t\tthis.setups.Add(setup);'        (5 tabs)
disk   : '\t\t\t\tthis.setups.Add(setup);'          (4 tabs)
→ "String to replace not found in file."
```
Bytes, PIPE, sweet arm (`callstack__react-native-paper-972`, `src/components/Searchbar.js`):
```
shown  : '135|       clearIcon,'
anchor : '       clearIcon,'    (7 spaces)
disk   : '      clearIcon,'     (6 spaces)
→ "String to replace not found in file."
```
Bytes, TAB, **native** arm, from claude-code's own `Read` (`src/Moq/Match.cs`):
```
shown  : '220\t\t\t\t\treturn ExpressionComparer.Default.Equals(this.RenderExpression, other.RenderExpression);'
anchor : '\t\t\t\t\treturn ExpressionComparer.Default.Equals(...);'   (5 tabs)
disk   : '\t\t\t\treturn ExpressionComparer.Default.Equals(...);'     (4 tabs)
```

**A failure the delimiter prevented:** none observable. `NONE` produced 0 carries but its own
failure rate on tab-indented repos is 20/90, higher than PIPE's 7/62. Removing the gutter
removes the carry and does not lower the failure rate.

**A failure the delimiter caused:** 20, priced at `$0.0327` whole-episode and `$0.0126` on
the one-extra-request bound. **None changed a solve.** `moq-1262` is 0/3 on claude-code in
all four conditions; `registry-961` is 3/3 in all four. `nmt-192` is 3/3 in three conditions and 2/3 under
claude sweet TAB; that lost rollout (rep 0) made **no edit call at all** and shipped no
patch, so no edit failure is involved. [M]

### codex — **NO mechanism**

`seek_sequence` runs exact → `trim_end` → `trim` → unicode-normalise. [C] A carried tab or
space matches on pass three. Nothing in this run contradicts that: 0 whitespace failures in
28 failed-anchor records across four cells, 0 residue in 3,911 anchor lines.

The 8 codex sweet TAB failed calls carry 11 failed-anchor records: 5 body-text differences,
3 anchors absent from the base, 2 that exist verbatim in the base (hunk order or
ambiguity), 1 empty. Three come from one
rollout that typed a wrong path — `/root/.ss-eval/r2-78/…` instead of
`/root/.ss-eval/runs/r2-78/…`: [M]

```
apply_patch verification failed: Failed to read file to update
/root/.ss-eval/r2-78/src/Moq/ExpressionComparer.cs: No such file or directory (os error 2)
```

Three more are patch-grammar errors — a `*** Delete File:` line placed inside an update
hunk: [M]

```
apply_patch verification failed: invalid hunk at line 63, Unexpected line found in update
hunk: '*** Delete File: lib/rules/order/ordering.js'. Every line should start with ' '
(context line), '+' (added line), or '-' (removed line)
```

Codex's real delimiter cost is the **output cap**, not the anchor: PIPE truncates 120 calls
against TAB's 105 and NONE's 100, and delivers 90 short blocks against 65 and 62. [M]

### opencode — **NO mechanism**

Same four-pass seek, ported to TypeScript. [C] Sweet TAB recorded **0 failures in 123
`apply_patch` calls and 992 anchor lines**. NONE recorded 7 and PIPE 4, all body-text or
hunk-order errors. Opencode's own `read` renders `N: `, which is the same shape as `N| `,
and it produced no carry either — because `apply_patch` forgives leading whitespace. [C][M]

---

## 5. Method, validation and limits

**Cells.** 264 = 3 harnesses × (22 native + 3 forms × 22 sweet). Native exists only in the
`*-tab-*` runs and is form-independent, so it is counted once per harness. The 11 repair
tasks take their opencode sweet rows from `rp-oc-{tab,none,pipe}-20260827`. **0 cells
missing.** [M]

**Rollout selection.** Three dearest transcripts per cell (trap 5). Rep index comes from
`rows.json` `rolloutFile` on codex, and from the jail path `runs/r<rep>-<n>` on opencode and
claude-code, with a single remaining hole filled by elimination.

**Validation.** The per-cell `resolved` counts recovered by this pipeline match
`FRESH-POOL-RESULTS.md` §1 in all 12 cells. Reconstructed cost per rollout matches the
published opencode figures to within `$0.00004` (`$0.009260` vs `$0.009265` TAB;
`$0.008579` vs `$0.008584` NONE; `$0.008731` vs `$0.008764` PIPE). [M]

**Cost column.** `idealUsd`, cache-normalised, the same formula as `costFromTurns`:
`newIn × $0.10 + resent × $0.01 + out × $0.60` per million. [C] Codex `out` follows the
harness convention `output_tokens + reasoning_output_tokens`; codex's own `total_tokens`
shows `output_tokens` already includes reasoning, so this over-counts codex output slightly.
The convention is kept so the numbers stay comparable with the published table. [M]

**Claude-code cost is transcript-reconstructed and sidechain-inclusive**, never summed from
`rows.json` (trap 2). My claude figures run 3–6% below the published reconstruction
(`$0.020328` vs `$0.021558` native); both are lower bounds and the sign of every comparison
is unchanged.

**Known limits.**

1. Retry linkage matches the next edit call on the same **file**, not the same hunk. A
   rollout that edits one file repeatedly can link a failure to an unrelated later edit.
   The one-extra-request bound is insensitive to this; the whole-episode bound is not.
2. `text-exists-in-base` bundles hunk-order errors, ambiguous context and
   already-applied hunks. Separating them needs the moving line index, which is item-level
   work not done here.
3. The TAB-carry effect rests on one task, `devlooped__moq-1262`. Three repos in the pool
   are tab-indented; only one produced claude-code `Edit` failures at volume. n = 9 rollouts
   per condition on that subset.
4. Codex "never shown" anchors (14 cases) were checked against middle-out gaps only
   coarsely — gaps present in the same rollout, not the same file region.

---

## Appendix — artifacts

| file | contents |
|---|---|
| `01-edit-mechanisms.json` | 207 failed-edit cases with run, cell, transcript, call id and bytes; 20 carry cases; per-cell summaries; read surfaces; repo indentation |
| `scripts/e1_common.py` | run map, repair substitution, per-harness parsing with turn indices and usage, edit detection, failure classes, gutter regexes, golden resolution |
| `scripts/e1-census.py` | items 1, 2 and 4 |
| `scripts/e1-surfaces.py` | item 3 |
| `scripts/e1-residue.py` | residue over every edit payload; indentation split |
| `scripts/e1-extras.py` | delimiter token price from identical commands; repo indentation; never-shown anchors vs truncation |
| `logs/census.log`, `surfaces.log`, `residue.log`, `extras.log` | full script output |
| `logs/census.json`, `surfaces.json`, `residue.json`, `extras.json` | raw script output |

**Corrections to the scripts inherited from `/tmp/gutter-inv/`.**

1. **Codex apply_patch verdicts were read from the shell exit code.** That code belongs to
   the whole compound command. `apply_patch <<PATCH … && rm x && npm test` exits non-zero
   when `rm` fails, although the edit applied. Three false failures were removed by reading
   the `Success. Updated the following files:` / `apply_patch verification failed:` markers
   instead. Cross-checked against codex's `patch_apply_end` records: 376 of 376 successes
   carry the marker, and `patch_apply_end` is never emitted for a failure. [M]
2. **`strip_naive` handled `|` and `:` only.** The TAB carry needs a digits-only strip, which
   keeps the delimiter itself. Without it the whole TAB mechanism is invisible.
3. **A mis-strip that equals the clean strip is not a carry.** An un-gutted block matches
   every strip rule trivially. Guarding for that removed 12 phantom "carries" from
   `claude sweet NONE` and 11 from `claude native`.
4. **Codex edits are now counted** (the 2026-08-26 correction, carried forward), and shell
   edit mechanisms beyond `apply_patch` are classified: `sed -i`, `perl -i`, `python`
   rewrite, `cat`/`tee > file`, `git apply`.
