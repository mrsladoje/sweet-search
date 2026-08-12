// Unit tests for the GRADER TEST-COLLISION FIX (harness/patch-strip.mjs + its
// wiring in evaluator-runtime.gradeArm). PLAN.md gate 3' — "grader isolation for
// test paths".
//
// Standalone, offline, ZERO docker/API spend: eval.py is replaced by a stub that
// records exactly which patch text it was handed. `node tests/patch-strip.mjs` —
// exit 1 on any failure.
//
// The property that matters most is NARROWNESS: an agent edit to a test-shaped file
// the hidden patch does NOT touch must survive untouched. A blanket test-glob sweep
// would discard part of the legitimate fix surface on 8 of the 501 tasks in the
// current populations, which is why collision — not shape — is the default rule.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEvaluatorRuntime } from '../harness/evaluator-runtime.mjs';
import {
  STRIP_COLLISIONS_ON, TEST_GLOB_RE,
  blockPaths, patchPaths, splitDiffBlocks, stripCollidingPaths,
} from '../harness/patch-strip.mjs';

let ok = true;
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra));
  if (!c) ok = false;
};

// --- fixtures modelled on the two tasks the hole actually cost -----------------
// redboltz__mqtt_cpp-239: gold touches include/mqtt/{client,endpoint}.hpp; the
// hidden patch MODIFIES test/test_broker.hpp; the agent modified it too.
const mod = (p, body = '@@ -1,1 +1,1 @@\n-old\n+new\n') =>
  `diff --git a/${p} b/${p}\nindex 1111111..2222222 100644\n--- a/${p}\n+++ b/${p}\n${body}`;
// protofire__solhint-224: the hidden patch CREATES test/fixtures/order/*.js; the
// agent hand-typed files at the same paths.
const create = (p, body = '@@ -0,0 +1,1 @@\n+created\n') =>
  `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/${p}\n${body}`;
const del = (p) =>
  `diff --git a/${p} b/${p}\ndeleted file mode 100644\nindex 3333333..0000000\n--- a/${p}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n`;

console.log('diff parsing:');
{
  const patch = mod('include/mqtt/client.hpp') + mod('test/test_broker.hpp');
  const { preamble, blocks } = splitDiffBlocks(patch);
  assert(preamble === '' && blocks.length === 2, 'splits into one block per file', `${blocks.length}`);
  assert(preamble + blocks.join('') === patch, 'split is byte-lossless');
  assert([...blockPaths(blocks[0])][0] === 'include/mqtt/client.hpp', 'reads the modified path');
  assert([...blockPaths(splitDiffBlocks(create('a/b/c.js')).blocks[0])].join() === 'a/b/c.js',
    'new-file block resolves its path despite /dev/null on the --- side');
  assert([...blockPaths(splitDiffBlocks(del('old/gone.js')).blocks[0])].join() === 'old/gone.js',
    'deleted-file block resolves its path despite /dev/null on the +++ side');
  const rename = 'diff --git a/old/x.js b/new/x.js\nsimilarity index 100%\nrename from old/x.js\nrename to new/x.js\n';
  const rp = [...blockPaths(splitDiffBlocks(rename).blocks[0])].sort();
  assert(rp.join() === 'new/x.js,old/x.js', 'a rename block reports BOTH sides', rp.join());
  const modeOnly = 'diff --git a/tools/run.sh b/tools/run.sh\nold mode 100644\nnew mode 100755\n';
  assert([...blockPaths(splitDiffBlocks(modeOnly).blocks[0])].join() === 'tools/run.sh',
    'header-less (mode-only) block falls back to the diff --git line');
  // A hunk body containing +++/--- text must not be mistaken for a file header.
  const tricky = mod('src/a.py', '@@ -1,2 +1,2 @@\n-print("--- a/evil")\n+print("+++ b/evil")\n');
  assert([...blockPaths(splitDiffBlocks(tricky).blocks[0])].join() === 'src/a.py',
    'header scan stops at @@ — hunk content cannot inject a path');
  assert(patchPaths(patch).size === 2, 'patchPaths unions across blocks');
  assert(splitDiffBlocks('').blocks.length === 0 && patchPaths('').size === 0, 'empty patch is empty');
}

console.log('\ncollision stripping (the default rule):');
{
  // (1) collision by MODIFY — redboltz__mqtt_cpp-239
  const agent = mod('include/mqtt/client.hpp') + mod('test/test_broker.hpp');
  const hidden = mod('test/test_broker.hpp', '@@ -5,1 +5,3 @@\n-x\n+y\n+z\n');
  const r = stripCollidingPaths(agent, hidden);
  assert(r.stripped.join() === 'test/test_broker.hpp', 'MODIFY collision is stripped', r.stripped.join());
  assert(r.patch === mod('include/mqtt/client.hpp'), 'the rest of the patch survives byte-exactly');
  assert(r.reasons['test/test_broker.hpp'] === 'collides-with-hidden-test-patch', 'reason is recorded');

  // (2) collision by CREATE-vs-CREATE — protofire__solhint-224
  const agent2 = mod('lib/rules/order/ordering.js')
    + create('test/fixtures/order/ordering-correct.js')
    + create('test/fixtures/order/ordering-incorrect.js');
  const hidden2 = create('test/fixtures/order/ordering-correct.js')
    + create('test/fixtures/order/ordering-incorrect.js')
    + create('test/rules/order/ordering.js');
  const r2 = stripCollidingPaths(agent2, hidden2);
  assert(r2.stripped.join(',') === 'test/fixtures/order/ordering-correct.js,test/fixtures/order/ordering-incorrect.js',
    'both CREATE collisions are stripped', r2.stripped.join(','));
  assert(r2.patch === mod('lib/rules/order/ordering.js'), 'the real fix survives');

  // (3) NARROWNESS — a test-shaped file the hidden patch does not touch is KEPT
  const agent3 = mod('src/lib.rs') + mod('tests/unrelated_test.rs');
  const r3 = stripCollidingPaths(agent3, mod('tests/other_test.rs'));
  assert(r3.stripped.length === 0 && r3.patch === agent3,
    'a test-file edit NOT touched by the hidden patch is preserved verbatim');

  // (4) NON-TEST collision — e.g. Sources/MapboxDirections/RouteStep.swift, a real
  // source path that a hidden test patch does touch in the reserve population.
  const agent4 = mod('Sources/MapboxDirections/RouteStep.swift') + mod('Sources/Other.swift');
  const r4 = stripCollidingPaths(agent4, mod('Sources/MapboxDirections/RouteStep.swift'));
  assert(r4.stripped.join() === 'Sources/MapboxDirections/RouteStep.swift',
    'a NON-test collision path is stripped too (hidden patch is authoritative for that file)');
  assert(r4.patch === mod('Sources/Other.swift'), 'the non-colliding source edit survives');

  // (5) rename collision — the agent renames a file the hidden patch modifies
  const agent5 = 'diff --git a/test/t.js b/test/renamed.js\nsimilarity index 100%\nrename from test/t.js\nrename to test/renamed.js\n';
  assert(stripCollidingPaths(agent5, mod('test/t.js')).stripped.includes('test/t.js'),
    'a rename whose SOURCE collides is stripped');

  // (6) empty after strip
  const r6 = stripCollidingPaths(mod('test/only.js'), mod('test/only.js'));
  assert(r6.patch.trim() === '' && r6.stripped.join() === 'test/only.js',
    'stripping every block yields an empty patch (graded as the zero-hunk case)');

  // (7) no-ops must be byte-identical passthroughs
  const clean = mod('src/a.py') + mod('src/b.py');
  assert(stripCollidingPaths(clean, mod('tests/t.py')).patch === clean, 'no collision → byte-identical patch');
  assert(stripCollidingPaths(clean, '').patch === clean, 'empty hidden patch → passthrough');
  assert(stripCollidingPaths('', mod('x')).patch === '' , 'empty agent patch → passthrough');
  assert(stripCollidingPaths(clean, mod('tests/t.py'), { enabled: false }).patch === clean,
    'disabled (SS_GRADE_STRIP_COLLISIONS=0) → passthrough');
  assert(STRIP_COLLISIONS_ON === true, 'the mechanism is ON by default');
}

console.log('\nbroad test-glob mode (opt-in, default OFF):');
{
  const agent = mod('src/lib.rs') + mod('tests/unrelated_test.rs') + create('spec/foo_spec.rb');
  const off = stripCollidingPaths(agent, mod('tests/other_test.rs'));
  assert(off.patch === agent, 'default leaves test-shaped non-colliding files alone');
  const on = stripCollidingPaths(agent, mod('tests/other_test.rs'), { testGlobs: true });
  assert(on.stripped.join(',') === 'spec/foo_spec.rb,tests/unrelated_test.rs',
    'testGlobs:true also strips test-shaped paths', on.stripped.join(','));
  assert(on.reasons['tests/unrelated_test.rs'] === 'test-glob', 'glob strips carry a distinct reason');
  assert(on.patch === mod('src/lib.rs'), 'source files still survive under the broad mode');
  assert(TEST_GLOB_RE.test('test/fixtures/order/x.js') && TEST_GLOB_RE.test('a/b_test.go')
    && !TEST_GLOB_RE.test('lib/latest/index.js'), 'glob matches test dirs/suffixes, not "latest"');
}

// --- gradeArm integration: both arms, row stamping, stub evaluator ------------
console.log('\ngradeArm wiring (stub evaluator, both arms):');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'patch-strip-'));
  const fakeEval = path.join(dir, 'srv2');
  mkdirSync(path.join(fakeEval, 'scripts'), { recursive: true });
  mkdirSync(path.join(fakeEval, 'lib'), { recursive: true });
  // Stub eval.py: echoes back the patch text it was handed so the test can assert
  // on exactly what the grader would have applied.
  writeFileSync(path.join(fakeEval, 'scripts/eval.py'), [
    'import argparse, json',
    'from pathlib import Path',
    'p = argparse.ArgumentParser()',
    'p.add_argument("--json", required=True); p.add_argument("--patches", required=True)',
    'p.add_argument("--max-workers", type=int); p.add_argument("--report-json", required=True)',
    'p.add_argument("--network")',
    // The grader must re-apply install_config's working-tree sed steps; without the flag the
    // container reverts the image author's SDK/TFM pins and no test can run (see D-1).
    'p.add_argument("--reapply-install-seds", action="store_true", required=True)',
    'a = p.parse_args()',
    'patches = json.loads(Path(a.patches).read_text())',
    'Path("seen.json").write_text(json.dumps(patches))',
    // n_test_results > 0: this fixture is about patch stripping, so it must clear the
    // test-evidence tripwire rather than trip it.
    'items = [{"instance_id": x["instance_id"], "from_fail_to_pass": ["t"], "n_test_results": 7,',
    '          "failed_from_pass_to_pass": [], "error": ""} for x in patches]',
    'Path(a.report_json).write_text(json.dumps({"total": len(items), "all_ok": True, "items": items}))',
    '',
  ].join('\n'));

  const taskById = new Map([
    ['redboltz__mqtt_cpp-239', {
      instance_id: 'redboltz__mqtt_cpp-239', FAIL_TO_PASS: ['t'], PASS_TO_PASS: [],
      test_patch: mod('test/test_broker.hpp'),
    }],
    ['clean__task-1', {
      instance_id: 'clean__task-1', FAIL_TO_PASS: ['t'], PASS_TO_PASS: [],
      test_patch: mod('tests/untouched.py'),
    }],
  ]);
  const runtime = createEvaluatorRuntime({
    benchDir: dir, dataset: 'unused', defaultTestTimeoutSec: 1, dockerHost: 'unused',
    dockerNetArgs: () => '', imageNameFor: () => 'unused', netLockdown: true,
    shellQuote: v => v, srEvalDir: fakeEval,
    srEvalRunner: path.join(fakeEval, 'scripts/eval.py'), srMode: true, taskById,
    taskOverrides: { defaults: {}, tasks: {} }, venvPython: process.env.PYTHON || 'python3',
  });

  const agentPatch = mod('include/mqtt/client.hpp') + mod('test/test_broker.hpp');
  const cleanPatch = mod('src/ok.py');
  const reports = {};
  for (const arm of ['native', 'sweet']) {
    reports[arm] = runtime.gradeArm(arm, [
      { instance_id: 'redboltz__mqtt_cpp-239', model_name_or_path: arm, model_patch: agentPatch },
      { instance_id: 'clean__task-1', model_name_or_path: arm, model_patch: cleanPatch },
    ], 'unit-run');
  }

  for (const arm of ['native', 'sweet']) {
    const sp = reports[arm].stripped_paths || {};
    assert(sp['redboltz__mqtt_cpp-239']?.join() === 'test/test_broker.hpp',
      `[${arm}] report stamps the stripped path`, JSON.stringify(sp));
    assert(!('clean__task-1' in sp), `[${arm}] a non-colliding task is NOT stamped`);
    const seen = JSON.parse(readFileSync(path.join(dir, 'results/unit-run', arm, 'seen.json'), 'utf8'));
    const byId = Object.fromEntries(seen.map(x => [x.instance_id, x.patch]));
    assert(byId['redboltz__mqtt_cpp-239'] === mod('include/mqtt/client.hpp'),
      `[${arm}] the evaluator received the STRIPPED patch`);
    assert(byId['clean__task-1'] === cleanPatch, `[${arm}] the clean patch reached the evaluator verbatim`);
  }
  assert(JSON.stringify(reports.native.stripped_paths) === JSON.stringify(reports.sweet.stripped_paths),
    'both arms are treated identically (symmetry)');

  // A prediction that is ENTIRELY stripped must fall through to the ordinary
  // zero-hunk path, not a special case.
  const emptied = runtime.gradeArm('sweet', [
    { instance_id: 'redboltz__mqtt_cpp-239', model_name_or_path: 'sweet', model_patch: mod('test/test_broker.hpp') },
  ], 'unit-run-empty');
  assert(emptied.resolved_instances === 0 && emptied.total_instances === 1,
    'emptied patch grades as the zero-hunk case', JSON.stringify(emptied));
  assert(emptied.stripped_paths['redboltz__mqtt_cpp-239']?.join() === 'test/test_broker.hpp',
    'the emptied task is still stamped');

  rmSync(dir, { recursive: true, force: true });
}

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
