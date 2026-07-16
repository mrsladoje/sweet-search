// L4a end-to-end test: exercises the REAL ss-read agent wrapper (child process),
// not a mock. Proves: (1) small-file whole-file read is BYTE-IDENTICAL with the
// window ON vs OFF (no-op path); (2) a large whole-file read is capped to the
// window + gets the continue trailer with L4a ON, and returns the full file with
// L4a OFF; (3) an EXPLICIT range is untouched by L4a (ON == OFF). Standalone:
// `node tests/l4-read-window.mjs` — exit 1 on fail.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPERS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agent-read-workflows/bin/_ss-helpers.mjs');
let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

const root = mkdtempSync(path.join(tmpdir(), 'l4-'));
// The wrapper guards on an index existing; ss-read is filesystem-grounded and never
// queries the db, so a stub file satisfies the guard hermetically (no real indexing).
mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), 'stub');
const mkfile = (name, n) => { const p = path.join(root, name); writeFileSync(p, Array.from({ length: n }, (_, i) => `line ${i + 1} contents here`).join('\n') + '\n'); return name; };
const small = mkfile('small.js', 50);
const big = mkfile('big.js', 400);

const run = (args, env = {}) => {
  try {
    return execFileSync('node', [HELPERS, 'read', ...args], { cwd: root, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return String(e.stdout || '') + '[ERR]' + String(e.stderr || e.message || ''); }
};

console.log('L4a read-window (real ss-read wrapper; PARKED default-off, opt-in via SS_READ_WINDOW):');
const ENABLE = { SS_READ_WINDOW: '150' };
// (0) default is OFF (parked): a big whole-file read returns the whole file
const bigDefault = run([big]);
assert(/\(400 lines\)/.test(bigDefault) && /line 400 contents/.test(bigDefault), 'DEFAULT (no env) is OFF: big read returns all 400 lines (legacy)');

// (1) small file: enabled vs default byte-identical (file ≤ window → no-op)
const smallEn = run([small], ENABLE);
const smallDef = run([small]);
assert(smallEn === smallDef && smallEn.length > 0, 'small file: enabled == default (byte-identical no-op)');
assert(/\(50 lines\)/.test(smallEn) && !/continue/.test(smallEn), 'small file shows "(50 lines)", no continue trailer');

// (2) big file: enabled caps + trailer; default returns all 400
const bigEn = run([big], ENABLE);
assert(/\(lines 1-150 of 400\)/.test(bigEn), 'big read ENABLED: capped to lines 1-150 of 400', bigEn.slice(0, 120));
assert(/line 150 contents/.test(bigEn) && !/line 151 contents/.test(bigEn), 'big read ENABLED: delivers exactly through line 150');
assert(/ss-read .*151/.test(bigEn) || /continue/i.test(bigEn), 'big read ENABLED: continue-affordance trailer present', bigEn.slice(-200));
assert(bigEn.length < bigDefault.length, 'big read ENABLED delivers fewer bytes than default');

// (3) explicit range: window must not touch it
const rangeEn = run([big, '200', '260'], ENABLE);
const rangeDef = run([big, '200', '260']);
assert(rangeEn === rangeDef, 'explicit range read: enabled == default (explicit ranges untouched)');
assert(/\(lines 200-260 of 400\)/.test(rangeEn), 'explicit range honored (200-260 of 400)');

// (4) retune knob
const bigW80 = run([big], { SS_READ_WINDOW: '80' });
assert(/\(lines 1-80 of 400\)/.test(bigW80), 'SS_READ_WINDOW=80 retunes the tier');

rmSync(root, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
