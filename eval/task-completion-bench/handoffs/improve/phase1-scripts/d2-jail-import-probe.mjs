// D2 reproduction probe — why does the generated run_tests shim fail to import a harness
// module under the production isolation policy?
//
// The previous attempt left this unreconciled: a jailed probe reported the WHOLE harness
// directory unreadable, including `rt-shim-runtime.mjs`, which the pre-D2 shim was believed
// to import the same way. That probe called startJail WITHOUT the extraBinds a real rollout
// passes, so it was treated as possibly over-reporting.
//
// This probe removes that doubt: it starts the jail with the EXACT extraBinds/extraMasks an
// opencode rollout passes, and then performs the real operation — a dynamic `import()` of an
// absolute harness path from a process running inside the jail — rather than a readability
// stat. Run it on the evidence box; it needs Linux + the jail preflight. Model spend: $0.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJail, stopJail, jailArgv, ISOLATION_ON } from '../../../harness/agent-jail.mjs';

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../harness');
const HOME = process.env.HOME || '/root';

const targets = [
  ['rt-shim-runtime.mjs', 'imported by the DIRECT shim variant (isolation OFF) and by the host-side broker'],
  ['rt-inflight.mjs', 'the import D2 adds to the BROKER REQUESTER, which runs INSIDE the jail'],
  ['rt-condense-lib.mjs', 'control: another harness module, same directory'],
];

const rundir = mkdtempSync(path.join(tmpdir(), 'd2-probe-rundir-'));
const runnerStateDir = mkdtempSync(path.join(tmpdir(), 'sweet-search-runner-'));
mkdirSync(path.join(runnerStateDir, 'bin'), { recursive: true });
writeFileSync(path.join(rundir, 'README'), 'probe\n');

// EXACTLY what opencode-task-runner.mjs passes.
const ocData = path.join(runnerStateDir, 'opencode-data');
mkdirSync(ocData, { recursive: true });
const extraBinds = [
  { src: path.join(HOME, '.cache/opencode'), dst: path.join(HOME, '.cache/opencode'), ro: true },
  { src: ocData, dst: path.join(HOME, '.local/share/opencode') },
];
const extraMasks = [path.join(HOME, '.config/opencode')];

console.log(`ISOLATION_ON=${ISOLATION_ON}`);
let jail = null;
try {
  jail = startJail({ rundir, runnerStateDir, label: 'd2-probe', extraBinds, extraMasks, requireBins: ['opencode'] });
  console.log(`jail up: initPid=${jail.initPid}\n`);
  const inJail = (script) => {
    const [bin, args] = jailArgv(jail, process.execPath, ['-e', script], '/tmp');
    try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch (e) { return `EXIT${e.status}: ${String(e.stdout || '').trim()} ${String(e.stderr || '').trim()}`.trim(); }
  };

  console.log(`harness dir listing from inside the jail: ${inJail(`try{console.log(require('node:fs').readdirSync(${JSON.stringify(HARNESS)}).length+' entries')}catch(e){console.log('readdir failed: '+e.code)}`)}`);
  console.log(`repo root listing from inside the jail:   ${inJail(`try{console.log(require('node:fs').readdirSync(${JSON.stringify(path.resolve(HARNESS, '../../..'))}).length+' entries')}catch(e){console.log('readdir failed: '+e.code)}`)}`);
  console.log(`eval/ listing from inside the jail:       ${inJail(`try{console.log(require('node:fs').readdirSync(${JSON.stringify(path.resolve(HARNESS, '../..'))}).length+' entries')}catch(e){console.log('readdir failed: '+e.code)}`)}`);
  console.log('');

  for (const [name, why] of targets) {
    const p = path.join(HARNESS, name);
    const readable = inJail(`try{require('node:fs').readFileSync(${JSON.stringify(p)});console.log('READABLE')}catch(e){console.log('NOT READABLE ('+e.code+')')}`);
    // The real operation the shim performs.
    const imported = inJail(`import(${JSON.stringify(p)}).then(()=>console.log('IMPORT OK')).catch(e=>console.log('IMPORT FAILED ('+(e.code||e.name)+')'))`);
    console.log(`${name.padEnd(24)} read=${readable.padEnd(24)} import=${imported}`);
    console.log(`${' '.repeat(24)} ${why}`);
  }
} finally {
  if (jail) stopJail(jail);
  try { rmSync(rundir, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(runnerStateDir, { recursive: true, force: true }); } catch { /* */ }
}
