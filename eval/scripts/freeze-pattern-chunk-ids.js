#!/usr/bin/env node

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ASTChunker } from '../../core/indexing/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const QUERIES_PATH = path.join(PROJECT_ROOT, 'eval', 'data', 'pattern-benchmark', 'queries.jsonl');
const CODEBASE_DB_PATH = path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db');

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'using', 'code',
  'must', 'find', 'many', 'among', 'across', 'broad', 'narrow', 'pattern',
  'regex', 'semantic', 'query', 'queries', 'case', 'cases', 'match', 'matches',
  'multiple', 'lines', 'line', 'block', 'blocks', 'calls', 'methods', 'method',
]);

function splitWords(text) {
  return (text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:(){}[\],-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word && word.length > 1 && !STOP_WORDS.has(word));
}

function extractAnchors(noteText = '') {
  const anchors = new Set();
  for (const match of noteText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b(?:\(\))?/g)) {
    const raw = match[0];
    const token = raw.replace(/\(\)$/, '');
    const looksCodeLike =
      /[A-Z]/.test(token.slice(1)) ||
      token === token.toUpperCase() ||
      token.includes('_') ||
      raw.endsWith('()');
    if (looksCodeLike || ['init', 'save', 'load', 'search', 'add'].includes(token)) {
      anchors.add(token);
    }
  }
  return [...anchors];
}

function makeChunkId(file, lineStart, lineEnd, chunkIndex) {
  return `${file}:${lineStart}-${lineEnd}:${chunkIndex}`;
}

function getChunkText(chunk) {
  return [chunk.embedding_text, chunk.text, chunk.content, chunk.metadata?.symbol]
    .filter(Boolean)
    .join('\n');
}

function findMatchingLines(fileContent, regex) {
  const re = new RegExp(regex);
  const lines = fileContent.split('\n');
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    if (re.test(lines[i])) matches.push(i + 1);
  }
  return matches;
}

function chunkContainsLine(chunk, line) {
  const start = chunk.metadata?.line_start || 0;
  const end = chunk.metadata?.line_end || start;
  return start <= line && line <= end;
}

function scoreChunk(query, chunk, fileContent, regexLines, anchors) {
  const chunkText = getChunkText(chunk);
  const chunkWords = new Set(splitWords(chunkText));
  const semanticWords = splitWords(query.semantic_query || '');
  const start = chunk.metadata?.line_start || 0;
  const end = chunk.metadata?.line_end || start;
  const chunkLineList = fileContent.split('\n').slice(Math.max(0, start - 1), end);
  const chunkLines = chunkLineList.join('\n');
  const firstLine = (chunkLineList[0] || '').trim();
  const matchingLineCount = regexLines.filter(line => chunkContainsLine(chunk, line)).length;

  let score = matchingLineCount > 0 ? 1000 + matchingLineCount * 25 : 0;
  if (chunk.metadata?.symbol) score += 200;

  for (const anchor of anchors) {
    const anchorRe = new RegExp(`\\b${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (anchorRe.test(chunkLines)) score += 1200;
    if (anchorRe.test(chunkText)) score += 500;
    if ((chunk.metadata?.symbol || '') === anchor) score += 1500;
    if (anchorRe.test(firstLine)) score += 2500;
  }

  for (const word of semanticWords) {
    if (chunkWords.has(word)) score += 8;
  }

  if (!chunk.metadata?.symbol && ['{', 'async', 'if', 'try', 'catch'].includes(firstLine)) {
    score -= 1000;
  }
  score -= Math.max(0, Math.floor((end - start) / 10));
  return score;
}

async function loadQueries() {
  const raw = await fs.readFile(QUERIES_PATH, 'utf8');
  return raw.trim().split('\n').map(line => JSON.parse(line));
}

async function buildChunkMap(files) {
  const chunksByFile = new Map();
  const contentByFile = new Map();

  if (existsSync(CODEBASE_DB_PATH)) {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(CODEBASE_DB_PATH, { readonly: true });
    try {
      const stmt = db.prepare('SELECT id, file_path, text, metadata FROM vectors WHERE file_path = ? ORDER BY id');
      for (const file of files) {
        const rows = stmt.all(file);
        const indexed = [];
        for (const row of rows) {
          const metadata = JSON.parse(row.metadata || '{}');
          indexed.push({
            id: row.id,
            file,
            text: row.text || '',
            content: row.text || '',
            metadata: {
              line_start: metadata.startLine || 0,
              line_end: metadata.endLine || metadata.startLine || 0,
              symbol: metadata.name || null,
              chunk_type: metadata.type || 'code',
            },
          });
        }
        chunksByFile.set(file, indexed);
        contentByFile.set(file, await fs.readFile(path.join(PROJECT_ROOT, file), 'utf8'));
      }
      return { chunksByFile, contentByFile };
    } finally {
      db.close();
    }
  }

  const chunker = new ASTChunker({ projectRoot: PROJECT_ROOT });
  for (const file of files) {
    const absPath = path.join(PROJECT_ROOT, file);
    const content = await fs.readFile(absPath, 'utf8');
    const chunks = await chunker.parseFile(file, content);
    const indexed = [];
    let chunkIndex = 0;

    for (const chunk of chunks) {
      const lineStart = chunk.metadata?.line_start || 0;
      const lineEnd = chunk.metadata?.line_end || lineStart;
      indexed.push({
        ...chunk,
        file,
        id: makeChunkId(file, lineStart, lineEnd, chunkIndex),
      });
      chunkIndex++;
    }

    chunksByFile.set(file, indexed);
    contentByFile.set(file, content);
  }

  return { chunksByFile, contentByFile };
}

function freezeQueryChunkIds(query, chunksByFile, contentByFile) {
  const anchors = extractAnchors(query.notes || '');
  const relevantChunkIds = [];

  for (const file of query.relevant_files || []) {
    const chunks = chunksByFile.get(file) || [];
    const content = contentByFile.get(file) || '';
    const regexLines = findMatchingLines(content, query.regex);
    const candidateChunks = chunks.filter(chunk =>
      regexLines.some(line => chunkContainsLine(chunk, line))
    );
    const pool = candidateChunks.length > 0 ? candidateChunks : chunks;
    if (pool.length === 0) continue;

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const chunk of pool) {
      const score = scoreChunk(query, chunk, content, regexLines, anchors);
      if (score > bestScore) {
        best = chunk;
        bestScore = score;
      }
    }

    if (best) relevantChunkIds.push(best.id);
  }

  return [...new Set(relevantChunkIds)];
}

async function main() {
  const write = process.argv.includes('--write');
  const queries = await loadQueries();
  const files = [...new Set(queries.flatMap(query => query.relevant_files || []))];
  const { chunksByFile, contentByFile } = await buildChunkMap(files);

  const updated = queries.map(query => ({
    ...query,
    relevant_chunk_ids: freezeQueryChunkIds(query, chunksByFile, contentByFile),
  }));

  const missing = updated.filter(query => query.relevant_chunk_ids.length === 0);
  if (missing.length > 0) {
    console.error(`Failed to resolve relevant_chunk_ids for ${missing.length} queries`);
    for (const query of missing.slice(0, 10)) {
      console.error(`  ${query.query_id}: ${query.semantic_query}`);
    }
    process.exit(1);
  }

  if (write) {
    const output = updated.map(query => JSON.stringify(query)).join('\n') + '\n';
    await fs.writeFile(QUERIES_PATH, output);
    console.log(`Updated ${updated.length} queries in ${path.relative(PROJECT_ROOT, QUERIES_PATH)}`);
    return;
  }

  for (const query of updated) {
    console.log(`${query.query_id}\t${query.relevant_chunk_ids.join(',')}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
