#!/usr/bin/env node
// HINT LADDER — does ANY amount of delivered information raise resolution?
//
// Every W0 gate so far has answered "could a tool derive the right fact at $0?" and the
// answer has repeatedly been yes. None of them answered the question that decides whether
// any of these tools is worth building: WHEN THE MODEL IS HANDED THE FACT, DOES THE TASK
// FLIP? P4 ended on exactly that gap — all six sweet+native cells had the state machine
// file in reach and still wrote the same one-quadrant patch.
//
// So this script builds derived task files that append an analysis block to the issue text
// and nothing else. `TASKS_FILE` already feeds `problem_statement` straight into the prompt,
// so no harness code changes and no ledger re-sweep is implied.
//
// THREE CONDITIONS, and they are conditions, not a monotone ladder. On Apple the blind
// certificate is already MORE specific than the file-and-symbol list, because the checker
// names states while localisation only names a function.
//
//   L0  baseline          nothing appended. Reproduces the recorded 0/2.
//   L1  blind certificate what a $0 analyzer can emit from the base tree + issue ALONE.
//                         Every line below is checked to be derivable without the reference
//                         patch and without any test. This is the shippable rung.
//   L2  localisation      the files and symbols the reference patch touches, with no
//                         semantics. GOLD-DERIVED — an upper bound, never a product.
//   L3  specification     prose statement of the required behaviour, still no code.
//                         GOLD-DERIVED — the ceiling probe.
//
// Reading it: a target that will not flip at L3 cannot be bought with retrieval at all, and
// its ceiling in the slate arithmetic is fictional. A target that flips at L1 is a tool
// worth building. A target that flips only at L2/L3 tells you which half of the gap is
// retrieval and which half is execution.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const HEAD = '\n\n=== REPOSITORY ANALYSIS (produced by static tooling from the code at this commit) ===\n';

export const HINTS = {

  // ---------------------------------------------------------------- Apple (P4 state space)
  'apple__swift-nio-http2-145': {
    L1: `ss-statecheck — Sources/NIOHTTP2/StreamStateMachine.swift

Two structural invariants hold over every operation in this file. Both are read off the
file itself; neither is an HTTP/2 policy decision.

1. MIRROR. Each \`sendX\` and its twin \`receiveX\` permit exactly reflected sets of states
   under the substitution Local<->Remote, Peer<->Local. At this commit sendHeaders /
   receiveHeaders, sendData / receiveData and sendPushPromise / receivePushPromise are all
   mirror-exact. A state added to one member of a pair must have its mirror added to the
   other, or the pair stops being a reflection.

2. END-OF-STREAM AXIS. The transitions the file performs under \`if endStream\` make
   halfOpenLocalPeerIdle and halfClosedLocalPeerIdle siblings, and likewise
   halfOpenRemoteLocalIdle and halfClosedRemoteLocalIdle. An operation that already admits
   both endpoints of one such transition is insensitive to that axis, so admitting one
   sibling while rejecting the other is an inconsistency rather than a policy.

Counterexamples the checker reports for a patch that widens receivePushPromise by a single
state (the shape every previous attempt on this issue produced):

  [class] receivePushPromise admits halfClosedLocalPeerIdle but rejects
          halfOpenLocalPeerIdle; the two differ only by a locally sent END_STREAM, an axis
          this operation is insensitive to.
          reachable by: idle(localRole: .client) --sendHeaders--> halfOpenLocalPeerIdle

  [mirror] receivePushPromise admits halfClosedLocalPeerIdle, but its twin sendPushPromise
          rejects the reflected state halfClosedRemoteLocalIdle. The two allow-sets are
          exact mirrors in the base tree, so one side moved alone.

A change that satisfies both invariants must handle four states, not one:
halfClosedLocalPeerIdle and halfOpenLocalPeerIdle on the receive side, and their
reflections halfClosedRemoteLocalIdle and halfOpenRemoteLocalIdle on the send side.`,

    L2: `The accepted change is confined to one file, Sources/NIOHTTP2/StreamStateMachine.swift,
and to two functions in it: \`receivePushPromise\` and \`sendPushPromise\`. No other file, type
or function is touched. Both functions are widened; neither is left alone.`,

    L3: `A stream that has finished sending its own request body is still allowed to receive a
server push, and symmetrically a server that has finished receiving a request body may still
send one. Push promises must therefore be permitted not only while the stream is fully open,
but also after the local side has half-closed, and in both the responder-idle and
responder-active positions. Both directions of the operation must be widened together and by
the same four-quadrant shape.`,
  },

  // ---------------------------------------------------------- CodeceptJS (P6 public surface)
  'codeception__codeceptjs-367': {
    L1: `ss-surface-probe — public actor surface

- The \`I\` object's public surface is assembled in \`lib/actor.js\`, inside
  \`module.exports = function (obj)\`. Only keys assigned onto \`obj\` in that function are
  visible as \`I.<name>\`. Methods defined on a Helper class reach the actor through
  \`methodsOfObject(helper, 'Helper')\` and remain owned by the helper; a helper method is
  NOT the same public surface as an actor key.
- Ordered, deferred execution is provided by \`recorder.add(name, fn)\`. Every existing actor
  method is queued through it by \`recordStep\`. Anything that must appear "at the intuitive
  time" instead of immediately has to be queued with \`recorder.add\`, not called directly.
- This repository already owns a user-facing print verb. \`lib/output.js\` exports
  \`say(message)\`. There is no \`comment\` and no \`remark\` anywhere in the public surface.
  When a project already has a name for a concept, its public API extends that name rather
  than introducing a synonym for it.`,

    L2: `The accepted change adds a single public member in \`lib/actor.js\`: one assignment onto
the \`obj\` the module returns, placed after the helper-method loop and before \`return obj\`.
It uses \`recorder\` and the \`output\` module. No Helper class is modified.`,

    L3: `Give the actor a print method that is queued into the step recorder rather than run
immediately, so its message appears in output in the same order as the surrounding \`I.\`
steps. Name it with the verb the project already uses for printing to the user, and
implement it by queueing that existing output function. It is a method on the actor object
itself, not on any helper, and it must be an ordinary enumerable property.`,
  },

  // -------------------------------------------------------- NimbleOptions (P2 family residue)
  'dashbitco__nimble_options-43': {
    L1: `ss-residue — family completeness for lib/nimble_options.ex

The nearest existing member of the family you are extending is \`:non_neg_integer\`. It
occurs at exactly three sites in lib/nimble_options.ex, and every other supported type atom
occurs at the same three:

  1. the documentation list of supported types      ("* \`:non_neg_integer\` - A non-negative integer.")
  2. the module's list of valid type atoms
  3. a \`defp validate_type(...)\` clause that returns the error tuple for a bad value

A patch that introduces a new type and touches fewer than all three of these sites is
incomplete: a type missing from site 2 is rejected as unknown, and a type missing from
site 3 is accepted without ever being validated.`,

    L2: `The accepted change touches one file, lib/nimble_options.ex, at three places: the
documentation list of supported types, the list of valid type atoms, and a new
\`defp validate_type/3\` clause. No other file changes.`,

    L3: `Add a plain \`:integer\` type alongside the existing \`:non_neg_integer\` and
\`:pos_integer\`. It must be documented, accepted as a valid type atom, and validated by its
own clause that returns an error tuple when the value is not an integer, with a message of
the same shape as its neighbours.`,
  },

  // ------------------------------------------------------------- bingo (P5 artifact graph)
  'joshuakgoldberg__bingo-274': {
    L1: `ss-author-api — artifact graph for this monorepo

Convention, read off the packages at this commit: ONE PUBLIC EXPORT PER MODULE FILE,
re-exported from the owning package's barrel.

  packages/bingo-fs/src/index.ts          export * from "./intake.js"; export type * from "./types.js";
  packages/bingo-fs/src/                  intake.ts, isModeExecutable.ts, types.ts
  packages/bingo-handlebars/src/index.ts  export * from "./handlebars.js"; export * from "./loadHandlebars.js";

A new public capability is therefore TWO artifacts, not one: a new module file, and a new
\`export *\` line in that package's index.ts. A function added to an existing module without
a barrel line is not importable by consumers, and a barrel line without its own module
breaks the one-export-per-file convention every other file in these packages follows.

Ownership follows the types. \`CreatedEntry\`, \`CreatedDirectory\` and \`CreatedFile\` are
declared in packages/bingo-fs/src/types.ts, so a predicate over those types belongs in
\`bingo-fs\`. A capability that wraps \`handlebars()\` belongs in \`bingo-handlebars\`.`,

    L2: `The accepted change creates three new module files and adds their barrel lines:
\`packages/bingo-fs/src/isFile.ts\` (exported from packages/bingo-fs/src/index.ts),
\`packages/bingo-handlebars/src/handlebarsDirectory.ts\` and
\`packages/bingo-handlebars/src/handlebarsFile.ts\`. It also edits
\`packages/bingo-handlebars/src/handlebars.ts\` and \`executeTemplatesRecursive.ts\`.
Consumers import the new helpers by name from the package root.`,

    L3: `Provide dedicated file and directory forms of \`handlebars()\` that narrow its
\`CreatedEntry | undefined\` result, so a producer can pass one straight to \`files\` without
an \`as\` assertion. Each throws if the template produced the wrong kind of entry. The
predicate that distinguishes a created file from a created directory is a shared filesystem
concern and belongs in the filesystem package next to the types it tests, exported from that
package's public root under a name that reads as a type predicate on an entry.`,
  },

  // -------------------------------------------------------------- dart http (P7 impact)
  'dart-lang__http-1114': {
    L1: `ss-trace BaseResponse impact — pkgs/http

\`BaseResponse\` (pkgs/http/lib/src/base_response.dart) is abstract and has two direct
subclasses in this repository:
  pkgs/http/lib/src/response.dart:16           class Response extends BaseResponse
  pkgs/http/lib/src/streamed_response.dart:11  class StreamedResponse extends BaseResponse
Both forward to the base constructor, and both are re-exported to consumers.

Adding an abstract or required member to \`BaseResponse\` forces an edit in every subclass
and in every downstream implementor outside this repository, which is a breaking change for
a published package. Dart's \`extension\` adds a public member to an existing type with zero
subclass edits and no breaking change, and is the mechanism this package should reach for
when the new member can be computed from data the base class already holds.

\`BaseResponse\` already holds the raw \`Map<String, String> headers\`, so the requested view
is derivable without touching either subclass.

Public surface: pkgs/http/lib/http.dart currently re-exports the whole module with
\`export 'src/base_response.dart';\`. A \`show\` list controls what consumers actually see, and
must name any new public type.`,

    L2: `The accepted change touches four files, but only one carries logic:
\`pkgs/http/lib/src/base_response.dart\` (+68/-1). The others are
\`pkgs/http/lib/http.dart\` (its export line), \`pkgs/http/CHANGELOG.md\` and
\`pkgs/http/pubspec.yaml\` (a minor version bump). Neither \`response.dart\` nor
\`streamed_response.dart\` is modified.`,

    L3: `Expose the response headers as \`Map<String, List<String>>\` by splitting each raw
header value on commas, as an extension on \`BaseResponse\` rather than a change to the class
itself. \`set-cookie\` cannot use the plain comma rule, because cookie values legitimately
contain commas in dates and paths; split it only where a comma is followed by a valid RFC
2616 token and an equals sign. Values with no comma become single-element lists. Export the
new extension type by name from the package's public library.`,
  },
};

// ------------------------------------------------------------------------------ generation

const LEVELS = ['L0', 'L1', 'L2', 'L3'];

export function buildTasks(specs, level, targets) {
  return specs.map((t) => {
    if (level === 'L0' || !targets.includes(t.instance_id)) return t;
    const h = HINTS[t.instance_id]?.[level];
    if (!h) throw new Error(`no ${level} hint for ${t.instance_id}`);
    return { ...t, problem_statement: `${t.problem_statement || ''}${HEAD}${h}\n` };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.env.SRC
    || '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json';
  const out = process.env.OUT_DIR || '/root/hint-ladder';
  const targets = Object.keys(HINTS);
  const specs = JSON.parse(readFileSync(src, 'utf8'));
  mkdirSync(out, { recursive: true });
  for (const lvl of LEVELS) {
    const built = buildTasks(specs, lvl, targets);
    writeFileSync(path.join(out, `tasks-${lvl}.json`), JSON.stringify(built, null, 1));
    const grew = built.filter((t, i) => t.problem_statement !== specs[i].problem_statement);
    console.log(`${lvl}  ${built.length} tasks, ${grew.length} carrying a hint`
      + (grew.length ? `  (+${grew.reduce((a, t, i) => a + t.problem_statement.length, 0)
        - specs.filter(s => targets.includes(s.instance_id)).reduce((a, s) => a + (s.problem_statement || '').length, 0)} chars)` : ''));
  }
  console.log(`\ntargets: ${targets.join(', ')}`);
}
