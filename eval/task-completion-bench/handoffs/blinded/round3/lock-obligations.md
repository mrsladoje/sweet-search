# Round 3 — obligation graphs, locked before reveal

**Derived from:** `ISSUES.json` (issue statement only) and the five base trees on the evidence
box at `/root/.ss-eval/golden/`. Nothing else.

**Not read before writing this file:** `handoffs/improve/`, `handoffs/blinded/picker/`,
`handoffs/blinded/round2/`, `handoffs/blinded/BLINDED-GATE-RESULTS.md`, any `lock*.md` from an
earlier round, any `select/.cache/tasks_full_*.json`, `results/`, `analysis/`, any
`FORENSICS-*`, `RESULTS-*`, `TURNFIX*`, `PLAN.md`, `MANIFEST_*`, or any memory file.

**Confidence contract.** HIGH is an assertion and scores in both directions. LOW is an advisory:
reported and counted, scoring in neither direction, and it cannot satisfy any requirement. Where
a task's assertion is a *refusal* (no new source module), that refusal is filed HIGH and any LOW
node nearby is explicitly marked as not weakening it.

---

## Task A — `s-knibbs__dataclasses-jsonschema-32`

**Issue.** `from_dict` must honour a dataclass field default other than `None`.
`DefaultVal.from_dict({'a': 1}) == DefaultVal(a=1)` where `b: Optional[int] = 5`.

**Package under change.** `dataclasses_jsonschema` — a single-module distribution.
`setup.py` declares `packages=['dataclasses_jsonschema']`; the package contains exactly
`__init__.py` (477 lines) and `py.typed`. Everything below lives in that one module.

### A1 — new source module: **REFUSED** · HIGH
The accepted solution adds **no new source module**. The entire library is one module and the
change is confined to `JsonSchemaMixin`. No packaging change is implied: `setup.py` already
declares the package, not a module list.

### A2 — modify existing behaviour in place · HIGH
- **Where:** `JsonSchemaMixin.from_dict` — package `dataclasses_jsonschema`, **public** (this is
  the documented entry point of the mixin).
- **Observable change:** a field whose key is absent from `data` no longer arrives at the
  constructor as `None`; the dataclass's own default applies. Today `from_dict` writes
  `decoded_data[field] = cls._decode_field(field, field_type, data.get(mapped_field), ...)` for
  every hinted field, so `cls(**decoded_data)` always passes an explicit `None` and the default
  never fires.
- **Direction:** `from_dict` → `_decode_field` (unchanged direction); the fix is upstream of the
  decoder, in how the argument dict is built.

### A3 — modify existing behaviour in place · HIGH
- **Where:** schema construction — `JsonSchemaMixin.json_schema` (public) and its helper
  `_get_field_schema` (internal, same module).
- **Observable change:** a field carrying **any** default, not only `Optional[...] = None`, is no
  longer emitted in the schema's `required` list. Today `required` is driven solely by
  `is_optional(field_type)`, so `b: Optional[int] = 5` and `b: int = 5` are both mishandled — the
  first only accidentally, the second outright.
- **Direction:** `json_schema` → `_get_field_schema` (existing edge, retained).

### A4 — add a type predicate or guard · HIGH
- **What it narrows:** "this field has a declared default" — distinct from, and not implied by,
  "this field's type is `Optional[...]`". The two are conflated today by `is_optional`.
- **Where it belongs:** internal to `dataclasses_jsonschema`, reachable from both A2 and A3. It
  must consult `dataclasses.fields(...)` (`default` / `default_factory` against
  `dataclasses.MISSING`), because a type hint cannot express a default. An inline check satisfies
  this node; a named helper is not required.
- **Direction:** the schema builder and the decoder both gain a dependency on
  `dataclasses.fields`, which the module already imports (`from dataclasses import fields,
  is_dataclass`).

### A5 — preserve an existing signature · HIGH
These public signatures must keep working unchanged:
- `JsonSchemaMixin.from_dict(cls, data: JsonDict, validate=True) -> T`
- `JsonSchemaMixin.to_dict(self, omit_none: bool = True, validate: bool = False) -> JsonDict`
- `JsonSchemaMixin.json_schema(cls, embeddable=False, schema_type=SchemaType.DRAFT_06, **kwargs)`
- `JsonSchemaMixin.field_mapping(cls) -> Dict[str, str]` and
  `JsonSchemaMixin.register_field_encoders(...)`
- `FieldEncoder.to_wire` / `to_python` / `json_schema`

`_get_field_schema` and `_get_fields` are internal (leading underscore) and **may** change
signature to carry the `dataclasses.Field` through; that is not a public-surface obligation.

### Low-confidence advisories (score in neither direction)
- **A-L1** · a `default` keyword is emitted into each property's schema for fields with a
  non-`None` default. The issue names `test_embeddable_json_schema` as failing hard, which is a
  schema-output test; the `required`-list change of A3 alone would also move that test.
- **A-L2** · `_get_fields` is promoted from an instance method (`fields(self)`) to a classmethod
  (`fields(cls)`) returning the `Field` objects, so `to_dict` and `json_schema` share one walk.
- **A-L3** · a sentinel or typing helper is split into a second module inside the same package.
  **Advisory only — this does not weaken the refusal in A1, which is the assertion for this task.**
- **A-L4** · `to_dict`'s `omit_none` behaviour changes for defaulted fields.

**Not scored:** the README bullet "Support field default values, currently only a default value
of `None` will work" is documentation.

---

## Task B — `ember-cli__eslint-plugin-ember-551`

**Issue.** New Octane rule `no-classic-components`: disallow `import Component from
'@ember/component'`; prefer `@glimmer/component`.

**Package under change.** `eslint-plugin-ember` — one npm package, `main: lib/index.js`,
`files: ["lib"]`.

### B1 — author a new source module: **ASSERTED** · HIGH
- **Owning package:** `eslint-plugin-ember`, at `lib/rules/no-classic-components.js`.
- **Public or internal:** **public.** `files: ["lib"]` ships it and it becomes reachable to every
  consumer as the rule id `ember/no-classic-components`.
- **Why it cannot live in an existing file:** `tests/rule-setup.js` asserts that
  `Object.keys(require('../lib/index.js').rules)` deep-equals `readdirSync('lib/rules')` with
  `.js` stripped. One rule is exactly one file in `lib/rules`; the mapping is structurally
  enforced, not conventional.
- **Module contract:** `module.exports = { meta: { docs: { description, category, recommended },
  fixable }, create(context) }`, reporting on `ImportDeclaration` where
  `node.source.value === '@ember/component'`. `lib/rules/no-proxies.js` is the exact template.
- **Dependency direction:** leaf. `lib/index.js` → the new module. The new module imports nothing
  from `lib/utils`.

### B2 — add or change an export · HIGH
- **Which public surface:** the plugin's `rules` map in `lib/index.js` — this *is* the plugin's
  public API; ESLint resolves `ember/<name>` through it.
- **Change:** `'no-classic-components': require('./rules/no-classic-components'),`
- **Direction of the edge:** `lib/index.js` (aggregator) depends on the new rule module; never
  the reverse.
- **Ordering rule:** yes. The map must be in `readdirSync` order, which is alphabetical, so the
  entry sits between `no-capital-letters-in-routes` and `no-computed-properties-in-native-classes`.

### B3 — update a public enumeration · HIGH
- **Which one:** `lib/recommended-rules.js` gains `"ember/no-classic-components": "<off|error>"`.
- **Public or internal:** **public.** It is a generated *source* file, not a doc or test fixture:
  `lib/config/recommended.js` requires it and re-exports it as the plugin's `configs.recommended`
  rule set.
- **Ordering rule:** yes — the generator (`scripts/update-rules.js`) walks `readdirSync` of
  `lib/rules`, so the same alphabetical slot as B2.
- **Direction:** `lib/config/recommended.js` → `lib/recommended-rules.js` → (no further edge).

### B4 — preserve an existing signature · HIGH
- The rule-module contract must be honoured exactly: `scripts/update-rules.js` reads
  `rule.meta.docs.category`, `rule.meta.docs.recommended`, `rule.meta.docs.description`,
  `rule.meta.fixable` and `rule.meta.deprecated` unconditionally. A rule missing `meta.docs`
  breaks `npm run update` and the README table generator.
- `lib/index.js` keeps its `{ rules, configs, utils }` shape, and `plugin.utils.ember` /
  `plugin.utils.utils` keep object identity with `lib/utils/ember` and `lib/utils/utils`
  (asserted by `tests/plugin-exports.js`).

### B5 — update a public enumeration (category) · HIGH
`meta.docs.category` must be the existing string **`'Ember Octane'`**, already used by
`lib/rules/no-computed-properties-in-native-classes.js` and already a README section. A fresh
category string would create a new README section and a new table block.

### Low-confidence advisories
- **B-L1** · a dedicated Octane config ships in the same change (`lib/config/octane.js` plus a
  generated `lib/octane-rules.js`). The base tree has only `base` and `recommended`, and the
  issue asks only for the rule.
- **B-L2** · the recommended value is `"off"` (`recommended: false`), matching the other Octane
  rule. HIGH is claimed for the *presence* of the entry, not its value.
- **B-L3** · the rule also flags the sub-path imports `@ember/component/checkbox` and
  `@ember/component/text-field`.
- **B-L4** · `meta.fixable` stays `null` (no autofix, because the replacement is not mechanical).

**Not scored:** `docs/rules/no-classic-components.md`, the README rules-table row,
`tests/lib/rules/no-classic-components.js`, and the `tests/__snapshots__` recommended snapshot.

---

## Task C — `phpactor__phpactor-2001`

**Issue.** Complete attribute classes; the reporter asks which `Completor` should serve the
`#[...]` context — an existing one or a new one — and wants the suggestion list restricted to
`Attribute`s.

**Packages in play.** `Phpactor\Completion` (`lib/Completion`) is the library;
`Phpactor\Extension\CompletionWorse` (`lib/Extension/CompletionWorse`) is the wiring. The
repository is a monorepo whose `composer.json` `replace`s the sub-packages, so `lib/Completion`
is a published public namespace.

### C1 — author a new source module: **ASSERTED** · HIGH
- **Owning package:** `Phpactor\Completion`, under `lib/Completion/Bridge/TolerantParser/` —
  most likely `.../WorseReflection/AttributeCompletor.php`, because it needs both a
  `NameSearcher` for candidate names and a `Reflector` to decide whether a candidate is an
  attribute class. `DoctrineAnnotationCompletor` sits in that directory with exactly those two
  collaborators.
- **Public or internal:** **public.** It lives in the library's public namespace and is
  constructed by the extension.
- **Why it cannot live in an existing file:** every completion context in this codebase is its
  own class, and that is load-bearing rather than stylistic. `CompletionWorseExtension` registers
  each completor under a name and *derives from that name* a user-facing configuration key
  `completion_worse.completor.<name>.enabled`, a default, and a description. There is no
  mechanism to enable or disable a branch inside an existing completor. Separately,
  `ClassLikeCompletor` is the wrong host: its guard `CompletionContext::classLike()` recognises
  only `extends` / `implements` / `use` clauses, and its `resolveType()` return contract is
  `NameSearcherType::INTERFACE|CLASS_|TRAIT`, none of which describes an attribute position or
  the `#[Attribute]` filter.
- **Dependency direction:** the new module depends on
  `Phpactor\Completion\Bridge\TolerantParser\TolerantCompletor`,
  `Phpactor\Completion\Core\Suggestion`, `Phpactor\ReferenceFinder\NameSearcher` and
  `Phpactor\WorseReflection\Reflector`. Nothing inside `lib/Completion` depends on it; only the
  extension reaches it.

### C2 — update a public enumeration · HIGH
- **Which one:** `CompletionWorseExtension::getTolerantCompletors()` gains one entry — a name, a
  description string, and a closure returning the new completor — and it is registered with the
  `TAG_TOLERANT_COMPLETOR` tag.
- **Public or internal:** **public.** `configure()` maps that array into the configuration
  schema, so a new entry creates the user-visible setting
  `completion_worse.completor.<name>.enabled` (default `true`) and its description.
- **Ordering rule:** none. The array is not sorted; position affects only the order in which
  `ChainTolerantCompletor` yields suggestions.
- **Direction of the edge:** `Phpactor\Extension\CompletionWorse` → `Phpactor\Completion`. The
  extension depends on the library; the library must not learn about the extension.

### C3 — add a type predicate or guard · HIGH
- **What it narrows:** the node under the cursor is inside an attribute group — an ancestor is
  `Microsoft\PhpParser\Node\Attribute` (or `AttributeGroup`) — and the completor returns
  immediately in every other position, yielding nothing. Every completor in this package opens
  with such a guard (`CompletionContext::classLike`, `::expression`, `::useImport`, `::type`,
  `::classClause`, `::declaration`).
- **Where it belongs:** `Phpactor\Completion\Bridge\TolerantParser` — internal to the Completion
  package, either as a new static on `CompletionContext` or inline in the new completor.
  Confidence is HIGH on the guard existing, LOW on it being a `CompletionContext` static.

### C4 — preserve an existing signature · HIGH
- `TolerantCompletor::complete(Node $node, TextDocument $source, ByteOffset $offset): Generator`
  is implemented unchanged. `ChainTolerantCompletor` calls it and then reads
  `$suggestions->getReturn()`, so the generator must `return` a boolean completeness flag.
- Suggestions are produced through the existing
  `Suggestion::createWithOptions(string $name, array $options)` with the established option keys
  `type`, `priority`, `short_description`, `class_import`, `name_import`.

### Low-confidence advisories
- **C-L1** · a new `Suggestion::TYPE_*` constant for attributes. `TYPE_CLASS` is adequate and the
  Language Server Protocol completion-item kinds have no attribute member.
- **C-L2** · `NameSearcherType::ATTRIBUTE` is added to `Phpactor\ReferenceFinder\NameSearcherType`
  (today: `FUNCTION`, `CLASS_`, `INTERFACE`, `TRAIT`, `ENUM`). The index cannot support it as
  things stand: `Indexer\Model\Record\ClassRecord` stores only a `type` of class/interface/trait/
  enum, with no attribute flag.
- **C-L3** · new attribute-reflection surface in `Phpactor\WorseReflection` (for example
  `ReflectionClass::attributes()` plus a reflection value type). Not forced, because
  `ReflectionClassLike::sourceCode()` already gives a completor a cheap route to the `#[Attribute]`
  marker. **This is the single largest miss risk on this task and it is recorded as an advisory
  rather than an assertion.**
- **C-L4** · the accepted change completes class names in attribute position without filtering to
  `#[Attribute]`-marked classes at all in this first pass.
- **C-L5** · the completor is wrapped by `limitCompletor(...)` at registration, as the other
  name-searching completors are.

**Not scored:** the `doc/reference/completion.rst` section, the generated
`doc/reference/configuration.rst` entry, and the integration test under
`lib/Completion/Tests/Integration/`.

---

## Task D — `cyclonedx__cyclonedx-core-java-105`

**Issue.** A BOM carrying `<pedigree>` fails to deserialise. Jackson feeds the string
`"enhancement"` to `org.cyclonedx.model.Component$Type`. The library must deserialise every valid
example in the specification repository.

**Package under change.** `org.cyclonedx.model` in the published artefact
`org.cyclonedx:cyclonedx-core-java`.

**Root cause derived from the base tree.** `src/main/resources/bom-1.2.xsd` declares
`pedigreeType` with the sequence `ancestors, descendants, variants, commits, patches, notes`, and
declares `patchesType`, `patchType`, `patchClassification`, `diffType`, `issueType` and
`issueClassification`. `src/main/java/org/cyclonedx/model/Pedigree.java` has `ancestors`,
`descendants`, `variants`, `commits` and `notes` — and **no `patches`**. There is no Java class
for `patchType`, `diffType` or `issueType`. With `<patches>` unmodelled, the `type` attribute of
the nested `<issue>` is bound to the enclosing bean, which is the reported failure.

### D1 — author new source modules: **ASSERTED** · HIGH
- **Owning package:** `org.cyclonedx.model` (`src/main/java/org/cyclonedx/model/`).
- **Public or internal:** **public.** These are the library's serialised data model; consumers
  read and write them.
- **The types:** `Patch` (for `patchType`), `Issue` (for `issueType`), `Diff` (for `diffType`).
- **Why they cannot live in an existing file:** Jackson binds one bean per XML complexType and no
  existing bean has a property that can absorb them; Java additionally permits one public
  top-level class per file. `Issue`'s `source` is an anonymous inner complexType in the schema and
  may legitimately be a nested static class rather than its own file — exact filenames do not
  score.
- **Dependency direction:** `Pedigree` → `Patch` → { `Diff`, `Issue` }; `Diff` → `AttachmentText`
  (existing). Nothing existing depends on the new types except `Pedigree`. House convention has
  them extend `ExtensibleElement`, as `Pedigree` and `Commit` do.

### D2 — update a public enumeration · HIGH
Two new public value sets in `org.cyclonedx.model`, following the `Component.Type` pattern of an
enum constant per value with an `@JsonProperty` wire name:
- the patch classification — exactly `unofficial`, `monkey`, `backport`, `cherry-pick`;
- the issue classification — exactly `defect`, `enhancement`, `security`.

**`enhancement` belongs to the issue enumeration, not to `Component.Type`.** `Component.Type`
keeps its existing eight values (`application`, `framework`, `library`, `container`,
`operating-system`, `device`, `firmware`, `file`) and is **not** widened. This is the deciding
obligation of the task: the exception is `enhancement` reaching `Component$Type`, and the repair
is to give `<issue type=…>` its own binding target, not to admit the value where it does not
belong.

**Ordering rule:** none semantically; house style declares members in schema order.

### D3 — modify existing behaviour in place · HIGH
- **Where:** `org.cyclonedx.model.Pedigree` — public.
- **Change:** a `patches` property, `List<Patch>`, with the wrapper annotations
  `@JacksonXmlElementWrapper(localName = "patches")` and
  `@JacksonXmlProperty(localName = "patch")`, exactly as `commits` is already annotated; plus its
  getter, setter, and inclusion in `equals` and `hashCode`.
- **Observable change:** a BOM whose `<pedigree>` contains `<patches>` deserialises without a
  `ParseException` and round-trips through the generators.
- **Direction:** a new downward edge `Pedigree` → `Patch`, inside the model package.

### D4 — update a public enumeration (ordering) · HIGH
`Pedigree`'s `@JsonPropertyOrder` becomes
`{"ancestors", "descendants", "variants", "commits", "patches", "notes"}` — `patches` inserted
between `commits` and `notes`. **The ordering rule is the XSD `pedigreeType` sequence**; XML
output must follow it or generated BOMs stop validating against the schema.

### D5 — prove a wrong-kind input is rejected · HIGH
- **Input class:** a `type` attribute whose value is drawn from the issue or patch classification
  (`defect`, `enhancement`, `security`, `unofficial`, `monkey`, `backport`, `cherry-pick`) and
  appears anywhere beneath `<pedigree>`.
- **Expected behaviour:** it binds to the corresponding new enumeration and never reaches
  `Component.Type`. Presenting `enhancement` to `Component.Type` itself must still fail, because
  `Component.Type` is not extended.

### D6 — preserve an existing signature · HIGH
- `Component.getPedigree()` / `setPedigree(Pedigree)` unchanged.
- `Component.Type` and `Component.Scope` values unchanged.
- The parser entry points `XmlParser.parse(...)` and `JsonParser.parse(...)` and their overloads
  unchanged; `Parser` interface unchanged.
- `Pedigree`'s existing five accessors unchanged; only `equals` and `hashCode` widen.

### Low-confidence advisories
- **D-L1** · CycloneDX 1.3 support ships in the same change (`Version.VERSION_13`,
  `bom-1.3.xsd`, `bom-1.3.schema.json`, a `BomXmlGenerator13`, a new `NS_BOM_13`). The reporter's
  sample document is 1.3, but the defect reproduces on a 1.2 document and the library is pinned at
  `VERSION_LATEST = VERSION_12`, so 1.3 is a separate piece of work.
- **D-L2** · the new `patches` property carries `@VersionFilter(versions = {"1.2"})`, following
  `Component`'s house style for version-gated fields.
- **D-L3** · `Issue` carries a `references` list of URLs with a `references`/`url` wrapper pair.
- **D-L4** · the issue `source` is its own file rather than a nested static class.
- **D-L5** · a serializer or deserializer is added under `org.cyclonedx.util` for the `resolves`
  wrapper, as `ComponentWrapperDeserializer` exists for `ancestors` / `descendants` / `variants`.

**Not scored:** new sample BOMs under `src/test/resources` and the parser unit tests, which the
issue explicitly calls for ("Need to rework unit tests to account for all valid examples").

---

## Task E — `rrd108__vue-mess-detector-129`

**Issue.** The `functionSize` check takes about five seconds on one single-file component and can
freeze the run. The arrow-function branch is commented out. All checks should finish under one
second.

**Package under change.** `vue-mess-detector`, one npm package built by Vite to
`dist/vue-mess-detector.es.js` with a `vue-mess-detector` binary.

### E1 — new source module: **REFUSED** · HIGH
The accepted solution adds **no new source module**. The rule already exists at
`src/rules/rrd/functionSize.ts`; it is already enumerated in `src/rules/rules.ts` under the `rrd`
rule set; it is already imported by `src/rulesCheck.ts` (`checkFunctionSize`) and
`src/rulesReport.ts` (`reportFunctionSize`); and it is already documented at
`docs/rules/rrd/function-size.md`. The defect is a pattern inside one function of one file and
the repair is confined there. If a helper were extracted it has an existing home in
`src/helpers/index.ts`.

### E2 — modify existing behaviour in place · HIGH
- **Where:** `checkFunctionSize` in `src/rules/rrd/functionSize.ts` — package
  `vue-mess-detector`, **internal**: the package entry point is the CLI and the built bundle, not
  the individual rule modules.
- **Observable change:** the two patterns

  ```
  /function\s+([\w$]+)\s*\([^)]*\)\s*\{([^{}]*(([^{}]*\{[^{}]*\}[^{}]*)*[^{}]*))\}/g
  /const\s+([\w$]+)\s*=\s*\([^)]*\)\s*=>\s*\{([^{}]*(([^{}]*\{[^{}]*\}[^{}]*)*[^{}]*))\}/g
  ```

  are replaced by a formulation with no nested unbounded quantifier over the same character
  class. The body group `([^{}]*(([^{}]*\{[^{}]*\}[^{}]*)*[^{}]*))` nests `[^{}]*` inside a
  starred group whose body can itself match empty, which is the classic exponential-backtracking
  shape and is why one component costs seconds. Analysis of the reported file drops from about
  five seconds to under one second.
- **Direction:** leaf module. `src/rulesCheck.ts` → `functionSize.ts` and
  `src/rulesReport.ts` → `functionSize.ts`, both unchanged.

### E3 — modify existing behaviour in place (separable second change) · HIGH
- **Where:** the same function.
- **Observable change:** the arrow-function branch, currently disabled by
  `// TODO temporary switch off see #116`, is re-enabled, so
  `const dummyArrowFunction = (name) => { … }` over the limit is reported. The rule's own base
  test carries the matching assertion commented out with the same marker, and the documentation
  already promises "It handles regular and arrow functions". The issue instructs the reader to
  uncomment the check before reproducing.

### E4 — preserve an existing signature · HIGH
- The module's four exports keep their names and shapes: `MAX_FUNCTION_LENGTH: number`,
  `checkFunctionSize(script: SFCScriptBlock | null, filePath: string): void`,
  `reportFunctionSize(): Offense[]`, `resetFunctionSize(): void`. `rulesCheck.ts`,
  `rulesReport.ts` and the rule's test all bind to them by name.
- The emitted `Offense` is unchanged in shape and text: `rule` stays `rrd ~ function size`,
  `description` stays the `MAX_FUNCTION_LENGTH` sentence with its docs URL, `message` stays
  ``function (<name>) is too long 🚨``. The `Offense` interface in `src/types/index.ts` is
  untouched.
- The module keeps its accumulate-then-report shape: a module-level `results` array filled by
  `checkFunctionSize`, drained by `reportFunctionSize`, cleared by `resetFunctionSize`.

### No enumeration change
`RULES.rrd` in `src/rules/rules.ts` already lists `functionSize`. No rule-set enumeration,
no CLI flag and no docs index entry is added. Stated to make the refusal in E1 explicit; not
filed as a node.

### Low-confidence advisories
- **E-L1** · a shared brace-matching or function-extraction helper is factored out, either into
  the existing `src/helpers/index.ts` or into a new module at `src/rules/` level beside
  `getLineNumber.ts` and `asceeCodes.ts`. **Advisory only. This does not weaken the refusal in
  E1, which is the assertion for this task.**
- **E-L2** · a size or time guard that skips very large script blocks, instead of or as well as
  repairing the pattern.
- **E-L3** · the change also covers concise arrow bodies without braces, closing the existing
  `// TODO it does not match arrow functions with no curly braces`.
- **E-L4** · line counting changes by one at the boundary, moving `MAX_FUNCTION_LENGTH`
  semantics.
- **E-L5** · `magic-regexp` is used to express the replacement, as fifteen other rules already do.

---

## Summary of what is asserted

| task | new source module | other high-confidence nodes | low-confidence nodes |
|---|---|---|---|
| A `dataclasses-jsonschema-32` | **none** (refusal) | 4 | 4 |
| B `eslint-plugin-ember-551` | **1**, `lib/rules/`, public | 4 | 4 |
| C `phpactor-2001` | **1**, `Phpactor\Completion`, public | 3 | 5 |
| D `cyclonedx-core-java-105` | **3**, `org.cyclonedx.model`, public | 5 | 5 |
| E `vue-mess-detector-129` | **none** (refusal) | 3 | 5 |

Five new source modules asserted across three tasks; two tasks refused. Nineteen high-confidence
nodes in total, of which five are the module verdicts. Twenty-three low-confidence advisories,
which score in neither direction.

**Largest single risk to this lock:** C-L3. If the accepted phpactor change also adds attribute
reflection to `Phpactor\WorseReflection`, Task C misses a new source module and the slate fails on
requirement 1. It is filed as an advisory rather than an assertion because
`ReflectionClassLike::sourceCode()` already exists and makes the extra reflection surface
optional, and because asserting it when absent would be a high-confidence false positive under
requirement 4.
