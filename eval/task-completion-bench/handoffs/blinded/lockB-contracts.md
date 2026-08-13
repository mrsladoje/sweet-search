# LOCK B — executable contracts, derived before reveal

**Written:** 2026-08-13. **Inputs used:** problem statement + base source tree only.

**Input I deliberately did not use.** The brief permits the *visible* test output recorded in
the rollouts. I did not read it, for any of the eight tasks. Reason: `run_tests` executes the
canonical suite in the prepared environment, so its recorded output can name the very
fail-to-pass tests the grader uses. A contract shaped by those names is a contract read off the
answer, which is the kill condition of this gate. Every contract below is derived from the issue
text and the base tree alone. This makes the gate harder than the brief requires; it does not
make it easier.

---

## Verdict alphabet and the safety rule

Each contract returns exactly one of:

- **ACCEPT** — every positive obligation is observed in the patched tree.
- **REJECT** — a named disqualifying observation is present.
- **UNDECIDED** — neither; the contract declines to decide.

**Safety rule, binding on every contract below:** REJECT fires only on an observation that is
incompatible with *any* correct solution, never on the absence of an expected pattern. Absence
yields UNDECIDED. This is deliberate, because the bar counts one rejection of a correct solution
as worse than deciding nothing.

**Execution model.** For each candidate patch: copy the base golden checkout to a disposable
directory, `git apply` (falling back to `patch -p1`), then run the contract over the patched
tree. Candidates carry opaque IDs; provenance and outcome labels are sealed until reveal.
Patches that fail to apply score **UNDECIDED (unapplied)** and are excluded from discrimination
counting.

---

## B1 — `jashkenas__underscore-2757` — runtime contract (node, genuinely executed)

**Derivation.** `_.groupBy` is built by the internal `group()` factory, whose behaviour hook is
`if (_.has(result, key)) result[key].push(value); else result[key] = [value];`
(`underscore.js:447-449`). In 1.9, `_.has` was widened to `_.has(obj, path)`: when its second
argument is an **array** it walks it as a deep path (`underscore.js:1372-1384`). A grouping key
that is itself an array — the reporter's `arrayProp` — is therefore read as a path into
`result`, not as a property name. `result` is fresh and empty, so the lookup is always false and
every element opens a new bucket, keyed by the array's `toString()` — which collides, so the
last write wins and the bucket holds one element. That is exactly the reported symptom
(`Object.keys(res).length === 1`, `res[key].length === 1` instead of 2).

**The axis a wrong solution differs on:** whether the aggregate helpers stop using
*path-aware* `_.has` while the public `_.has` **keeps** its path capability. Reverting `_.has`
itself is the tempting wrong fix; the repo's own visible suite asserts path semantics at
`test/objects.js:915-916`, so that fix trades one break for another.

**Probes** (patched `underscore.js` loaded in node):

| id | input | required observation |
|---|---|---|
| P1 | `a=[1,2]`; `_.groupBy([{p:a,o:1},{p:a,o:2}],'p')` | exactly 1 key, and its value has length **2** |
| P2 | `_.groupBy([1.3,2.1,2.4], Math.floor)` | `{1:[1.3],2:[2.1,2.4]}` |
| P3 | `a=[1,2]`; `_.countBy([{p:a},{p:a}],'p')` | exactly 1 key, value **2** |
| P4 | `_.has({a:{b:'foo'}}, ['a','b'])` | `true` — path capability preserved |
| P5 | `_.has({a:{b:'foo'}}, ['a','x'])` | `false` |
| P6 | `a=[1,2]`; `_.indexBy([{p:a,o:1},{p:a,o:2}],'p')` | exactly 1 key |

**Decision.** ACCEPT iff P1–P6 all hold. REJECT iff (P1 fails) or (P4 fails) or the module
throws on load. Otherwise UNDECIDED.

---

## B2 — `pytask-dev__pytask-210` — runtime contract (python, genuinely executed)

**Derivation.** `_is_internal_or_hidden_traceback_frame`
(`src/_pytask/traceback.py:66-79`) reads
`frame.tb_frame.f_locals.get("__tracebackhide__", False)` and treats the result as a plain
boolean. The issue asks that the value be allowed to be a **callable**, citing pytest, where the
callable is consulted and its return value decides. Under the base code a callable is always
truthy, so the frame is always hidden and the callable's own decision is discarded.

**The axis a wrong solution differs on:** whether the callable is **called**, or merely treated
as truthy. A patch that adds `callable(...)` detection but still returns `True` regardless of
the callable's answer passes a naive "is it callable-aware" check and fails this one.

**Probes.** The module is loaded by executing its source with `pluggy`, `rich.traceback` and
`_pytask` stubbed in `sys.modules`, so no repository dependency needs to be installed. A frame
double supplies `tb_frame.f_locals` and `tb_frame.f_code.co_filename` pointing at a path outside
both internal directories. Callables accept `*args, **kwargs` so the contract makes no
assumption about the arity the patch chooses.

| id | `__tracebackhide__` value | required return |
|---|---|---|
| Q1 | `lambda *a, **k: True` | `True` |
| Q2 | `lambda *a, **k: False` | `False` |
| Q3 | `True` | `True` |
| Q4 | `False` | `False` |
| Q5 | absent | `False` (frame is outside `_pytask`/`pluggy`) |

**Decision.** ACCEPT iff Q1–Q5 all hold. REJECT iff Q2 returns `True` (callable not consulted)
or Q3/Q4/Q5 regress. Otherwise UNDECIDED. If the patch relocates the predicate so that no
callable of that name is reachable, UNDECIDED.

---

## B3 — `codeception__codeceptjs-367` — runtime contract (node, stubbed dependencies)

**Derivation.** The request is a step that prints a message. The issue's stated reason is
ordering: "console.log isn't sufficient … because it will run all console.log calls right away
instead of at the intuitive time." `lib/actor.js` builds the `I` object purely from helper
methods and routes each through `recorder.add(task, …)` (`lib/actor.js:44-52`). `lib/output.js`
already exposes `say(message)` (line 89). So the missing piece is an actor-level method, not
owned by any helper, that **enqueues** the print onto the recorder rather than printing when
called.

**The axis a wrong solution differs on:** synchronous versus deferred emission. Printing inside
the method body reproduces the exact defect the issue describes.

**Probes.** `lib/actor.js` is required with `./container`, `./recorder`, `./event`, `./step` and
`./output` replaced by doubles in the module cache. The recorder double records queued
callbacks without running them.

| id | action | required observation |
|---|---|---|
| R1 | build `I` with **zero** helpers registered | at least one of `say` / `comment` / `remark` is a function on `I` |
| R2 | call `I.say('hello')` | the output double has recorded **no** print yet |
| R3 | then drain the recorder queue | `'hello'` appears in what the output double printed |

**Decision.** ACCEPT iff R1–R3 hold. REJECT iff R1 holds and R2 fails — a method that prints on
call is the defect restated. Otherwise UNDECIDED (including the case where the harness cannot
build the actor at all).

---

## B4 — `dashbitco__nimble_options-43` — static contract (no Elixir runtime offline)

**Derivation.** `@basic_types` (`lib/nimble_options.ex:172-186`) is the single list that gates
which type atoms a schema may name; `available_types/0` (line 466) derives its error text from
it, and `type/1` (line 475) validates against it. Per-type checking is a set of
`defp validate_type(<atom>, key, value) when <guard>` clauses (lines 339+). The two existing
integer types differ **only** in their guard: `not is_integer(value) or value < 0` and
`not is_integer(value) or value < 1`.

**The axis a wrong solution differs on:** two distinct failure modes. (a) The atom is added to
`@basic_types` but no `validate_type(:integer, …)` clause is written — then every value passes
for `:integer`, including strings. (b) The clause is written by copying a neighbour, keeping a
`value < 0` or `value < 1` comparison — then negative integers are wrongly rejected, which is
precisely the gap the issue exists to close.

**Checks** (over `lib/nimble_options.ex` in the patched tree):

| id | observation |
|---|---|
| S1 | `:integer` is an element of the `@basic_types` list |
| S2 | at least one clause matches `defp validate_type(:integer,` |
| S3 | no guard of an `:integer` clause contains a `value <` or `value >` magnitude comparison |
| S4 | the `:non_neg_integer` and `:pos_integer` clauses and their guards are unchanged |

**Decision.** ACCEPT iff S1–S4 hold. REJECT iff (S1 holds and S2 fails) — a declared type with
no validation — or if S4 fails. Otherwise UNDECIDED.

---

## B5 — `epiforecasts__scoringutils-229` — semantic contract on the extracted guard

**Derivation.** `check_equal_length` (`R/input-check-helpers.R`) computes
`lengths <- unique(lengths(vars))`, drops the 1s when `one_allowed`, then raises unless
`length(unique(lengths)) != 1` is false. When **every** argument has length 1 the filtered
vector is empty, `length(...)` is `0`, `0 != 1` is true, and the function raises on input that
is in fact perfectly valid. The reporter's trace shows this: the error prints an empty list of
lengths.

**The axis a wrong solution differs on:** whether the empty case is admitted **without**
admitting genuinely ragged input. A patch that replaces the guard with something permanently
false silences the check entirely.

**Checks.** The `if (…)` expression guarding the `stop(` inside `check_equal_length` is
extracted and translated to an evaluable predicate over the post-filter vector `lengths`. It is
then evaluated on three vectors:

| id | original argument lengths | post-filter `lengths` | required |
|---|---|---|---|
| T1 | all length 1 (the reported case) | `integer(0)` | **no** error |
| T2 | `c(1, 3, 3)` | `c(3)` | **no** error |
| T3 | `c(2, 3)` | `c(2, 3)` | **error** |

**Decision.** ACCEPT iff T1–T3 hold. REJECT iff T3 fails — the check has been neutered — or if
the `stop(` call is deleted outright. UNDECIDED if the guard cannot be extracted or translated,
or if the function has been restructured beyond the translator's reach.

---

## B6 — `redboltz__mqtt_cpp-466` — structural contract (no Boost offline)

**Derivation.** The issue quotes one `#if BOOST_VERSION < 106600` block verbatim and states the
premise: "Now that mqtt_cpp requires Boost 1.66 or newer, this version of the code will no
longer work." The legacy arm builds an `as::ip::tcp::resolver::query` and an
`as::ip::tcp::resolver::iterator`; the modern arm calls `r.resolve(host_, port_)` and uses
`eps.begin()` / `eps.end()`. Both arms appear twice in `include/mqtt/client.hpp` (lines 466 and
502). A separate pre-1.61 fallback in `include/mqtt/string_view.hpp` selects
`boost::string_ref` over `boost::string_view`; it is dead under the same premise.

**The axis a wrong solution differs on:** which arm survives. Deleting the `#else` arm rather
than the `#if` arm inverts the fix and leaves code that cannot compile against Boost ≥ 1.66.
Deleting the preprocessor lines while keeping both bodies also fails to compile. Editing only
`test/` leaves the library unchanged.

**Checks** (scoped to `include/mqtt/**` — library headers only):

| id | observation |
|---|---|
| U1 | no occurrence of `BOOST_VERSION < 106600` |
| U2 | no occurrence of `resolver::query` |
| U3 | `r.resolve(host_, port_)` still present, and `eps.begin()`/`.end()` still reachable — the modern arm is the survivor |
| U4 | `boost/utility/string_ref.hpp` not included (soft; observed and reported, does not decide) |

**Decision.** ACCEPT iff U1–U3 hold. REJECT iff U2 holds false while U1 holds — the guards were
stripped but the legacy body kept — or if U3 fails while U1 holds, which is the inverted
deletion. Otherwise UNDECIDED.

---

## B7 — `apple__swift-nio-http2-145` — structural contract (no Swift offline)

**Derivation.** `Sources/NIOHTTP2/StreamStateMachine.swift` holds two switch statements over
`self.state`, one per direction. `receivePushPromise` (line 697) accepts only
`.fullyOpen(localRole: .client, …)` and `.halfClosedLocalPeerActive(localRole: .client,
initiatedBy: .client, …)`; every other state, `.halfClosedLocalPeerIdle` among them, falls into
a case returning `.streamError(… BadStreamStateTransition(), type: .protocolError)`. The issue
reports exactly that state and exactly that error, for a client that has sent its request and
whose peer has not yet sent HEADERS.

**The axis a wrong solution differs on:** three ways to be wrong. (a) Relaxing
`sendPushPromise` instead of `receivePushPromise` — the wrong direction; RFC 7540 §6.6 still
forbids sending on locally-initiated streams. (b) Accepting the frame but still returning a
stream error. (c) Collapsing the error case entirely, so `.idle` and `.closed` also become
acceptable — that would tolerate a PUSH_PROMISE on a stream that does not exist.

**Checks.** The body of `mutating func receivePushPromise` is isolated up to the next `mutating
func`. Its accepting case block is the one whose body calls `processRequestHeaders`; its
rejecting block is the one returning `.streamError`.

| id | observation |
|---|---|
| V1 | `halfClosedLocalPeerIdle` appears in the **accepting** block of `receivePushPromise` |
| V2 | `halfClosedLocalPeerIdle` no longer appears in its **rejecting** block |
| V3 | `.idle` and `.closed` still appear in the rejecting block |
| V4 | `sendPushPromise` still rejects `halfClosedLocalPeerIdle` (soft; observed and reported, does not decide) |

**Decision.** ACCEPT iff V1–V3 hold. REJECT iff V3 fails — the state machine has been made
permissive rather than corrected — or if the only edit is inside `sendPushPromise`. Otherwise
UNDECIDED.

---

## B8 — `statamic__cms-9029` — structural contract (no PHP offline)

**Derivation.** `Outpost::request()` (`src/Licensing/Outpost.php:42-62`) calls
`$this->cache()->lock(self::LOCK_KEY, 10)` unconditionally, then `$lock->block(…)` and, in
`finally`, `$lock->release()`. `cache()` returns `Cache::store('outpost')` or the default store.
Laravel's `ApcStore` does not implement `Illuminate\Contracts\Cache\LockProvider`, so `lock()`
resolves through `Repository::__call` and raises the reported
`Call to undefined method Illuminate\Cache\ApcStore::lock()`. The trace in the issue lands on
`Outpost.php(45)` — the `lock()` line — via the `ContactOutpost` control-panel middleware,
which is why the whole `/cp` route 500s.

**The axis a wrong solution differs on:** whether locking is made **conditional** or simply
removed. Removing it fixes APCu and regresses every driver that does support locking, which is
the concurrency protection the code exists for. A second axis is the `finally` block: if the
lock was never taken, `$lock->release()` must not run on `null`.

**Checks** (over `src/Licensing/Outpost.php` plus any file the patch adds):

| id | observation |
|---|---|
| W1 | a capability test is present — one of `LockProvider`, `method_exists(`, `supportsLock`, or a `try`/`catch` around the lock acquisition |
| W2 | `->lock(` and `->block(` still occur on the supported path — locking is not deleted for everyone |
| W3 | the release path is null-safe — `?->release()`, `if ($lock`, `$lock !== null`, `isset($lock`, or release moved inside the guarded branch |
| W4 | `request()` still returns a response on the unsupported path — `performAndCacheRequest`/`hasCachedResponse` remain reachable when the lock is skipped |

**Decision.** ACCEPT iff W1–W4 hold. REJECT iff W2 fails — locking removed unconditionally.
Otherwise UNDECIDED. Deliberately **no** REJECT for "no capability test found": the defect
admits mechanisms this contract does not enumerate, such as selecting a lock-capable store or
introducing a null-lock shim, and rejecting those would violate the safety rule.

---

## Pre-registered expectation

Contracts B1, B2, B3 execute real code and should discriminate. B4, B6, B7 are structural and
should discriminate on the axes named. B5 depends on a translation step that may not survive a
restructured function. B8 is the weakest by construction — its REJECT arm is narrow on purpose.

The bar is correct discrimination on at least three tasks with **zero** rejections of a patch
that was in fact accepted.
