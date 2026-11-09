/**
 * Document Chunker facade: dispatches to the chunker for the file extension.
 */

import path from 'path';
import { MarkdownChunker } from './chunking/markdown-chunker.js';
import { PlainTextChunker } from './chunking/plaintext-chunker.js';
import { recursiveSplit, buildDocChunk, hashContent } from './chunking/chunk-builder.js';

export const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);

/** Drop-in replacement for ASTChunker.parseGenericFile for document files. */
export class DocumentChunker {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.markdown = new MarkdownChunker({ ...options, projectRoot: this.projectRoot });
    this.plaintext = new PlainTextChunker({ ...options, projectRoot: this.projectRoot });
  }

  parseFile(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.md':
      case '.mdx':
      case '.rst':
        // MarkdownChunker handles both Markdown (#-headers) and RST
        // (underline-style headers) via internal dispatch on extension.
        return this.markdown.parseFile(filePath, content);

      default:
        return this.plaintext.parseFile(filePath, content);
    }
  }
}

export { MarkdownChunker, PlainTextChunker, recursiveSplit, buildDocChunk, hashContent };
