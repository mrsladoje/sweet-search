import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
const W = new URL('../../../../../../../', import.meta.url).pathname.replace(/\/$/, '');  // repo root
const { installClaudeLeanHarness } = await import(W + '/scripts/install-claude-lean-harness.js');
const [out, appendOverride] = [process.argv[2], process.argv[3] === 'true'];
const d = mkdtempSync(join(tmpdir(), 'lean-'));
const r = installClaudeLeanHarness({ projectRoot: d, appendOverride });
console.log(r.status, r.active);
const files = {};
const walk = p => { for (const f of readdirSync(p)) { const q = join(p, f); statSync(q).isDirectory() ? walk(q) : files[relative(d, q)] = readFileSync(q, 'utf8'); } };
walk(d); writeFileSync(out, JSON.stringify(files)); console.log(Object.keys(files));
