# W0 gate — P1 dependency contract closure

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P1 dependency closure"<br>
**Date:** 2026-08-17 — **Model spend: `$0`** (no agent rollout; compute was docker pulls and
greps over recorded rollouts)<br>
**Protected state:** remote `results/` not mutated; every task image GC'd after probing; HO2
untouched.

---

## 0. Verdict

**P1 survives its gate, but not for the reason the plan expected. The corpus is not the
problem — demand is.**

| W0 required output | result |
|---|---|
| pinned-source availability map | **13 of 14** admissible tasks ship readable dependency source offline; 1 (Java) ships only compiled JARs |
| pytask source query | the contract is an **explicit type annotation**, one grep away — stronger than §4 claimed |
| repaired caller-edge result | already closed at `$0` before this session (`FIX-REPORT.md` §4) |
| blind-spot trigger census | sweet reached for dependency source in **6 of 102** rollouts, against native's **17**; terminal state summaries name an external contract in **3–11 of 94** |

The kill condition is two-part: *source cannot adjudicate contracts* **or** *the model has no
demonstrated intent to consult it*. The first half fails clearly — the source adjudicates. The
second half is where P1 is weak, and it is the half `ss-deps` does not address.

---

## 1. The source exists, and it settles the contract outright

Inside the pinned image, with `--network none`:

```
pytest 9.0.2  →  /usr/local/lib/python3.10/site-packages/_pytest/_code/code.py
  line 320   tbh: bool | Callable[[ExceptionInfo[BaseException] | None], bool] = False
  line 333   return tbh(excinfo)
```

`SLATE-B-UBER.md` §4 quoted `tbh(None if self._excinfo is None else self._excinfo)`. The actual
pinned source is better for P1's case: the contract is stated in a **type annotation**, so it is
recoverable by a single grep rather than by reading control flow. It confirms the recorded
discriminator — one argument (`exc_info`) resolved 4/4; zero arguments or a frame resolved 0/8.

**The gap is architectural, not availability.** The agent runs on the host against a bare git
checkout: `/root/.ss-eval/golden/pytask-dev__pytask@3022733` has no `site-packages`, no venv, no
vendored `_pytest`. The source exists only inside the `run_tests` container, which the agent never
reads. That is precisely the hole `ss-deps` would fill.

---

## 2. Availability map — 13 of 14

Probed per task: pull → inspect with `--network none` → `rmi`. Counts are files under discovered
dependency roots, classified by **the task's own language**, not by total source found.

| task | lang | verdict | own-lang source | own-lang binary |
|---|---|---|---:|---:|
| `joshuakgoldberg__bingo-274` | ts | SOURCE | 18,690 | 0 |
| `codeception__codeceptjs-367` | js | SOURCE | 17,820 | 0 |
| `teleporthq__teleport-code-generators-291` | ts | SOURCE | 12,753 | 0 |
| `jashkenas__underscore-2757` | js | SOURCE | 6,256 | 0 |
| `oceanparcels__parcels-617` | python | SOURCE | 5,893 | 5,794 |
| `litestar-org__polyfactory-405` | python | SOURCE | 4,464 | 1,416 |
| `dart-lang__http-1114` | dart | SOURCE | 3,874 | 0 |
| `pytask-dev__pytask-210` | python | SOURCE | 3,659 | 1,416 |
| `apple__swift-nio-http2-145` | swift | SOURCE | 1,071 | 0 |
| `epiforecasts__scoringutils-229` | r | SOURCE | 462 | 510 |
| `rstudio-education__gradethis-161` | r | SOURCE | 429 | 434 |
| `akinsho__nvim-bufferline.lua-173` | lua | SOURCE | 113 | 0 |
| `dashbitco__nimble_options-43` | elixir | SOURCE | 111 | 9 |
| **`ontodev__robot-710`** | **java** | **BINARY** | **0** | **290 jars** |

**Java is the one ecosystem where the mechanism does not transfer.** No `-sources.jar` anywhere in
the image and no `.java` outside the repo — the dependencies are compiled. Walking a tree is not
enough; that needs a decompiler or a per-ecosystem extractor, and it is a separate build item.

**A design cost the probe exposed.** The pytask image contains **seven** `site-packages` roots:
the task's own at `/usr/local/lib/python3.10`, plus six conda toolchain trees under `/opt/conda`.
`ss-deps` must scope to the task's actual environment. Indexing everything reachable would bury
the pinned dependency in the toolchain that happens to share its extension.

---

## 3. The trigger, which is where P1 is thin

Two signals, per rollout, main sessions only, across all 204 recorded rollouts.

| signal | native | sweet |
|---|---:|---:|
| **REACHED** — actually tried to read dependency source | **17 / 102** | **6 / 102** |
| terminal `<state_summary>` naming an external contract | n/a (no such block) | **3 / 94** narrow, **11 / 94** widest |

Seven distinct tasks saw any rollout reach for dependency source. pytask supplies **4 of the 11**
wide state-summary hits, so the trigger is real where the mechanism applies and thin everywhere
else.

**The uncomfortable asymmetry: it is NATIVE that shows the appetite**, roughly three times as
often. Sweet stops when its indexed repository evidence is exhausted, which is exactly the
behaviour §2 of the slate predicted an opponent would exploit. `ss-deps` is a sweet-only corpus;
adding a corpus sweet does not consult satisfies the second half of P1's own kill condition.

**Consequence for the programme:** the blind-spot escrow stops being an optional trigger component
(§4 mechanism 3) and becomes load-bearing. P1 without it is a corpus nobody queries.

---

## 4. Instrument reliability — read this before trusting §2

The availability map took **five** corrections, and every headline number here comes from an
instrument that first disagreed with a hand check:

| defect | direction | effect if unfixed |
|---|---|---|
| hardcoded dependency paths | under-report | `dart-lang__http` scored ABSENT; its pub cache is at `/workspace/.pub-cache` with 3,874 files |
| `execFileSync` discarded stdout on a non-zero exit | under-report | all 14 tasks scored ERROR; the probe's last `[ -gt ] && echo` exits 1 when a count is zero |
| backticks inside a `String.raw` template | under-report | sweep died with `ReferenceError: gt is not defined` before probing anything |
| classifier summed ALL source extensions | **over-report** | 14/14 SOURCE, because every image carries a ~1,500-file Python toolchain regardless of language |
| language keys `javascript`/`typescript` vs the file's `js`/`ts`; neovim `pack/*/start` not a cache dir name | under-report | 4 JS/TS tasks scored UNPROBED; Lua scored ABSENT despite 113 `.lua` files of `plenary.nvim` |

Four of five under-reported, and an under-report reads as evidence *against* P1. **A gate whose
failure modes nearly all point one way cannot have its negative results taken at face value.**
Both surviving negatives were therefore hand-verified in the image: Java's BINARY verdict held
(no sources jars, no `.java`), Lua's ABSENT verdict did not and was corrected to SOURCE.

The classifier now hard-fails on an unknown `language` value rather than silently scoring it
UNPROBED, and the validation asserts the extracted probe's byte length, terminal `exit 0`, and
absence of backticks before any run.

---

## 5. Gate verdict and what it changes

**P1 is NOT killed.** Source availability is broad (13/14), the pytask contract is decisively
recoverable, and the reach is structurally blocked today.

**P1's ceiling is unchanged at +1 task**, and this gate supplies no evidence for more. The corpus
would be broadly available and rarely consulted.

**Three things a later session must not skip:**

1. **The trigger is the programme, not the corpus.** Any `ss-deps` build that does not ship a
   mechanism making sweet *look* is buying a corpus for the 6-in-102 case.
2. **Java needs its own decision.** Either accept that JVM tasks are out of scope for ss-deps, or
   price a decompiler path separately. Do not let 13/14 imply 13/14 of a real task population.
3. **Scope the index to the task environment.** Seven `site-packages` in one image is the shape of
   the problem.

**Unchanged:** NO-GO for a paid pilot. Next `$0` gate is P2 (terminal family-residue audit).

---

## 6. Artifacts

- `handoffs/improve/w0-p1-20260817/availability.json` — per-task probe output and extension counts
- `handoffs/improve/w0-p1-20260817/availability-classified.txt` — the §2 map as produced
- `handoffs/improve/w0-p1-20260817/sweep.log` — the sweep transcript
- `phase1-scripts/w0-p1-source-availability.mjs` — the probe (roots discovered, not assumed)
- `phase1-scripts/w0-p1-availability-classify.mjs` — ecosystem-aware reclassification
- `phase1-scripts/w0-p1-blindspot-census.mjs`, `w0-p1-statesummary-trigger.mjs` — §3
