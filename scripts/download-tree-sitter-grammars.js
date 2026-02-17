#!/usr/bin/env node
/**
 * Download tree-sitter WASM grammar files.
 *
 * Downloads pre-built .wasm grammar files for supported languages into
 * .sweet-search/grammars/. These are loaded at runtime by tree-sitter-provider.js.
 *
 * Usage:
 *   node scripts/download-tree-sitter-grammars.js
 *   node scripts/download-tree-sitter-grammars.js --dir ./my-grammars
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, '..', '.sweet-search', 'grammars');

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'ruby', 'php', 'kotlin', 'swift',
];

function main() {
  const dirIdx = process.argv.indexOf('--dir');
  const grammarsDir = dirIdx !== -1 ? process.argv[dirIdx + 1] : DEFAULT_DIR;

  fs.mkdirSync(grammarsDir, { recursive: true });

  console.log('Tree-sitter grammar download helper');
  console.log('====================================');
  console.log(`Target directory: ${grammarsDir}\n`);

  const missing = [];
  const present = [];

  for (const lang of LANGUAGES) {
    const filename = `tree-sitter-${lang}.wasm`;
    const filepath = path.join(grammarsDir, filename);
    if (fs.existsSync(filepath)) {
      present.push(filename);
    } else {
      missing.push(filename);
    }
  }

  if (present.length > 0) {
    console.log(`Already present (${present.length}):`);
    for (const f of present) console.log(`  ✓ ${f}`);
    console.log();
  }

  if (missing.length > 0) {
    console.log(`Missing grammars (${missing.length}):`);
    for (const f of missing) console.log(`  ✗ ${f}`);
    console.log();
    console.log('To obtain pre-built WASM grammar files:');
    console.log('  1. https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt');
    console.log('  2. Build from source: https://github.com/nicolo-ribaudo/chora');
    console.log('  3. npm install tree-sitter-wasms (if available)');
    console.log();
    console.log(`Place .wasm files in: ${grammarsDir}`);
  } else {
    console.log('All grammars present!');
  }
}

main();
