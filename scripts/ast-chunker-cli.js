#!/usr/bin/env node

import fs from 'fs/promises';
import { ASTChunker } from '../ast-chunker.js';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/ast-chunker-cli.js <file-or-directory>');
  process.exit(1);
}

const inputPath = args[0];
const chunker = new ASTChunker();

(async () => {
  try {
    const stat = await fs.stat(inputPath);
    let chunks;

    if (stat.isFile()) {
      const content = await fs.readFile(inputPath, 'utf-8');
      chunks = await chunker.parseFile(inputPath, content);
    } else {
      console.error('Directory parsing not implemented in CLI');
      process.exit(1);
    }

    console.log(JSON.stringify(chunks, null, 2));
    console.error(`\nExtracted ${chunks.length} chunks`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
