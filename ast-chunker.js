/**
 * AST-based semantic code chunking
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
import { getLanguageByPath } from './core/language-patterns.js';
import { DocumentChunker } from './core/document-chunker.js';

const MAX_CHUNK_SIZE = 2000;

/**
 * AST-like semantic code chunker supporting 35+ languages.
 * Uses regex boundary patterns from core/language-patterns.js registry.
 * Three parsing strategies: brace-based, indent-based, end-keyword.
 */
export class ASTChunker {
  constructor(options) {
    this.projectRoot = options?.projectRoot || process.cwd();
  }

  async parseFile(filePath, content) {
    // Dispatch document files (markdown, plaintext) to DocumentChunker
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.txt') {
      if (!this._docChunker) {
        this._docChunker = new DocumentChunker({ projectRoot: this.projectRoot });
      }
      return this._docChunker.parseFile(filePath, content);
    }

    const langInfo = getLanguageByPath(filePath);
    if (!langInfo || !langInfo.chunker) {
      return this.parseGenericFile(filePath, content);
    }

    const { id: language, chunker: patterns, indentBased, endKeyword, comment } = langInfo;

    if (indentBased) {
      return this.parseIndentBasedFile(filePath, content, language, patterns);
    }
    if (endKeyword) {
      return this.parseEndKeywordFile(filePath, content, language, patterns, endKeyword);
    }
    return this.parseBraceBasedFile(filePath, content, language, patterns, comment);
  }

  parseBraceBasedFile(filePath, content, language, patterns, comment) {
    const chunks = [];
    const lines = content.split('\n');
    const hasTemplateInterpolation = (language === 'javascript');

    let currentChunk = null;
    let braceDepth = 0;
    let chunkStart = 0;
    const stripState = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = this._stripNonCode(line, stripState, comment, hasTemplateInterpolation);

      braceDepth += (stripped.match(/{/g) || []).length;
      braceDepth -= (stripped.match(/}/g) || []).length;

      const { name: matched, type: matchType } = this._matchBoundary(line, patterns);

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

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return chunks;
  }

  parseIndentBasedFile(filePath, content, language, patterns) {
    const chunks = [];
    const lines = content.split('\n');

    let currentChunk = null;
    let chunkStart = 0;
    let chunkIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue; // skip blank/comment lines

      const indent = line.length - trimmed.length;

      // If we're inside a chunk and hit a line at the same or lesser indent, close
      if (currentChunk && indent <= chunkIndent && i > chunkStart) {
        const chunkContent = lines.slice(chunkStart, i).join('\n');
        if (chunkContent.trim().length > 30) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
        }
        currentChunk = null;
        chunkStart = i;
      }

      const { name: matched, type: matchType } = this._matchBoundary(line, patterns);

      if (matched) {
        // Close prior chunk if any non-empty content
        if (currentChunk && chunkStart < i) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > 30) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
        chunkIndent = indent;
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return chunks;
  }

  parseEndKeywordFile(filePath, content, language, patterns, endKeyword) {
    const chunks = [];
    const lines = content.split('\n');
    const endRe = new RegExp(`^\\s*${endKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

    let currentChunk = null;
    let depth = 0;
    let chunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const { name: matched, type: matchType } = this._matchBoundary(line, patterns);

      if (matched) {
        if (currentChunk && depth === 0) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > 30) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        if (!currentChunk || depth === 0) {
          currentChunk = { type: matchType, name: matched };
          chunkStart = i;
        }
        depth++;
      }

      if (endRe.test(line) && depth > 0) {
        depth--;
        if (depth === 0 && currentChunk) {
          const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
          if (chunkContent.trim().length > 30) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
          }
          currentChunk = null;
          chunkStart = i + 1;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return chunks;
  }

  _matchBoundary(line, patterns) {
    const trimmed = line.trimStart();
    for (const [type, pattern] of Object.entries(patterns)) {
      const match = trimmed.match(pattern);
      if (match) {
        return { name: match[1], type };
      }
    }
    return { name: null, type: null };
  }

  _stripNonCode(line, state, comment, hasTemplateInterpolation) {
    let result = '';
    const lineComment = comment?.line || null;
    const blockOpen = comment?.block?.[0] || null;
    const blockClose = comment?.block?.[1] || null;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      // In block comment → scan for block-close delimiter
      if (state.inBlockComment) {
        if (blockClose && line.startsWith(blockClose, i)) {
          state.inBlockComment = false;
          i += blockClose.length - 1;
        }
        continue;
      }

      // In template/raw literal body
      if (state.inTemplateLiteral) {
        if (hasTemplateInterpolation && ch === '\\') {
          i++;
          continue;
        }
        if (hasTemplateInterpolation && ch === '$' && i + 1 < line.length && line[i + 1] === '{') {
          state.interpolationDepth = 1;
          state.inTemplateLiteral = false;
          i++;
          continue;
        }
        if (ch === '`') {
          state.inTemplateLiteral = false;
          continue;
        }
        continue;
      }

      // Code mode

      // Block comment open
      if (blockOpen && line.startsWith(blockOpen, i)) {
        state.inBlockComment = true;
        i += blockOpen.length - 1;
        continue;
      }

      // Line comment
      if (lineComment && line.startsWith(lineComment, i)) {
        break;
      }

      // Double-quoted string
      if (ch === '"') {
        for (i++; i < line.length; i++) {
          if (line[i] === '\\') { i++; continue; }
          if (line[i] === '"') break;
        }
        continue;
      }

      // Single-quoted string
      if (ch === "'") {
        for (i++; i < line.length; i++) {
          if (line[i] === '\\') { i++; continue; }
          if (line[i] === "'") break;
        }
        continue;
      }

      // Backtick string
      if (ch === '`') {
        state.inTemplateLiteral = true;
        continue;
      }

      // Closing brace in template interpolation
      if (ch === '}' && state.interpolationDepth > 0) {
        state.interpolationDepth--;
        if (state.interpolationDepth === 0) {
          state.inTemplateLiteral = true;
          continue;
        }
        result += ch;
        continue;
      }

      // Opening brace in template interpolation
      if (ch === '{' && state.interpolationDepth > 0) {
        state.interpolationDepth++;
      }

      result += ch;
    }

    return result;
  }

  _pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk) {
    if (chunkStart < lines.length) {
      const chunkContent = lines.slice(chunkStart).join('\n');
      if (chunkContent.trim().length > 30) {
        chunks.push(this.buildChunk(
          chunkContent, filePath, language,
          currentChunk?.type || 'code',
          currentChunk?.name || 'unknown',
          chunkStart, lines.length
        ));
      }
    }
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

