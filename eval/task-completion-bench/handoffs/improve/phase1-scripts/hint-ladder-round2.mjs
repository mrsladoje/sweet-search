#!/usr/bin/env node
// ROUND 2 — four follow-ups the first ladder round earned.
//
// Round 1 result that drives all of this: the blind certificate flipped Apple 0/3 -> 4/4 and
// CodeceptJS not at all, but the CodeceptJS failure changed SHAPE. At baseline every rollout
// put a `comment()` method on the wrong object in the wrong file. With the certificate all
// four rollouts wrote the right name, in the right file, through the right queue — and then
// attached it with `Object.defineProperty`, which is non-enumerable by default, and two of
// them set `enumerable: false` outright. The grader wants the actor's enumerable keys. The
// certificate carried every static fact and stopped one fact short of the answer, and the
// fact it lacked is a RUNTIME property of the object, which is exactly what P6 claims only a
// runtime probe can see. NimbleOptions moved the same way: all four rollouts hit the three
// residue sites, then three of them added a fourth, unrequested edit that broke the suite.
//
//   LP    placebo. The same tool, the same format, the same length, aimed at a file the fix
//         does not touch. If Apple flips on this too, the flip was attention, not content,
//         and the whole result dies. This is the control the headline stands on.
//   L1R   Apple's certificate with the derived counterexamples REMOVED, leaving only the two
//         rules. Separates "state the symmetry" from "compute the closure" — the first is a
//         sentence, the second is the tool.
//   L1P   the certificate PLUS the one runtime fact it was missing. For CodeceptJS that is
//         enumerability; for bingo, that a barrel line is what makes an export importable at
//         all. If this flips CodeceptJS, P6 is bought and its price is one runtime probe.
//   (the fourth follow-up needs no new text: rerun L1 with the stop-at-first-green frame
//    clause, which targets NimbleOptions' fourth-edit self-break.)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { HINTS } from './hint-ladder.mjs';

const HEAD = '\n\n=== REPOSITORY ANALYSIS (produced by static tooling from the code at this commit) ===\n';

// ---------------------------------------------------------------------------- LP (placebo)
// True, derived, same shape, same tool, wrong file. ConnectionStateMachine.swift is where
// the P4 rotation census found eight armed mirror pairs and zero findings: a real, clean
// report about code the reference fix never touches.
const PLACEBO = {
  'apple__swift-nio-http2-145': `ss-statecheck — Sources/NIOHTTP2/ConnectionStateMachine/ConnectionStateMachine.swift

This file is the connection-level state machine. The checker reads 19 operations that switch
on the stored connection state, and applies the same two invariants it applies everywhere.

1. MIRROR. Each \`sendX\` and its twin \`receiveX\` must permit exactly reflected sets of
   states under the substitution of the two peer roles. Eight such pairs are armed here —
   they are already exact mirrors of each other in the code as written, so the rule is in
   force for all eight and any future change to one side must be matched on the other.

2. END-OF-STREAM AXIS. Not derivable in this file: none of its operations perform a
   transition under an end-of-stream condition, so there are zero sibling edges to hold any
   operation to, and the axis rule is inactive here.

Counterexamples reported at this commit: none. All eight armed mirror pairs are exact, and no
operation is inconsistent with any state reachable from the connection's initial state. The
connection-level state machine is internally consistent as written and needs no change under
either invariant.`,
};

// ------------------------------------------------------------------- L1R (rules, no closure)
const RULES_ONLY = {
  'apple__swift-nio-http2-145': `ss-statecheck — Sources/NIOHTTP2/StreamStateMachine.swift

Two structural invariants hold over every operation in this file. Both are read off the file
itself; neither is an HTTP/2 policy decision.

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

Check your change against both invariants before you submit.`,
};

// ------------------------------------------------- L1P (certificate + the one runtime fact)
const RUNTIME_ADDENDUM = {
  'codeception__codeceptjs-367': `

RUNTIME SURFACE (observed by loading the public factory in a local process, before and after
a change — this cannot be read off the source):
- The actor's public contract is its set of ENUMERABLE own keys. Every method the helper loop
  installs today is a plain assignment \`obj[action] = ...\`, so every one of them is
  enumerable, and \`Object.keys(I)\` is the surface consumers and conformance checks see.
- \`Object.defineProperty\` defaults \`enumerable\` to FALSE. A member installed that way is
  callable but absent from \`Object.keys\`, from spreads and from any exact-key comparison, so
  it is not on the public surface even though it works when called.
- Therefore add the new member the same way the existing ones are added: a direct assignment
  onto \`obj\`. If you use \`Object.defineProperty\`, you must pass \`enumerable: true\`.`,

  'joshuakgoldberg__bingo-274': `

RUNTIME SURFACE (observed by resolving the package entry point, before and after a change):
- What a consumer can import from a package is exactly what its \`src/index.ts\` re-exports.
  A symbol declared in a module that no barrel line names is unreachable from outside the
  package, whatever its \`export\` keyword says, and a test that imports it by name from the
  package root fails to resolve rather than failing an assertion.
- A widened return type or an added overload signature on an existing function changes no
  importable name. If the capability is meant to be called by name, it must exist as a name.`,
};

const LEVELS = {
  LP: (id) => PLACEBO[id],
  L1R: (id) => RULES_ONLY[id],
  L1P: (id) => (HINTS[id]?.L1 && RUNTIME_ADDENDUM[id]) ? HINTS[id].L1 + RUNTIME_ADDENDUM[id] : null,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.env.SRC
    || '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json';
  const out = process.env.OUT_DIR || '/root/hint-ladder';
  const specs = JSON.parse(readFileSync(src, 'utf8'));
  mkdirSync(out, { recursive: true });
  for (const [lvl, get] of Object.entries(LEVELS)) {
    const built = specs.map((t) => {
      const h = get(t.instance_id);
      return h ? { ...t, problem_statement: `${t.problem_statement || ''}${HEAD}${h}\n` } : t;
    });
    writeFileSync(path.join(out, `tasks-${lvl}.json`), JSON.stringify(built, null, 1));
    const ids = specs.filter(t => get(t.instance_id)).map(t => t.instance_id);
    console.log(`${lvl.padEnd(4)} carries a hint on: ${ids.join(', ') || '(none)'}`);
  }
}
