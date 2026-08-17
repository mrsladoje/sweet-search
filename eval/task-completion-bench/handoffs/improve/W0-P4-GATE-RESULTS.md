# W0 gate — P4 normative state closure

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P4 spec/state"<br>
**Date:** 2026-08-18 — **Model spend: `$0`** (no agent rollout; compute was `git archive`
plus a static parse of Swift source)<br>
**Protected state:** remote `results/` not mutated; golden checkouts never written to —
every tree was materialised with `git archive` into a temp dir and deleted; HO2 untouched;
no network.<br>
**Freeze:** the checker was committed at `193ff9b` **before** this replay existed. It was
authored from the issue text of `apple/swift-nio-http2#145` and
`Sources/NIOHTTP2/StreamStateMachine.swift` at base `3d0b382` only. The reference patch,
the hidden test patch, `FAIL_TO_PASS` and `PASS_TO_PASS` were not opened until after the
twelve recorded patches had been scored.

---

## 0. Verdict

**The checker passes, and passes harder than the gate asked. The cited-reference corpus is
dead. Generality is the open question, and the honest answer is narrow.**

P4 is a composite proposal and its two halves came apart cleanly, so they get separate
verdicts rather than one blended one.

| W0 required output | bar | result |
|---|---|---|
| a one-quadrant patch must fail the computed matrix | reject all recorded one-state patches | **12 of 12 rejected**, base accepted, zero errors |
| citations harvested across the task repositories | **at least two** task contracts materially derivable | **zero of two** pre-registered probes — bar missed |
| rotate onto unrelated state-machine changes | kill if per-project semantics needed nearly every time | **no project semantics needed**, but the strict shape occurs **once in 152,270 files** |

**The single strongest fact in this gate:** the checker was frozen before it saw the
reference fix, and the four states it names are *exactly* the four states the reference fix
adds — set equality on both operations, not merely "gold was accepted".

---

## 1. What the checker is, and why it needs no hand-written semantics

Two rules. Neither is a statement about HTTP/2 that I supplied.

**The end-of-stream axis is read out of the file.** The states that differ only by "the
initiating side has ended its stream" are exactly the pairs the code walks under
`if endStream`, in `sendData` / `receiveData` / `sendHeaders` / `receiveHeaders`. The
checker parses that relation; it does not declare it. Eight such edges are derived from the
base tree, and all eight are hand-checkable:

```
send  halfOpenRemoteLocalIdle       -> halfClosedLocalPeerActive(initiatedBy: .client, localRole: .server)   [sendHeaders]
send  halfOpenLocalPeerIdle         -> halfClosedLocalPeerIdle                                               [sendData]
send  fullyOpen(localRole: .client) -> halfClosedLocalPeerActive(initiatedBy: .client, localRole: .client)   [sendData]
send  fullyOpen(localRole: .server) -> halfClosedLocalPeerActive(initiatedBy: .client, localRole: .server)   [sendData]
recv  halfOpenLocalPeerIdle         -> halfClosedRemoteLocalActive(initiatedBy: .client, localRole: .client) [receiveHeaders]
recv  halfOpenRemoteLocalIdle       -> halfClosedRemoteLocalIdle                                             [receiveData]
recv  fullyOpen(localRole: .client) -> halfClosedRemoteLocalActive(initiatedBy: .client, localRole: .client) [receiveData]
recv  fullyOpen(localRole: .server) -> halfClosedRemoteLocalActive(initiatedBy: .client, localRole: .server) [receiveData]
```

**An operation is only held to that axis once it demonstrates insensitivity to it.**
`receivePushPromise` at base admits `fullyOpen(.client)` and
`halfClosedLocalPeerActive(.client, initiatedBy: .client)` — both ends of one `sendES`
edge. So PUSH_PROMISE validity does not turn on whether the *local* side has ended its
stream. It plainly does turn on the *remote* side, and the rule discovers that too, because
no `recvES` edge has both endpoints in the allow-set. **The direction is found, not
chosen.** Once demonstrated, admitting one end of an edge while rejecting the other is a
counterexample.

**The mirror rule arms only where the base is already a mirror.** `sendX` and `receiveX`
are one rule seen from the two ends of the wire, and the state names carry the reflection:
`(Local|Remote)` is which side we are, `(Peer|Local)` names the responder. Reflecting also
flips `localRole`; `initiatedBy` names the opener in absolute terms and does not flip. A
pair is armed only when its two allow-sets are already exact reflections in the base tree.
That precondition is what keeps the rule off operations that are legitimately asymmetric.

### The one exclusion, and why the base tree forced it

The first version fired **three counterexamples on the shipped, unmodified base tree**, all
of them pairing some state with `idle`. The cause is real and the fix is derived, not
tuned: an arm that reports `.streamCreated` is *opening* the stream, not ending a body on an
existing one. `idle --sendHeaders(END_STREAM)--> halfClosedLocalPeerIdle` crosses stream
creation, so its two endpoints are not siblings on this axis. Excluding arms that emit
`.streamCreated` / `.streamCreatedAndClosed` takes the base tree to zero. That exclusion is
read off the effect the code itself emits.

Base tree after the fix: **11 states, 10 operations, 8 end-of-stream edges, 3 armed
directional pairs** (`sendHeaders/receiveHeaders`, `sendData/receiveData`,
`sendPushPromise/receivePushPromise`), `sendWindowUpdate/receiveWindowUpdate` reported
**unarmed**, **0 counterexamples**.

---

## 2. Controls — 17 checks, all green

A checker can fail in two opposite directions and only one of them is visible from the
headline. Under-firing flatters P4 by never contradicting anything; over-firing kills
correct work, which is exactly the cost the P3 gate found and which P4's ceiling arithmetic
never counts. So every control is asserted in both directions.

| # | control | asserts |
|---|---|---|
| 1 | shipped base tree | 11 states, 10 operations, 8 edges, push-promise pair armed, window-update pair reported unarmed, **0 counterexamples** |
| 2 | the one-quadrant patch both arms wrote | rejected; class rule names `halfOpenLocalPeerIdle`; mirror rule names `halfClosedRemoteLocalIdle`; a reachable path is attached |
| 3 | both receive states, send side untouched | class rule falls silent, mirror rule still rejects |
| 4 | **the four-quadrant patch** | **accepted, 0 counterexamples**, and both operations really widened to 4 |
| 5 | mirrored but class-broken | mirror silent, class rejects on both sides — the rules are independent |
| 6 | comment-only edit | still accepted |

**Control 4 is the one that matters.** A rule nobody can satisfy is a wall, not a checker.
Control 4 builds the four-quadrant patch by hand and requires zero counterexamples on it,
which proves the rule is satisfiable *before* any recorded patch is scored against it.

---

## 3. Falsifier 1 — the replay

Twelve recorded patches: three harnesses × two arms × two repetitions. Apple is 0/2 in both
arms on all three harnesses, so every recorded cell is an unresolved cell.

| cell | resolved | verdict | recv\|send allow | counterexamples |
|---|---|---|---|---|
| BASE (unmodified) | false | **ACCEPT** | 2\|2 | — |
| codex sweet r0, r1 | false | REJECT | 3\|2 | class:`halfOpenLocalPeerIdle` mirror:`halfClosedRemoteLocalIdle` |
| codex native r0, r1 | false | REJECT | 3\|2 | same |
| opencode sweet r0, r1 | false | REJECT | 3\|2 | same |
| opencode native r0, r1 | false | REJECT | 3\|2 | same |
| claude-code sweet r0, r1 | false | REJECT | 3\|2 | same |
| claude-code native r0, r1 | false | REJECT | 3\|2 | same |
| **GOLD (reference fix)** | true | **ACCEPT** | **4\|4** | — |

- unresolved cells rejected: **12 / 12**
- unresolved cells the rule missed: **0**
- apply failures, parse errors, missing patches: **0**
- counterexamples by rule: **12 class, 12 mirror** — every cell produced exactly one of each

All twelve patches are the same patch. Every arm on every harness added
`halfClosedLocalPeerIdle` to `receivePushPromise` and stopped.

### The blind prediction was exact

The checker named four states. The reference fix adds four states. They are the same four,
on both operations:

```
GOLD receivePushPromise      GOLD sendPushPromise
  fullyOpen(.client)           fullyOpen(.server)
  halfClosedLocalPeerActive    halfClosedRemoteLocalActive
  halfClosedLocalPeerIdle      halfClosedRemoteLocalIdle      <- added
  halfOpenLocalPeerIdle        halfOpenRemoteLocalIdle        <- added
```

This is the outcome P3 warned about, coming out the other way. P3's Akinsho witness was
written to its own prescription, over-specified, and rejected the reference fix along with
eleven rollouts the grader had scored as solved. The same failure was available here — a
mirror rule that demanded a send-side change the maintainers never made would have been
over-specification, and P4's mirror rule would have had to be withdrawn on the spot. It was
not. The maintainers fixed all four quadrants.

### It specifies the fix, it does not merely refuse it

Starting from the actual recorded codex sweet r0 patch and repeatedly admitting exactly the
states the counterexamples name:

```
round 1: recv=3 send=2  ->  admit halfOpenLocalPeerIdle to receivePushPromise
                            admit halfClosedRemoteLocalIdle to sendPushPromise
round 2: recv=4 send=3  ->  admit halfOpenRemoteLocalIdle to sendPushPromise
round 3: recv=4 send=4  ->  0 counterexamples

CONVERGED after 2 rounds. Matches the reference allow-sets exactly: true
```

Two rounds. That is the difference between an instrument that says *no* and one that says
*what*.

---

## 4. Falsifier 2 — the cited-reference corpus fails its own bar

The bar was pre-registered: **at least two task contracts materially derivable from cited
documents**, with Apple and pytask as the named probes. Harvest across all 18 task
repositories at their base commits, counting only normative pointers (numbered standards
and links to standards bodies), not issue links or badges:

| measure | count of 18 |
|---|---|
| repositories with any normative citation | 7 |
| citing a numbered section anywhere | **1** |
| citing on a file the reference fix changes | 2 |
| citing a numbered section **on a file the fix changes** | **1** |

Only Apple reaches the last row. Both probes then fail on their merits:

**pytask** — 4 citations, all bare mentions of POSIX, **none** on a file the reference fix
touches. Nothing to derive from.

**Apple** — 106 citations, with RFC 7540 by far the most-cited document, and two of them
land directly on the two functions in question. They do not decide the task:

```
Sources/NIOHTTP2/StreamStateMachine.swift: // RFC 7540 § 6.6 forbids sending PUSH_PROMISE frames on locally-initiated streams.
Sources/NIOHTTP2/StreamStateMachine.swift: // RFC 7540 § 6.6 forbids receiving PUSH_PROMISE frames on remotely-initiated streams.
```

Those cover *who initiated the stream*. The task turns on a different axis entirely —
whether the responder has sent its HEADERS yet. And the repository says so about itself,
twice, in primary sources:

> **the base source, on the very arm the fix changes:** "Authors note: I cannot find a
> citation for this in RFC 7540, but this seems a sensible choice."

> **the issue text:** "The RFC seems to be unclear here."

**Zero of two probes. The bar was two. The cited-reference corpus is dead at `$0`**, and it
dies on evidence written by the maintainers, not on a judgement of mine. Note what this
implies about the other half: the checker succeeded precisely because it read the code's
*internal* symmetry, and would have gained nothing from the cited document.

---

## 5. Falsifier 3 — rotation, and how narrow this really is

Census across **all 457 golden checkouts, 152,270 source files**.

**Prevalence, measured twice so the answer is not an artifact of my own regex.** The
narrow detector requires a stored state field switched on by three or more operations. The
generous one accepts any file declaring a state-named enum or union and branching on it
three or more times.

| detector | files | repositories | rate |
|---|---|---|---|
| narrow | 16 | 4 of 457 | 1 in 9,517 |
| generous | 174 | 64 of 457 | 1 in 875 |

The generous detector spans ten languages — Rust 71, Swift 34, Go 20, Java 19, C++ 8,
TypeScript 7, C# 6, JavaScript 6, Scala 2, Dart 1. So the *shape* is not exotic: one
repository in seven has one. What is exotic is the strict configuration the two rules need.

**Of the 16 narrow candidates:**

- the Swift front end reads **9**; it cannot read 7 (5 Swift files with no operation
  switching on a state enum, 1 Java, 1 Rust) — **56.3%**
- **1** derives an end-of-stream axis
- **2** have an armed directional pair
- **1** has both, and it is `Sources/NIOHTTP2/StreamStateMachine.swift`, the motivating file

**False firing on shipped code: 0 of 9.** The proxy matters because rejection cost cannot
be measured on rollouts here — Apple is 0/2 in both arms on all three harnesses, so there
are **zero resolved cells to lose**, and `0/0` is not evidence. Shipped release trees stand
in for correct work instead. Notably `ConnectionStateMachine.swift` in the same repository
carries **8 armed mirror pairs** and produces **0** counterexamples, so the mirror rule saw
11 armed pairs across two files and stayed silent on every one.

**Verdict on the kill condition.** The pre-registered condition was "kill it if
project-specific handwritten semantics are required for nearly every case". Strictly read,
it is not met: the Apple analysis needed **no** hand-written semantics — both axes were
parsed out of the file. But the honest reading is less kind. The two rules are
language-independent; the *parser* is a Swift front end, and each language needs its own.
And the shape that lets both rules fire appeared exactly once in 152,270 files. **This is
not a general capability at present. It is a correct, precise instrument with a
demonstrated reach of one file.**

---

## 6. What this gate does and does not license

**Established.**

- A frozen, gold-free static checker rejects all twelve recorded patches and accepts both
  the base tree and the reference fix.
- Its named counterexamples converge on the reference fix in two rounds.
- It does not contradict shipped code: 0 firings on 9 shipped state machines, 11 armed
  mirror pairs among them.
- The cited-reference corpus misses its own retention bar, with the repository's own words
  as the evidence.

**Not established.**

- **That an agent handed this list would act on it.** P4's ceiling is +1 task on each
  harness; this gate proves the checker can *name* the fix, not that naming it changes what
  a model does. All three harnesses had the full base file in reach and all six cells still
  stopped at one quadrant. That is a paid question, and it is the one that decides P4.
- **Rejection cost.** Unmeasurable on rollouts here for want of a resolved Apple cell. The
  shipped-tree proxy is reassuring, not conclusive, and P3's finding stays open: any
  terminal checker that contradicts a correct patch converts solves into non-solves.
- **Cost non-increase**, which P4 named as its first gate. The checker is a local static
  parse and adds no API cost, but its output is context: about 400 characters per
  counterexample, so roughly 800 characters on this task. Small, and unpriced.

**Recommended disposition.** Keep `ss-statecheck` as a **narrow, gated analyzer**, not a
general capability, and do not build the reference corpus. If P4 is ever taken to a paid
pilot, the question to buy an answer to is whether the counterexample list changes the
patch, and the run must count solves lost as well as solves gained.

---

## 7. Instrument traps for anyone reusing this rig

- **Freeze before you look.** The checker is commit `193ff9b`; the replay is a later commit.
  Reversing that order turns a prediction into a fit, and the exact-match result would have
  been worthless.
- **Run the checker on the unmodified base first.** It fired three times on shipped code and
  exposed a real design gap (stream-creation arms). A checker that has never been run
  against the tree it analyses has not been tested.
- **Build the satisfying patch by hand before scoring anything.** Without control 4 there is
  no way to tell a strict rule from an unsatisfiable one.
- **Report unarmed pairs.** A rule that declines to fire and says nothing is how a gate
  flatters itself; `sendWindowUpdate/receiveWindowUpdate` is printed as unarmed, never
  dropped.
- **Measure prevalence twice.** The narrow and generous detectors differ by 11×. Quoting
  only the narrow one would have overstated the kill.
- Golden checkouts are single-commit repositories at a synthetic SHA. Every tree here was
  materialised with `git archive` into a temp dir and deleted; nothing under
  `/root/.ss-eval/golden` was written.

---

## 8. Artifacts

`handoffs/improve/w0-p4-20260818/`

| file | contents |
|---|---|
| `base-statecheck.txt` | the checker on the unmodified base tree |
| `controls.txt` | all 17 controls |
| `replay.txt`, `w0-p4-replay.json` | the twelve recorded patches, base and gold |
| `converge.txt` | counterexample-following convergence onto the reference fix |
| `rotation.txt` | the 457-repository census and false-firing count |
| `prevalence.txt` | narrow versus generous detector |
| `candidates.txt` | all 16 candidate state machines, itemised |
| `citations.txt` | the citation harvest across all 18 task repositories |

Scripts: `phase1-scripts/w0-p4-statecheck.mjs` (frozen at `193ff9b`),
`w0-p4-controls.mjs`, `w0-p4-replay.mjs`, `w0-p4-rotation.mjs`, `w0-p4-prevalence.mjs`,
`w0-p4-candidates.mjs`, `w0-p4-converge.mjs`, `w0-p4-citations.mjs`.
