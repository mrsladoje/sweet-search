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
import { detectProjectBoundary } from '../infrastructure/project-detector.js';
import { getLanguageByPath, resolveLanguage } from '../infrastructure/language-patterns.js';
import { DocumentChunker } from './document-chunker.js';

const MAX_CHUNK_SIZE = 2000;
const MIN_CONTENT_LENGTH = 30;
const MAX_PEEK_LINES = 3;
const DEFAULT_MAX_REGEX_LINE_LENGTH = 4000;

// =============================================================================
// Embedding-text cap — RESEARCH / ABLATION INFRASTRUCTURE
// =============================================================================
//
// Production default: 2000, byte-identical to shipped v6.2.
//
// Set SWEET_SEARCH_EMBED_TEXT_CAP=N to raise/lower the slice ceiling on
// `embedding_text`, `li_text`, `li_greedy_text`, and the enriched form.
// The May-2026 chunk-overflow audit found 80.5% of overflowing chunks are
// header-pushed (raw content ≤2000, headers push the embedding text over),
// motivating an A/B vs slightly-larger caps. See eval/results/
// chunk-overflow-audit.md for the audit and eval/run_overflow_ablation.sh
// for the wiring. Does NOT alter the chunker max size — that lives behind
// SWEET_SEARCH_CHUNK_HEADER_OVERHEAD in tree-sitter-provider.js.
function getEmbedTextCap() {
  const v = parseInt(process.env.SWEET_SEARCH_EMBED_TEXT_CAP || '', 10);
  return Number.isFinite(v) && v >= 500 ? v : MAX_CHUNK_SIZE;
}

/**
 * Strip a trailing `_<hex>` slug from a path's final basename, before
 * its extension. Used by the Java family (Java/PHP/C#/Kotlin/Scala)
 * per the v6.2 language-conditioned policy.
 *
 *   javascript/Semantic-UI/Table_366c13.js -> javascript/Semantic-UI/Table.js
 *   src/Button.tsx (no slug) -> src/Button.tsx (unchanged)
 *
 * Exported for reuse in chunk-builder.js (document chunks) and tests.
 */
export function normalizePathSlug(relativePath) {
  if (!relativePath) return relativePath;
  return relativePath.replace(/_[0-9a-f]{6,}(\.[a-zA-Z0-9]+)$/, '$1');
}

// Languages that share Java's slug-stripped-path li_text policy.
// (At LI input routing time these will all be sent to chunk.li_text;
// see LI_TEXT_LANGUAGES in core/indexing/indexer-ann.js, which imports
// this set so the policy stays consistent in one place.)
export const JAVA_FAMILY = new Set([
  'java', 'php',
  'csharp', 'c#',
  'kotlin', 'scala',
]);

// =============================================================================
// Embedding-text variant switch — RESEARCH / ABLATION INFRASTRUCTURE
// =============================================================================
//
// Production behavior is fixed at variant=current and is byte-identical to
// shipped v6.2. None of the alternative variants below are recommended for
// production; an isolated R1 ablation in May 2026 found no variant beats
// shipped on total MRR@10 (see docs/JS_CHUNK_BLEEDING_ANALYSIS.md for the
// full table). The switch and helpers are kept ONLY so future R1
// experiments can be re-run without re-implementing the scaffolding.
//
// Default: SWEET_SEARCH_EMBED_TEXT_VARIANT unset → 'current' →
//          embedding_text + LI input both byte-identical to shipped.
//
// Available experiment variants (research use only):
//   current           shipped form (production default)
//   no_path           drop the # path line
//   normalized_path   slug-strip the trailing _<hex> in path
//   no_language       drop # Language: line
//   parent_only       path + parent only, drop function + language
//   enriched          identical to current here; also runs enrichment
//   code_breadcrumb   compact `# Parent.Symbol` or `# Parent::symbol`
//   signature         current + `# Signature: <multi-line-sig>` line
//                     between the symbol line and the language line.
//                     Signature is AST-extracted by tree-sitter (decl
//                     header up to body, whitespace-collapsed, capped
//                     at MAX_SIGNATURE_LENGTH). When no signature is
//                     available (regex fallback path, non-boundary
//                     chunks, or merged sibling buffers) this variant
//                     is byte-identical to `current`.
//   signature_rbphp   like `signature` but only for Ruby and PHP — the
//                     two languages where the May-2026 R1 ablation
//                     showed signatures helped (PHP +0.79 MRR@10,
//                     Ruby +0.58); other languages route to the same
//                     output as `current`. Motivated by per-language
//                     pareto front (matching v6.2 LI routing pattern).
//
// LI isolation: when a non-current variant is active, `chunk.li_greedy_text`
// still carries the shipped (variant=current) form, and pickLiInput() for
// non-Python/Java languages reads it — so an R1 experiment never
// contaminates the LI input. See enrichEmbeddingText() and pickLiInput().
const ENRICHMENT_VARIANTS = new Set(['current', 'enriched']);

function getEmbedTextVariant() {
  const v = (process.env.SWEET_SEARCH_EMBED_TEXT_VARIANT || 'current').toLowerCase();
  return [
    'current', 'no_path', 'normalized_path', 'no_language',
    'parent_only', 'enriched', 'code_breadcrumb',
    'signature', 'signature_rbphp',
  ].includes(v) ? v : 'current';
}

// Languages where the May-2026 ablation showed `signature` strictly
// helped on R1 MRR@10 (PHP +0.79, Ruby +0.58 vs current). The
// `signature_rbphp` variant only emits the # Signature: line for
// these — every other language gets exactly the `current` output.
const SIGNATURE_HELP_LANGUAGES = new Set(['ruby', 'php']);

export function shouldRunEnrichment() {
  return ENRICHMENT_VARIANTS.has(getEmbedTextVariant());
}

// `Foo::bar` for langs that conventionally use ::, `Foo.bar` otherwise.
// Used by the experimental code_breadcrumb variant only.
function breadcrumbSep(language) {
  return ['ruby', 'php', 'cpp', 'c++', 'rust'].includes(language) ? '::' : '.';
}

/**
 * Build `embedding_text` per the active R1 variant.
 *
 * Production callers always pass either no variant (env-driven, defaults
 * to 'current') or `variant: 'current'` explicitly — both produce text
 * byte-identical to shipped v6.2.
 *
 * `variant: 'current'` is also passed explicitly when populating
 * `chunk.li_greedy_text` so the LI stage sees the shipped form even
 * when the bi-encoder is consuming a different experimental variant.
 */
function buildEmbeddingText({ variant: variantOverride, content, relativePath, language, chunkType, symbol, hierarchyInfo }) {
  const variant = variantOverride || getEmbedTextVariant();
  const trimmed = content.trim();
  const parts = [];

  const pathLine = relativePath ? `# ${relativePath}` : null;
  const parentLine = hierarchyInfo?.parentSymbol
    ? `# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}` : null;
  // Ruby method chunks keep metadata anchors, but omit method-name header
  // text so top-level Ruby snippets stay aligned with the pre-method-boundary
  // embedding surface.
  const isRubyMethodChunk = language === 'ruby'
    && (chunkType === 'method' || chunkType === 'singleton_method');
  const symbolLine = (symbol && symbol !== 'unknown' && !isRubyMethodChunk)
    ? `# ${chunkType}: ${symbol}` : null;
  const langLine = (language && language !== 'text')
    ? `# Language: ${language}` : null;
  const signatureLine = hierarchyInfo?.signature
    ? `# Signature: ${hierarchyInfo.signature}` : null;
  // Multi-symbol header: when the cAST sibling-merge collapses several
  // top-level boundaries into one chunk (small Rust files with adjacent
  // free-standing fns, e.g. packaging.rs:is_package + detect_package_root),
  // the bi-encoder otherwise only sees the FIRST boundary's name. Adding
  // an `# Additional:` line surfaces sibling symbol names to the encoder
  // without changing chunk count or chunk text.
  const additionalLine = (hierarchyInfo?.additionalSymbols && hierarchyInfo.additionalSymbols.length > 0)
    ? `# Additional: ${hierarchyInfo.additionalSymbols.join(', ')}` : null;

  switch (variant) {
    case 'no_path':
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      if (langLine) parts.push(langLine);
      break;
    case 'normalized_path':
      if (relativePath) parts.push(`# ${normalizePathSlug(relativePath)}`);
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      if (langLine) parts.push(langLine);
      break;
    case 'no_language':
      if (pathLine) parts.push(pathLine);
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      break;
    case 'parent_only':
      if (pathLine) parts.push(pathLine);
      if (parentLine) parts.push(parentLine);
      break;
    case 'code_breadcrumb': {
      if (pathLine) parts.push(pathLine);
      const sep = breadcrumbSep(language);
      if (hierarchyInfo?.parentSymbol && symbol && symbol !== 'unknown') {
        parts.push(`# ${hierarchyInfo.parentSymbol}${sep}${symbol}`);
      } else if (symbol && symbol !== 'unknown') {
        parts.push(`# ${symbol}`);
      } else if (hierarchyInfo?.parentSymbol) {
        parts.push(`# ${hierarchyInfo.parentSymbol}`);
      }
      if (language && language !== 'text') parts.push(`# ${language}`);
      break;
    }
    case 'signature':
      // Same headers as current, plus a `# Signature:` line emitted
      // between the symbol line and the language line. When no
      // signature is available (regex fallback / merged sibling
      // buffer / non-boundary chunk), this is byte-identical to
      // current — the variant degrades gracefully.
      if (pathLine) parts.push(pathLine);
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      if (signatureLine) parts.push(signatureLine);
      if (langLine) parts.push(langLine);
      break;
    case 'signature_rbphp':
      // Lang-conditioned: emit signature only for Ruby and PHP (the
      // two languages where unconditional `signature` strictly helped
      // on the May-2026 R1 ablation). Every other language gets the
      // exact `current` output. Mirrors the v6.2 LI routing pattern.
      if (pathLine) parts.push(pathLine);
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      if (signatureLine && SIGNATURE_HELP_LANGUAGES.has(language)) {
        parts.push(signatureLine);
      }
      if (langLine) parts.push(langLine);
      break;
    case 'enriched':
    case 'current':
    default:
      if (pathLine) parts.push(pathLine);
      if (parentLine) parts.push(parentLine);
      if (symbolLine) parts.push(symbolLine);
      if (additionalLine) parts.push(additionalLine);
      if (langLine) parts.push(langLine);
      break;
  }

  parts.push(trimmed);
  return parts.join('\n').slice(0, getEmbedTextCap());
}

/**
 * Per-language path-line strategy for late-interaction MaxSim input.
 *
 *   - Python: no path line (at 97% MRR ceiling; path duplicated funcname).
 *   - Java family (Java, PHP, C#, Kotlin, Scala): slug-stripped path.
 *   - Everything else: full path. (For JS family, Ruby, Go, C/C++/Rust
 *     and unknown languages, the LI input router in indexer-ann.js
 *     bypasses li_text entirely and reads chunk.embedding_text directly,
 *     so this branch only matters as a fallback if those routes ever
 *     fail to find embedding_text.)
 */
function pathLineForLi(relativePath, language) {
  if (!relativePath) return null;
  if (language === 'python') return null;
  if (JAVA_FAMILY.has(language)) {
    return `# ${normalizePathSlug(relativePath)}`;
  }
  return `# ${relativePath}`;
}

/**
 * Build `li_text` — the text fed to lateon-code MaxSim reranking.
 *
 * v6.2 (2026-05): language-conditioned path strategy. All languages
 * share the same `# Parent / # symbol / # Language` label-shaped
 * headers and differ only in how (or whether) the path comment is
 * included. See pathLineForLi() docstring for the per-language map.
 *
 * Why language-conditioned vs uniform: per-language ablation showed
 * uniform policies always regress at least one language (greedy
 * regresses Python; v4 no-path regresses Ruby below baseline; v5
 * slug-strip-uniform hurts JS). The v6.2 split — Python skips the
 * path, Java family slug-strips, JS family / Ruby / Go / fallback get
 * the full enriched embedding_text — is the empirical pareto front.
 *
 * The actual routing of `li_text` vs `embedding_text` lives in
 * core/indexing/indexer-ann.js (`pickLiInput`).
 */
function buildLiText({ content, relativePath, language, chunkType, symbol, hierarchyInfo }) {
  const trimmed = content.trim();
  const lines = [];

  const pathLine = pathLineForLi(relativePath, language);
  if (pathLine) lines.push(pathLine);

  if (hierarchyInfo?.parentSymbol) {
    lines.push(`# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}`);
  }
  // Mirror the Ruby method header carve-out used by embedding_text.
  const isRubyMethodChunk = language === 'ruby'
    && (chunkType === 'method' || chunkType === 'singleton_method');
  if (symbol && symbol !== 'unknown' && !isRubyMethodChunk) {
    lines.push(`# ${chunkType}: ${symbol}`);
  }
  // Mirror embedding_text: surface sibling symbol names so the LI MaxSim
  // stage's input includes the same context as the bi-encoder embedding.
  if (hierarchyInfo?.additionalSymbols && hierarchyInfo.additionalSymbols.length > 0) {
    lines.push(`# Additional: ${hierarchyInfo.additionalSymbols.join(', ')}`);
  }
  if (language && language !== 'text') {
    lines.push(`# Language: ${language}`);
  }
  lines.push(trimmed);

  return lines.join('\n').slice(0, getEmbedTextCap());
}

/**
 * AST-like semantic code chunker supporting 35+ languages.
 * Uses regex boundary patterns from core/language-patterns.js registry.
 * Three parsing strategies: brace-based, indent-based, end-keyword.
 */
export class ASTChunker {
  constructor(options) {
    this.projectRoot = options?.projectRoot || process.cwd();
    this.warnOnPatternDrop = options?.warnOnPatternDrop || false;
    this.maxRegexLineLength = options?.maxRegexLineLength || DEFAULT_MAX_REGEX_LINE_LENGTH;
    this._useTreeSitter = options?.useTreeSitter !== false; // enabled by default
    this.debugCounters = {
      emptyCapture: {
        boundary: 0,
      },
      skippedLongLines: 0,
      byLanguage: {},
      byPattern: {},
    };
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

    // resolveLanguage handles per-file disambiguation of ambiguous extensions
    // (today: `.h` → c-vs-cpp) using a content scan for C++-only tokens.
    // Header-only C++ libraries (highway, Eigen, …) are routed to cpp so the
    // chunker uses tree-sitter-cpp instead of tree-sitter-c.
    const langInfo = resolveLanguage(filePath, content);
    if (!langInfo || !langInfo.chunker) {
      // Mapped-but-chunkerless languages (e.g. Clojure: no tree-sitter grammar,
      // and paren-delimited forms don't fit the brace/indent/endKeyword parsers)
      // fall back to lossless generic windowing but keep their resolved language
      // id so chunks are tagged 'clojure' rather than generic 'text'.
      return this.parseGenericFile(filePath, content, langInfo?.id || 'text');
    }

    // Try tree-sitter WASM first for supported languages
    if (this._useTreeSitter) {
      try {
        const tsChunks = await this._parseWithTreeSitter(filePath, content, langInfo);
        if (tsChunks) return tsChunks;
      } catch {
        // Tree-sitter failed silently, fall back to regex
      }
    }

    // Fallback: regex-based parsing
    const { id: language, chunker: patterns, indentBased, endKeyword, comment, blockKeywords } = langInfo;

    const multiLine = !!langInfo.multiLinePatterns;

    if (indentBased) {
      return this.parseIndentBasedFile(filePath, content, language, patterns, multiLine);
    }
    if (endKeyword) {
      return this.parseEndKeywordFile(filePath, content, language, patterns, endKeyword, blockKeywords, multiLine);
    }
    return this.parseBraceBasedFile(filePath, content, language, patterns, comment, multiLine);
  }

  /** Attempt tree-sitter WASM parse, returns chunks array or null */
  async _parseWithTreeSitter(filePath, content, langInfo) {
    const { getTreeSitterProvider } = await import('../infrastructure/tree-sitter-provider.js');
    const provider = getTreeSitterProvider();

    if (!await provider.isAvailable()) return null;
    if (!provider.hasLanguage(langInfo.id)) return null;

    const tsChunks = await provider.parseFileToChunks(content, langInfo.id);
    if (!tsChunks || tsChunks.length === 0) return null;

    return tsChunks.map(chunk => {
      const isTopLevelRubyMethod = langInfo.id === 'ruby'
        && (chunk.type === 'method' || chunk.type === 'singleton_method')
        && !chunk.parentSymbol;

      return this.buildChunk(
        chunk.text, filePath, langInfo.id,
        isTopLevelRubyMethod ? 'code' : chunk.type,
        isTopLevelRubyMethod ? null : chunk.name,
        chunk.startLine, chunk.endLine,
        {
          chunkId: chunk.chunkId,
          parentChunkId: chunk.parentChunkId,
          parentSymbol: chunk.parentSymbol,
          parentType: chunk.parentType,
          signature: chunk.signature || null,
          additionalSymbols: chunk.additionalSymbols || null,
        }
      );
    });
  }

  parseBraceBasedFile(filePath, content, language, patterns, comment, multiLine) {
    const chunks = [];
    const lines = content.split('\n');
    const hasTemplateInterpolation = (language === 'javascript');

    let currentChunk = null;
    let braceDepth = 0;
    let chunkStart = 0;
    const stripState = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Capture the comment state BEFORE _stripNonCode mutates it so we
      // can tell whether this line entered the iteration inside a block
      // comment (e.g. mid-Javadoc). Boundary detection must be skipped
      // for such lines — otherwise `_matchBoundary` happily matches
      // `public class MyClass {` inside a Java `/** ... <pre> ... */`
      // example and emits a phantom class chunk. Verified on gson
      // SerializedName.java where the regex fallback path emits a
      // 25-82 chunk attributed to "class MyClass" sourced from the
      // Javadoc body. See the matching extractJava() block-comment
      // skip in core/graph/graph-extractor.js for the symmetric fix.
      const inBlockCommentAtStart = stripState.inBlockComment;
      const stripped = this._stripNonCode(line, stripState, comment, hasTemplateInterpolation);

      braceDepth += (stripped.match(/{/g) || []).length;
      braceDepth -= (stripped.match(/}/g) || []).length;

      // When the line is entirely inside a block comment (entered as
      // such AND still inside on exit), there's nothing executable to
      // match — skip boundary detection entirely. The stripped output
      // is already empty/whitespace so brace-depth tracking is a no-op.
      const lineFullyInComment = inBlockCommentAtStart && stripState.inBlockComment;
      const { name: matched, type: matchType, joinedLines } = lineFullyInComment
        ? { name: null, type: null, joinedLines: 0 }
        : this._matchBoundary(stripped, patterns, language, lines, i, multiLine);

      if ((matched && currentChunk) || (braceDepth === 0 && currentChunk)) {
        const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
        if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
        }
        currentChunk = null;
        chunkStart = i;
      }

      if (matched) {
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          // Count braces on the skipped lines to keep depth accurate
          for (let s = 1; s <= joinedLines; s++) {
            const skippedStripped = this._stripNonCode(lines[i + s], stripState, comment, hasTemplateInterpolation);
            braceDepth += (skippedStripped.match(/{/g) || []).length;
            braceDepth -= (skippedStripped.match(/}/g) || []).length;
          }
          i += joinedLines;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, comment);
  }

  parseIndentBasedFile(filePath, content, language, patterns, multiLine) {
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
        if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
          chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
        }
        currentChunk = null;
        chunkStart = i;
      }

      const { name: matched, type: matchType, joinedLines } = this._matchBoundary(line, patterns, language, lines, i, multiLine);

      if (matched) {
        // Close prior chunk if any non-empty content
        if (currentChunk && chunkStart < i) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        currentChunk = { type: matchType, name: matched };
        chunkStart = i;
        chunkIndent = indent;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          i += joinedLines;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, null);
  }

  parseEndKeywordFile(filePath, content, language, patterns, endKeyword, blockKeywords, multiLine) {
    const chunks = [];
    const lines = content.split('\n');
    const endRe = new RegExp(`^\\s*${endKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    // Build regex to detect non-boundary block-start keywords (if/case/while etc.)
    // These increment depth but don't start new chunks
    const blockStartRe = blockKeywords?.length
      ? new RegExp(`^\\s*(?:${blockKeywords.join('|')})\\b`)
      : null;

    let currentChunk = null;
    let depth = 0;
    let chunkStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const { name: matched, type: matchType, joinedLines } = this._matchBoundary(line, patterns, language, lines, i, multiLine);

      if (matched) {
        if (currentChunk && depth === 0) {
          const chunkContent = lines.slice(chunkStart, i).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i - 1));
          }
        }
        if (!currentChunk || depth === 0) {
          currentChunk = { type: matchType, name: matched };
          chunkStart = i;
        }
        depth++;
        // Skip lines consumed by cross-line joining so they aren't double-processed
        if (joinedLines > 0) {
          i += joinedLines;
        }
      } else if (blockStartRe && blockStartRe.test(line)) {
        // Non-boundary block opener (if/case/while etc.) — track depth
        depth++;
      }

      if (endRe.test(line) && depth > 0) {
        depth--;
        if (depth === 0 && currentChunk) {
          const chunkContent = lines.slice(chunkStart, i + 1).join('\n');
          if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
            chunks.push(this.buildChunk(chunkContent, filePath, language, currentChunk.type, currentChunk.name, chunkStart, i));
          }
          currentChunk = null;
          chunkStart = i + 1;
        }
      }
    }

    this._pushFinalChunk(chunks, lines, chunkStart, filePath, language, currentChunk);
    return this._splitOversizedRegexChunks(chunks, filePath, language, patterns, null);
  }

  /**
   * Match a line against boundary patterns. Optionally joins continuation lines
   * (up to 3 ahead) when the line ends with `(`, `,`, or `\` and the language
   * opts in via `multiLinePatterns`.
   *
   * @param {string} line - Current source line
   * @param {object} patterns - Chunker boundary patterns
   * @param {string} language - Language ID
   * @param {string[]|null} [lines] - Full lines array (enables cross-line matching)
   * @param {number|null} [lineIndex] - Current index into lines
   * @param {boolean} [multiLine] - Whether cross-line matching is enabled for this language
   * @returns {{ name: string|null, type: string|null, joinedLines?: number }}
   */
  _matchBoundary(line, patterns, language, lines, lineIndex, multiLine) {
    const trimmed = line.trimStart();
    if (trimmed.length > this.maxRegexLineLength) {
      this._recordLongLineSkip(language, trimmed.length);
      return { name: null, type: null };
    }

    // Cross-line joining: if enabled and line ends with continuation char
    if (multiLine && lines && lineIndex != null) {
      const trimmedEnd = line.trimEnd();
      const lastChar = trimmedEnd[trimmedEnd.length - 1];
      if (lastChar === '(' || lastChar === ',' || lastChar === '\\') {
        const maxPeek = Math.min(MAX_PEEK_LINES, lines.length - lineIndex - 1);
        if (maxPeek > 0) {
          let joined = line;
          for (let p = 1; p <= maxPeek; p++) {
            joined += ' ' + lines[lineIndex + p].trim();
          }
          const joinedTrimmed = joined.trimStart();
          if (joinedTrimmed.length <= this.maxRegexLineLength) {
            for (const [type, pattern] of Object.entries(patterns)) {
              const match = joinedTrimmed.match(pattern);
              if (match && match[1]) {
                return { name: match[1], type, joinedLines: maxPeek };
              }
            }
          }
        }
      }
    }

    // Single-line match (original behavior)
    for (const [type, pattern] of Object.entries(patterns)) {
      const match = trimmed.match(pattern);
      if (match) {
        if (!match[1]) {
          this._recordEmptyCapture(language, type, trimmed);
          continue;
        }
        return { name: match[1], type };
      }
    }
    return { name: null, type: null };
  }

  _recordEmptyCapture(language, patternType, line) {
    this.debugCounters.emptyCapture.boundary += 1;
    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { boundary: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language].boundary += 1;

    const key = `${language}:boundary:${patternType}`;
    this.debugCounters.byPattern[key] = (this.debugCounters.byPattern[key] || 0) + 1;

    if (this.warnOnPatternDrop && this.debugCounters.byPattern[key] <= 3) {
      console.warn(`[ast-chunker] Empty capture dropped for ${key}: ${line.slice(0, 120)}`);
    }
  }

  _recordLongLineSkip(language, lineLength) {
    this.debugCounters.skippedLongLines += 1;
    if (!this.debugCounters.byLanguage[language]) {
      this.debugCounters.byLanguage[language] = { boundary: 0, skippedLongLines: 0 };
    }
    this.debugCounters.byLanguage[language].skippedLongLines += 1;
    if (this.warnOnPatternDrop && this.debugCounters.byLanguage[language].skippedLongLines <= 3) {
      console.warn(`[ast-chunker] Skipping boundary regex on long line (${lineLength} chars) for ${language}`);
    }
  }

  getDebugCounters() {
    const byLanguage = {};
    for (const [language, counts] of Object.entries(this.debugCounters.byLanguage)) {
      byLanguage[language] = { ...counts };
    }
    return {
      emptyCapture: { ...this.debugCounters.emptyCapture },
      skippedLongLines: this.debugCounters.skippedLongLines,
      byLanguage,
      byPattern: { ...this.debugCounters.byPattern },
    };
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
      if (chunkContent.trim().length > MIN_CONTENT_LENGTH) {
        chunks.push(this.buildChunk(
          chunkContent, filePath, language,
          currentChunk?.type || 'code',
          currentChunk?.name || 'unknown',
          chunkStart, lines.length - 1
        ));
      }
    }
  }

  /**
   * Post-process regex-produced chunks: split oversized ones at depth boundaries.
   * Approximates cAST recursive split for the regex fallback tier.
   *
   * @param {Array} chunks - Chunks from brace/indent/end-keyword parsing
   * @param {string} filePath - Source file path
   * @param {string} language - Language ID
   * @param {object} patterns - Chunker boundary patterns for sub-boundary detection
   * @param {object} comment - Comment syntax config
   * @returns {Array} Chunks with oversized ones split and parent_chunk_id linked
   */
  _splitOversizedRegexChunks(chunks, filePath, language, patterns, comment) {
    const result = [];
    let parentCounter = 0;

    for (const chunk of chunks) {
      if (chunk.content.length <= MAX_CHUNK_SIZE) {
        result.push(chunk);
        continue;
      }

      // Oversized chunk: attempt to split at sub-boundary points
      parentCounter++;
      const parentId = `rx-p${parentCounter}`;
      const parentSymbol = chunk.metadata.symbol;
      const parentType = chunk.metadata.chunk_type;
      const lineStart = chunk.metadata.line_start - 1; // back to 0-indexed

      const subChunks = this._splitAtSubBoundaries(
        chunk.content, filePath, language, patterns, comment,
        lineStart, parentId, parentSymbol, parentType
      );

      if (subChunks.length > 1) {
        result.push(...subChunks);
      } else {
        // Couldn't split further — emit as-is
        result.push(chunk);
      }
    }

    return result;
  }

  /**
   * Split oversized content at sub-boundary points (brace depth transitions,
   * boundary pattern matches within the chunk).
   */
  _splitAtSubBoundaries(content, filePath, language, patterns, comment, lineOffset, parentId, parentSymbol, parentType) {
    const lines = content.split('\n');
    const subChunks = [];
    const hierarchyInfo = {
      parentChunkId: parentId,
      parentSymbol,
      parentType,
    };

    let segStart = 0;
    let segSize = 0;
    let childCounter = 0;
    let braceDepth = 0;
    const stripState = { inBlockComment: false, inTemplateLiteral: false, interpolationDepth: 0 };
    const hasTemplateInterpolation = (language === 'javascript');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineSize = line.length + 1; // +1 for newline
      const inBlockCommentAtStart = stripState.inBlockComment;
      const stripped = this._stripNonCode(line, stripState, comment, hasTemplateInterpolation);

      braceDepth += (stripped.match(/{/g) || []).length;
      braceDepth -= (stripped.match(/}/g) || []).length;

      // Check if this line is a sub-boundary (a new construct starting at depth >= 1).
      // Use the comment-stripped line so Javadoc `<pre>public class Foo {...}</pre>`
      // examples don't get matched as real sub-boundaries (parallels
      // parseBraceBasedFile fix above).
      const lineFullyInComment = inBlockCommentAtStart && stripState.inBlockComment;
      const { name: matched, type: matchType } = lineFullyInComment
        ? { name: null, type: null }
        : this._matchBoundary(stripped, patterns, language, lines, i, false);
      const isSubBoundary = matched && i > segStart;

      // Split condition: at a sub-boundary, or accumulated segment exceeds max
      if ((isSubBoundary || (segSize + lineSize > MAX_CHUNK_SIZE && segSize > 0)) && i > segStart) {
        const segContent = lines.slice(segStart, i).join('\n');
        if (segContent.trim().length > MIN_CONTENT_LENGTH) {
          childCounter++;
          subChunks.push(this.buildChunk(
            segContent, filePath, language,
            subChunks.length === 0 ? parentType || 'code' : (matchType || 'code'),
            subChunks.length === 0 ? parentSymbol : (matched || 'unknown'),
            lineOffset + segStart, lineOffset + i - 1,
            { ...hierarchyInfo, chunkId: `${parentId}-${childCounter}` }
          ));
        }
        segStart = i;
        segSize = 0;
      }

      segSize += lineSize;
    }

    // Flush remaining
    if (segStart < lines.length) {
      const segContent = lines.slice(segStart).join('\n');
      if (segContent.trim().length > MIN_CONTENT_LENGTH) {
        childCounter++;
        subChunks.push(this.buildChunk(
          segContent, filePath, language,
          'code', 'unknown',
          lineOffset + segStart, lineOffset + lines.length - 1,
          { ...hierarchyInfo, chunkId: `${parentId}-${childCounter}` }
        ));
      }
    }

    return subChunks;
  }

  parseGenericFile(filePath, content, language = 'text') {
    const lines = content.split('\n');
    const chunks = [];
    const CHUNK_SIZE = 50;
    const OVERLAP = 10;

    let start = 0;
    while (start < lines.length) {
      const end = Math.min(start + CHUNK_SIZE, lines.length);
      const chunkContent = lines.slice(start, end).join('\n');

      if (chunkContent.trim().length > 20) {
        chunks.push(this.buildChunk(chunkContent, filePath, language, 'code', 'unknown', start, end - 1));
      }

      start = end - OVERLAP;
      if (start >= lines.length - OVERLAP) break;
    }

    return chunks;
  }

  buildChunk(content, filePath, language, chunkType, symbol, lineStart, lineEnd, hierarchyInfo) {
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const relativePath = this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath;

    // Production embedding text. With the default variant (current) this
    // is byte-identical to shipped v6.2; under a research-only variant
    // (SWEET_SEARCH_EMBED_TEXT_VARIANT) it produces the experimental form.
    const embedding_text = buildEmbeddingText({
      content,
      relativePath,
      language,
      chunkType,
      symbol,
      hierarchyInfo,
    });

    // Research isolation: always build the shipped (current-variant)
    // form alongside, so the LI stage can read a canonical input even
    // when an R1 experiment is active on embedding_text. In production
    // (variant=current) this is the same content as embedding_text and
    // pickLiInput's preference for li_greedy_text changes nothing.
    const li_greedy_text = buildEmbeddingText({
      variant: 'current',
      content,
      relativePath,
      language,
      chunkType,
      symbol,
      hierarchyInfo,
    });

    // Build LI text via the v6.2 builder (language-conditioned path
    // policy). See buildLiText() docstring for rationale.
    const li_text = buildLiText({
      content,
      relativePath,
      language,
      chunkType,
      symbol,
      hierarchyInfo,
    });

    const metadata = {
      type: 'codebase',
      file: path.basename(filePath),
      path: relativePath,
      language,
      chunk_type: chunkType,
      symbol,
      line_start: lineStart + 1,
      line_end: lineEnd + 1,
      hash,
    };

    // Hierarchical chunk linking (cAST parent/child)
    if (hierarchyInfo?.chunkId) {
      metadata.chunk_id = hierarchyInfo.chunkId;
    }
    if (hierarchyInfo?.parentChunkId) {
      metadata.parent_chunk_id = hierarchyInfo.parentChunkId;
    }
    if (hierarchyInfo?.parentSymbol) {
      metadata.parent_symbol = hierarchyInfo.parentSymbol;
      metadata.parent_type = hierarchyInfo.parentType;
    }
    // Carry sibling-symbol context into metadata so enrichEmbeddingText()
    // can rebuild the multi-symbol header during post-chunk enrichment.
    if (hierarchyInfo?.additionalSymbols && hierarchyInfo.additionalSymbols.length > 0) {
      metadata.additional_symbols = hierarchyInfo.additionalSymbols;
    }

    return {
      text: content.trim(),
      content: content.trim(),
      embedding_text,
      li_greedy_text,
      li_text,
      metadata,
      tags: ['codebase', language, this.inferProjectTag(filePath)]
    };
  }

  /**
   * Enrich a chunk's embedding_text with scope chain and import info.
   * Called after initial chunking when scope info is available.
   *
   * Production path (variant=current): updates BOTH `embedding_text`
   * and `li_greedy_text` to the same enriched string — byte-identical
   * to shipped v6.2.
   *
   * Research path (variant != current/enriched): only updates
   * `li_greedy_text`. The variant's `embedding_text` is preserved so
   * an R1 ablation can compare its embedding form against shipped
   * without losing the LI side's enriched text.
   */
  static enrichEmbeddingText(chunk, scopeChain, imports) {
    const parts = [];
    parts.push(`# ${chunk.metadata.path}`);

    const isRubyMethodChunk = chunk.metadata.language === 'ruby'
      && (chunk.metadata.chunk_type === 'method'
        || chunk.metadata.chunk_type === 'singleton_method');
    const hasOnlySelfScope = scopeChain
      && scopeChain.length === 1
      && scopeChain[0] === chunk.metadata.symbol
      && !chunk.metadata.parent_symbol;

    if (scopeChain && scopeChain.length > 0 && !(isRubyMethodChunk && hasOnlySelfScope)) {
      parts.push(`# Scope: ${scopeChain.join(' > ')}`);
    } else if (chunk.metadata.parent_symbol) {
      // Preserve cAST parent context when no scope chain from code graph
      parts.push(`# Parent: ${chunk.metadata.parent_type} ${chunk.metadata.parent_symbol}`);
    }
    // Keep Ruby method metadata, but avoid injecting the method name into
    // the production embedding/LI text. Top-level Ruby method chunks also
    // skip self-only scope above.
    if (chunk.metadata.symbol && chunk.metadata.symbol !== 'unknown' && !isRubyMethodChunk) {
      parts.push(`# Defines: ${chunk.metadata.chunk_type} ${chunk.metadata.symbol}`);
    }

    if (chunk.metadata.additional_symbols && chunk.metadata.additional_symbols.length > 0) {
      parts.push(`# Additional: ${chunk.metadata.additional_symbols.join(', ')}`);
    }

    if (imports && imports.length > 0) {
      parts.push(`# Uses: ${imports.slice(0, 5).join(', ')}`);
    }

    if (chunk.metadata.language && chunk.metadata.language !== 'text') {
      parts.push(`# Language: ${chunk.metadata.language}`);
    }

    parts.push(chunk.content);
    const enriched = parts.join('\n').slice(0, getEmbedTextCap());

    // Always update the byte-stable LI passthrough form.
    chunk.li_greedy_text = enriched;

    // Only update embedding_text when the active variant participates
    // in post-build enrichment.
    if (shouldRunEnrichment()) {
      chunk.embedding_text = enriched;
    }
    return chunk;
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

