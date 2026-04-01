/**
 * Document Chunker tests
 * Covers: MarkdownChunker, PlainTextChunker, DocumentChunker facade, RST support
 */

import { describe, it, expect } from 'vitest';
import { MarkdownChunker, PlainTextChunker, DocumentChunker, recursiveSplit } from '../../core/indexing/document-chunker.js';

const mdChunker = new MarkdownChunker({ projectRoot: '/test' });
const txtChunker = new PlainTextChunker({ projectRoot: '/test' });
const docChunker = new DocumentChunker({ projectRoot: '/test' });

// =============================================================================
// MARKDOWN CHUNKER
// =============================================================================

describe('MarkdownChunker', () => {
  describe('frontmatter extraction', () => {
    it('extracts YAML frontmatter and attaches to chunks', () => {
      const md = [
        '---',
        'title: My Guide',
        'author: Jane Doe',
        'tags: [api, auth, rest]',
        '---',
        '',
        '# Introduction',
        '',
        'This is a guide about building APIs with proper authentication.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/guide.md', md);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.frontmatter).toBeDefined();
      expect(chunks[0].metadata.frontmatter.title).toBe('My Guide');
      expect(chunks[0].metadata.frontmatter.author).toBe('Jane Doe');
      expect(chunks[0].metadata.frontmatter.tags).toEqual(['api', 'auth', 'rest']);
    });

    it('handles documents without frontmatter', () => {
      const md = '# Hello World\n\nSome content here that is long enough to be a chunk.';
      const chunks = mdChunker.parseFile('/test/hello.md', md);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.frontmatter).toBeUndefined();
    });

    it('handles quoted frontmatter values', () => {
      const md = [
        '---',
        "title: 'Quoted Title'",
        'description: "Double quoted"',
        '---',
        '',
        '# Content',
        '',
        'Body text that is long enough to pass the minimum chunk threshold.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/quoted.md', md);
      expect(chunks[0].metadata.frontmatter.title).toBe('Quoted Title');
      expect(chunks[0].metadata.frontmatter.description).toBe('Double quoted');
    });
  });

  describe('header splitting', () => {
    it('splits on header boundaries with hierarchy', () => {
      const md = [
        '# Top Level',
        '',
        'Introduction text that is long enough to form a chunk on its own.',
        '',
        '## Section A',
        '',
        'Content for section A that is long enough to form a chunk on its own.',
        '',
        '## Section B',
        '',
        'Content for section B that is long enough to form a chunk on its own.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/headers.md', md);
      expect(chunks.length).toBe(3);
      expect(chunks[0].metadata.symbol).toBe('Top Level');
      expect(chunks[1].metadata.symbol).toBe('Section A');
      expect(chunks[2].metadata.symbol).toBe('Section B');
    });

    it('preserves header hierarchy in metadata', () => {
      const md = [
        '# API Reference',
        '',
        '## Authentication',
        '',
        '### OAuth2',
        '',
        'OAuth2 implementation details that are long enough to chunk properly here.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/hierarchy.md', md);
      const oauth2Chunk = chunks.find(c => c.metadata.symbol === 'OAuth2');
      expect(oauth2Chunk).toBeDefined();
      expect(oauth2Chunk.metadata.header_hierarchy).toEqual({
        h1: 'API Reference',
        h2: 'Authentication',
        h3: 'OAuth2',
      });
    });

    it('resets deeper levels when a shallower header appears', () => {
      const md = [
        '# Part 1',
        '',
        '## Chapter A',
        '',
        '### Detail about this chapter that is long enough for a chunk.',
        '',
        '## Chapter B',
        '',
        'Content for chapter B that is long enough to be its own chunk here.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/reset.md', md);
      const chB = chunks.find(c => c.metadata.symbol === 'Chapter B');
      expect(chB).toBeDefined();
      // h3 should NOT be present since we went back to h2
      expect(chB.metadata.header_hierarchy.h3).toBeUndefined();
      expect(chB.metadata.header_hierarchy.h1).toBe('Part 1');
      expect(chB.metadata.header_hierarchy.h2).toBe('Chapter B');
    });
  });

  describe('code block preservation', () => {
    it('never splits inside code blocks', () => {
      const md = [
        '# Code Example',
        '',
        'Here is some code:',
        '',
        '```javascript',
        'function hello() {',
        '  console.log("Hello, World!");',
        '  return true;',
        '}',
        '```',
        '',
        'And some more text after the code block to make it substantial.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/code.md', md);
      expect(chunks.length).toBeGreaterThan(0);
      // Every chunk containing code should have the full code block
      for (const chunk of chunks) {
        if (chunk.text.includes('```javascript')) {
          expect(chunk.text).toContain('function hello()');
          expect(chunk.text).toContain('```');
        }
      }
    });

    it('keeps oversized code blocks as single chunks', () => {
      const longCode = Array.from({ length: 100 }, (_, i) =>
        `  const var${i} = computeValue(${i});`
      ).join('\n');

      const md = [
        '# Large Code Block',
        '',
        '```javascript',
        longCode,
        '```',
      ].join('\n');

      const chunkerSmall = new MarkdownChunker({ projectRoot: '/test', maxChunkSize: 500 });
      const chunks = chunkerSmall.parseFile('/test/docs/large-code.md', md);
      // The code block should exist as a single chunk, even if oversized
      const codeChunk = chunks.find(c => c.metadata.content_type === 'code');
      if (codeChunk) {
        expect(codeChunk.text).toContain('const var0');
        expect(codeChunk.text).toContain('const var99');
      }
    });

    it('detects contains_code metadata', () => {
      const md = [
        '# Has Code',
        '',
        'Some text followed by a code block:',
        '',
        '```python',
        'def greet(name):',
        '    return f"Hello, {name}"',
        '```',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/has-code.md', md);
      expect(chunks[0].metadata.contains_code).toBe(true);
    });
  });

  describe('table handling', () => {
    it('keeps tables as atomic units', () => {
      const md = [
        '# Data Table',
        '',
        '| Name | Age | City |',
        '|------|-----|------|',
        '| Alice | 30 | NYC |',
        '| Bob | 25 | LA |',
        '| Carol | 35 | SF |',
        '',
        'Some text after the table that is long enough to matter.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/table.md', md);
      expect(chunks.length).toBeGreaterThan(0);
      // Table should be intact in some chunk
      const tableChunk = chunks.find(c => c.text.includes('| Alice |'));
      expect(tableChunk).toBeDefined();
      expect(tableChunk.text).toContain('| Bob |');
      expect(tableChunk.text).toContain('| Carol |');
    });

    it('detects contains_table metadata', () => {
      const md = [
        '# Table Section',
        '',
        '| Col1 | Col2 |',
        '|------|------|',
        '| val1 | val2 |',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/table-meta.md', md);
      expect(chunks[0].metadata.contains_table).toBe(true);
    });
  });

  describe('chunk data structure', () => {
    it('produces chunks with correct metadata shape', () => {
      const md = [
        '# Test Section',
        '',
        'This is a paragraph of text that is long enough to be chunked properly.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/structure.md', md);
      const chunk = chunks[0];

      expect(chunk).toHaveProperty('text');
      expect(chunk).toHaveProperty('content');
      expect(chunk.text).toBe(chunk.content);
      expect(chunk.metadata).toHaveProperty('type', 'document');
      expect(chunk.metadata).toHaveProperty('file', 'structure.md');
      expect(chunk.metadata).toHaveProperty('path');
      expect(chunk.metadata).toHaveProperty('language', 'markdown');
      expect(chunk.metadata).toHaveProperty('chunk_type');
      expect(chunk.metadata).toHaveProperty('symbol');
      expect(chunk.metadata).toHaveProperty('line_start');
      expect(chunk.metadata).toHaveProperty('line_end');
      expect(chunk.metadata).toHaveProperty('hash');
      expect(chunk.metadata.hash).toHaveLength(16);
      expect(chunk).toHaveProperty('tags');
      expect(chunk.tags).toContain('document');
      expect(chunk.tags).toContain('markdown');
    });

    it('uses detectProjectBoundary for project tag (matches ASTChunker)', async () => {
      const md = '# Section\n\nContent long enough to be a valid chunk for testing.';
      const docChunks = mdChunker.parseFile('/test/docs/project-tag.md', md);
      const docChunk = docChunks[0];

      // Parse a code file with ASTChunker to get reference project tag
      const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
      const astChunker = new ASTChunker({ projectRoot: '/test' });
      const jsContent = 'function foo() { return true; }\n\nfunction bar() { return false; }';
      const astChunks = await astChunker.parseFile('/test/docs/helper.js', jsContent);
      const astChunk = astChunks[0];

      expect(docChunk.tags).toHaveLength(3);
      expect(astChunk.tags).toHaveLength(3);
      // Both use detectProjectBoundary; same projectRoot → same project tag
      expect(docChunk.tags[2]).toBe(astChunk.tags[2]);
      expect(docChunk.tags[2].length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty document', () => {
      const chunks = mdChunker.parseFile('/test/docs/empty.md', '');
      expect(chunks).toEqual([]);
    });

    it('handles document with only frontmatter', () => {
      const md = '---\ntitle: Empty\n---\n';
      const chunks = mdChunker.parseFile('/test/docs/fm-only.md', md);
      expect(chunks).toEqual([]);
    });

    it('handles single-line document', () => {
      const chunks = mdChunker.parseFile('/test/docs/tiny.md', 'Hello');
      expect(chunks).toEqual([]);  // Below min chunk size
    });

    it('handles document with no headers', () => {
      const md = 'This is a plain paragraph without any headers but long enough to be a chunk.\n\nAnother paragraph here.';
      const chunks = mdChunker.parseFile('/test/docs/no-headers.md', md);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.symbol).toBe('untitled');
    });

    it('handles deeply nested headers', () => {
      const md = [
        '# L1',
        '## L2',
        '### L3',
        '#### L4',
        '##### L5',
        '###### L6',
        '',
        'Content at the deepest level is long enough to be a chunk here.',
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/deep.md', md);
      const deepChunk = chunks.find(c => c.metadata.symbol === 'L6');
      expect(deepChunk).toBeDefined();
      expect(deepChunk.metadata.header_hierarchy).toEqual({
        h1: 'L1', h2: 'L2', h3: 'L3', h4: 'L4', h5: 'L5', h6: 'L6',
      });
    });

    it('handles unclosed code blocks', () => {
      const md = [
        '# Broken',
        '',
        '```python',
        'def broken():',
        '    pass',
        // Missing closing ```
      ].join('\n');

      const chunks = mdChunker.parseFile('/test/docs/unclosed.md', md);
      // Should not crash, and should still produce chunks
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// RST CHUNKER (reStructuredText support)
// =============================================================================

describe('RST support', () => {
  it('splits on RST underline-style headers', () => {
    const rst = [
      'Introduction',
      '============',
      '',
      'This is the introductory section with enough text for a chunk.',
      '',
      'Getting Started',
      '===============',
      '',
      'This section explains how to get started with the system here.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/guide.rst', rst);
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('Introduction');
    expect(chunks[1].metadata.symbol).toBe('Getting Started');
  });

  it('assigns RST header levels by order of first appearance', () => {
    const rst = [
      'Top Level Title',
      '===============',
      '',
      'Top level content that is long enough for chunking properly here.',
      '',
      'Subsection',
      '----------',
      '',
      'Subsection content that is long enough to be a chunk on its own.',
      '',
      'Another Subsection',
      '------------------',
      '',
      'More subsection text that meets the minimum threshold for chunking.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/levels.rst', rst);
    // = appears first → level 1, - appears second → level 2
    const sub = chunks.find(c => c.metadata.symbol === 'Subsection');
    expect(sub).toBeDefined();
    expect(sub.metadata.header_hierarchy).toEqual({
      h1: 'Top Level Title',
      h2: 'Subsection',
    });
  });

  it('handles RST overline+underline headers', () => {
    const rst = [
      '###########',
      'Main Title',
      '###########',
      '',
      'Content under the main title that is long enough to be a chunk.',
      '',
      'Section',
      '=======',
      '',
      'Section content long enough to meet the minimum chunk threshold.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/overline.rst', rst);
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.symbol).toBe('Main Title');
    expect(chunks[1].metadata.symbol).toBe('Section');
    // Overline # → level 1 (over_#), underline = → level 2
    expect(chunks[0].metadata.header_hierarchy.h1).toBe('Main Title');
  });

  it('sets language to rst for .rst files', () => {
    const rst = [
      'Title',
      '=====',
      '',
      'Content that is long enough to meet the minimum chunk size threshold.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/lang.rst', rst);
    expect(chunks[0].metadata.language).toBe('rst');
  });

  it('does not apply frontmatter extraction to RST files', () => {
    const rst = [
      '---',
      'title: Not Frontmatter',
      '---',
      '',
      'RST document with YAML-like content that is long enough for chunk.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/no-fm.rst', rst);
    expect(chunks.length).toBeGreaterThan(0);
    // RST should NOT parse frontmatter
    expect(chunks[0].metadata.frontmatter).toBeUndefined();
  });

  it('ignores lines that look like underlines but are too short', () => {
    const rst = [
      'A very long title that exceeds the underline',
      '===',
      '',
      'Content that is long enough to meet the minimum chunk size threshold.',
    ].join('\n');

    const chunks = mdChunker.parseFile('/test/docs/short-underline.rst', rst);
    // Underline is shorter than title → not a header → no split
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBe('untitled');
  });
});

// =============================================================================
// PLAIN TEXT CHUNKER
// =============================================================================

describe('PlainTextChunker', () => {
  describe('paragraph splitting', () => {
    it('splits on paragraph boundaries', () => {
      const text = [
        'First paragraph with enough content to form a chunk.',
        '',
        'Second paragraph with different content that forms another chunk.',
        '',
        'Third paragraph that completes this test document properly.',
      ].join('\n');

      const chunks = txtChunker.parseFile('/test/notes.txt', text);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.language).toBe('plaintext');
    });

    it('applies overlap: second chunk contains content from end of first', () => {
      // Build text that will produce multiple chunks with clear content
      const paragraphs = Array.from({ length: 30 }, (_, i) =>
        `Paragraph ${i}: This is a unique sentence with distinctive content number ${i}.`
      );
      const longText = paragraphs.join('\n');

      const chunkerWithOverlap = new PlainTextChunker({
        projectRoot: '/test',
        maxChunkSize: 300,
        overlapFraction: 0.3,  // 30% overlap — large enough to be obvious
      });
      const chunks = chunkerWithOverlap.parseFile('/test/overlap.txt', longText);

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // The tail of chunk[0] should appear at the start of chunk[1]
      // because _applyOverlap prepends overlapFraction of previous piece
      const firstChunkText = chunks[0].text;
      const secondChunkText = chunks[1].text;

      // Extract the last N chars from first chunk (what should be overlapped)
      const overlapSize = Math.floor(firstChunkText.length * 0.2); // conservative check
      const tailOfFirst = firstChunkText.slice(-overlapSize);

      // The second chunk must start with content that was at the end of the first
      expect(secondChunkText).toContain(tailOfFirst);
    });

    it('produces no overlap when overlapFraction is 0', () => {
      const paragraphs = Array.from({ length: 30 }, (_, i) =>
        `Paragraph ${i}: Distinct sentence with unique content number ${i}.`
      );
      const longText = paragraphs.join('\n');

      const chunkerNoOverlap = new PlainTextChunker({
        projectRoot: '/test',
        maxChunkSize: 300,
        overlapFraction: 0,
      });
      const chunks = chunkerNoOverlap.parseFile('/test/no-overlap.txt', longText);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // With 0 overlap, second chunk should NOT start with the end of first
      const firstTail = chunks[0].text.slice(-20);
      expect(chunks[1].text.startsWith(firstTail)).toBe(false);
    });
  });

  describe('chunk metadata', () => {
    it('includes positional metadata with correct values', () => {
      const text = 'Some text content that is long enough to form a valid chunk.\n\nAnother paragraph here with more content.';
      const chunks = txtChunker.parseFile('/test/meta.txt', text);
      const chunk = chunks[0];

      expect(chunk.metadata).toHaveProperty('chunk_index');
      expect(chunk.metadata).toHaveProperty('total_chunks');
      expect(chunk.metadata).toHaveProperty('start_char');
      expect(chunk.metadata).toHaveProperty('end_char');
      expect(chunk.metadata.chunk_index).toBe(0);
      expect(chunk.metadata.start_char).toBeGreaterThanOrEqual(0);
      expect(chunk.metadata.end_char).toBeGreaterThan(chunk.metadata.start_char);
      // end_char - start_char should roughly match content length
      expect(chunk.metadata.end_char - chunk.metadata.start_char).toBeGreaterThan(0);
    });

    it('has correct data structure', () => {
      const text = 'A document with enough content to be chunked properly for testing purposes.';
      const chunks = txtChunker.parseFile('/test/struct.txt', text);
      const chunk = chunks[0];

      expect(chunk).toHaveProperty('text');
      expect(chunk).toHaveProperty('content');
      expect(chunk.text).toBe(chunk.content);
      expect(chunk.metadata).toHaveProperty('type', 'document');
      expect(chunk.metadata).toHaveProperty('language', 'plaintext');
      expect(chunk.metadata).toHaveProperty('chunk_type', 'paragraph');
      expect(chunk.metadata).toHaveProperty('hash');
      expect(chunk.tags).toContain('document');
      expect(chunk.tags).toContain('plaintext');
    });
  });

  describe('edge cases', () => {
    it('handles empty text', () => {
      const chunks = txtChunker.parseFile('/test/empty.txt', '');
      expect(chunks).toEqual([]);
    });

    it('handles very short text', () => {
      const chunks = txtChunker.parseFile('/test/short.txt', 'Hi');
      expect(chunks).toEqual([]);
    });

    it('handles text with only whitespace', () => {
      const chunks = txtChunker.parseFile('/test/ws.txt', '   \n\n   \n  ');
      expect(chunks).toEqual([]);
    });

    it('handles single long line', () => {
      const longLine = 'word '.repeat(500);
      const chunks = txtChunker.parseFile('/test/longline.txt', longLine);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// RECURSIVE SPLIT UTILITY
// =============================================================================

describe('recursiveSplit', () => {
  it('returns text as-is when under max size', () => {
    const result = recursiveSplit('short text', 100);
    expect(result).toEqual(['short text']);
  });

  it('splits on paragraph boundaries first', () => {
    const text = 'Paragraph one.\n\nParagraph two.';
    const result = recursiveSplit(text, 20);
    expect(result.length).toBe(2);
  });

  it('falls back to sentence splitting', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const result = recursiveSplit(text, 25);
    expect(result.length).toBeGreaterThan(1);
  });

  it('handles text with no good split points', () => {
    const text = 'a'.repeat(100);
    const result = recursiveSplit(text, 30);
    expect(result.length).toBeGreaterThan(1);
    // All pieces should be <= maxSize
    for (const piece of result) {
      expect(piece.length).toBeLessThanOrEqual(30 + 1);
    }
  });

  it('all pieces are within maxSize for mixed content', () => {
    const text = 'Hello world. This is a test. Another sentence here.\n\nNew paragraph with more words and content.';
    const maxSize = 40;
    const result = recursiveSplit(text, maxSize);
    for (const piece of result) {
      expect(piece.length).toBeLessThanOrEqual(maxSize);
    }
  });
});

// =============================================================================
// DOCUMENT CHUNKER FACADE
// =============================================================================

describe('DocumentChunker', () => {
  it('dispatches .md files to MarkdownChunker', () => {
    const md = '# Hello\n\nWorld is a large enough section to be chunked properly.';
    const chunks = docChunker.parseFile('/test/docs/hello.md', md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('markdown');
  });

  it('dispatches .mdx files to MarkdownChunker', () => {
    const md = '# Hello MDX\n\nContent that is long enough to pass the minimum threshold.';
    const chunks = docChunker.parseFile('/test/docs/hello.mdx', md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('markdown');
  });

  it('dispatches .txt files to PlainTextChunker', () => {
    const txt = 'A plain text file with enough content to be chunked by the plain text chunker.';
    const chunks = docChunker.parseFile('/test/notes.txt', txt);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('plaintext');
  });

  it('dispatches .rst files with RST underline headers', () => {
    const rst = [
      'RST Document',
      '============',
      '',
      'Content that is long enough to be properly chunked here.',
    ].join('\n');
    const chunks = docChunker.parseFile('/test/docs/hello.rst', rst);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('rst');
    expect(chunks[0].metadata.symbol).toBe('RST Document');
  });

  it('falls back to PlainTextChunker for unknown extensions', () => {
    const content = 'Some content in an unknown format that is long enough to chunk.';
    const chunks = docChunker.parseFile('/test/data.log', content);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('plaintext');
  });
});

// =============================================================================
// INTEGRATION: ASTChunker dispatch
// =============================================================================

describe('ASTChunker integration', () => {
  it('dispatches markdown files to DocumentChunker', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/test' });

    const md = [
      '# API Reference',
      '',
      '## Authentication',
      '',
      'Use bearer tokens for API authentication in all requests.',
      '',
      '## Endpoints',
      '',
      'The following endpoints are available for use in production.',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/docs/api.md', md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('markdown');
    expect(chunks[0].metadata.type).toBe('document');
  });

  it('dispatches text files to DocumentChunker', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/test' });

    const txt = 'A plain text document with enough content to be indexed and chunked properly.\n\nSecond paragraph.';
    const chunks = await chunker.parseFile('/test/notes.txt', txt);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('plaintext');
    expect(chunks[0].metadata.type).toBe('document');
  });

  it('dispatches RST files with proper header detection', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/test' });

    const rst = [
      'Installation Guide',
      '==================',
      '',
      'Follow these steps to install the software on your system.',
    ].join('\n');

    const chunks = await chunker.parseFile('/test/docs/install.rst', rst);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.language).toBe('rst');
    expect(chunks[0].metadata.symbol).toBe('Installation Guide');
  });

  it('still routes code files to AST chunker', async () => {
    const { ASTChunker } = await import('../../core/indexing/ast-chunker.js');
    const chunker = new ASTChunker({ projectRoot: '/test' });

    const js = 'function hello() {\n  console.log("hello");\n  return true;\n}';
    const chunks = await chunker.parseFile('/test/src/app.js', js);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.type).toBe('codebase');
    expect(chunks[0].metadata.language).toBe('javascript');
  });
});
