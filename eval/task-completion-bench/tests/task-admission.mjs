// Unit tests for the TASK-ADMISSION BLOCKLIST — SLATE-B-UBER.md Phase 0 / §7.
//
// Entry point: `node tests/task-admission.mjs` (exit 1 on fail).
//
// The gate exists because two classes of task cannot measure anything: a
// zero-character issue, and a FAIL_TO_PASS that already passes at base so an EMPTY
// patch grades resolved. Both had already reached a published denominator once.
// These tests pin the two properties that make the gate worth having:
//   1. it cannot be switched off by NO_TASK_OVERRIDES=1 (separate file, separate loader)
//   2. SS_ALLOW_BLOCKED_TASKS=1 admits the blocked tasks for real — the admitted set
//      must not quietly drop them, or the override would silently become the gate
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admissionReport, loadBlocklist, vacuityMarkers, vacuityBlocklist } from '../harness/task-admission.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const work = mkdtempSync(path.join(tmpdir(), 'task-admission-'));

let ok = true;
const assert = (c, name, extra = '') => {
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra));
  if (!c) ok = false;
};

const BLOCK = {
  tasks: {
    'bad__empty-1': { reason: 'empty-issue', _why: 'zero-character statement', since: '2026-08-17' },
    'bad__vacuous-2': { reason: 'vacuous-f2p', _why: 'resolves with an empty patch', since: '2026-08-17' },
  },
};
const listPath = path.join(work, 'blocklist.json');
writeFileSync(listPath, JSON.stringify(BLOCK));

console.log('loader:');
{
  const m = loadBlocklist(listPath);
  assert(Object.keys(m).length === 2, 'reads the tasks map');
  assert(m['bad__empty-1'].reason === 'empty-issue', 'carries the reason code');
  assert(Object.keys(loadBlocklist(path.join(work, 'nope.json'))).length === 0,
    'a missing blocklist means nothing is blocked, not a crash');
}

console.log('\nimplicit selection (whole task file swept in):');
{
  const sel = ['good__a-1', 'bad__empty-1', 'good__b-2', 'bad__vacuous-2'];
  const r = admissionReport(sel, BLOCK.tasks, { explicit: false });
  assert(r.action === 'drop', 'action is drop');
  assert(r.admitted.length === 2, 'denominator shrinks to the valid tasks', JSON.stringify(r.admitted));
  assert(!r.admitted.includes('bad__empty-1') && !r.admitted.includes('bad__vacuous-2'),
    'neither blocked task survives');
  assert(r.reasons.length === 2 && r.reasons.every(x => x._why && x.reason),
    'every dropped task carries its evidence, so the shrink is never silent');
  assert(sel.length === 4, 'the caller\'s array is not mutated');
}

console.log('\nexplicit selection (task named by hand):');
{
  const r = admissionReport(['bad__empty-1'], BLOCK.tasks, { explicit: true });
  assert(r.action === 'refuse', 'naming a blocked task by name is a hard stop');
  const clean = admissionReport(['good__a-1'], BLOCK.tasks, { explicit: true });
  assert(clean.action === 'ok' && clean.admitted.length === 1,
    'an explicit selection of valid tasks is untouched');
}

console.log('\nSS_ALLOW_BLOCKED_TASKS override:');
{
  for (const explicit of [true, false]) {
    const r = admissionReport(['good__a-1', 'bad__empty-1'], BLOCK.tasks, { explicit, allow: true });
    assert(r.action === 'warn', `explicit=${explicit}: downgrades to warn`);
    assert(r.admitted.length === 2 && r.admitted.includes('bad__empty-1'),
      `explicit=${explicit}: the blocked task is really admitted, not silently dropped`);
    assert(r.reasons.length === 1, `explicit=${explicit}: still names what it admitted`);
  }
}

console.log('\nthe shipped blocklist:');
{
  const shipped = loadBlocklist(path.join(BENCH, 'harness/task-blocklist.json'));
  const ids = Object.keys(shipped);
  assert(ids.length >= 4, 'the known-invalid tasks are listed', ids.join(','));
  for (const id of ['dotnet__yarp-2825', 'mransan__ocaml-protoc-202', 'redboltz__mqtt_cpp-466', 'statamic__cms-9029'])
    assert(!!shipped[id], `${id} is blocked`);
  assert(ids.every(id => shipped[id]._why && shipped[id].reason && shipped[id].since),
    'every entry carries reason, evidence and a date');
}

console.log('\nthe gate cannot be turned off by a convenience switch:');
{
  // NO_TASK_OVERRIDES=1 exists to ignore task-overrides.json wholesale. If the
  // blocklist lived in that file, that switch would also disable the validity gate.
  const overrides = readFileSync(path.join(BENCH, 'harness/task-overrides.json'), 'utf8');
  assert(!/mransan__ocaml-protoc-202|redboltz__mqtt_cpp-466|statamic__cms-9029/.test(overrides),
    'no blocked task is carried in task-overrides.json');
  const pilot = readFileSync(path.join(BENCH, 'harness/run-pilot.mjs'), 'utf8');
  assert(/loadBlocklist\(BLOCKLIST_PATH\)/.test(pilot),
    'run-pilot loads the blocklist through its own loader');
  // Match the statement, not the prose around it — the comment above it legitimately
  // explains why NO_TASK_OVERRIDES must not reach here.
  const decl = pilot.split('\n').filter(l => /const TASK_BLOCKLIST\s*=/.test(l));
  assert(decl.length === 1 && !/NO_TASK_OVERRIDES/.test(decl[0]),
    'the blocklist load is not gated on NO_TASK_OVERRIDES', decl.join(' | '));
}

console.log('\nvacuity pre-screen (VACUITY-PRESCREEN-RESULTS.md):');
{
  // The two tasks a null arm independently proved vacuous, with their real recorded strings.
  const MQTT = { instance_id: 'redboltz__mqtt_cpp-466',
    FAIL_TO_PASS: JSON.stringify(['10/25 Test #10: pubsub ...........   Passed    0.68 sec']) };
  const CMS = { instance_id: 'statamic__cms-9029',
    FAIL_TO_PASS: ['it runs without hooks (3 ms)'] };
  assert(vacuityMarkers(MQTT).length > 0, 'recovers mqtt_cpp-466 — the ctest success marker');
  assert(vacuityMarkers(CMS).length > 0, 'recovers cms-9029 — the jest timing suffix');

  // Negatives: ordinary FAIL_TO_PASS entries in the formats this corpus actually uses.
  const NEGATIVES = [
    ['pytest', ['tests/test_foo.py::test_bar']],
    ['go', ['TestHandlerRejectsEmptyBody']],
    ['elixir', ['test type/1 accepts :integer (NimbleOptionsTest)']],
    ['lua busted', ['bufferline offsets the sidebar on the left']],
    ['rust', ['parser::tests::rejects_trailing_comma']],
  ];
  for (const [name, f2p] of NEGATIVES) {
    assert(vacuityMarkers({ instance_id: 'x', FAIL_TO_PASS: f2p }).length === 0,
      `no false alarm on a ${name} test name`, JSON.stringify(vacuityMarkers({ instance_id: 'x', FAIL_TO_PASS: f2p })));
  }

  // A format it cannot read must produce NO markers. Guessing would turn a parsing
  // problem into a validity claim, which is the failure mode of the FIRST version of
  // this screen (1 of 2 recovered, 5 false alarms, 8 of 18 unparseable).
  assert(vacuityMarkers({ instance_id: 'x', FAIL_TO_PASS: '{not json' }).length === 0,
    'an unparseable FAIL_TO_PASS yields no markers rather than a guess');
  assert(vacuityMarkers({ instance_id: 'x' }).length === 0, 'a missing FAIL_TO_PASS yields no markers');

  const derived = vacuityBlocklist([MQTT, CMS, { instance_id: 'good__a-1', FAIL_TO_PASS: ['test_ok'] }]);
  assert(Object.keys(derived).length === 2, 'only the flagged tasks become entries');
  assert(!derived['good__a-1'], 'a clean task is not blocked');
  assert(derived[MQTT.instance_id].reason === 'vacuous-f2p-prescreen', 'entries carry the pre-screen reason code');
  assert(/null arm is the authority/.test(derived[MQTT.instance_id]._why),
    'the entry states in its own evidence that it is a pre-filter, not the authority');
  assert(derived[MQTT.instance_id].since === '2026-08-21',
    'since records when the SIGNAL was established, not today, so a derived entry never looks fresh');

  // It has to travel the SAME path as the static blocklist, or a refusal would print
  // differently and be read differently.
  const r = admissionReport(['good__a-1', MQTT.instance_id], derived, { explicit: true });
  assert(r.action === 'refuse', 'naming a pre-screened task by hand is a hard stop, same as the static list');
  const swept = admissionReport(['good__a-1', MQTT.instance_id], derived, { explicit: false });
  assert(swept.action === 'drop' && swept.admitted.length === 1,
    'sweeping one in shrinks the denominator, loudly');
}

console.log('\nrun-pilot wires the pre-screen into the gate:');
{
  const pilot = readFileSync(path.join(BENCH, 'harness/run-pilot.mjs'), 'utf8');
  assert(/vacuityBlocklist\(selectedSpecs\)/.test(pilot), 'run-pilot derives the pre-screen from the SELECTED task specs');
  assert(/\{ \.\.\.prescreened, \.\.\.TASK_BLOCKLIST \}/.test(pilot),
    'the static blocklist wins a collision — a hand-written entry carries evidence a derived one cannot');
  assert(/admissionReport\(INSTANCES, MERGED_BLOCKLIST/.test(pilot),
    'the merged map is what the gate actually decides on');
}

rmSync(work, { recursive: true, force: true });
console.log(ok ? '\ntask-admission: all assertions passed' : '\ntask-admission: FAILURES');
process.exit(ok ? 0 : 1);
