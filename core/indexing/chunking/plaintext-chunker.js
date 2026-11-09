/**
 * Plain text document chunker.
 */

import { TXT_DEFAULTS, buildDocChunk, recursiveSplit } from './chunk-builder.js';

export class PlainTextChunker {
  constructor(options = {}) {
    this.maxChunkSize = options.maxChunkSize || TXT_DEFAULTS.maxChunkSize;
    this.minChunkSize = options.minChunkSize || TXT_DEFAULTS.minChunkSize;
    this.overlapFraction = options.overlapFraction ?? TXT_DEFAULTS.overlapFraction;
    this.projectRoot = options.projectRoot || process.cwd();
  }

  /**
   * Parse a plain text file into chunks.
   *
   * @param {string} filePath
   * @param {string} content
   * @returns {Array<object>} Chunk objects compatible with ASTChunker output
   */
  parseFile(filePath, content) {
    if (!content || content.trim().length < this.minChunkSize) return [];

    const rawPieces = recursiveSplit(content, this.maxChunkSize);

    const pieces = this._applyOverlap(rawPieces);

    const chunks = [];
    let charOffset = 0;

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const trimmed = piece.trim();
      if (trimmed.length < this.minChunkSize) continue;

      const startChar = content.indexOf(piece, charOffset);
      const actualStart = startChar >= 0 ? startChar : charOffset;
      const endChar = actualStart + piece.length;

      const startLine = content.slice(0, actualStart).split('\n').length - 1;
      const endLine = content.slice(0, endChar).split('\n').length - 1;

      chunks.push(buildDocChunk(
        piece, filePath, 'plaintext', 'paragraph',
        `chunk_${i + 1}`,
        startLine, endLine + 1,
        this.projectRoot,
        {
          chunk_index: i,
          total_chunks: pieces.length,
          start_char: actualStart,
          end_char: endChar,
        },
      ));

      charOffset = actualStart + piece.length;
    }

    return chunks;
  }

  _applyOverlap(pieces) {
    if (pieces.length <= 1 || this.overlapFraction <= 0) return pieces;

    const result = [];

    for (let i = 0; i < pieces.length; i++) {
      let piece = pieces[i];

      if (i > 0) {
        const prevPiece = pieces[i - 1];
        const overlapChars = Math.floor(prevPiece.length * this.overlapFraction);
        if (overlapChars > 0) {
          const overlap = prevPiece.slice(-overlapChars);
          piece = overlap + piece;
          if (piece.length > this.maxChunkSize) {
            piece = piece.slice(0, this.maxChunkSize);
          }
        }
      }

      result.push(piece);
    }

    return result;
  }
}

export default PlainTextChunker;
