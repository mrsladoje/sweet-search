// Frame fairness + bracket invariants for the task-completion harness.
// Standalone (no test runner): `node tests/frame-invariants.mjs` — exit 1 on fail.
// Guards the publishable claim that the ONLY system-prompt asymmetry between the
// native and sweet arms is the M++ search-guidance block (the treatment).
import { buildSysPolicy, FRAME_AUTHORITY, FRAME_CLOSE, TASK_POLICY } from '../harness/api-task-runner.mjs';
import {
  buildInstructionFile, FRAME_CLOSE as CLI_FRAME_CLOSE, FRAME_OPEN as CLI_FRAME_OPEN,
  packingTreatmentRowFields, resolvePackingTreatment,
} from '../harness/agent-runner-shared.mjs';

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

console.log('== FROZEN PACKING TREATMENTS ==');
const offEnv = { SS_PACKING_TREATMENT: 'off' };
const batchEnv = { SS_PACKING_TREATMENT: 'ss-batch' };
const parallelEnv = { SS_PACKING_TREATMENT: 'parallel-bash' };
const instructionOff = buildInstructionFile({ sweet: true, mppText: M, env: offEnv });
const instructionBatch = buildInstructionFile({ sweet: true, mppText: M, env: batchEnv });
const instructionParallel = buildInstructionFile({ sweet: true, mppText: M, env: parallelEnv });
assert(resolvePackingTreatment({}) === 'off', 'packing defaults OFF');
assert(instructionOff === `${CLI_FRAME_OPEN}\n\n${M}\n\n${CLI_FRAME_CLOSE}`, 'OFF preserves the pre-treatment instruction bytes');
assert(instructionBatch.startsWith(instructionOff.replace(`\n\n${CLI_FRAME_CLOSE}`, '')), 'batch keeps the frozen frame and M++ prefix');
assert(instructionBatch.includes('"maxChars":16000') && instructionBatch.indexOf('ss-batch-v1') < instructionBatch.indexOf(CLI_FRAME_CLOSE), 'ss-batch guidance is bounded inside the authority frame');
assert(instructionParallel.includes('with &, ;, or &&'), 'parallel guidance forbids shell fusion');
assert(packingTreatmentRowFields({ sweet: true, env: batchEnv }).packingInstructionSha256 !== packingTreatmentRowFields({ sweet: true, env: offEnv }).packingInstructionSha256, 'rows hash the exact treatment instruction');
try {
  buildInstructionFile({ sweet: false, mppText: M, env: batchEnv });
  assert(false, 'native rejects a non-OFF packing treatment');
} catch {
  assert(true, 'native rejects a non-OFF packing treatment');
}

console.log(ok ? '\nALL INVARIANTS PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
