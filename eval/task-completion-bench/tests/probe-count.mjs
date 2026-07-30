// Unit fixtures for the turn-economy A/B's operation counter (stats/probe-count.mjs).
// These LOCK THE DEFINITION of a "retrieval-and-test operation" before any paid run,
// because operations/task is a HARD REVERT GATE and a mis-count there silently
// invalidates the anti-shotgun conclusion.
//
// The counter's job: recover the number of retrieval/test operations from a shell
// string that the harness records as ONE tool envelope. Edits and non-retrieval shell
// count zero on BOTH arms — this is the anti-shotgun metric, not "all operations".
//
// `node tests/probe-count.mjs` — exit 1 on any failure. Offline, zero spend.
import { countProbes, splitShell } from '../stats/probe-count.mjs';

let failures = 0;
let n = 0;

function eq(actual, expected, label) {
  n++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
}

const probes = (cmd, want) => eq(countProbes(cmd), want, `countProbes(${JSON.stringify(cmd)})`);

// ── the shape the block actually asks for ────────────────────────────────────
probes('ss-grep "sym"', 1);
probes('ss-grep "sym"; ss-read src/x.rs 40 120', 2);
probes('ss-grep A; ss-read B; ss-search C', 3);
probes('ss-search "how does routing work"; ss-trace dispatch; ss-read a.go 1 60', 3);

// ── separators ───────────────────────────────────────────────────────────────
probes('ss-grep A && ss-read B', 2);
probes('ss-grep A || ss-read B', 2);
probes('ss-grep A\nss-read B', 2);

// ── quoting must not create phantom separators ───────────────────────────────
probes('ss-grep "a;b"', 1);
probes('ss-grep "a;b" ; ss-read C', 2);
probes("ss-grep 'x && y'", 1);
probes('ss-grep "a|b" | head -20', 1);          // a pipeline is ONE retrieval

// ── grouping: recursion, not opacity (regression: reported 1) ────────────────
probes('(ss-grep A; ss-read B) && ss-search C', 3);
probes('{ ss-grep A; ss-read B; }', 2);
probes('(ss-grep A)', 1);
probes('(cd src && ss-grep A); ss-read B', 2);

// ── env assignments and wrappers (regression: reported 1) ────────────────────
probes('X=1 ss-grep A; ss-read B', 2);
probes('FOO=bar BAZ=qux ss-search "x"', 1);
probes('timeout 60 ss-grep A', 1);
probes('timeout 60s ss-grep A; ss-read B', 2);
probes('env FOO=bar ss-search "x"', 1);
probes('command ss-grep A', 1);
probes('stdbuf -o0 ss-grep A', 1);
probes('/usr/bin/timeout 30 ss-grep A', 1);      // absolute-path wrapper

// ── quoting suppresses substitution (regression: reported 1) ─────────────────
probes("echo '$(ss-grep A)'", 0);            // single quotes: no substitution
probes('echo "$(ss-grep A)"', 1);            // double quotes: substitution happens
probes("X='a b' ss-grep A; ss-read B", 2);   // quoted assignment value
probes('X="a b" ss-grep A', 1);
probes("ss-grep 'literal $(not a call)'", 1);

// ── command substitution counts the inner retrieval too ──────────────────────
probes('ss-read "$(ss-grep -l foo)" 1 40', 2);
probes('echo "$(ss-grep A)"', 1);

// ── native-side retrieval counts identically (symmetry across arms) ──────────
probes('cat src/x.rs', 1);
probes('sed -n "1,40p" src/x.rs', 1);
probes('rg "sym" src', 1);
probes('grep -rn "sym" .', 1);
probes('cat a.py; sed -n "1,20p" b.py', 2);
probes('ls && ss-grep A', 2);                    // BOTH are retrieval operations

// ── non-retrieval shell counts ZERO on both arms ─────────────────────────────
probes('git log --oneline -5', 0);
probes('npm install', 0);
probes('cd src && npm test', 0);
probes('git log --oneline -5; git status', 0);
probes('', 0);
probes('   ', 0);

// ── run_tests is an operation ────────────────────────────────────────────────
probes('run_tests', 1);
probes('run_tests 2>&1 | tail -80', 1);
probes('ss-grep A; run_tests', 2);

// ── splitShell contract ──────────────────────────────────────────────────────
eq(splitShell('a; b && c || d'), ['a', 'b', 'c', 'd'], 'splitShell separators');
eq(splitShell('a "x; y" ; b'), ['a "x; y"', 'b'], 'splitShell quoted separator');
eq(splitShell('a | b'), ['a | b'], 'splitShell does not split pipes');
eq(splitShell('(a; b); c'), ['(a; b)', 'c'], 'splitShell keeps groups intact');

// ── the two documented un-handled forms: assert we KNOW we miss them ─────────
// Not bugs to fix silently — they are the audit boundary named in the header.
// If a pilot rollout contains one of these, it is hand-audited.
probes('eval "ss-grep A; ss-read B"', 0);        // eval-constructed: invisible, by design

console.log(`${n - failures}/${n} assertions passed`);
if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
