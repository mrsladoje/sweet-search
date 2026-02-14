/**
 * Markdown/RST document chunker.
 */

import path from 'path';
import { MD_DEFAULTS, buildDocChunk, recursiveSplit } from './chunk-builder.js';

const RST_UNDERLINE_CHARS = new Set('=-`:\'.\"~^_*+#'.split(''));

export class MarkdownChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || MD_DEFAULTS.maxChunkSize;
    this.minChunkSize = options.minChunkSize || MD_DEFAULTS.minChunkSize;
    this.overlapLines = options.overlapLines ?? MD_DEFAULTS.overlapLines;
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Parse a markdown or RST file into semantically meaningful chunks.
   *
   * RST support: detects underline-style headers (Title\n====) used in
   * reStructuredText. RST assigns heading levels by order of first
   * appearance of the underline character, not by character type.
   *
   * Limitations:
   * - Frontmatter parser handles key: value, [arrays], and quoted strings
   *   but not nested objects, multiline values, or typed scalars.
   * - Indented code blocks (4-space) are not detected as atomic blocks;
   *   only fenced code blocks (```) are preserved.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>} Chunk objects compatible with ASTChunker output
   */
  parseFile(filePath, content) {
    if (!content || content.trim().length < this.minChunkSize) return [];

    const ext = path.extname(filePath).toLowerCase();
    const isRst = ext === '.rst';
    const language = isRst ? 'rst' : 'markdown';

    // Phase 1: Extract frontmatter (RST doesn't typically have YAML frontmatter)
    const { frontmatter, body } = isRst
      ? { frontmatter: null, body: content }
      : this._extractFrontmatter(content);

    // Phase 2: Parse into sections by headers
    const sections = isRst ? this._splitByRstHeaders(body) : this._splitByHeaders(body);

    // Phase 3: Build chunks from sections
    const chunks = [];
    const bodyStartLine = frontmatter ? content.indexOf(body) : 0;
    const bodyLineOffset = content.slice(0, bodyStartLine).split('\n').length - 1;

    for (const section of sections) {
      const sectionChunks = this._chunkSection(
        section, filePath, bodyLineOffset, frontmatter, language,
      );
      chunks.push(...sectionChunks);
    }

    return chunks;
  }

  /**
   * Extract YAML frontmatter from markdown content.
   */
  _extractFrontmatter(content) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!fmMatch) return { frontmatter: null, body: content };

    const rawYaml = fmMatch[1];
    const frontmatter = {};

    // Simple YAML parser (key: value pairs)
    for (const line of rawYaml.split('\n')) {
      const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
      if (kvMatch) {
        let value = kvMatch[2].trim();
        // Handle array syntax [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
        // Strip quotes
        else if ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[kvMatch[1]] = value;
      }
    }

    const body = content.slice(fmMatch[0].length);
    return { frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null, body };
  }

  /**
   * Split markdown body into sections by header boundaries.
   * Each section includes its header line and all content until the next
   * same-or-higher-level header.
   *
   * @returns {Array<{level: number, title: string, hierarchy: object, content: string, lineStart: number, lineEnd: number}>}
   */
  _splitByHeaders(body) {
    const lines = body.split('\n');
    const sections = [];
    const headerStack = {};  // level → title mapping for hierarchy

    let currentSection = null;
    let sectionStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        // Close previous section
        if (currentSection !== null || i > 0) {
          const sectionContent = lines.slice(sectionStart, i).join('\n');
          sections.push({
            ...currentSection || { level: 0, title: '', hierarchy: {} },
            content: sectionContent,
            lineStart: sectionStart,
            lineEnd: i - 1,
          });
        }

        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();

        // Update header stack: clear all deeper levels
        for (let l = level; l <= 6; l++) {
          delete headerStack[l];
        }
        headerStack[level] = title;

        // Build hierarchy snapshot
        const hierarchy = {};
        for (let l = 1; l <= 6; l++) {
          if (headerStack[l]) hierarchy[`h${l}`] = headerStack[l];
        }

        currentSection = { level, title, hierarchy };
        sectionStart = i;
      }
    }

    // Push final section
    const finalContent = lines.slice(sectionStart).join('\n');
    if (finalContent.trim().length > 0) {
      sections.push({
        ...currentSection || { level: 0, title: '', hierarchy: {} },
        content: finalContent,
        lineStart: sectionStart,
        lineEnd: lines.length - 1,
      });
    }

    return sections;
  }

  /**
   * Split RST body into sections by underline-style headers.
   *
   * RST headers: a line of text followed by a line of repeated underline
   * characters (=, -, ~, ^, etc.) at least as long as the text.
   * Optionally, an overline of the same character precedes the title.
   * Level is determined by order of first appearance, not character type.
   *
   * @returns {Array<{level: number, title: string, hierarchy: object, content: string, lineStart: number, lineEnd: number}>}
   */
  _splitByRstHeaders(body) {
    const lines = body.split('\n');
    const sections = [];
    const charToLevel = {};    // maps underline char → level number
    let nextLevel = 1;
    const headerStack = {};    // level → title

    // First pass: find all header positions
    const headerPositions = [];  // [{lineIdx, title, level}]

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
      const prevLine = i > 0 ? lines[i - 1] : null;

      if (!nextLine) continue;

      // Check if nextLine is an underline: all same RST char, length >= title
      const titleCandidate = line.trim();
      if (titleCandidate.length === 0) continue;

      if (this._isRstUnderline(nextLine, titleCandidate.length)) {
        const underlineChar = nextLine.trim()[0];

        // Check for overline (optional): prevLine is same underline
        const hasOverline = prevLine !== null &&
          this._isRstUnderline(prevLine, titleCandidate.length) &&
          prevLine.trim()[0] === underlineChar;

        // Assign level by order of first appearance
        const levelKey = hasOverline ? `over_${underlineChar}` : underlineChar;
        if (!(levelKey in charToLevel)) {
          charToLevel[levelKey] = nextLevel++;
        }
        const level = charToLevel[levelKey];

        const headerLineIdx = hasOverline ? i - 1 : i;
        headerPositions.push({
          lineIdx: headerLineIdx,
          title: titleCandidate,
          level,
          // The header block spans: headerLineIdx to i+1 (title + underline)
          headerEndIdx: i + 1,
        });

        // Skip the underline line
        i++;
      }
    }

    // Second pass: build sections from header positions
    let sectionStart = 0;
    let currentSection = null;

    for (const hp of headerPositions) {
      // Close previous section
      if (hp.lineIdx > sectionStart || currentSection !== null) {
        const sectionContent = lines.slice(sectionStart, hp.lineIdx).join('\n');
        if (sectionContent.trim().length > 0 || currentSection !== null) {
          sections.push({
            ...currentSection || { level: 0, title: '', hierarchy: {} },
            content: sectionContent,
            lineStart: sectionStart,
            lineEnd: hp.lineIdx - 1,
          });
        }
      }

      // Update header stack
      for (let l = hp.level; l <= 6; l++) {
        delete headerStack[l];
      }
      headerStack[hp.level] = hp.title;

      const hierarchy = {};
      for (let l = 1; l <= 6; l++) {
        if (headerStack[l]) hierarchy[`h${l}`] = headerStack[l];
      }

      currentSection = { level: hp.level, title: hp.title, hierarchy };
      sectionStart = hp.lineIdx;
    }

    // Final section
    const finalContent = lines.slice(sectionStart).join('\n');
    if (finalContent.trim().length > 0) {
      sections.push({
        ...currentSection || { level: 0, title: '', hierarchy: {} },
        content: finalContent,
        lineStart: sectionStart,
        lineEnd: lines.length - 1,
      });
    }

    return sections;
  }

  /**
   * Check if a line is a valid RST underline/overline.
   * Must consist entirely of a single repeated RST adornment character
   * and be at least as long as the title.
   */
  _isRstUnderline(line, minLength) {
    const trimmed = line.trim();
    if (trimmed.length < minLength || trimmed.length < 2) return false;
    const ch = trimmed[0];
    if (!RST_UNDERLINE_CHARS.has(ch)) return false;
    // All characters must be the same
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] !== ch) return false;
    }
    return true;
  }

  /**
   * Chunk a single markdown/RST section.
   * Preserves code blocks and tables as atomic units.
   */
  _chunkSection(section, filePath, bodyLineOffset, frontmatter, language = 'markdown') {
    const { content, title, hierarchy, lineStart, lineEnd } = section;
    const trimmed = content.trim();

    if (trimmed.length < this.minChunkSize) return [];

    // Detect content type
    const containsCode = /```[\s\S]*?```/.test(trimmed);
    const containsTable = /\|.+\|/.test(trimmed) && /\|[\s-:]+\|/.test(trimmed);
    const contentType = containsCode ? 'code' : containsTable ? 'table' : 'prose';

    // Build extra metadata
    const extraMeta = {
      header_hierarchy: hierarchy,
      content_type: contentType,
      contains_code: containsCode,
      contains_table: containsTable,
    };
    if (frontmatter) extraMeta.frontmatter = frontmatter;

    const absLineStart = bodyLineOffset + lineStart;
    const absLineEnd = bodyLineOffset + lineEnd;

    // If section fits in one chunk, emit directly
    if (trimmed.length <= this.maxChunkSize) {
      return [buildDocChunk(
        trimmed, filePath, language, 'section',
        title || 'untitled',
        absLineStart, absLineEnd + 1,
        this.projectRoot, extraMeta,
      )];
    }

    // Section too large — split while preserving atomic blocks
    return this._splitLargeSection(
      trimmed, filePath, title, hierarchy, frontmatter,
      absLineStart, absLineEnd, extraMeta, language,
    );
  }

  /**
   * Split an oversized section while respecting atomic blocks
   * (code fences, tables).
   */
  _splitLargeSection(content, filePath, title, hierarchy, frontmatter, lineStart, lineEnd, extraMeta, language = 'markdown') {
    const chunks = [];
    const blocks = this._identifyAtomicBlocks(content);
    const totalLines = content.split('\n').length;

    // Process blocks: emit atomic blocks whole, recursively split prose
    for (const block of blocks) {
      if (block.type === 'code' || block.type === 'table') {
        // Atomic block — emit as single chunk even if oversized
        if (block.content.trim().length >= this.minChunkSize) {
          const blockLineStart = lineStart + block.relLineStart;
          const blockLineEnd = lineStart + block.relLineEnd;
          chunks.push(buildDocChunk(
            block.content, filePath, language,
            block.type === 'code' ? 'code_block' : 'table',
            title || 'untitled',
            blockLineStart, blockLineEnd + 1,
            this.projectRoot,
            { ...extraMeta, content_type: block.type },
          ));
        }
      } else {
        // Prose — recursive split
        const proseChunks = recursiveSplit(block.content, this.maxChunkSize);
        let runningLine = lineStart + block.relLineStart;

        for (const piece of proseChunks) {
          if (piece.trim().length < this.minChunkSize) continue;
          const pieceLines = piece.split('\n').length;
          chunks.push(buildDocChunk(
            piece, filePath, language, 'section',
            title || 'untitled',
            runningLine, runningLine + pieceLines,
            this.projectRoot, extraMeta,
          ));
          runningLine += pieceLines;
        }
      }
    }

    return chunks;
  }

  /**
   * Identify atomic (no-split) blocks within markdown content.
   * Returns an array of {type, content, relLineStart, relLineEnd} objects.
   */
  _identifyAtomicBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    let currentProse = [];
    let proseStart = 0;
    let inCodeBlock = false;
    let codeBlockStart = 0;
    let codeBlockLines = [];
    let inTable = false;
    let tableStart = 0;
    let tableLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code fence toggle
      if (line.trimStart().startsWith('```')) {
        if (!inCodeBlock) {
          // Flush prose
          if (currentProse.length > 0) {
            blocks.push({
              type: 'prose',
              content: currentProse.join('\n'),
              relLineStart: proseStart,
              relLineEnd: i - 1,
            });
            currentProse = [];
          }
          inCodeBlock = true;
          codeBlockStart = i;
          codeBlockLines = [line];
        } else {
          codeBlockLines.push(line);
          blocks.push({
            type: 'code',
            content: codeBlockLines.join('\n'),
            relLineStart: codeBlockStart,
            relLineEnd: i,
          });
          inCodeBlock = false;
          codeBlockLines = [];
          proseStart = i + 1;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Table detection
      const isTableLine = /^\|.+\|/.test(line.trim());
      if (isTableLine) {
        if (!inTable) {
          // Flush prose before table
          if (currentProse.length > 0) {
            blocks.push({
              type: 'prose',
              content: currentProse.join('\n'),
              relLineStart: proseStart,
              relLineEnd: i - 1,
            });
            currentProse = [];
          }
          inTable = true;
          tableStart = i;
          tableLines = [];
        }
        tableLines.push(line);
        continue;
      }

      // End of table
      if (inTable) {
        blocks.push({
          type: 'table',
          content: tableLines.join('\n'),
          relLineStart: tableStart,
          relLineEnd: i - 1,
        });
        inTable = false;
        tableLines = [];
        proseStart = i;
      }

      // Regular prose
      if (currentProse.length === 0) proseStart = i;
      currentProse.push(line);
    }

    // Flush remaining
    if (inCodeBlock && codeBlockLines.length > 0) {
      // Unclosed code block — treat as code anyway
      blocks.push({
        type: 'code',
        content: codeBlockLines.join('\n'),
        relLineStart: codeBlockStart,
        relLineEnd: lines.length - 1,
      });
    } else if (inTable && tableLines.length > 0) {
      blocks.push({
        type: 'table',
        content: tableLines.join('\n'),
        relLineStart: tableStart,
        relLineEnd: lines.length - 1,
      });
    }

    if (currentProse.length > 0) {
      blocks.push({
        type: 'prose',
        content: currentProse.join('\n'),
        relLineStart: proseStart,
        relLineEnd: lines.length - 1,
      });
    }

    return blocks;
  }
}

export default MarkdownChunker;
