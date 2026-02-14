/**
 * Shared chunk-builder utilities for document chunking.
 */

import { createHash } from 'crypto';
import path from 'path';
import { detectProjectBoundary } from '../project-detector.js';

const MAX_CHUNK_SIZE = 2000;  // chars — matches ast-chunker.js
const MIN_CHUNK_SIZE = 30;    // chars — matches ast-chunker.js threshold

/** Default config for markdown chunker */
const MD_DEFAULTS = {
  maxChunkSize: MAX_CHUNK_SIZE,
  minChunkSize: MIN_CHUNK_SIZE,
  overlapLines: 2,
};

/** Default config for plain text chunker */
const TXT_DEFAULTS = {
  maxChunkSize: MAX_CHUNK_SIZE,
  minChunkSize: MIN_CHUNK_SIZE,
  overlapFraction: 0.15,       // 15% overlap
};

/** Separator hierarchy for recursive splitting (priority order) */
const SEPARATOR_HIERARCHY = [
  '\n\n',                        // paragraph breaks
  '\n',                          // line breaks
  /(?<=[.!?])\s+/,              // sentence endings
  /(?<=[;])\s+/,                // clause boundaries
  /(?<=[,])\s+/,                // phrase boundaries
  ' ',                           // word boundaries
];

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build a chunk object matching ASTChunker.buildChunk() shape.
 *
 * Uses detectProjectBoundary for the project tag, matching ASTChunker.inferProjectTag().
 */
function buildDocChunk(content, filePath, language, chunkType, symbol, lineStart, lineEnd, projectRoot, extraMeta = {}) {
  const trimmed = content.trim();
  const hash = hashContent(trimmed);
  const relativePath = projectRoot ? path.relative(projectRoot, filePath) : filePath;
  const { name: projectTag } = detectProjectBoundary(filePath, projectRoot || process.cwd());

  return {
    text: trimmed,
    content: trimmed,
    metadata: {
      type: 'document',
      file: path.basename(filePath),
      path: relativePath,
      language,
      chunk_type: chunkType,
      symbol,
      line_start: lineStart + 1,    // 1-indexed
      line_end: lineEnd,
      hash,
      ...extraMeta,
    },
    tags: ['document', language, projectTag],
  };
}

/**
 * Recursively split text using a separator hierarchy.
 * Tries the highest-priority separator first; if any resulting piece
 * still exceeds maxSize, recurse with the next separator.
 *
 * @param {string} text
 * @param {number} maxSize
 * @param {number} [sepIdx=0] - Current index in SEPARATOR_HIERARCHY
 * @returns {string[]}
 */
function recursiveSplit(text, maxSize, sepIdx = 0) {
  if (text.length <= maxSize) return [text];
  if (sepIdx >= SEPARATOR_HIERARCHY.length) {
    // Last resort: hard split at maxSize
    const pieces = [];
    for (let i = 0; i < text.length; i += maxSize) {
      pieces.push(text.slice(i, i + maxSize));
    }
    return pieces;
  }

  const sep = SEPARATOR_HIERARCHY[sepIdx];
  let parts;

  if (sep instanceof RegExp) {
    // Split on regex but keep delimiters at end of preceding part
    parts = [];
    let lastIdx = 0;
    const globalRe = new RegExp(sep.source, 'g');
    let m;
    while ((m = globalRe.exec(text)) !== null) {
      // Include the match in the preceding part
      parts.push(text.slice(lastIdx, m.index + m[0].length));
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      parts.push(text.slice(lastIdx));
    }
  } else {
    parts = text.split(sep);
    // Re-join with separator (except last)
    parts = parts.map((p, i) => i < parts.length - 1 ? p + sep : p);
  }

  // Filter empty
  parts = parts.filter(p => p.length > 0);

  // If we couldn't split (only one piece), try next separator
  if (parts.length <= 1) {
    return recursiveSplit(text, maxSize, sepIdx + 1);
  }

  // Merge small consecutive parts, then recurse on oversized ones
  const merged = [];
  let buffer = '';

  for (const part of parts) {
    if (buffer.length + part.length <= maxSize) {
      buffer += part;
    } else {
      if (buffer.length > 0) merged.push(buffer);
      buffer = part;
    }
  }
  if (buffer.length > 0) merged.push(buffer);

  // Recurse on any oversized pieces
  const result = [];
  for (const piece of merged) {
    if (piece.length > maxSize) {
      result.push(...recursiveSplit(piece, maxSize, sepIdx + 1));
    } else {
      result.push(piece);
    }
  }

  return result;
}

export {
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MD_DEFAULTS,
  TXT_DEFAULTS,
  SEPARATOR_HIERARCHY,
  hashContent,
  buildDocChunk,
  recursiveSplit,
};
