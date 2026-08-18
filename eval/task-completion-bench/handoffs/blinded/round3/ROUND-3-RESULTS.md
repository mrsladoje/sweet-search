# ROUND 3 RESULTS — obligation-graph gate, third rotation

**Run:** 2026-08-17. **Spend: `$0`.** No model rollouts, no paid calls, no pilots. Every statement
below comes from reading issue text, base trees and stored artifacts.

---

## 0. Declaration and lock hash

> I did not open `handoffs/improve/`, `handoffs/blinded/picker/`, `handoffs/blinded/round2/`,
> the earlier round's results or lock files, or any `tasks_full_*.json` before writing and
> hashing my lock file. I checked my memory index for contamination and found: **none**.
> Lock hash: `b7b5ff263deeca79e7ac98d8e125c8cdf5f23ef807333b96d1410a84774a5918`.

The lock file is `round3/lock-obligations.md`, written and hashed at 2026-08-17T08:40:37Z, before
`SEALED-labels-round3.json` or any pool file was opened. It has not been edited since.

### 0.1 The memory-index check, in full

`MEMORY.md` loads automatically before any brief can be read, so it was swept first. I searched the
index, every file in the memory directory, `~/.claude/CLAUDE.md` and the project `CLAUDE.md` for all
five task identifiers, all five repository names, all five base commits and every distinctive path
token on the slate. **No match anywhere.** The memory-directory sweep printed filenames only, so no
memory file was opened. The three index lines that do name benchmark repositories (`kiota`, `zeek`,
`Julia`) name none of this slate.

I re-ran the bench-wide prose sweep independently of `LEAK-SWEEP.md` and reproduce its result: no
`.md` or `.txt` document under the bench names any slate repository except the three bare inventory
files the sweep already declared out of scope. **This round is uncontaminated.**

### 0.2 One channel the sweep did not cover, found before locking, benign on inspection

A filename-only sweep across **all** file types — not just prose — put one slate identifier inside
`handoffs/improve/evidence-pack.json`. The picker's "discussed in a prose document" rule scans
`.md` and `.txt` only, so a JSON evidence pack sits outside it. **I did not open the file before
locking.** Read afterwards, the entry for `cyclonedx__cyclonedx-core-java-105` is a harness
environment note — a warmed container image, because test-time dependency fetch dies under egress
lockdown — and it says nothing about the fix, the classes, or the tests.

**Benign this time. The class of channel is real.** JSON artefacts under `handoffs/` carry free-text
`_why` fields, and nothing scans them. Recorded for round 4 in §5.

---

## 1. Per-task results

Twenty-four high-confidence nodes filed across five tasks, plus twenty-three low-confidence
advisories. Five new source modules asserted; the accepted solutions add six.

*(Clerical note on the lock: its own summary table says "nineteen high-confidence nodes in total,
of which five are the module verdicts". The correct count is twenty-four, of which five are module
verdicts and nineteen are not. The arithmetic slip is in the summary line only; no node is
ambiguous. Recorded rather than corrected, because the lock is not edited after hashing.)*

---

### 1.1 `s-knibbs__dataclasses-jsonschema-32` — **PASS**

**Derived.** No new source module: the distribution is one module, `dataclasses_jsonschema/__init__.py`.
An in-place change to the public `from_dict` so an absent key stops arriving at the constructor as
`None`. An in-place change to schema construction so a field with **any** default, not only
`Optional[...] = None`, leaves the `required` list. A guard narrowing "this field has a declared
default", distinct from `is_optional`, consulting `dataclasses.fields` and `MISSING`, reachable from
both paths. Five public signatures preserved, with the internal `_get_field_schema` free to change.

**Reveal.** Two files: `README.rst` (documentation, does not count) and
`dataclasses_jsonschema/__init__.py`. `from_dict` becomes
`data.get(target_field, field.default)`. `_get_field_schema` takes a `Field`, and on
`field.default is not MISSING and field.default is not None` sets `required = False`.
`_get_fields` is promoted to a classmethod carrying `Field` objects.

**Score.** New modules **0/0**, refusal correct. Every asserted node landed, including the guard's
exact vehicle (`dataclasses.MISSING`). All five preserved signatures survive; only underscore-prefixed
internals changed, as the lock allowed.
**High-confidence false positives: 0. Low-confidence advisories that did not materialise: 2 of 4**
(a second module; an `omit_none` behaviour change). The two that did land — the `default` keyword
in the property schema, and `_get_fields` becoming a classmethod — were filed low and therefore
score in neither direction.

---

### 1.2 `ember-cli__eslint-plugin-ember-551` — **PASS**

**Derived.** One new public module `lib/rules/no-classic-components.js`, which cannot live in an
existing file because `tests/rule-setup.js` asserts `Object.keys(plugin.rules)` deep-equals
`readdirSync('lib/rules')`. An export edge `lib/index.js` → the new module, in alphabetical slot
between `no-capital-letters-in-routes` and `no-computed-properties-in-native-classes`. A public
enumeration entry in `lib/recommended-rules.js`, in the same slot, public because
`lib/config/recommended.js` re-exports it as `configs.recommended`. The rule-module contract
preserved, because `scripts/update-rules.js` reads `meta.docs.*` unconditionally. Category exactly
the existing string `'Ember Octane'`.

**Reveal.** Five files. Source: `lib/rules/no-classic-components.js` (new), `lib/index.js`,
`lib/recommended-rules.js`. Non-scoring: `README.md` table row, `docs/rules/no-classic-components.md`.

**Score.** New modules **1/1**, correct owning package, correct public/internal call, correct
directory. Both slots alphabetically exact. `"ember/no-classic-components": "off"` — the value was
filed low and it landed. Category is `'Ember Octane'` as asserted.
**High-confidence false positives: 0. Low-confidence advisories that did not materialise: 2 of 4**
(a dedicated Octane config; sub-path imports). Withholding the Octane config from the asserted tier
was the right call — asserting it would have been a high-confidence false positive.

The patch adds one thing the lock did not name, `meta.docs.url`. That is a field inside the new
module, not a missed obligation.

---

### 1.3 `phpactor__phpactor-2001` — **FAIL** (requirement 4)

**Derived.** A new public module in `Phpactor\Completion` under
`lib/Completion/Bridge/TolerantParser/`, implementing `TolerantCompletor`, because every completion
context in this codebase is its own class — `CompletionWorseExtension` derives a user-facing
`completion_worse.completor.<name>.enabled` key from the registration name, and there is no way to
toggle a branch inside an existing completor. A public enumeration entry in
`getTolerantCompletors()`, with the edge running Extension → Completion and no ordering rule. A
guard narrowing "the node is inside an attribute group", belonging to
`Phpactor\Completion\Bridge\TolerantParser`. The `complete(Node, TextDocument, ByteOffset): Generator`
signature and the five `Suggestion::createWithOptions` option keys preserved.

**Reveal.** Four files: `lib/Completion/Bridge/TolerantParser/ReferenceFinder/AttributeCompletor.php`
(new), `lib/Completion/Bridge/TolerantParser/CompletionContext.php`,
`lib/Extension/CompletionWorse/CompletionWorseExtension.php`, and the generated
`doc/reference/configuration.rst` (documentation, does not count).

**Score on requirements 1 to 3.** New modules **1/1**, correct owning package, correct public call,
correct dependency direction. The enumeration entry is exact, including the derived config key
`completion_worse.completor.attribute.enabled` and the `limitCompletor` wrapper filed low. The guard
is exact and landed in the predicted location: `CompletionContext::attribute(?Node $node): bool`,
matching `AttributeGroup`, `Attribute`, or a child of `Attribute`. The interface and all five option
keys are preserved verbatim.

**Score on requirement 4 — one high-confidence false positive.** The lock's C1 node names
`Phpactor\WorseReflection\Reflector` among the new module's dependencies, on the reasoning that
restricting suggestions to `#[Attribute]`-marked classes needs reflection. **The accepted completor
takes `NameSearcher` and `DocumentPrioritizer` only, and does not filter to attribute classes at
all.** That outcome was filed as advisory C-L4 and it is exactly what happened — but the asserted
tier named an edge that does not exist, and requirement 4 does not care that the alternative was
also written down at low confidence.

**One imprecision, recorded, not scored.** The lock guessed the sub-namespace
`.../WorseReflection/AttributeCompletor.php`; the accepted file is `.../ReferenceFinder/`. Exact
filenames are not required by the bar and the owning package was right, so this is not counted.
The guess was wrong for the same reason as the false positive above: it assumed a `Reflector`.

**High-confidence false positives: 1. Low-confidence advisories that did not materialise: 3 of 5.**
The largest miss risk the lock named for itself — new attribute reflection in
`Phpactor\WorseReflection` — did not happen, so withholding it was correct.

---

### 1.4 `cyclonedx__cyclonedx-core-java-105` — **FAIL** (requirements 1 and 4)

**Derived.** New public model types in `org.cyclonedx.model` for the three XSD complexTypes with no
Java counterpart: `patchType`, `issueType`, `diffType`. `Pedigree` gains a `patches` list with
`@JacksonXmlElementWrapper(localName = "patches")` and `@JacksonXmlProperty(localName = "patch")`.
`@JsonPropertyOrder` gains `"patches"` between `"commits"` and `"notes"`, because XML output must
follow the `pedigreeType` sequence. Two new enumerations, and `enhancement` belongs to the issue
enumeration while `Component.Type` is **not** widened. Existing public signatures preserved.

**Reveal.** Seven files. Four new: `Diff.java`, `Issue.java`, `Patch.java`, **`Source.java`**.
Three modified: `Pedigree.java`, `Vulnerability10.java`, `ExtensionDeserializer.java`.

**The requirement-1 miss.** `Source.java` is a fourth new source module and the lock does not assert
it. The lock's D1 node says the issue's `source` "may legitimately be a nested static class rather
than its own file", and files "its own file" as advisory D-L4. Low confidence cannot satisfy a
requirement, so this is a miss: **3 of 4 new modules asserted.**

**The miss was derivable and I did not derive it.** `Source` already existed in the base tree as
`public static class Source` at line 200 of
`src/main/java/org/cyclonedx/model/vulnerability/Vulnerability10.java`. The accepted solution
**promotes** it to a top-level `org.cyclonedx.model.Source` and reuses it from `Issue`, which is why
`Vulnerability10.java` and `ExtensionDeserializer.java` are in the patch at all. One `grep -rn
'class Source' src/main/java` would have found it. I reasoned forward from the specification schema
to the types the schema requires, and never asked the reciprocal question — *does a type of this
shape already exist in the tree, and would the fix move it?* That is a method gap, not missing
information.

**Score on the rest.** `Pedigree.patches` is exact, both annotations included. The
`@JsonPropertyOrder` node is exact, `"patches"` between `"commits"` and `"notes"`. `Issue.Type` is
exactly `enhancement`, `security`, `defect`. `Component.Type` is not widened, and the wrong-kind
input node holds: the `type` attribute of `<issue>` now binds to `Issue.Type` and never reaches
`Component$Type`. The reported exception is closed by exactly the mechanism derived.

**Score on requirement 4 — two high-confidence false positives.**

1. The lock asserts the patch classification enumeration is "exactly `unofficial`, `monkey`,
   `backport`, `cherry-pick`". The accepted `Patch.Type` has **two** members, `BACKPORT` and
   `UNOFFICIAL`. `monkey` and `cherry-pick` are absent.
2. The lock asserts, in D3 and again in D6, that `Pedigree.equals` and `hashCode` widen to include
   `patches`. **They do not.** The patch adds the field, the annotations, the getter and the setter,
   and leaves `equals` and `hashCode` untouched.

Both are cases where the accepted patch is **less complete than the schema requires** — the XSD
declares four patch classifications, and a value field excluded from `equals` is a defect. The graph
predicted what the specification demands; the maintainer shipped less. That is a real and
uncomfortable property of this bar, discussed in §3.2. It does not change the score. The bar is
scored against the accepted solution and it is not softened after the reveal.

**High-confidence false positives: 2. Low-confidence advisories that did not materialise: 4 of 5.**
Withholding CycloneDX 1.3 support from the asserted tier was correct — it did not happen.

---

### 1.5 `rrd108__vue-mess-detector-129` — **PASS**

**Derived.** No new source module: the rule exists, is already enumerated in `src/rules/rules.ts`,
already imported by `rulesCheck.ts` and `rulesReport.ts`, and already documented; the defect is one
pattern in one function. An in-place change replacing the two regular expressions, whose body group
`([^{}]*(([^{}]*\{[^{}]*\}[^{}]*)*[^{}]*))` nests an unbounded quantifier inside a starred group
that can match empty — the classic exponential-backtracking shape. A second, separable in-place
change re-enabling the arrow-function branch disabled by `// TODO temporary switch off see #116`.
Four exports and the `Offense` text preserved.

**Reveal.** One file, `src/rules/rrd/functionSize.ts`. Both regular expressions are deleted outright
and replaced by a linear scan with explicit brace counting — `parseFunctionName`,
`skipToFunctionBody`, `parseArrowFunction`, `extractFunctionBody`, `cleanFunctionName`, all private
to the module. The arrow-function path is live again.

**Score.** New modules **0/0**, refusal correct — including the specific prediction that any
extracted helper would stay inside the existing file rather than become a module. Both in-place
nodes exact. All four exports keep their names and shapes; the private `addFunctionToFiles` changed
signature, which the lock did not protect. The `Offense` interface and the rule and description
strings are untouched.
**High-confidence false positives: 0. Low-confidence advisories that did not materialise: 5 of 5.**
That tier was pure noise on this task, which is the correct outcome for advisories but worth noting.

---

## 2. Overall verdict against `NARROWED-CLAIM.md` §3

| # | requirement | result |
|---|---|---|
| 1 | every new source module asserted, correct owning package | **FAIL** — 5 of 6 across the slate; `Source.java` missed on task D |
| 2 | no missing export, overload, enumeration or predicate obligation | **PASS** — none missing on any of the five |
| 3 | no new source module asserted where the solution adds none | **PASS** — 2 of 2 refusals correct |
| 4 | zero high-confidence false positives across the whole slate | **FAIL** — 3 |
| 5 | all five tasks pass 1–4 | **FAIL** — 3 of 5 |

### **VERDICT: FAIL.**

Per task: **A PASS · B PASS · C FAIL · D FAIL · E PASS.**

| task | HC nodes | HC false positives | LC advisories | LC that did not materialise |
|---|---:|---:|---:|---:|
| A `dataclasses-jsonschema-32` | 5 | 0 | 4 | 2 |
| B `eslint-plugin-ember-551` | 5 | 0 | 4 | 2 |
| C `phpactor-2001` | 4 | 1 | 5 | 3 |
| D `cyclonedx-core-java-105` | 6 | 2 | 5 | 4 |
| E `vue-mess-detector-129` | 4 | 0 | 5 | 5 |
| **total** | **24** | **3** | **23** | **16** |

### 2.1 The verdict does not depend on a judgement call

Two of the three high-confidence false positives are *over-specifications inside a node whose kind,
owning package and dependency direction are correct*: an extra collaborator on the phpactor
completor, and a complete enum member list on the CycloneDX patch classification. A reader could
argue those should be scored at node granularity rather than clause granularity, and under that
lenient reading only one false positive survives — `Pedigree.equals`/`hashCode`, which is a plain
behavioural claim that is simply false.

**Requirement 4 fails under both readings**, and requirement 1 fails independently of requirement 4.
I record the two readings so nobody has to take my strictness on trust, and I take the strict one,
because the brief says a near miss is a miss.

### 2.2 What round 3 confirms, and what it breaks

| sub-capability | round 2 | round 3 | cumulative |
|---|---|---|---|
| new source modules recalled, correct owning package | 4/4 | 5/6 | **9/10** |
| correct refusal where the solution adds none | 2/2 | 2/2 | **4/4** |
| export / enumeration / predicate obligations not missed | all | all | **clean** |
| **zero high-confidence false positives** | not gated | **3** | **broken on first test** |

The claim in `NARROWED-CLAIM.md` §2.3 — that across two rounds "the low-confidence mark sorted every
false positive correctly, and no high-confidence node has been wrong" — **does not survive its first
honest test as a gate.** Requirement 4 was added precisely to convert that observation from a happy
accident into something scored, and it failed immediately. That is the most useful thing this round
produced.

---

## 3. Why it failed, in two mechanisms

### 3.1 Forward-only derivation misses reuse (the requirement-1 miss)

The graph reasons from *what the requirement demands* to *what must therefore exist*. On CycloneDX
that produced the right three types from the XSD and stopped. It never asked the reciprocal
question — **does something of this shape already exist in the tree, and would the accepted fix move
or promote it rather than create it?** `Vulnerability10.Source` was sitting in the base tree, in the
model package, with the exact field pair the issue type needs. The maintainer promoted it; the graph
did not look.

This is fixable and cheap: one existence sweep per required type before the module list is closed.
It is a change to the artefact's method, not evidence about the underlying capability.

### 3.2 Everything inside a high-confidence node inherits high confidence

All three false positives are elaborations written inside correct nodes — a collaborator list, an
enum member list, a consequential `equals`/`hashCode` update. The artefact has no way to say *"this
obligation is asserted; this is how I expect it to be implemented"*. The confidence mark attaches to
the paragraph, not to the claim.

Two of the three are worse than mis-marked, and this is the finding with teeth: **they are cases
where the accepted patch is less complete than the specification requires.** The CycloneDX XSD
declares four patch classifications and the shipped enum has two. A value field omitted from
`equals` is a defect. A graph that predicts what *should* change will over-assert wherever the
maintainer under-delivers — so requirement 4 is measuring two different things at once, "was the
deriver wrong" and "was the maintainer incomplete", and it cannot separate them.

**That is an observation for the design of any future gate, not a reason to re-cut this one.** The
bar was frozen and published before the slate was drawn, and it is scored as written.

---

## 4. What should happen next

**Recommendation: do not run round 4. Record C-6 as dead and stop.**

`NARROWED-CLAIM.md` §5 pre-committed to this disposition — "FAIL — the capability does not survive,
and the honest disposition is to say so and stop" — and the pre-commitment is worth more than the
argument I could make against it now. Three further reasons, in order of weight:

1. **It has now failed twice against its own pre-registered bar.** Round 2 scored 4 of 5, round 3
   scores 3 of 5. Both are FAIL. The narrowing between them removed mechanism from the scored set
   and added requirement 4; the capability failed the new requirement on first contact *and* lost a
   module it had never lost before.

2. **Round 4 would exhaust the pool for a claim that has already failed.** `LEAK-SWEEP.md` §5 records
   six new-module tasks in the augmented 268-task pool after exclusions. This slate spent three.
   Three remain — exactly one more 3+2 slate, and nothing after it without the fresh stratified set,
   which is the same work as Phase 4.

3. **Both failure modes point at artefact design, not at more evidence.** The repairs are known and
   cheap: sweep for pre-existing types before closing the module list, and separate "the obligation"
   from "how I expect it to be implemented" so a wrong implementation guess cannot spend the
   assertion budget. But applying those repairs and re-running on the last three tasks would be
   **tuning to the observed failure** — the precise thing the freeze-then-draw order exists to
   prevent. A repaired artefact is a new claim. It needs its own pre-registration and its own pool.

**If the programme wants to spend on this area, spend it on the question C-6 was gating, not on
C-6.** `NARROWED-CLAIM.md` §5 says a PASS would have unlocked *"does handing an agent a correct
obligation graph change its patch?"* — and notes that a perfect graph the agent ignores is worth
nothing. That question does not require a derivation gate to pass first. It can be tested directly
with two or three **hand-built** graphs, which removes derivation from the experiment entirely. If
handing an agent a known-correct graph does not move its patch, the derivation capability was never
worth buying at any accuracy, and this whole line closes for a fraction of what round 4 would cost.

**What to preserve from three rounds.** Two sub-capabilities have not failed: new-module recall is
9 of 10 across rounds 2 and 3, and correct refusal is 4 of 4. If a downstream use needs "which
package will this change touch, and does it add a module at all", that narrower question has
better evidence behind it than the claim just tested. It is not what C-6 claimed, and it should not
be smuggled in as a partial pass — but it is a real result and should not be thrown away with the
verdict.

---

## 5. Things I tripped over that the brief did not anticipate

1. **The prose-leak sweep scans `.md` and `.txt` only.** `handoffs/improve/evidence-pack.json` names
   a slate task. I found it before locking with a filename-only sweep across all file types, did not
   open it, and confirmed afterwards that its content is a harness environment note with no bearing
   on the fix. **Benign here; the channel is real.** JSON artefacts under `handoffs/` carry free-text
   `_why` fields. Round 4 should either extend the discussion scan to JSON free-text fields or
   exclude the whole `handoffs/` tree from the eligible set.

2. **`harness/task-overrides.json` also names slate identifiers.** Harness configuration, benign,
   not forbidden, same class as the above.

3. **Two goldens exist for `rrd108/vue-mess-detector`** on the evidence box, `@6ec3031…` (this
   slate) and `@e533e34…` (not this slate). I used only the path the brief named. A session that
   globbed by repository name rather than by full `<repo>@<sha>` would silently read a different
   tree. One line in the next brief's environment section fixes this.

4. **The `ember-cli__eslint-plugin-ember` golden carries a `.sweet-search` index directory** at its
   root, dated 2026-07-21. It is a second stray non-repository artefact in a golden, alongside the
   `.vault-manifest.sha256` the brief already warns about in the CycloneDX tree. It indexes base-tree
   content only, so it is not a leak, and both are untracked so `git status --porcelain` finds them
   immediately. Worth naming as a class — "goldens may carry non-repository artefacts; check
   `git status` before trusting a file listing" — rather than enumerating them one at a time.

5. **The bar cannot distinguish a wrong prediction from an incomplete accepted patch.** Two of the
   three high-confidence false positives are places where the maintainer shipped less than the
   project's own schema requires. The brief anticipates the add-versus-remove case in
   `NARROWED-CLAIM.md` §2.2 and rules it a scope note; it does not anticipate the
   *predicted-more-than-was-delivered* case. This did not change the verdict — requirement 1 fails
   independently — but any successor gate needs a rule for it, decided in advance.

6. **No difficulty with the single-commit goldens.** The brief's warning about
   `git checkout <base_commit>` was sufficient; every tree was read as-is and verified by content.
   The rebuild claim holds up: the CycloneDX tree carries exactly the stray manifest the brief
   predicted and nothing else, and no golden showed post-fix content — every one of the five was
   confirmed pre-fix by the absence of the thing its issue asks for.
