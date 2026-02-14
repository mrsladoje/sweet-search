/**
 * Document Chunker facade — compatibility layer.
 *
 * Exposes the same public API as before while delegating implementation to
 * split modules for smaller context windows and cleaner responsibilities.
 */

import path from 'path';
import { MarkdownChunker } from './chunking/markdown-chunker.js';
import { PlainTextChunker } from './chunking/plaintext-chunker.js';
import { recursiveSplit, buildDocChunk, hashContent } from './chunking/chunk-builder.js';

// =============================================================================
// DOCUMENT CHUNKER FACADE
// =============================================================================

/**
 * Facade that dispatches to the appropriate chunker based on file extension.
 * Drop-in replacement for ASTChunker.parseGenericFile for document files.
 */
export class DocumentChunker {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.markdown = new MarkdownChunker({ ...options, projectRoot: this.projectRoot });
    this.plaintext = new PlainTextChunker({ ...options, projectRoot: this.projectRoot });
  }

  /**
   * Parse a document file into chunks.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>}
   */
  parseFile(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.md':
      case '.mdx':
      case '.rst':
        // MarkdownChunker handles both Markdown (#-headers) and RST
        // (underline-style headers) via internal dispatch on extension.
        return this.markdown.parseFile(filePath, content);

      case '.txt':
        return this.plaintext.parseFile(filePath, content);

      default:
        // Fallback: treat as plain text
        return this.plaintext.parseFile(filePath, content);
    }
  }
}

export { MarkdownChunker, PlainTextChunker, recursiveSplit, buildDocChunk, hashContent };
