# Round-3 leak sweep — record

**Run:** 2026-08-13, by the session that wrote the brief. **Result: two channels found and
closed, one task ruled unusable, then clean.** This file is the evidence, not a promise.

---

## 1. What was swept, and against what

Every task id, repository name and distinctive path token on the slate, against every surface a
deriving session sees without asking for it:

| surface | why it counts |
|---|---|
| `MEMORY.md` | auto-loads at session start, before any brief can be read — the channel that broke round 1 |
| every file in the memory directory | a hook line can look harmless while the file names tasks |
| `~/.claude/CLAUDE.md` and the project `CLAUDE.md` | always in context |
| `round3/HANDOFF-BLINDED-ROUND-3.md` and `round3/NARROWED-CLAIM.md` | a brief that quotes the deciding fact broke round 2's predecessor |

---

## 2. The channel the sweep found — the fourth in this programme

**The first draw put three tasks on the slate that another programme had already run.**

The picker excluded `rotate20`, the round-1 subjects and the round-2 slate. It did not exclude
the **turnfix cohorts**: **98 of the 200 development-pool tasks** are named in that manifest —
94 of them still eligible at that point in the filter, the other 4 already excluded by an earlier
rule — and every one was run as a turnfix subject,
so rollout transcripts, trajectories, analysis documents and memory files exist that can name
what their fix was. Three of the first five drawn were among them.

The frozen claim already excluded "every task any planning document discusses"
(`NARROWED-CLAIM.md` §4). Those tasks were therefore **out of scope before the draw**; the
picker simply did not know which they were. `select/MANIFEST_turnfix_cohorts.json` is the file
that says.

**What was done.** `pick-newmodule-slate.mjs` now excludes every instance id anywhere inside
that manifest, and the slate was **redrawn at the same frozen seed `20260901`**. The claim file
is untouched and its hash is unchanged: `33c9e3aa3c161c9703322abe712a8586c5c4cfa28bfe86f1013eadb8200377d6`.

**This is enforcement of the frozen text, not an amendment to it.** Nothing had been derived,
so no result was seen and nothing was tuned to. The first draw's task ids are deliberately not
recorded outside the picker.

**A second guard shipped with it.** The picker used to overwrite `round2/SLATE-PUBLIC.json` and
`picker/SEALED-labels.json` in place. It now refuses to clobber a drawn round's slate without
`--force`, and reads every previous round's public slate to exclude what it already burned.

---

## 2b. The second channel — a forensics write-up printing the answer

The redraw after §2 was swept again, and this is what it found.

`FORENSICS-heldout200-grok-opencode-2026-07-28.md` discusses one of the newly drawn tasks **and
names the exact new packages its hidden test imports** — which is precisely the obligation this
gate asks the deriver to predict. Not a hint about it: the thing itself.

**Excluding tasks another programme RAN is not enough. Tasks another programme WROTE UP have to
go too.** The picker now scans every `.md` and `.txt` document under the bench and excludes any
task named in one. Bare inventory files are deliberately not counted as discussion —
`run-history-instance-ids.txt` lists every id ever run and `HELDOUT2_EXCLUDED_REPOS.json` lists
the whole pool, so counting them would exclude all 200 tasks and leak nothing about any of them.
**Prose is the discriminating signal.** 12 development-pool tasks are discussed in prose.

**A repository rule came with it.** A repo whose layout has been discussed in prose, or derived
on in a previous round, gives a head start on exactly what this gate scores — owning package and
dependency direction. Sibling tasks in such a repo are excluded even when the task itself is
untouched: 6 more.

**That emptied the frozen pool.** Two development-pool tasks add a new source module after all
exclusions, against a pre-registered requirement of three. The pool was widened rather than the
bar lowered; see [`DEVIATION-ADDENDUM.md`](./DEVIATION-ADDENDUM.md).

## 2c. One task has no base tree at all, and the harness would not have told us

`ember-intl__ember-intl-596` was drawn and cannot be materialised: its base commit is unreachable
on GitHub, by clone or by `git fetch origin <sha>`.

**`harness/golden-build.mjs` does not check that its `git checkout <base_commit>` succeeded.** On
that task the checkout fails, the script proceeds, and the fresh-init captures the repository's
**default branch** — a post-fix tree, under a directory name claiming to be the base commit. A
blinded gate handed that tree would be reading the answer out of the working directory.

The task is recorded in `picker/UNMATERIALISABLE.json` and excluded, and the slate was drawn
again at the same frozen seed. **Every base tree this round uses was rebuilt with an explicit
`git rev-parse HEAD` check against the intended commit before its history was stripped.** The two
that already existed on the evidence box were byte-compared against freshly verified clones: one
identical, the other identical but for a stray `.vault-manifest.sha256` bench file.

---

## 3. The sweep on the redrawn slate

| term class | `MEMORY.md` | memory files | brief / claim | `CLAUDE.md` | bench prose |
|---|---|---|---|---|---|
| all five task ids | clean | clean | clean | clean | clean |
| all five repositories | clean | clean | golden paths only | clean | none discussed |

No slate task shares a repository with round 2, and no repository appears twice within the
slate. The languages are python, js, php, java and ts.

**Repository names appear in the brief on purpose**, in the golden-checkout path list in §6, and
nowhere else. The deriver cannot read a base tree without being told where it is. Round 2's
brief did the same.

---

## 4. What this does not prove

A clean sweep means the terms searched for are absent from the surfaces searched. It does not
mean there is no fifth channel. Blinding has now broken three times and been caught pre-emptively
once, and every one was a surface nobody had thought to check. **The deriving session is asked to
report anything it trips over, and to treat a tripped channel as contamination rather than
noise.**

## 5. A constraint on round 4, recorded now because it is not obvious

After every exclusion, the augmented 268-task pool holds **six** tasks that add a new source
module, and this slate spends three of them. The frozen development pool alone holds **two**.

So a round 4 is possible but not comfortable, and a round 5 is not possible at all without a
fresh pool. If round 3 does not settle the claim, the next test needs the new stratified set,
which is the same work as Phase 4.
