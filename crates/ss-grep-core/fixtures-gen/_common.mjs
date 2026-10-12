// Shared by the fixture generators: where the JS and the inputs live, a recorder for every
// file-system probe the JS makes (replayed by the Rust FakeProbe), a PRNG shared with the
// Rust tests, and a hash.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CRATE = path.resolve(HERE, '..');
export const SCRATCH = path.resolve(CRATE, '../../..');
export const WT = path.join(SCRATCH, 'wt-new');
export const CORPUS = path.join(SCRATCH, 'corpus');
export const REPOS_DIR = '/Users/admin/.ss-eval/grep-e2e-bench/repos';
export const REPOS = ['django', 'fastify', 'flask', 'gin', 'go', 'kubernetes', 'rails', 'react', 'redis', 'ripgrep', 'rust', 'tokio', 'vue'];
export const FIXTURES = path.join(CRATE, 'tests', 'fixtures');

export function jsPath(rel) { return path.join(WT, rel); }

// --- probe recorder -------------------------------------------------------------------------
export const PROBE = { exists: {}, realpath: {}, isFile: {} };
export function resetProbe() { PROBE.exists = {}; PROBE.realpath = {}; PROBE.isFile = {}; }
export function takeProbe() { const p = { exists: PROBE.exists, realpath: PROBE.realpath, isFile: PROBE.isFile }; resetProbe(); return p; }

const origExists = fs.existsSync;
const origRealNative = fs.realpathSync.native;
fs.existsSync = function existsSync(p) {
  const r = origExists(p);
  if (typeof p === 'string') PROBE.exists[p] = r;
  return r;
};
fs.realpathSync.native = function native(p, ...rest) {
  try {
    const r = origRealNative(p, ...rest);
    if (typeof p === 'string') PROBE.realpath[p] = r;
    return r;
  } catch (e) {
    if (typeof p === 'string') PROBE.realpath[p] = null;
    throw e;
  }
};
syncBuiltinESMExports();

// --- fixtures -------------------------------------------------------------------------------
export function writeFixture(mod, name, data) {
  const dir = path.join(FIXTURES, mod);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

export function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// mulberry32, mirrored in tests/common/mod.rs
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

// FNV-1a 64 over UTF-8 bytes, as a hex string (mirrored in Rust).
export function fnv1a(str) {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(str, 'utf8')) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}
