// Frame fairness + bracket invariants for the task-completion harness.
// Standalone (no test runner): `node tests/frame-invariants.mjs` — exit 1 on fail.
// Guards the publishable claim that the ONLY system-prompt asymmetry between the
// native and sweet arms is the M++ search-guidance block (the treatment).
import { buildSysPolicy, FRAME_AUTHORITY, FRAME_CLOSE, TASK_POLICY } from '../harness/api-task-runner.mjs';

const M = 'MPP_SEARCH_GUIDANCE_BLOCK ss-search ss-trace';
const MPP_WRAPPER = '\n\n=== Code-search expertise — use the ss_* tools per this guidance (this is your advantage; use it to locate code in fewer, sharper steps) ===\n' + M;
let ok = true;
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };

const nOn = buildSysPolicy('', true), sOn = buildSysPolicy(M, true);
const nOff = buildSysPolicy('', false), sOff = buildSysPolicy(M, false);

console.log('== FRAME ON: fairness + bracket ==');
assert(nOn.includes(FRAME_AUTHORITY) && sOn.includes(FRAME_AUTHORITY), 'both arms open with FRAME_AUTHORITY');
assert(nOn.trimEnd().endsWith(FRAME_CLOSE) && sOn.trimEnd().endsWith(FRAME_CLOSE), 'both arms end with FRAME_CLOSE (last word)');
assert(sOn.includes(M) && !nOn.includes(M), 'only sweet has the M++ block');
assert(sOn.indexOf(FRAME_AUTHORITY) < sOn.indexOf(M) && sOn.indexOf(M) < sOn.indexOf(FRAME_CLOSE), 'sweet: M++ sits BETWEEN open and close');
assert(sOn.replace(MPP_WRAPPER, '') === nOn, 'FAIRNESS: sweet minus M++ block === native (only asymmetry is the treatment)');
assert(!/ss[-_]|grep|semantic|read_file/i.test(FRAME_AUTHORITY), 'FRAME_AUTHORITY is tool-agnostic');
assert(!/ss[-_]|grep|semantic|read_file/i.test(FRAME_CLOSE.replace(/write_file/g, '')), 'FRAME_CLOSE names no SEARCH tools (write_file ok)');

console.log('== FRAME OFF: legacy A/B reproduction ==');
assert(nOff === TASK_POLICY, 'native OFF === legacy TASK_POLICY');
assert(sOff.startsWith(TASK_POLICY) && sOff.includes(M) && !sOff.includes(FRAME_CLOSE), 'sweet OFF === legacy (TASK_POLICY + M++, no frame)');

console.log(ok ? '\nALL INVARIANTS PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
