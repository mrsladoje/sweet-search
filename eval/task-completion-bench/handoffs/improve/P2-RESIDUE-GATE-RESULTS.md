# P2 terminal residue audit — DEAD at `$0`

**Executes:** [`P2-RESIDUE-PREREGISTRATION.md`](./P2-RESIDUE-PREREGISTRATION.md), committed
before any code existed. **Spend: `$0`.** 78 sweet rollouts replayed against their base trees.
**Instrument:** [`p2-residue-gate.mjs`](./phase1-scripts/p2-residue-gate.mjs).

---

## 0. Verdict

**It can find the twin. It cannot find only the twin, and no threshold exists that does.**

| | value | pre-registered bar |
|---|---:|---|
| residues per **resolved** rollout, untouched files | **98.18** | ≤ 0.5 pass, **> 2.0 kill** |
| residues per **failed** rollout | 345.11 | — |
| finds `underscore.js:461`, the `countBy` twin | **yes** | required |

It clears the kill condition by roughly **fifty times**. On the one rollout it is meant to
save, the correct line is **1 hit out of 33** in the same file. On rollouts that were already
correct it emits ninety-eight.

## 1. Why, precisely — and this is the part that generalises

The lever assumes the twin is a *repeat* of what the agent replaced. It is not.

```
edited     if (_.has(result, key)) result[key].push(value); else result[key] = [value];
twin       if (_.has(result, key)) result[key]++;          else result[key] = 1;
```

They share the **call**, not the line. So:

- **Whole-line stems score exactly 0 sensitivity.** Tried first; it cannot see a family whose
  members differ in their bodies, which is every family worth catching.
- **The minimal changed token is `_.has` — five characters.** That token *does* find line 461.
  It also finds the **other 32 legitimate uses of `_.has` in the same file**, plus everything
  matching elsewhere in the pool.

There is no middle setting. The token that identifies the family is short and common **by
construction**, because a family is defined by a shared call, and a shared call is shared by
non-members too. Raising the threshold loses the twin; lowering it buries it.

## 2. What would actually be required

Separating `countBy` from the other 32 `_.has` sites needs the knowledge that `groupBy` and
`countBy` are both produced by `group(...)` — that they are members of one construction. That
is **structural twin detection**, which this pre-registration deliberately scoped out, and
which P4's own rotation gate already found needs per-project semantics on all but a vanishing
fraction of files (the strict shape occurred once in 152,270).

**So the string half is dead and the structural half is the thing the slate already
established is not generally buildable.**

## 3. Two bugs found and fixed in the gate itself, recorded so the numbers are trustworthy

1. **The first pass grepped the base tree**, not the patched tree, so every replaced stem was
   trivially still present. It reported 8.64 false residues that were an artefact of not
   applying the patch.
2. **The second pass wrote the patch file inside the tree it then grepped**, so every stem
   matched the patch itself. Every hit read `.p2.patch:9`.

Both were caught because the sensitivity column was doing work the specificity column could
not: a lever that finds nothing on its own flagship task is a broken instrument, not a
negative result. Only after both were fixed did the real trade-off appear.

## 4. Disposition

**P2 is closed.** With it closes the last candidate in `SLATE-B-UBER.md` that could plausibly
have added resolution:

| program | state |
|---|---|
| P1 dependency closure | dead — native reads dependencies 0/18 too |
| **P2 residue audit** | **dead — 98 false residues per correct rollout** |
| P3 witnesses | blocked — its tools do not exist; the prompt substitute is twice-rejected |
| P4 state checker | works, but its shape occurs once in 152,270 files |
| P5 artifact graph | dead — the hidden test imports an invented name |
| P6 runtime probe | one property descriptor, over-specification risk unpriced |
| P7 forge | cost-only; native's addressability is higher than sweet's |
| Q1 cardinality | dead — gold fails its own gate |

**The honest position: on this bench, retrieval is not the binding constraint on resolution,
and no lever we have found moves it.** The measured product claim is cost — cheaper per
rollout on both harnesses, materially cheaper on claude-code, on ~26% fewer tool calls.
