# Panel review — gutter and edit mechanics (tag `p2`)

**Target.** `09-synthesis-draft.md`, claims 1, 2, 3, 4, 5, 18 and 20, plus the five new
gutter designs in its §4.2.
**Method.** Read-only over the epoch-C traces, the golden checkouts and the two deployed
harness binaries on the evidence box. Every tokeniser number was re-derived locally from
scratch in a fresh `tiktoken` venv. No rollout was launched. Nothing under `results/` was
written. My box scratch is `/tmp/fp-inv/p2/`.
**Scripts** (all in `scripts/`, all mine, none imported from `e1_common.py` or
`r1-gutter-tokens.py`): `p2-casebytes.py`, `p2-casebytes2.py`, `p2-tok.py`,
`p2-transparency.py`, `p2-ambiguity2.py`, `p2-cxoc.py`, `p2-silentcarry.py`,
`p2-carryroll.py`, `p2-carryproof.py`, `p2-cap.py`, `p2-strip.py`, `p2-colon.py`,
`p2-ocerr.py`. Output in `logs/p2-*.txt`.

Tags: **[M]** measured by me, script and numbers named · **[C]** read from source or a
deployed binary · **[I]** inferred.

---

## 0. Verdict

**The draft's arithmetic survives. Its mechanism story does not.**

Three findings change the picture.

1. **The tab is not a zero-ambiguity delimiter.** [M] It is ambiguous exactly where the
   file's own indentation is tabs. On the draft's own five-file corpus `N<TAB>` fuses into
   a homogeneous tab run on **9.9%** of lines — every one of them tab-indented — against
   `N| ` at 64.1% and `N:`/`N|` at **0.0%**. `05` §3.4 reports the tab at "0% ambiguous"
   because its ambiguity test only looks for a fused run of **spaces**. That test cannot
   see the one failure `01` actually measured.
2. **Codex and opencode do have the delimiter mechanism.** [M] Under `N<TAB>` both carry
   the gutter tab into `apply_patch` context lines: 15 lines in 4 of 66 codex rollouts and
   15 lines in 3 of 66 opencode rollouts, against **0 under NONE and 0 under PIPE** (pooled
   7/132 against 0/265, `p = 0.0004`). Their four-pass seek trims the extra tab away and
   the call reports success, so the mechanism is invisible in the failure log. It is not
   absent.
3. **Claude-code's read-before-edit gate is switched off by the model's name, not by the
   tool's design.** [C] `grg = new Set(["claude-opus-4-6", … ,"claude-3-5-haiku"])` and the
   gate throws unless the model is outside that set. The benchmark ran
   `openai/gpt-5.6-luna`. On any Claude model — that is, on every real claude-code user —
   an `Edit` with no prior `Read` throws. 218 of 259 sweet TAB edits had exactly that shape.

The decision does not move: keep `N<TAB>`, ship nothing on the delimiter. The reason
changes. The tab is not safe and cheap. It is **cheap, and hazardous in a different place
from the pipe**, and no affordable run can price the difference.

---

## 1. Verdicts

### Claim 1 — the tab gutter costs `$0.00030`–`$0.00044` (2.1–3.7%), two thirds resident; `05`/`06` understate it 2.5–4× because they used the epoch-B line count

**UPHELD in magnitude. WEAKENED in attribution.**

The magnitude reproduces three independent ways. `03`'s 1,163 codex gutter tokens divided
by its own +1.341 tokens per line gives 867 gutted lines; `01` §3.6 counts 57,239 gutted
lines over 66 rollouts, which is 867.3 [M]. The resident share is 61.6% / 62.7% / 67.0%
on codex / opencode / claude-code, so "two thirds" is fair [M, `03` §2.1 divided out].

The attribution is only half right. I decomposed the codex understatement [M `p2-tok.py`]:

| factor | value |
|---|---:|
| line count, epoch C ÷ epoch B | 878 ÷ 394 = **2.23×** |
| per-line overhead, `03` ÷ `05` | 1.341 ÷ 1.481 = **0.91×** |
| net token ratio | **2.02×** |
| observed cost-share ratio (2.45% ÷ 0.75%) | **3.27×** |
| **residual, from the residency model** | **1.62×** |

So the line count explains about two thirds of the gap in log terms. The rest is `05`'s
residency assumption: it charged the gutter over half the turns and used call counts (12.5)
where requests (19.6) belong. The draft states both causes in §7 item 1 but the headline
claim names only the line count. Say both.

**The tokeniser itself is not the error.** I re-derived `05` §3.1 from scratch on the same
five golden files and reproduced every row to four decimals [M `p2-tok.py`,
`logs/p2-tok.txt`]: none 8.5157, `N<TAB>` 9.9971, `N ` 9.9135, `N:` 10.7031, `N|` 10.7408,
`N |` 10.7539, `N| ` 10.9135, `N: ` 10.9135, `%05d |` 11.5282, `%5d<TAB>` 11.7713,
`%5d␣␣` 11.7739. Whole-file blocks and 100-line windows agree to three decimals, so the
numbers are not an artefact of block size.

### Claim 2 — codex PIPE's premium is 51% the delimiter's own bytes; PIPE − TAB is +0.93 tokens per delivered line on all three harnesses

**UPHELD, with a precision caveat.**

The per-line constant reproduces. On the five fixture files I measure `N| ` − `N<TAB>` =
**+0.9164** tokens per line, and `03` measures +0.93 on the blocks the agents actually
received [M `p2-tok.py`]. Two independent corpora, the same constant.

The share arithmetic reproduces too: `$0.000217 ÷ $0.000424 = 51%`, and
`$0.000217 ÷ $0.000302 = 72%` of the input side [M]. `05`'s 13–18% is wrong for the reason
in claim 1.

**Caveat.** The numerator is a counterfactual on the TAB cell's own delivered bytes. The
denominator is a difference between two cells whose paired bootstrap interval is
`[−$0.000600, +$0.001447]` and contains zero [M, `03-gutter-form-cost.json`
`D_bootstrap_total`]. Inside that interval the same numerator would read anywhere from 15%
to over 100%. Report "the delimiter's own bytes are `$0.00022` of a `$0.00042` gap that is
itself not distinguishable from zero", not "51%".

### Claim 3 — the claude-code carry is real and symmetric: TAB 8/61 (`p = 0.0029`), PIPE 6/144 (`p = 0.0055`), native 6/79, NONE 0/269; 20 carries cost `$0.0327` and 0 solves

**WEAKENED.**

I re-read seven cases byte by byte in the raw transcripts [M `p2-casebytes2.py`,
`logs/p2-carrycases.txt`]. Five confirm the mechanism, one refutes its classification, and
one is a retry of another.

| case | cell | file | shown bytes | anchor | on disk | my verdict |
|---|---|---|---|---|---|---|
| 6 | sweet TAB | `Match.cs` | `171` + 4 tabs | 4 tabs | **3 tabs** | carry confirmed |
| 8 | sweet TAB | `SetupCollection.cs` | `47` + 5 tabs | 5 tabs on all 5 lines | **4 tabs** | carry confirmed, whole anchor |
| 11 | sweet TAB | `Match.cs` | `171` + 4 tabs | 4 tabs | **3 tabs** | carry confirmed |
| 4 | **native** | `Match.cs` | `220` + 5 tabs, from `Read` | 5 tabs | **4 tabs** | carry confirmed on the harness's own tool |
| 18 | sweet PIPE | `Searchbar.js` | `135|` + 7 spaces | 7 spaces on 3 lines | **6 spaces** | carry confirmed |
| 17 | sweet PIPE | `cli.js` | `743|` + 21 spaces | 21 spaces on 2 lines | **20 spaces** | carry, but a **retry**: blocks 15 and 17 are the model's own earlier `Edit` errors echoing the same string back |
| 14 | sweet PIPE | `cli.js` | `772|` + 17 spaces | 17 spaces on 4 of 11 lines | 16 spaces | **not a carry failure.** 7 of 11 lines differ in content: `group: 'Options for execute:'` against `'Options for retrieve:'` on disk, and the wrapped `describe:` line joined into one. A perfect strip would still have failed |

**Two structural problems with the counts.**

*Clustering.* The 20 carry calls are **14 distinct (rollout, file, anchor) events in 8
rollouts and 3 tasks** [M]. TAB: 8 calls → 5 events → 3 rollouts → **one task**
(`devlooped__moq-1262`). PIPE: 6 calls → 5 events → 3 rollouts → two tasks. Native: 6 calls
→ 4 events → 2 rollouts → one task. Eight of the 20 provenance chains lead to the model's
own earlier failure echo, not to a fresh read.

*Unit.* The edit-level Fisher tests reproduce exactly (`p = 0.002859` and `p = 0.005527`)
[M]. At the rollout unit this programme insists on — `GUTTER-MECHANISM` §2.2, `FRESH-POOL`
§6, `01` §1.2 — the same comparisons are:

| comparison | rollout-level | `p` |
|---|---|---:|
| tab-indented repos, TAB v PIPE | 3/9 v 0/9 | **0.21** |
| space-indented repos, PIPE v TAB | 3/57 v 0/57 | **0.24** |

Neither is significant. The draft applies the rollout unit to failures and the edit unit to
carries, in the same paragraph.

*"Symmetric" overstates.* TAB's carries are one task; PIPE's are two, and at least one of
its six is a body paraphrase with an incidental `+1`.

**The dollar figures are exact.** I re-summed the 20 cases: `$0.032706` whole-episode and
`$0.012550` on the one-extra-request bound [M]. Per cell of 66 rollouts: sweet TAB
`$0.000220` / `$0.000076`, sweet PIPE `$0.000114` / `$0.000043`, native `$0.000161` /
`$0.000071`. Eighteen of the 20 sit in unresolved rollouts and two in a resolved one, so
"changed 0 solves" is consistent.

### Claim 4 — codex and opencode have no delimiter mechanism: 0 whitespace failures and 0 residue across 7,796 anchor lines; opencode sweet TAB 0 failed edits in 123 calls

**REFUTED on "no mechanism". The residue and failure counts are upheld.**

I rebuilt the census myself [M `p2-cxoc.py`, `logs/p2-cxoc.txt`]:

| cell | my calls / failures | `01`'s calls / failures | my anchor lines | my residue |
|---|---|---|---:|---:|
| codex sweet TAB | 112 / 6 | 112 / 8 | 840 | **0** |
| codex sweet NONE | 124 / 2 | 124 / 4 | 1,116 | **0** |
| codex sweet PIPE | 121 / 3 | 120 / 4 | 863 | **0** |
| opencode sweet TAB | 123 / **0** | 123 / **0** | 992 | **0** |
| opencode sweet NONE | 108 / 7 | 106 / 7 | 888 | **0** |
| opencode sweet PIPE | 122 / 4 | 121 / 4 | 996 | **0** |
| codex native | 124 / 6 | 124 / 9 | 1,102 | **0** |
| opencode native | 118 / 3 | 117 / 3 | 1,026 | **0** |

**0 residue in 7,823 anchor lines.** The "0 of 123" on opencode TAB reproduces exactly.

But "0 whitespace failures" is near-tautological. Pass three of `seek_sequence` compares
`line.trim()` to `pattern.trim()` [C], so a carried delimiter **cannot** produce a failure
on these harnesses. The testable question is whether the carry reaches the patch text at
all. It does [M `p2-silentcarry.py`, `logs/p2-silentcarry.txt`]. For every context or
removed line I found the golden line with the same stripped text, counted only when that
stripped text has one single indentation in the whole file, and compared:

| cell | context lines tested | on tab-indented lines | **gutter-tab carries** | space carries |
|---|---:|---:|---:|---:|
| codex sweet **TAB** | 528 | 98 | **15 (15.3%)** | 0 |
| codex sweet NONE | 625 | 113 | 0 | 0 |
| codex sweet PIPE | 539 | 78 | 0 | 0 |
| opencode sweet **TAB** | 598 | 76 | **15 (19.7%)** | 0 |
| opencode sweet NONE | 529 | 90 | 0 | 0 |
| opencode sweet PIPE | 559 | 57 | 0 | 0 |
| codex native | 665 | 97 | 0 | 0 |
| opencode native | 199 | 3 | 0 | 0 |

At the rollout unit: codex TAB **4 of 66**, opencode TAB **3 of 66**, both 0 of 66 under
NONE and PIPE. Pooled, TAB 7/132 against 0/265, **`p = 0.0004`** [M].

**The bytes, with the outcome** [M `p2-carryproof.py`, `logs/p2-carryproof.txt`]. Codex,
`devlooped__moq-1262`, sweet TAB, rollout
`fp-codex-tab-20260826/…/rollout-2026-08-27T00-34-45-01a040a4-…jsonl`, call
`call_ADEK3QSj7eIywkhn1mkeUSfv`:

```
ss-read showed :  '36\t\t\t\tif (x is MemberExpression)'      ("36" + gutter TAB + 3 content tabs)
patch context  :  '-\t\t\t\tif (x is MemberExpression)'       (4 tabs)
on disk        :  '\t\t\tif (x is MemberExpression)'          (3 tabs)
apply_patch    :  Success. Updated the following files: M src/Moq/ExpressionComparer.cs
```

The same rollout also emitted `+\t\t\t\tif (x is MemberExpression)` as an **added** line.
`apply_patch` trims only when it seeks; it writes `+` lines verbatim [C]. So on codex and
opencode the carry does not fail the edit — **it writes one extra indent character into the
file**. That is harmless in C# and Go. It is not harmless in Python, YAML or a Makefile.

**Corrected statement.** The gutter-tab carry is a model behaviour that fires on all three
harnesses. Claude-code turns it into a failure because its `Edit` matches exactly.
Codex and opencode absorb it. The delimiter is not "mechanically inert" there. It is
mechanically active and, on those languages, consequence-free.

### Claim 5 — claude-code's Edit does not force a prior native Read; 0 gate errors in 1,044 calls across 264 rollouts, although the string is in the 2.1.218 binary

**UPHELD as a measurement. WEAKENED as a statement about the tool.**

The measurement is right and I made it independently: **0** transcripts contain
`File has not been read yet` across all 336 claude-code session files of the three fresh-pool
runs [M, `grep -rl` over `fp-claudecode-{tab,none,pipe}-20260826/agent-state`].

The reason is not that the gate does not apply to `Edit`. I read the code [C, deployed
binary `/root/.local/share/claude/versions/2.1.218`]:

```js
function MSy({absoluteFilePath:e,fileContents:t,lastRead:r,oldString:n,replaceAll:o,model:i,readNotAutoAllowed:s}){
  if(!r){ if(!rji(i)&&!s()) return !1; throw new j1e(veo) }   // veo = "File has not been read yet…"
  …
}
function rji(e){ return grg.has(oa(e)) }
grg = new Set(["claude-opus-4-6","claude-haiku-4-5","claude-opus-4-5","claude-opus-4-1",
               "claude-opus-4-0","claude-sonnet-4-5","claude-sonnet-4-0","claude-3-7-sonnet",
               "claude-3-5-sonnet","claude-3-5-haiku"]);
```

The gate throws whenever the model **is** in that set, or reads are not auto-allowed. The
set holds Anthropic model ids only. The benchmark ran `openai/gpt-5.6-luna`, so the gate was
disabled by model identity before sweet did anything.

**Consequence the draft does not state.** On any Claude model, every one of the 218 sweet
TAB edits that had no prior `Read` would throw, and the model would have to `Read` and retry.
That is one failed call plus one read per file, per rollout. The claude-code efficiency
headline — "sweet reaches the same tasks on 28% fewer calls" — is measured in the one
configuration where that cost is switched off. This is a product risk, not a benchmark
artefact, and it belongs in the record.

The `Edit` prompt itself is gate-selected too [C]:

```
Strip the Read line prefix (${t?"line number + a single tab or `:`":"line number + tab"}) before matching.
…
FPt = qr(() => Xe("tengu_tab_read_sep", !1))
```

`!1` is `false`. **The gate is off in 2.1.218**, so the model is told "line number + tab".

### Claim 18 — the GUTTER-AB anchor result reverses at 66 rollouts per cell

**UPHELD, with a metric mismatch that must be fixed before it is published.**

The statistics reproduce: rollouts-with-failure claude 18 / 19 / 15 / 16 for
native / TAB / NONE / PIPE, and TAB against PIPE gives **`p = 0.6937`** [M], which is the
draft's 0.69.

The rates quoted are not comparable to the ones they retire. `GUTTER-AB` counted
**anchor** failures (1/63 = 1.6% TAB, 8/105 = 7.6% PIPE, 8/71 = 11.3% NONE). The draft
quotes epoch-C **all-failure** rates (18.4 / 12.6 / 14.8 / 16.7%), which include no-ops,
oversized JSON inputs and ambiguity errors. Like for like, from `01` §1.2's own anchor
column [M]:

| cell | anchor failures | rate | epoch B |
|---|---:|---:|---:|
| claude native | 24/323 | 7.4% | — |
| claude TAB | 15/256 | **5.9%** | 1.6% |
| claude NONE | 12/270 | 4.4% | 11.3% |
| claude PIPE | 9/206 | **4.4%** | 7.6% |

The reversal survives on the like-for-like metric, and TAB still shows no advantage
(`p = 0.53` at edit level, `p = 1.00` at rollout level). Quote these numbers, not the
all-failure ones.

### Claim 20 — no gutter design can be detected in an affordable run

**UPHELD as a decision. WEAKENED on two numbers.**

Verified: all six paired bootstrap intervals include zero
(`03-gutter-form-cost.json` → `D_bootstrap_total`, `excludesZero: false` on all six) [M].
The opencode TAB rep spread reproduces: `$0.008634 / $0.010612 / $0.008549`, mean exactly
`$0.0092650` against the published `$0.009265`, range 22.3% of the mean [M].

Two corrections.

1. **"No design can be detected" conflates two questions.** The *total* effect of a form
   change cannot be detected — that is right. The *direct token* effect can be measured at
   `$0` to three significant figures by re-tokenising the delivered blocks, and `03` did
   exactly that. State it as "no run we can afford can tell whether behaviour eats the
   token saving".
2. **The "6,403 numbered lines" is 21% too high.** It comes from `02` §8.2, which divides a
   generic payload requirement (9,285 tokens) by 1.45 tokens per line. Using `03`'s own
   measured constants — 1.341 tokens per line and `$2.60 × 10⁻⁷` per gutter token, which is
   `$0.000302` ÷ 1,163 — the answer is **5,275 to 5,310 lines** [M]. The substance is
   unchanged: that is six times the 867 lines a codex rollout actually receives.

---

## 2. The tokeniser, re-derived — and the one place `05` is wrong

I reproduced `05` §3.4 exactly [M `p2-transparency.py`, `logs/p2-transparency.txt`]:
transparency and ambiguity, every row, including the tab at 24.3% transparent and 0.0%
ambiguous, and the ambiguous share equal to the space-indented share (1,955 of 3,052 =
64.1%).

Then I asked the symmetric question `05` never asks [M `p2-ambiguity2.py`,
`logs/p2-ambiguity.txt`]. A gutter is ambiguous on a line when the token holding the
delimiter is a homogeneous run of the delimiter's own last character **and** the file's own
indentation starts with that same character. The strip boundary is then unmarked in either
direction.

| form | `05`'s metric | **symmetric** | on tab-indented lines | on space-indented lines |
|---|---:|---:|---:|---:|
| `N<TAB>` | 0.0% | **9.9%** | **9.9%** | 0.0% |
| `N\| ` | 64.1% | 64.1% | 0.0% | 64.1% |
| `N: ` | 64.1% | 64.1% | 0.0% | 64.1% |
| `N ` | 64.1% | 64.1% | 0.0% | 64.1% |
| **`N:`** | 0.0% | **0.0%** | 0.0% | 0.0% |
| **`N\|`** | 0.0% | **0.0%** | 0.0% | 0.0% |

The corpus is 64.1% space-indented, 15.0% tab-indented and 20.9% unindented. The tab is
ambiguous on 302 of the 458 tab-indented lines — the ones with two or more tabs of indent.

**The tokens of the real failing line** [M]:

```
disk  moq SetupCollection.cs:47   '\t\t\t' '\tthis' '.set' 'ups' '.Add' '(set' 'up' ');'
TAB   47 + gutter                 '47' '\t\t\t\t' '\tthis' '.set' 'ups' …      <- 4-tab run, nothing marks the boundary
disk  Searchbar.js:135            '     ' ' clear' 'Icon' ','
PIPE  135| + content              '135' '|' '      ' ' clear' 'Icon' ','       <- 6-space run where the file makes 5
TAB   135 + content               '135' '\t     ' ' clear' 'Icon' ','          <- begins with \t, boundary marked
COLON 171: + content              '171' ':' '\t\t' '\tthis' …                  <- file's own token reproduced exactly
COLON 135: + content              '135' ':' '     ' ' clear' 'Icon' ','        <- reproduced exactly
```

So the draft's §1 sentence — *"the tab fuses too but the token begins with a character the
file's indentation cannot contain, so the boundary is marked"* — is true for space-indented
files and **false for the 15% of lines that are tab-indented**. Those are exactly the lines
that produced all 8 TAB carries on claude-code, all 6 native carries, and all 30 silent
carries on codex and opencode. As written, the draft's tokeniser explanation contradicts
its own carry measurement.

**Corrected frontier.** Every dense delimiter is ambiguous on the lines whose own
indentation begins with the delimiter's last character. Only `N:` and `N|` are ambiguous on
neither style. The tab's advantage is exposure, not kind: 15% of a mixed corpus against
64%, and about 100% inside a tab-indented repository.

---

## 3. The five designs against hard constraints

### 3.1 What the renderer and the tests actually allow

[C] `core/search/search-read.js`:

- `GUTTER_DELIMITER` is a **module-load constant** (line 673). `tests/search/read-line-gutter.test.js`
  has a test named *"does not let the paid A/B environment switch restore the rejected pipe
  gutter"* that asserts setting `SS_READ_GUTTER=pipe` at run time changes nothing. Any new
  form must be selected before import. A **per-file** delimiter (design 4) cannot use this
  hatch at all; it needs a new parameter on `numberCodeLines`, whose signature is shared by
  four call sites: `search-read.js:705`, `search-server.js:658`,
  `search-read-semantic.js:881` and `_ss-helpers.mjs:72`/`:608`.
- `stripCodeLineNumbers` takes the **first** tab in the line and strips when everything
  before it is digits. It is used only by the tests, but the code comment states its
  purpose: *"any future delimiter change has to keep it exact"*.
- Two shipped tests break under sparse or landmark numbering **by construction**:
  *"THE DEFECT: no rendered line has whitespace adjacent to the delimiter"* asserts
  `indexOf(delimiter) > 0` on **every** rendered line, and the round-trip tests assume every
  line carries a prefix.
- Measured strip hazard over the 22 goldens [M `p2-strip.py`]: **104 of 1,522,150 lines**
  (0.0068%) match `^\d+<TAB>` and would be mangled by the inverse if left unnumbered. All
  104 are in one Jam debugger fixture that itself prints numbered listings.
- The colon and the bare pipe are **strictly safer inverses**: `^\d+:` and `^\d+|` match
  **0 of 1,463,914** golden lines [M `p2-colon.py`].

### 3.2 Can landmark or sparse numbering come from the existing index?

**Only on `ss-read`.** [C]

- `_attachIndexMetadata` (`search-read.js:317`) returns
  `chunks: [{id, symbol, type, startLine, endLine, signature}]`, sorted by `startLine`, and
  `readFile` narrows them to the requested range (`:487`). `_formatAgent` already uses them
  for the `symbols:` hint. Everything a landmark renderer needs is in hand at the call site.
- **`ss-search` and `ss-find` do not have it.** The wrapper calls `gutter(r.code, r.startLine)`
  (`_ss-helpers.mjs:454`, `:745`) with one symbol per hit and no interior symbol table.
  `ss-semantic` (`:857`) has `span.symbols` as names only, with no per-line offsets.
- These three surfaces are **17–26% + 4–16% + 0.4–5%** of delivered code lines [M `03` §2.3].
  Landmark numbering would therefore re-fragment the surfaces `ba5b4ee` just unified — the
  exact inconsistency the fix removed.
- Landmarks degrade silently where the index is empty. `_attachIndexMetadata` returns
  `{indexed:false, chunks:[]}` for an unindexed file, and the C-family chunker stores
  `name: null` often enough that the code already carries a `_sniffRemainderDefinitions`
  fallback (`:469`). The draft's own claim 15 documents a repository with 0 of 321 files
  indexed. In that repository the landmark render collapses to "number line 1 only".
- **The cost of landmark numbering is not a measured constant.** `05` counts 153 symbol
  starts (5.0%, +0.067 tokens/line). My own detector counts 321 to 344 (10.5–11.3%,
  **+0.143 to +0.154 tokens/line**) on the same corpus [M `p2-tok.py`]. Sweet's chunker
  would give a third number. A quantity uncertain by 2× at 20× below the noise floor is not
  a design input.

### 3.3 The codex cap, measured on epoch C

[M `p2-cap.py`] Over 3,407 codex tool outputs carrying a token-count header: the largest
untruncated is **2,496** tokens, the smallest truncated **2,502**. The cap is bracketed to
6 tokens. This is tighter than the epoch-B 2,459 / 2,511.

Lines before the cap, from my own per-line constants: **none 293, sparse-10 288, `N<TAB>`
250, `N:` 234, `N| ` 229**.

Two consequences for the design table.

- Sparse-10 buys back about **38 lines per codex read** against the tab, a 15% larger window
  before middle-out truncation. The draft counts none of this.
- The draft's kill rationale for codex NONE — *"NONE loses the only clue to a middle-out
  truncation gap (the numbers jump)"* — does **not** apply to sparse-10. Every tenth number
  survives, so a deleted span still shows as a jump.

### 3.4 Opencode's contract belongs to a tool the agent never used

[C, deployed binary] The `N: ` prefix declaration and the read-before-edit precondition
(*"You must use your `Read` tool at least once in the conversation before editing"*) sit in
the **`edit`** tool's prompt. `edit` was called **0 times** in these runs. The tool the model
used, `apply_patch`, declares nothing about line prefixes. "Match opencode's own prefix"
would match a contract the agent never reads.

### 3.5 Design-by-design

| # | design | constraint check | falsifier `$0`? | kill line pre-registrable? |
|---|---|---|---|---|
| 1 | sparse-10 tab | breaks two shipped tests by construction; strip hazard 0.0068% of golden lines; keeps the codex truncation clue; partially reverts the stated purpose of the gutter ("native `Read` numbers every line") | **yes**, but the exclusion list is incomplete — a range bound can also come from the `unreadBelow` trailer, which prints `startLine` per symbol (`search-read.js:462-478`), and from the previous read's own header | **no.** "`ss-read` calls up by > 0.5" and "one anchor failure traceable to a miscounted line" need a paid run, and §6's run fixes the gutter at TAB with no gutter arm |
| 2 | header-only (= NONE) | correct: `SS_READ_LINENUMS` never touches the header | **yes** — already run, 198 rollouts per form | **already fired**; honestly recorded |
| 3 | landmark tab | **producible on `ss-read` only** (§3.2); cost uncertain by 2×; degrades silently on unindexed files | yes in money, but it needs a symbol table for every file a rollout read, which the index does not always hold | **no.** "below 'most' of ranges symbol-aligned" is a word, not a threshold |
| 4 | indent-aware delimiter | needs a new parameter through four call sites; cannot use the module-load hatch | yes | **self-defeating.** "Kill: 0 rollouts saved — which is the current reading" means it is dead on arrival. Also its evidence base ("14 TAB and 9 PIPE failed anchors") ties to neither `01` (8 and 6 carries) nor `01` §1.4 (11 and 4 whitespace anchors) |
| 5 | `N:` everywhere | the only dense form ambiguous on **neither** indent style; 0 content collisions in 1.46M golden lines | **yes, and I executed it** | **already fired.** `FPt = qr(()=>Xe("tengu_tab_read_sep", !1))` — the gate default is **off** in 2.1.218 |

**One ranking correction.** The draft ranks `N:` last because it *"trades a 0% hazard for a
0% hazard at +48% gutter cost"*. The tab's hazard is not 0%. It is 9.9% of lines on a mixed
corpus, ~100% inside a tab-indented repository, and it is the only carry mechanism this run
measured on **all three** harnesses. The honest trade is:

| | cost of `N:` over `N<TAB>` | what it removes |
|---|---:|---|
| codex | 867 lines × 0.706 tok = 612 tok = **`$0.000159`** (1.3%) | 15 silent carries, 4 of 66 rollouts |
| opencode | 937 × 0.706 = 662 tok = **`$0.000177`** (1.9%) | 15 silent carries, 3 of 66 rollouts |
| claude-code | 1,077 × 0.706 = 760 tok = **`$0.000231`** (1.1%) | 8 failed edits worth `$0.000076`–`$0.000220` per rollout |

So `N:` is a net cost of roughly `$0` to `−$0.00016` per rollout — under 1% — and it is the
only form with no measured defect on any harness. It still should not ship, because the gate
is off and the model is told "tab". But the reason is the contract, not the hazard.
Re-read the gate default at every claude-code version bump; that is a `$0`, thirty-second check.

---

## 4. What I could not finish

- I did not re-bootstrap the six confidence intervals from per-task data. I verified them
  from `03`'s stored JSON (`excludesZero: false` on all six) and confirmed the deltas equal
  the published cell differences. The bootstrap is paired over 22 tasks, which is the right
  design.
- I did not test whether a carried `+` line ever reached a **shipped** patch. The three
  codex TAB `moq` reps all shipped an empty `model_patch`, so that task cannot answer it.
  The write-through itself is [C] from `apply_patch` semantics and [M] for the one call I
  traced.
- I did not rebuild the claude-code cost columns. My verdicts on claims 1, 2 and 20 use
  `03`'s dollar figures and re-derive only the token arithmetic on top of them.
- My codex failure counts run 2 to 3 below `01`'s in three cells. The difference is the
  classification of patch-grammar and file-not-found errors, not the anchor result. It does
  not touch any verdict.
