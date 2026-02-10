#!/usr/bin/env node

/**
 * AST-based semantic code chunking using Tree-sitter
 *
 * Extracts meaningful code chunks (classes, methods, functions, components)
 * with contextual information for AgentDB storage and semantic search.
 *
 * Note: Requires tree-sitter and language grammars to be installed.
 * Falls back to line-based chunking if tree-sitter is unavailable.
 */

import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { detectProjectBoundary } from './core/project-detector.js';

const MAX_CHUNK_SIZE = 2000;

/**
 * Simple AST-like chunker that works without tree-sitter
 * Uses regex patterns to identify code boundaries
 */
export class ASTChunker {
  constructor(options) {
    this.projectRoot = options?.projectRoot || process.cwd();
    this.patterns = {
      java: {
        class: /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*class\s+(\w+)/,
        method: /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*[\w<>\[\]]+\s+(\w+)\s*\(/,
        interface: /(?:public)?\s*interface\s+(\w+)/,
        enum: /(?:public)?\s*enum\s+(\w+)/
      },
      javascript: {
        function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/,
        class: /(?:export\s+)?class\s+(\w+)/,
        component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
        arrow: /const\s+(\w+)\s*=\s*(?:async\s*)?\(/
      },
      proto: {
        message: /message\s+(\w+)/,
        service: /service\s+(\w+)/,
        enum: /enum\s+(\w+)/,
        rpc: /rpc\s+(\w+)/
      }
    };
  }

  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const extMap = {
      '.java': 'java',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'javascript',
      '.tsx': 'javascript',
      '.proto': 'proto'
    };
    return extMap[ext] || null;
  }

  async parseFile(filePath, content) {
    const language = this.detectLanguage(filePath);
    if (!language) {
      return this.parseGenericFile(filePath, content);
    }

    const chunks = [];
    const lines = content.split('\n');
    const patterns = this.patterns[language];

    let currentChunk = null;
    let braceDepth = 0;
    let chunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track brace depth
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Check for code boundaries
      let matched = null;
      let matchType = null;

      for (const [type, pattern] of Object.entries(patterns)) {
        const match = line.match(pattern);
        if (match) {
          matched = match[1];
          matchType = type;
          break;
        }
      }

      // Create chunk at boundaries
      if ((matched && currentChunk) || (braceDepth === 0 && currentChunk)) {
        const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
        if (chunkContent.trim().length > 30) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
        }
        currentChunk = null;
        chunkStart = i;
      }

      if (matched) {
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
      }
    }

    // Final chunk
    if (chunkStart < lines.length) {
      const chunkContent = lines.slice(chunkStart).join('\n');
      if (chunkContent.trim().length > 30) {
        chunks.push(this.buildChunk(
          chunkContent,
          filePath,
          language,
          currentChunk?.type || 'code',
          currentChunk?.name || 'unknown',
          chunkStart,
          lines.length
        ));
      }
    }

    return chunks;
  }

  parseGenericFile(filePath, content) {
    const lines = content.split('\n');
    const chunks = [];
    const CHUNK_SIZE = 50;
    const OVERLAP = 10;

    let start = 0;
    while (start < lines.length) {
      const end = Math.min(start + CHUNK_SIZE, lines.length);
      const chunkContent = lines.slice(start, end).join('\n');

      if (chunkContent.trim().length > 20) {
        chunks.push(this.buildChunk(chunkContent, filePath, 'text', 'code', 'unknown', start, end));
      }

      start = end - OVERLAP;
      if (start >= lines.length - OVERLAP) break;
    }

    return chunks;
  }

  buildChunk(content, filePath, language, chunkType, symbol, lineStart, lineEnd) {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;

    return {
      text: content.trim(),
      content: content.trim(),
      metadata: {
        type: 'codebase',
        file: path.basename(filePath),
        path: relativePath,
        language,
        chunk_type: chunkType,
        symbol,
        line_start: lineStart + 1,
        line_end: lineEnd,
        hash
      },
      tags: ['codebase', language, this.inferProjectTag(filePath)]
    };
  }

  inferProjectTag(filePath) {
    const { name } = detectProjectBoundary(filePath, this.projectRoot || process.cwd());
    return name;
  }

  async parseFiles(filePaths) {
    const allChunks = [];

    for (const filePath of filePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const chunks = await this.parseFile(filePath, content);
        allChunks.push(...chunks.flat());
      } catch (error) {
        console.error(`Failed to parse ${filePath}:`, error.message);
      }
    }

    return allChunks;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ast-chunker.js <file-or-directory>');
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
}
