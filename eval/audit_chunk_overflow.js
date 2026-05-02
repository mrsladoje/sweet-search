#!/usr/bin/env node
/**
 * audit_chunk_overflow.js
 *
 * RESEARCH-ONLY audit. Does NOT change production behavior.
 *
 * Question: how often does the .slice(0, 2000) cap on `embedding_text`,
 * `li_text`, `li_greedy_text`, and stored chunk text cause meaningful
 * signal loss?
 *
 * The script runs the production ASTChunker + DocumentChunker on a list
 * of repo paths, then for each chunk recomputes UNSLICED versions of the
 * same builders (duplicated locally so production code stays untouched)
 * and reports overflow distributions, language/chunk-type breakdowns,
 * the 50 worst offenders, and a cheap heuristic on whether the tail past
 * char 2000 is likely meaningful code signal vs noise.
 *
 * Usage:
 *   node eval/audit_chunk_overflow.js [repoPath ...]
 *
 *   # default: audits a built-in shortlist of available repos
 *   node eval/audit_chunk_overflow.js
 *
 *   # audit Sweet Search itself
 *   node eval/audit_chunk_overflow.js .
 *
 *   # audit specific repos
 *   node eval/audit_chunk_overflow.js eval/repos/fastify eval/repos/flask
 *
 * Outputs (under eval/results/):
 *   chunk-overflow-audit-<repoTag>.json   per-repo metrics
 *   chunk-overflow-audit.json             merged metrics across all repos
 *   chunk-overflow-audit.md               markdown summary
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

import { ASTChunker, JAVA_FAMILY, normalizePathSlug } from '../core/indexing/ast-chunker.js';
import { FILE_PATTERNS } from '../core/infrastructure/config/search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');

const MAX_CHUNK_SIZE = 2000;          // matches ast-chunker.js
const TAIL_HEURISTIC_MAX_LEN = 8000;  // cap heuristic work for huge chunks

// ----------------------------------------------------------------------------
// UNSLICED MIRRORS of production builders.
//
// IMPORTANT: these are duplicated from core/indexing/ast-chunker.js with the
// trailing `.slice(0, 2000)` removed. Touching the production functions to
// add an "unsliced=true" mode would risk regressions; the audit isolates the
// measurement here. Keep in sync if production builders change.
// ----------------------------------------------------------------------------

function buildEmbeddingTextUnsliced({ content, relativePath, language, chunkType, symbol, hierarchyInfo }) {
  // Mirrors the `current` variant in production (which is the prod default).
  const trimmed = content.trim();
  const parts = [];
  if (relativePath) parts.push(`# ${relativePath}`);
  if (hierarchyInfo?.parentSymbol) {
    parts.push(`# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}`);
  }
  if (symbol && symbol !== 'unknown') parts.push(`# ${chunkType}: ${symbol}`);
  if (language && language !== 'text') parts.push(`# Language: ${language}`);
  parts.push(trimmed);
  return parts.join('\n');
}

function buildLiTextUnsliced({ content, relativePath, language, chunkType, symbol, hierarchyInfo }) {
  const trimmed = content.trim();
  const lines = [];
  if (relativePath) {
    if (language === 'python') {
      // skip path line for python
    } else if (JAVA_FAMILY.has(language)) {
      lines.push(`# ${normalizePathSlug(relativePath)}`);
    } else {
      lines.push(`# ${relativePath}`);
    }
  }
  if (hierarchyInfo?.parentSymbol) {
    lines.push(`# Parent: ${hierarchyInfo.parentType} ${hierarchyInfo.parentSymbol}`);
  }
  if (symbol && symbol !== 'unknown') lines.push(`# ${chunkType}: ${symbol}`);
  if (language && language !== 'text') lines.push(`# Language: ${language}`);
  lines.push(trimmed);
  return lines.join('\n');
}

/**
 * Approximate enrichEmbeddingText without graph context. Production reads
 * scope chain + imports from the code-graph DB; the audit is offline so we
 * fall back to chunk parent metadata (same fallback the production fn does
 * when no graph data is available). Imports are not approximated.
 */
function buildEnrichedEmbeddingTextUnsliced(chunk) {
  const parts = [];
  parts.push(`# ${chunk.metadata.path}`);
  if (chunk.metadata.parent_symbol) {
    parts.push(`# Parent: ${chunk.metadata.parent_type} ${chunk.metadata.parent_symbol}`);
  }
  if (chunk.metadata.symbol && chunk.metadata.symbol !== 'unknown') {
    parts.push(`# Defines: ${chunk.metadata.chunk_type} ${chunk.metadata.symbol}`);
  }
  if (chunk.metadata.language && chunk.metadata.language !== 'text') {
    parts.push(`# Language: ${chunk.metadata.language}`);
  }
  parts.push(chunk.content);
  return parts.join('\n');
}

// ----------------------------------------------------------------------------
// Tail signal heuristic.
//
// Conservative classification of the tail past char 2000:
//   likely_meaningful — high identifier density, declaration keywords, or
//                       new identifiers not seen in prefix
//   maybe_meaningful  — middling signal, identifiers present but mostly
//                       continuation of the prefix
//   likely_noise      — comment-heavy, literal-heavy, or low identifier
//                       density (data tables, embedded JSON, generated)
// ----------------------------------------------------------------------------

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
const DECL_KEYWORDS = new Set([
  // JS/TS, Java, Kotlin, Swift, C#
  'function', 'class', 'interface', 'type', 'enum', 'extends', 'implements',
  'public', 'private', 'protected', 'static', 'abstract', 'async', 'export',
  'import', 'default', 'return', 'throw',
  // Python
  'def', 'lambda', 'yield', 'raise',
  // Rust / Go
  'fn', 'impl', 'trait', 'struct', 'mod', 'pub', 'func', 'package',
  // Ruby
  'module', 'attr_reader', 'attr_writer', 'attr_accessor',
  // PHP / C++
  'namespace', 'use',
]);
const ROUTE_PATTERNS = [
  /\bapp\.(get|post|put|delete|patch|use|all|head|options)\b/i,
  /\brouter\.(get|post|put|delete|patch|use|all|head|options)\b/i,
  /\b(register|addRoute|on|emit|listen|subscribe)\s*\(/i,
  /\bmodule\.exports\b/,
  /\bexport\s+(default|const|class|function)\b/,
  /\b@(Get|Post|Put|Delete|Patch|RequestMapping|RestController|Controller)\b/,
  /^\s*[A-Z][A-Z0-9_]+\s*[:=]/m, // CONFIG_KEY = / :
];

function topIdentifiers(text, n = 10) {
  const counts = new Map();
  const matches = text.match(IDENT_RE) || [];
  for (const m of matches) counts.set(m, (counts.get(m) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, c]) => ({ id, count: c }));
}

function classifyTail(prefix, tail) {
  // Cap heuristic work: we only need a directional signal, not whole-tail
  // tokenization, and very long tails (megabyte minified files) waste cpu.
  const sampledTail = tail.length > TAIL_HEURISTIC_MAX_LEN
    ? tail.slice(0, TAIL_HEURISTIC_MAX_LEN)
    : tail;

  const tailLen = sampledTail.length;
  if (tailLen === 0) {
    return { class: 'likely_noise', reason: 'empty', features: {} };
  }

  const idents = sampledTail.match(IDENT_RE) || [];
  const uniqueIdents = new Set(idents);
  const identsPer100 = (idents.length / tailLen) * 100;

  const declHits = idents.filter(t => DECL_KEYWORDS.has(t)).length;
  const routeHits = ROUTE_PATTERNS.reduce((acc, re) => acc + (re.test(sampledTail) ? 1 : 0), 0);

  // Prefix identifier set for "new symbol" detection (cap prefix sample too).
  const prefixSampled = prefix.length > TAIL_HEURISTIC_MAX_LEN
    ? prefix.slice(-TAIL_HEURISTIC_MAX_LEN)
    : prefix;
  const prefixIdents = new Set(prefixSampled.match(IDENT_RE) || []);
  const newIdents = [];
  for (const id of uniqueIdents) {
    if (!prefixIdents.has(id) && !DECL_KEYWORDS.has(id)) newIdents.push(id);
    if (newIdents.length >= 25) break;
  }

  // Comment-heavy detection: count comment-prefixed lines.
  const lines = sampledTail.split('\n');
  let commentLines = 0;
  let blankLines = 0;
  for (const ln of lines) {
    const t = ln.trimStart();
    if (!t.length) blankLines++;
    else if (t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*')) commentLines++;
  }
  const commentRatio = lines.length > 0 ? commentLines / lines.length : 0;

  // Literal/data-heavy: high ratio of `,:"{}[]` chars vs alpha chars.
  let punct = 0;
  let alpha = 0;
  for (let i = 0; i < sampledTail.length; i++) {
    const c = sampledTail.charCodeAt(i);
    if (',:"\'{}[]'.indexOf(sampledTail[i]) >= 0) punct++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alpha++;
  }
  const punctRatio = punct / Math.max(1, punct + alpha);

  const features = {
    tailLen,
    identTokens: idents.length,
    uniqueIdents: uniqueIdents.size,
    identsPer100,
    declHits,
    routeHits,
    commentRatio: Number(commentRatio.toFixed(3)),
    punctRatio: Number(punctRatio.toFixed(3)),
    blankLineRatio: Number((blankLines / Math.max(1, lines.length)).toFixed(3)),
    newIdents: newIdents.slice(0, 10),
  };

  // Decision (conservative):
  //   noise: very comment-heavy, very punct-heavy, or near-zero identifiers.
  //   meaningful: declaration keywords, routes/exports, OR several new symbols
  //               not in prefix and identifier density is decent.
  //   else: maybe_meaningful.
  if (commentRatio >= 0.7) {
    return { class: 'likely_noise', reason: 'comment-heavy', features };
  }
  if (punctRatio >= 0.6 && declHits === 0 && routeHits === 0) {
    return { class: 'likely_noise', reason: 'literal/data-heavy', features };
  }
  if (uniqueIdents.size <= 3) {
    return { class: 'likely_noise', reason: 'few-identifiers', features };
  }

  if (declHits >= 1 || routeHits >= 1) {
    return { class: 'likely_meaningful', reason: 'declaration-or-route', features };
  }
  if (newIdents.length >= 5 && identsPer100 >= 5) {
    return { class: 'likely_meaningful', reason: 'new-symbols', features };
  }
  if (newIdents.length >= 2) {
    return { class: 'maybe_meaningful', reason: 'some-new-symbols', features };
  }
  return { class: 'maybe_meaningful', reason: 'continuation', features };
}

// ----------------------------------------------------------------------------
// Statistics
// ----------------------------------------------------------------------------

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor((p / 100) * sortedArr.length)));
  return sortedArr[idx];
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

function bumpDist(dist, key, overflow) {
  if (!dist[key]) dist[key] = { chunks: 0, overflows: 0, overflowCharsTotal: 0 };
  dist[key].chunks++;
  if (overflow > 0) {
    dist[key].overflows++;
    dist[key].overflowCharsTotal += overflow;
  }
}

// ----------------------------------------------------------------------------
// File discovery — minimal local version that doesn't need git or PROJECT_ROOT.
// ----------------------------------------------------------------------------

async function discoverFilesIn(repoPath, { maxFiles } = {}) {
  const files = await fg(FILE_PATTERNS.include, {
    ignore: FILE_PATTERNS.exclude,
    cwd: repoPath,
    absolute: false,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
  });
  // Drop oversize files (> 1MB) to mirror production's maxFileSize default.
  const kept = [];
  let oversized = 0;
  for (const rel of files) {
    try {
      const stat = await fs.stat(path.join(repoPath, rel));
      if (stat.size > 1024 * 1024) {
        oversized++;
      } else {
        kept.push(rel);
      }
    } catch { /* race */ }
  }
  if (maxFiles && kept.length > maxFiles) {
    return { files: kept.slice(0, maxFiles), oversized, truncated: kept.length - maxFiles };
  }
  return { files: kept, oversized, truncated: 0 };
}

// ----------------------------------------------------------------------------
// Main per-repo audit
// ----------------------------------------------------------------------------

async function auditRepo(repoPath, options = {}) {
  const absRepo = path.resolve(repoPath);
  const repoTag = path.basename(absRepo);
  console.error(`\n=== Auditing ${repoTag} (${absRepo}) ===`);

  const { files, oversized, truncated } = await discoverFilesIn(absRepo, options);
  console.error(`  Files discovered: ${files.length}${truncated ? ` (truncated from ${files.length + truncated})` : ''}`);
  if (oversized) console.error(`  Skipped ${oversized} oversize files`);

  const chunker = new ASTChunker({ projectRoot: absRepo });

  // Per-repo state
  const contentLengths = [];
  const embeddingLengths = [];
  const enrichedLengths = [];
  const liLengths = [];

  let chunkTotal = 0;
  let chunkOversizedContent = 0;
  let chunkOversizedEmbedding = 0;
  let chunkOversizedEnriched = 0;
  let chunkOversizedLi = 0;

  const byLanguage = {};
  const byChunkType = {};

  const tailClassCounts = { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 };
  const tailReasonCounts = {};

  // Magnitude buckets across ALL overflowing chunks (not just top 50).
  const overflowBuckets = { tiny: 0, small: 0, medium: 0, large: 0 };
  // Cross-tab: overflow magnitude × tail classification
  const tailByBucket = {
    tiny: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    small: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    medium: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    large: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
  };
  // Header-pushed counter across ALL overflowing chunks (content fits but
  // headers push over the cap). This isolates the dominant pattern.
  let headerPushedTotal = 0;
  let headerPushedTiny = 0;

  // Per-language overflow chars
  const langOverflowChars = {};

  // Top offenders: keep top 50 by overflow chars on embedding text.
  const offenders = [];

  let processed = 0;
  let parseErrors = 0;

  for (const rel of files) {
    const absPath = path.join(absRepo, rel);
    let content;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch {
      parseErrors++;
      continue;
    }
    let chunks;
    try {
      chunks = await chunker.parseFile(absPath, content);
    } catch {
      parseErrors++;
      continue;
    }
    if (!chunks || !chunks.length) {
      processed++;
      continue;
    }

    for (const chunk of chunks) {
      chunkTotal++;
      const meta = chunk.metadata || {};
      const language = meta.language || 'unknown';
      const chunkType = meta.chunk_type || 'code';

      // Prefer freshly-recomputed unsliced versions over the ones already
      // sliced on the chunk object so we can see the true overflow.
      const hierarchyInfo = meta.parent_symbol
        ? { parentSymbol: meta.parent_symbol, parentType: meta.parent_type }
        : null;

      // Document chunks have a slightly different builder shape; for those
      // the AST builder isn't called, but the audit still measures content
      // length and a best-effort embedding text using the same template.
      const embedUnsliced = buildEmbeddingTextUnsliced({
        content: chunk.content || chunk.text || '',
        relativePath: meta.path,
        language,
        chunkType,
        symbol: meta.symbol,
        hierarchyInfo,
      });
      const liUnsliced = buildLiTextUnsliced({
        content: chunk.content || chunk.text || '',
        relativePath: meta.path,
        language,
        chunkType,
        symbol: meta.symbol,
        hierarchyInfo,
      });
      const enrichedUnsliced = buildEnrichedEmbeddingTextUnsliced(chunk);

      const contentLen = (chunk.content || chunk.text || '').length;
      const embedLen = embedUnsliced.length;
      const enrichedLen = enrichedUnsliced.length;
      const liLen = liUnsliced.length;

      contentLengths.push(contentLen);
      embeddingLengths.push(embedLen);
      enrichedLengths.push(enrichedLen);
      liLengths.push(liLen);

      const overflowEmbed = Math.max(0, embedLen - MAX_CHUNK_SIZE);
      const overflowEnriched = Math.max(0, enrichedLen - MAX_CHUNK_SIZE);
      const overflowLi = Math.max(0, liLen - MAX_CHUNK_SIZE);

      if (contentLen > MAX_CHUNK_SIZE) chunkOversizedContent++;
      if (embedLen > MAX_CHUNK_SIZE) chunkOversizedEmbedding++;
      if (enrichedLen > MAX_CHUNK_SIZE) chunkOversizedEnriched++;
      if (liLen > MAX_CHUNK_SIZE) chunkOversizedLi++;

      bumpDist(byLanguage, language, overflowEmbed);
      bumpDist(byChunkType, chunkType, overflowEmbed);
      langOverflowChars[language] = (langOverflowChars[language] || 0) + overflowEmbed;

      if (overflowEmbed > 0) {
        // Tail heuristic on embedding text (production-shape).
        const prefix = embedUnsliced.slice(0, MAX_CHUNK_SIZE);
        const tail = embedUnsliced.slice(MAX_CHUNK_SIZE);
        const tailClass = classifyTail(prefix, tail);
        tailClassCounts[tailClass.class]++;
        tailReasonCounts[tailClass.reason] = (tailReasonCounts[tailClass.reason] || 0) + 1;

        // Magnitude bucket
        let bucket;
        if (overflowEmbed <= 100) bucket = 'tiny';
        else if (overflowEmbed <= 500) bucket = 'small';
        else if (overflowEmbed <= 2000) bucket = 'medium';
        else bucket = 'large';
        overflowBuckets[bucket]++;
        tailByBucket[bucket][tailClass.class]++;

        // Header-only overflow check: if content alone fits but headers push
        // it over, that's a different story than huge content.
        const headerLen = embedLen - (chunk.content || chunk.text || '').trim().length;
        const headerDominated = headerLen > 0 && contentLen <= MAX_CHUNK_SIZE;
        if (headerDominated) {
          headerPushedTotal++;
          if (bucket === 'tiny') headerPushedTiny++;
        }

        offenders.push({
          path: meta.path,
          language,
          chunkType,
          symbol: meta.symbol,
          line_start: meta.line_start,
          line_end: meta.line_end,
          contentLen,
          embedLen,
          enrichedLen,
          liLen,
          overflowEmbed,
          headerDominated,
          tailClass: tailClass.class,
          tailReason: tailClass.reason,
          tailFeatures: tailClass.features,
          // Avoid storing huge text — sample only.
          tailSample: tail.slice(0, 240),
        });
      }
    }
    processed++;
    if (processed % 250 === 0) {
      console.error(`  ... ${processed}/${files.length} files, ${chunkTotal} chunks`);
    }
  }

  // Keep top 50 offenders by overflowEmbed
  offenders.sort((a, b) => b.overflowEmbed - a.overflowEmbed);
  const topOffenders = offenders.slice(0, 50);

  const overflowEmbedValues = offenders.map(o => o.overflowEmbed);

  return {
    repoTag,
    repoPath: absRepo,
    filesScanned: processed,
    parseErrors,
    chunks: chunkTotal,
    oversized: {
      content: chunkOversizedContent,
      embedding: chunkOversizedEmbedding,
      enriched: chunkOversizedEnriched,
      li: chunkOversizedLi,
    },
    rates: {
      contentOverflowPct: chunkTotal ? +(100 * chunkOversizedContent / chunkTotal).toFixed(2) : 0,
      embedOverflowPct: chunkTotal ? +(100 * chunkOversizedEmbedding / chunkTotal).toFixed(2) : 0,
      enrichedOverflowPct: chunkTotal ? +(100 * chunkOversizedEnriched / chunkTotal).toFixed(2) : 0,
      liOverflowPct: chunkTotal ? +(100 * chunkOversizedLi / chunkTotal).toFixed(2) : 0,
    },
    contentStats: summarize(contentLengths),
    embedStats: summarize(embeddingLengths),
    enrichedStats: summarize(enrichedLengths),
    liStats: summarize(liLengths),
    overflowEmbedStats: summarize(overflowEmbedValues),
    byLanguage,
    byChunkType,
    langOverflowChars,
    tailClassCounts,
    tailReasonCounts,
    overflowBuckets,
    tailByBucket,
    headerPushedTotal,
    headerPushedTiny,
    topOffenders,
  };
}

// ----------------------------------------------------------------------------
// Markdown summary across all repos
// ----------------------------------------------------------------------------

function fmtPct(n) {
  return `${n.toFixed(2)}%`;
}

function buildMarkdown(perRepo) {
  const lines = [];
  lines.push('# Chunk Overflow Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('Audits how often Sweet Search\'s `.slice(0, 2000)` cap on `embedding_text`, `enriched embedding_text`, and `li_text` discards content, and whether the discarded tail past char 2000 looks meaningful.');
  lines.push('');
  lines.push('Production behavior was not modified. The audit duplicates production builders locally with the trailing slice removed.');
  lines.push('');
  lines.push('## Per-repo summary');
  lines.push('');
  lines.push('| Repo | Files | Chunks | Content >2000 | Embed >2000 | Enriched >2000 | LI >2000 |');
  lines.push('|------|------:|-------:|--------------:|------------:|---------------:|---------:|');
  for (const r of perRepo) {
    lines.push(`| ${r.repoTag} | ${r.filesScanned} | ${r.chunks} | ${r.oversized.content} (${fmtPct(r.rates.contentOverflowPct)}) | ${r.oversized.embedding} (${fmtPct(r.rates.embedOverflowPct)}) | ${r.oversized.enriched} (${fmtPct(r.rates.enrichedOverflowPct)}) | ${r.oversized.li} (${fmtPct(r.rates.liOverflowPct)}) |`);
  }

  // Aggregated totals
  const totals = {
    files: 0, chunks: 0,
    content: 0, embedding: 0, enriched: 0, li: 0,
    tail: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
  };
  for (const r of perRepo) {
    totals.files += r.filesScanned;
    totals.chunks += r.chunks;
    totals.content += r.oversized.content;
    totals.embedding += r.oversized.embedding;
    totals.enriched += r.oversized.enriched;
    totals.li += r.oversized.li;
    for (const k of Object.keys(totals.tail)) totals.tail[k] += r.tailClassCounts[k] || 0;
  }
  lines.push('');
  lines.push('## Aggregated overflow rates');
  lines.push('');
  lines.push(`- Total files scanned: **${totals.files}**`);
  lines.push(`- Total chunks: **${totals.chunks}**`);
  if (totals.chunks > 0) {
    lines.push(`- Chunks with raw content > 2000 chars: **${totals.content} (${fmtPct(100 * totals.content / totals.chunks)})**`);
    lines.push(`- Chunks with embedding text > 2000 chars: **${totals.embedding} (${fmtPct(100 * totals.embedding / totals.chunks)})**`);
    lines.push(`- Chunks with enriched embedding text > 2000 chars: **${totals.enriched} (${fmtPct(100 * totals.enriched / totals.chunks)})**`);
    lines.push(`- Chunks with li_text > 2000 chars: **${totals.li} (${fmtPct(100 * totals.li / totals.chunks)})**`);
  }

  // Tail classification across all overflowing embed chunks
  const totalTail = totals.tail.likely_meaningful + totals.tail.maybe_meaningful + totals.tail.likely_noise;
  lines.push('');
  lines.push('## Tail signal classification (chunks where embedding text overflows)');
  lines.push('');
  if (totalTail === 0) {
    lines.push('_No overflowing chunks observed._');
  } else {
    lines.push(`- likely_meaningful: **${totals.tail.likely_meaningful} (${fmtPct(100 * totals.tail.likely_meaningful / totalTail)})**`);
    lines.push(`- maybe_meaningful:  **${totals.tail.maybe_meaningful} (${fmtPct(100 * totals.tail.maybe_meaningful / totalTail)})**`);
    lines.push(`- likely_noise:      **${totals.tail.likely_noise} (${fmtPct(100 * totals.tail.likely_noise / totalTail)})**`);
  }

  // Per-repo length distributions
  lines.push('');
  lines.push('## Length distributions (per repo)');
  lines.push('');
  for (const r of perRepo) {
    lines.push(`### ${r.repoTag}`);
    lines.push('');
    lines.push('| Metric | p50 | p90 | p95 | p99 | max | mean |');
    lines.push('|--------|----:|----:|----:|----:|----:|----:|');
    const rows = [
      ['content', r.contentStats],
      ['embedding', r.embedStats],
      ['enriched', r.enrichedStats],
      ['li_text', r.liStats],
    ];
    for (const [name, s] of rows) {
      if (!s.count) continue;
      lines.push(`| ${name} | ${s.p50} | ${s.p90} | ${s.p95} | ${s.p99} | ${s.max} | ${s.mean} |`);
    }
    if (r.overflowEmbedStats.count) {
      lines.push('');
      lines.push(`Overflow chars on embedding text (only chunks > 2000): p50=${r.overflowEmbedStats.p50}, p90=${r.overflowEmbedStats.p90}, p95=${r.overflowEmbedStats.p95}, p99=${r.overflowEmbedStats.p99}, max=${r.overflowEmbedStats.max}.`);
    }
    lines.push('');
  }

  // By language and chunk type
  lines.push('## By language (embedding overflow)');
  lines.push('');
  lines.push('| Repo | Language | Chunks | Overflowing | % | Total overflow chars |');
  lines.push('|------|----------|-------:|------------:|--:|---------------------:|');
  for (const r of perRepo) {
    const entries = Object.entries(r.byLanguage)
      .filter(([, v]) => v.overflows > 0)
      .sort((a, b) => b[1].overflowCharsTotal - a[1].overflowCharsTotal);
    for (const [lang, v] of entries.slice(0, 20)) {
      const pct = v.chunks ? (100 * v.overflows / v.chunks).toFixed(1) : '0.0';
      lines.push(`| ${r.repoTag} | ${lang} | ${v.chunks} | ${v.overflows} | ${pct}% | ${v.overflowCharsTotal} |`);
    }
  }

  lines.push('');
  lines.push('## By chunk type (embedding overflow)');
  lines.push('');
  lines.push('| Repo | Chunk type | Chunks | Overflowing | % |');
  lines.push('|------|------------|-------:|------------:|--:|');
  for (const r of perRepo) {
    const entries = Object.entries(r.byChunkType)
      .filter(([, v]) => v.overflows > 0)
      .sort((a, b) => b[1].overflows - a[1].overflows);
    for (const [type, v] of entries.slice(0, 15)) {
      const pct = v.chunks ? (100 * v.overflows / v.chunks).toFixed(1) : '0.0';
      lines.push(`| ${r.repoTag} | ${type} | ${v.chunks} | ${v.overflows} | ${pct}% |`);
    }
  }

  // Overflow magnitude buckets (tiny header-push vs real content overflow)
  lines.push('');
  lines.push('## Overflow magnitude buckets');
  lines.push('');
  lines.push('Buckets defined on overflow chars (`embedLen - 2000`):');
  lines.push('');
  lines.push('- `tiny`   ≤ 100 chars (typically headers pushing near-cap content over)');
  lines.push('- `small`  101–500 chars');
  lines.push('- `medium` 501–2000 chars');
  lines.push('- `large`  > 2000 chars (oversized leaves, doc tables, SVG)');
  lines.push('');
  lines.push('| Repo | Total overflows | Tiny | Small | Medium | Large |');
  lines.push('|------|----------------:|-----:|------:|-------:|------:|');
  for (const r of perRepo) {
    const b = r.overflowBuckets || { tiny: 0, small: 0, medium: 0, large: 0 };
    const total = b.tiny + b.small + b.medium + b.large;
    lines.push(`| ${r.repoTag} | ${total} | ${b.tiny} | ${b.small} | ${b.medium} | ${b.large} |`);
  }

  // Cross-tab: tail meaningfulness by bucket (across repos)
  lines.push('');
  lines.push('### Tail meaningfulness by overflow magnitude (across repos)');
  lines.push('');
  lines.push('Does the tail past 2000 chars look more meaningful when overflow is large (real content) vs tiny (header push)?');
  lines.push('');
  lines.push('| Bucket | likely_meaningful | maybe_meaningful | likely_noise |');
  lines.push('|--------|------------------:|-----------------:|-------------:|');
  const aggTailByBucket = {
    tiny: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    small: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    medium: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
    large: { likely_meaningful: 0, maybe_meaningful: 0, likely_noise: 0 },
  };
  for (const r of perRepo) {
    if (!r.tailByBucket) continue;
    for (const b of Object.keys(aggTailByBucket)) {
      for (const c of Object.keys(aggTailByBucket[b])) {
        aggTailByBucket[b][c] += (r.tailByBucket[b]?.[c] || 0);
      }
    }
  }
  for (const b of ['tiny', 'small', 'medium', 'large']) {
    const v = aggTailByBucket[b];
    const total = v.likely_meaningful + v.maybe_meaningful + v.likely_noise;
    if (total === 0) {
      lines.push(`| ${b} | 0 | 0 | 0 |`);
      continue;
    }
    const fmt = (n) => `${n} (${(100 * n / total).toFixed(1)}%)`;
    lines.push(`| ${b} | ${fmt(v.likely_meaningful)} | ${fmt(v.maybe_meaningful)} | ${fmt(v.likely_noise)} |`);
  }
  lines.push('');
  lines.push('Header-pushed overflow stats (content fits in 2000, headers push it over):');
  let hp = 0, hpTiny = 0;
  for (const r of perRepo) { hp += (r.headerPushedTotal || 0); hpTiny += (r.headerPushedTiny || 0); }
  const totalOver = perRepo.reduce((a, r) => a + r.oversized.embedding, 0);
  if (totalOver > 0) {
    lines.push(`- Header-pushed: **${hp}/${totalOver} (${(100 * hp / totalOver).toFixed(1)}%)** of all overflowing chunks.`);
    lines.push(`- Of those, **${hpTiny}/${hp} (${hp > 0 ? (100 * hpTiny / hp).toFixed(1) : '0.0'}%)** are in the tiny bucket — pure header push, content was already well-sized.`);
  }

  // Top offenders (across repos)
  lines.push('');
  lines.push('## Top 50 offenders (by overflow chars on embedding text, across repos)');
  lines.push('');
  lines.push('| Repo | File | Lang | Type | Symbol | Lines | Content | Embed | Overflow | HeaderOnly | Tail |');
  lines.push('|------|------|------|------|--------|-------|--------:|------:|---------:|-----------:|------|');
  const allOff = [];
  for (const r of perRepo) {
    for (const o of r.topOffenders) allOff.push({ repo: r.repoTag, ...o });
  }
  allOff.sort((a, b) => b.overflowEmbed - a.overflowEmbed);
  for (const o of allOff.slice(0, 50)) {
    const lines2 = `${o.line_start || ''}–${o.line_end || ''}`;
    const sym = (o.symbol || '').slice(0, 40);
    lines.push(`| ${o.repo} | ${o.path} | ${o.language} | ${o.chunkType} | ${sym} | ${lines2} | ${o.contentLen} | ${o.embedLen} | ${o.overflowEmbed} | ${o.headerDominated ? 'yes' : 'no'} | ${o.tailClass} (${o.tailReason}) |`);
  }

  // Q&A
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  const overallEmbedOverflowPct = totals.chunks ? (100 * totals.embedding / totals.chunks) : 0;
  const overallContentOverflowPct = totals.chunks ? (100 * totals.content / totals.chunks) : 0;

  lines.push('### 1. Is overflow common or rare?');
  lines.push('');
  lines.push(`Across all audited repos, **${fmtPct(overallEmbedOverflowPct)}** of chunks have embedding text > 2000 chars (raw content > 2000: ${fmtPct(overallContentOverflowPct)}).`);
  if (overallEmbedOverflowPct < 1) {
    lines.push('That is **rare** — the cAST recursive split keeps almost all chunks within the cap.');
  } else if (overallEmbedOverflowPct < 5) {
    lines.push('That is **uncommon** — the cap clips a small minority of chunks, mostly long single-statement leaves.');
  } else {
    lines.push('That is **common enough to investigate** — the cap fires on a non-trivial fraction of chunks.');
  }

  lines.push('');
  lines.push('### 2. Is overflow caused by metadata headers or huge content?');
  lines.push('');
  let headerOnlyOff = 0;
  let totalOff = 0;
  for (const r of perRepo) {
    for (const o of r.topOffenders) {
      totalOff++;
      if (o.headerDominated) headerOnlyOff++;
    }
  }
  let globalHeader = 0;
  let globalOver = 0;
  for (const r of perRepo) {
    globalHeader += r.headerPushedTotal || 0;
    globalOver += r.oversized.embedding;
  }
  if (globalOver === 0) {
    lines.push('No overflowing chunks to inspect.');
  } else {
    const globalPct = (100 * globalHeader / globalOver).toFixed(1);
    lines.push(`Across **all** overflowing chunks: ${globalHeader}/${globalOver} (${globalPct}%) are header-pushed (raw content ≤ 2000, headers push over). The remaining ${globalOver - globalHeader} are genuinely large chunks (oversized AST leaves, doc tables, SVG).`);
    if (totalOff > 0) {
      const topPct = (100 * headerOnlyOff / totalOff).toFixed(1);
      lines.push('');
      lines.push(`Note: among the *worst* ${totalOff} offenders by overflow chars, only ${topPct}% are header-pushed, because that view is biased toward large content overflows. Looking at the full distribution above is more representative.`);
    }
  }

  lines.push('');
  lines.push('### 3. Which languages and chunk types dominate overflow?');
  lines.push('');
  // Aggregate across repos
  const langAgg = {};
  const typeAgg = {};
  for (const r of perRepo) {
    for (const [lang, v] of Object.entries(r.byLanguage)) {
      if (!langAgg[lang]) langAgg[lang] = { chunks: 0, overflows: 0, overflowCharsTotal: 0 };
      langAgg[lang].chunks += v.chunks;
      langAgg[lang].overflows += v.overflows;
      langAgg[lang].overflowCharsTotal += v.overflowCharsTotal;
    }
    for (const [type, v] of Object.entries(r.byChunkType)) {
      if (!typeAgg[type]) typeAgg[type] = { chunks: 0, overflows: 0, overflowCharsTotal: 0 };
      typeAgg[type].chunks += v.chunks;
      typeAgg[type].overflows += v.overflows;
      typeAgg[type].overflowCharsTotal += v.overflowCharsTotal;
    }
  }
  const topLangs = Object.entries(langAgg)
    .filter(([, v]) => v.overflows > 0)
    .sort((a, b) => b[1].overflows - a[1].overflows)
    .slice(0, 5);
  const topTypes = Object.entries(typeAgg)
    .filter(([, v]) => v.overflows > 0)
    .sort((a, b) => b[1].overflows - a[1].overflows)
    .slice(0, 5);
  if (topLangs.length === 0) {
    lines.push('No overflows observed.');
  } else {
    lines.push('Top languages by overflow count:');
    for (const [lang, v] of topLangs) {
      const pct = v.chunks ? (100 * v.overflows / v.chunks).toFixed(1) : '0.0';
      lines.push(`- ${lang}: ${v.overflows}/${v.chunks} chunks (${pct}%), ${v.overflowCharsTotal} overflow chars`);
    }
    lines.push('');
    lines.push('Top chunk types by overflow count:');
    for (const [type, v] of topTypes) {
      const pct = v.chunks ? (100 * v.overflows / v.chunks).toFixed(1) : '0.0';
      lines.push(`- ${type}: ${v.overflows}/${v.chunks} chunks (${pct}%)`);
    }
  }

  lines.push('');
  lines.push('### 4. Does the tail look meaningful often enough to justify work?');
  lines.push('');
  if (totalTail === 0) {
    lines.push('No overflowing chunks — nothing to classify.');
  } else {
    const meaningfulPct = 100 * totals.tail.likely_meaningful / totalTail;
    const noisePct = 100 * totals.tail.likely_noise / totalTail;
    lines.push(`- ${fmtPct(meaningfulPct)} of overflow tails look likely_meaningful (declarations, routes, or several new symbols).`);
    lines.push(`- ${fmtPct(noisePct)} look likely_noise (comment-heavy, literal/data-heavy, or sparse identifiers).`);
    if (meaningfulPct < 25) {
      lines.push('The tail is mostly noise. Targeted work is hard to justify.');
    } else if (meaningfulPct < 50) {
      lines.push('Tails are mixed. A targeted splitter for specific constructs may be worthwhile, but a blanket "split all" change would help noise just as much as signal.');
    } else {
      lines.push('Tails look meaningful more often than not. A targeted splitter for the worst-offending construct types is plausible.');
    }
  }

  lines.push('');
  lines.push('### 5. Recommendation');
  lines.push('');
  // Aggregate bucket totals
  const aggBuckets = { tiny: 0, small: 0, medium: 0, large: 0 };
  let totalHeaderPushed = 0;
  let totalHeaderPushedTiny = 0;
  let totalOverflows = 0;
  for (const r of perRepo) {
    for (const k of Object.keys(aggBuckets)) aggBuckets[k] += (r.overflowBuckets?.[k] || 0);
    totalHeaderPushed += r.headerPushedTotal || 0;
    totalHeaderPushedTiny += r.headerPushedTiny || 0;
    totalOverflows += r.oversized.embedding;
  }
  const tinyPct = totalOverflows ? (100 * aggBuckets.tiny / totalOverflows) : 0;
  const headerPushedPct = totalOverflows ? (100 * totalHeaderPushed / totalOverflows) : 0;

  // Multi-line recommendation that names the dominant pattern.
  if (overallEmbedOverflowPct < 0.5) {
    lines.push('**Do nothing.** Overflow is statistically negligible. No follow-up work justified.');
  } else if (tinyPct >= 60 && headerPushedPct >= 50) {
    // The dominant pattern is "headers push near-cap content over the cap".
    lines.push(`The dominant overflow pattern is **headers pushing near-cap content over the cap**, not large chunks.`);
    lines.push('');
    lines.push(`- ${fmtPct(tinyPct)} of overflows are ≤100 chars over the cap.`);
    lines.push(`- ${fmtPct(headerPushedPct)} of overflowing chunks have raw content ≤ 2000 — only the prepended headers (path / parent / symbol / language ≈ 50–100 chars) push them over.`);
    lines.push('');
    lines.push('**Recommended action: budget alignment, not a splitter or sampling experiment.**');
    lines.push('');
    lines.push('The tree-sitter chunker targets `maxChunkSize=2000` for *content*, but the embedding builder then prepends ~50–100 chars of headers and the result is sliced again at 2000 — silently dropping the closing lines of legitimately-sized chunks.');
    lines.push('');
    lines.push('Two cheap, low-risk options:');
    lines.push('1. **Subtract a fixed header overhead from the chunker budget.** Compute a per-language header overhead estimate (~80 chars) and pass `maxChunkSize = 2000 - overhead` into `recursiveChunk` so the AST text + headers fit in 2000. Zero impact on chunk count for content well under the cap; only changes shape for chunks at the boundary.');
    lines.push('2. **Raise the embedding-text slice ceiling.** A modest bump (e.g. `slice(0, 2200)`) would absorb header overhead with no chunking changes. Verify the bi-encoder tokenizer doesn\'t re-truncate at a smaller limit first.');
    lines.push('');
    lines.push('Either option is small enough to ship behind a config flag and validate with `eval/retrieval-harness.js`. A blanket "split all large chunks" change would over-fit a problem that mostly isn\'t there.');
    lines.push('');
    if (aggBuckets.medium + aggBuckets.large > 50) {
      lines.push(`**Secondary action (optional):** ${aggBuckets.medium + aggBuckets.large} chunks have *real* content overflow (>500 chars over cap). These cluster in oversized AST leaves (Rust file-level preludes, Python multi-statement classes) and document tables/SVGs. The largest absolute overflows are doc/data files which go through document-chunker paths and likely don't materially affect code retrieval. For the code-only oversized leaves, child-chunk emission could be a follow-up — but first check whether the budget-alignment fix above already shrinks this set.`);
    }
  } else if (overallEmbedOverflowPct < 5) {
    if (totalTail > 0 && (100 * totals.tail.likely_meaningful / totalTail) >= 50) {
      lines.push('**Targeted splitter for the worst offender constructs.** Overflow is small but the tail tends to look meaningful — implement child-chunk emission for oversized leaves in the offending chunk types only. Skip blanket splitting; skip sampling experiments.');
    } else {
      lines.push('**Investigate stored text truncation separately, otherwise do nothing.** Embedding overflow is small and tails skew toward noise. The `chunk.text.slice(0, 2000)` in `indexer-build.js` (which truncates the *stored* text shown to users in search results) is a separate concern that does not affect embedding quality.');
    }
  } else {
    lines.push('**Run a child-chunk-for-overflow-leaves experiment.** Overflow is common enough that it could be costing recall. Implement child chunks for AST leaves > 2000 (begin/middle/end split or sub-construct split), then re-run the existing retrieval harness (`eval/retrieval-harness.js`) to confirm an MRR delta before shipping.');
  }
  lines.push('');
  lines.push('## Methodology notes');
  lines.push('');
  lines.push('- Production code untouched. Audit duplicates `buildEmbeddingText`, `buildLiText`, and `enrichEmbeddingText` with the trailing `.slice(0, 2000)` removed.');
  lines.push('- Enriched embedding text is approximated without the code-graph DB, using the same fallback the production function uses when no graph data is available (chunk parent metadata only). Imports are not approximated, so enriched lengths slightly under-count the production maximum.');
  lines.push('- Files with parse errors are skipped (counted in `parseErrors`).');
  lines.push('- Tail heuristic: identifier density, declaration keywords, route/export patterns, comment ratio, punctuation/literal ratio, and "new identifier" detection vs the prefix. Conservative: defaults to `maybe_meaningful` when signals are mixed.');
  lines.push('');

  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

function defaultRepos() {
  // Try several known locations; only return the ones that exist.
  const candidates = [
    REPO_ROOT,
    path.join(REPO_ROOT, 'eval/repos/fastify'),
    path.join(REPO_ROOT, 'eval/repos/flask'),
    path.join(REPO_ROOT, 'eval/repos/ripgrep'),
  ];
  return candidates;
}

async function main() {
  const args = process.argv.slice(2);
  const opts = { maxFiles: undefined };
  const repoArgs = [];
  for (const a of args) {
    if (a.startsWith('--max-files=')) opts.maxFiles = parseInt(a.split('=')[1], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node eval/audit_chunk_overflow.js [--max-files=N] [repoPath ...]`);
      process.exit(0);
    } else repoArgs.push(a);
  }

  const repos = repoArgs.length > 0 ? repoArgs : defaultRepos();
  const existing = [];
  for (const r of repos) {
    try {
      const stat = await fs.stat(r);
      if (stat.isDirectory()) existing.push(r);
      else console.error(`Skipping ${r}: not a directory`);
    } catch {
      console.error(`Skipping ${r}: not found`);
    }
  }
  if (!existing.length) {
    console.error('No valid repo paths to audit.');
    process.exit(1);
  }

  await fs.mkdir(RESULTS_DIR, { recursive: true });

  const perRepo = [];
  for (const repo of existing) {
    const result = await auditRepo(repo, opts);
    perRepo.push(result);

    const outPath = path.join(RESULTS_DIR, `chunk-overflow-audit-${result.repoTag}.json`);
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
    console.error(`  Wrote ${outPath}`);
  }

  // Combined JSON
  const combinedPath = path.join(RESULTS_DIR, 'chunk-overflow-audit.json');
  await fs.writeFile(combinedPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    repos: perRepo,
  }, null, 2));
  console.error(`Wrote ${combinedPath}`);

  const md = buildMarkdown(perRepo);
  const mdPath = path.join(RESULTS_DIR, 'chunk-overflow-audit.md');
  await fs.writeFile(mdPath, md);
  console.error(`Wrote ${mdPath}`);

  // Brief stdout summary so callers can see headline numbers.
  let totalChunks = 0, totalEmbedOver = 0;
  for (const r of perRepo) { totalChunks += r.chunks; totalEmbedOver += r.oversized.embedding; }
  console.error('');
  console.error(`SUMMARY: ${totalEmbedOver}/${totalChunks} chunks (${(100 * totalEmbedOver / Math.max(1, totalChunks)).toFixed(2)}%) have embedding text > 2000 chars across ${perRepo.length} repo(s).`);
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
