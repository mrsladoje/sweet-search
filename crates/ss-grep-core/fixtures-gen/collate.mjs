// Fixtures for src/collate.rs: V8 localeCompare on (1) every pair of 1-char ASCII strings,
// (2) 120,000 random ASCII string pairs from a PRNG the Rust test runs too (case variants,
// punctuation runs, digits, ignorable controls), (3) 15,000 random pairs of real paths per bench
// repo, and (4) the full `git ls-files` list of every bench repo sorted with localeCompare
// (stored as a hash; the Rust test lists and sorts the repo itself).
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPOS, REPOS_DIR, fnv1a, mulberry32, writeFixture } from './_common.mjs';

const cmp = (a, b) => Math.sign(a.localeCompare(b));
// signs -1/0/1 -> 0/1/2, two per hex digit (pad with 1)
function pack(signs) {
  let out = '';
  for (let i = 0; i < signs.length; i += 2) {
    const a = signs[i] + 1;
    const b = i + 1 < signs.length ? signs[i + 1] + 1 : 1;
    out += (a * 3 + b).toString(16);
  }
  return out;
}

const env = { locale: Intl.Collator().resolvedOptions().locale, icu: process.versions.icu, node: process.version };

// (1) every pair of single ASCII chars
const singles = [];
for (let a = 0; a < 128; a++) for (let b = 0; b < 128; b++) singles.push(cmp(String.fromCharCode(a), String.fromCharCode(b)));

// (2) PRNG strings (mirrored in tests/collate.rs)
const PUNCT = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const CONTROLS = [0, 1, 9, 10, 13, 127];
const INSERT = [0, 1, 8, 14, 31, 127, 9, 32];
function genString(r) {
  const len = r() % 7;
  let s = '';
  for (let i = 0; i < len; i++) {
    const k = r() % 10;
    let c;
    if (k < 3) c = 97 + (r() % 26);
    else if (k < 5) c = 65 + (r() % 26);
    else if (k < 6) c = 48 + (r() % 10);
    else if (k < 8) c = PUNCT.charCodeAt(r() % PUNCT.length);
    else if (k < 9) c = r() % 128;
    else c = CONTROLS[r() % CONTROLS.length];
    s += String.fromCharCode(c);
  }
  return s;
}
function variant(a, r) {
  let s = '';
  for (const ch of a) {
    const c = ch.charCodeAt(0);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    s += (isLetter && r() % 4 === 0) ? String.fromCharCode(c ^ 32) : ch;
  }
  if (r() % 2 === 0) {
    const pos = r() % (s.length + 1);
    const ins = String.fromCharCode(INSERT[r() % INSERT.length]);
    s = s.slice(0, pos) + ins + s.slice(pos);
  }
  return s;
}
const r = mulberry32(2026);
const N = 120000;
const synSigns = [];
let synHash = '';
const all = [];
for (let i = 0; i < N; i++) {
  const a = genString(r);
  const b = r() % 3 === 0 ? variant(a, r) : genString(r);
  all.push(a, b);
  synSigns.push(cmp(a, b));
}
synHash = fnv1a(all.join('\u0001|'));

// (3) + (4) real paths
const repos = [];
for (const repo of REPOS) {
  const root = path.join(REPOS_DIR, repo);
  const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const ascii = files.filter((f) => /^[\x00-\x7f]*$/.test(f));
  const sorted = [...ascii].sort((a, b) => a.localeCompare(b));
  const rr = mulberry32(31);
  const signs = [];
  for (let i = 0; i < 15000; i++) {
    const ia = rr() % ascii.length;
    // half the pairs from a nearby index, which shares a long prefix
    const j = rr() % 2 === 0 ? rr() % ascii.length : Math.min(ascii.length - 1, ia + 1 + (rr() % 3));
    signs.push(cmp(ascii[ia], ascii[j]));
  }
  repos.push({
    repo, count: files.length, ascii: ascii.length, listHash: fnv1a(files.join('\n')),
    sortedHash: fnv1a(sorted.join('\n')), pairSigns: pack(signs),
    nonAscii: files.filter((f) => !/^[\x00-\x7f]*$/.test(f)).slice(0, 3),
  });
}
writeFixture('collate', 'collate', { env, singles: pack(singles), n: N, synHash, synSigns: pack(synSigns), repos });
console.log('ok', env);
