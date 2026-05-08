#!/usr/bin/env node
/**
 * Parity gate for the native demotion kernel.
 *
 * Asserts that the Rust `testChunkBodyMatchBatch` (in
 * crates/sweet-search-native/src/demotions.rs) returns BYTE-IDENTICAL
 * verdicts to the V8 regex `TEST_CHUNK_BODY_RE` on a fixed corpus.
 *
 * Run before flipping SWEET_SEARCH_DEMOTIONS_NATIVE on by default, and
 * before each release tag once the native package is part of the
 * publish pipeline. Exit codes:
 *   0 — parity passed, native path is safe to enable
 *   1 — parity failed, do not ship
 *   2 — native addon not loaded (e.g. wrong platform or unbuilt)
 *
 * Usage:
 *   node scripts/parity-demotions.js
 *   node scripts/parity-demotions.js --corpus=eval/corpus/gencodesearchnet
 *   node scripts/parity-demotions.js --max=2000
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getNativeDemotionKernelForceLoad } from '../core/ranking/demotion-kernel-native.js';

// Mirror the regex literally from core/ranking/file-kind-ranking.js. Any
// drift here would silently invalidate the parity check.
const TEST_CHUNK_BODY_RE = /^\s*(?:#\[(?:cfg\s*\(\s*test\s*\)|test)\]|func\s+Test[A-Z]|def\s+test_|(?:it|test|describe)\s*\(\s*['"])/m;

function parseArgs(argv) {
  const out = { corpus: null, max: 5000, verbose: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--corpus=')) out.corpus = a.split('=')[1];
    else if (a.startsWith('--max=')) out.max = parseInt(a.split('=')[1], 10);
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}

function gatherChunkTexts(corpusRoot, max) {
  const texts = [];
  // Walk the corpus, sample text from source files. Each "chunk" is a
  // 30-60 line slice — representative of what the demotion sub-rule
  // actually sees at retrieval time.
  const stack = [corpusRoot];
  const exts = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.c', '.cpp', '.h']);
  while (stack.length && texts.length < max) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (texts.length >= max) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && exts.has(path.extname(e.name))) {
        let content;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        // Slice into ~50-line chunks so each text is realistic in size.
        const chunkSize = 50;
        for (let i = 0; i < lines.length && texts.length < max; i += chunkSize) {
          texts.push(lines.slice(i, i + chunkSize).join('\n'));
        }
      }
    }
  }
  return texts;
}

async function main() {
  const args = parseArgs(process.argv);
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');
  const corpusRoot = args.corpus
    ? path.resolve(args.corpus)
    : path.join(repoRoot, 'eval/corpus/gencodesearchnet');

  console.log(`Parity check: native demotion kernel vs V8 regex`);
  console.log(`  corpus:   ${corpusRoot}`);
  console.log(`  max chunks: ${args.max}`);

  const kernel = getNativeDemotionKernelForceLoad();
  if (!kernel) {
    console.error('FAIL: native demotion kernel not loaded.');
    console.error('       Build with `npm run build:native` and ensure the');
    console.error('       sweet-search-native package matches this platform.');
    process.exit(2);
  }

  if (!fs.existsSync(corpusRoot)) {
    console.error(`FAIL: corpus not found at ${corpusRoot}`);
    process.exit(1);
  }

  console.log('\n[1/3] Gathering chunk texts...');
  const texts = gatherChunkTexts(corpusRoot, args.max);
  console.log(`  collected ${texts.length} chunks`);

  // Always include a fixed fixture set to lock down the regex semantics
  // even if the corpus drifts. These cover the four production patterns
  // plus negative cases.
  const fixtures = [
    '',
    '   ',
    '#[test]\nfn x() {}',
    '#[cfg(test)]\nmod tests {}',
    '  #[cfg ( test )]\nmod x {}',
    'func TestFoo(t *testing.T) {}',
    'func testFoo() {}',                                         // lowercase 'test'
    'def test_foo():\n    pass',
    '    def test_bar():',
    'def TestFoo():',                                            // uppercase 'T' for python
    "it(\"works\", () => {})",
    "describe('suite', () => {})",
    "test('bar', () => {})",
    "myit('not a test', () => {})",                              // not at line start
    '// trailing line\n#[test]\nfn t() {}',                      // /m flag — line-anchored
    'pub fn helper() {}\nlet x = 1;',
    'class Foo { method() { return this.bar; } }',
    'package main\n\nimport "fmt"\n\nfunc main() {}',
  ];
  texts.unshift(...fixtures);

  console.log('\n[2/3] Running V8 regex...');
  const t0js = process.hrtime.bigint();
  const jsVerdicts = texts.map((t) => TEST_CHUNK_BODY_RE.test(t));
  const t1js = process.hrtime.bigint();
  const jsMs = Number(t1js - t0js) / 1e6;
  console.log(`  V8: ${jsMs.toFixed(2)} ms (${(jsMs * 1000 / texts.length).toFixed(2)} µs/chunk)`);

  console.log('\n[3/3] Running native batch matcher...');
  const t0rs = process.hrtime.bigint();
  const rsVerdicts = kernel.testChunkBodyMatchBatch(texts);
  const t1rs = process.hrtime.bigint();
  const rsMs = Number(t1rs - t0rs) / 1e6;
  console.log(`  native: ${rsMs.toFixed(2)} ms (${(rsMs * 1000 / texts.length).toFixed(2)} µs/chunk)`);
  console.log(`  speedup: ${(jsMs / rsMs).toFixed(2)}x`);

  console.log('\n[diff] Asserting byte-identical verdicts...');
  let mismatches = 0;
  for (let i = 0; i < texts.length; i++) {
    if (jsVerdicts[i] !== rsVerdicts[i]) {
      mismatches++;
      if (mismatches <= 5) {
        const preview = texts[i].slice(0, 100).replace(/\n/g, '\\n');
        console.error(`  MISMATCH idx=${i}: js=${jsVerdicts[i]} native=${rsVerdicts[i]}`);
        console.error(`    text: "${preview}${texts[i].length > 100 ? '…' : ''}"`);
      }
    }
  }
  if (mismatches > 0) {
    console.error(`\nFAIL: ${mismatches}/${texts.length} verdicts differ.`);
    process.exit(1);
  }
  console.log(`\nPASS: ${texts.length}/${texts.length} verdicts byte-identical.`);
  console.log('Native demotion kernel is parity-safe to enable via SWEET_SEARCH_DEMOTIONS_NATIVE=1.');
  process.exit(0);
}

main().catch((err) => {
  console.error('parity check threw:', err.stack || err.message || err);
  process.exit(1);
});
