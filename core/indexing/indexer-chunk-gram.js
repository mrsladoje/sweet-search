import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import {
  buildChunkGramIndexArtifact,
  hasNativeChunkGramSupport,
} from '../infrastructure/native-sparse-gram.js';
import { atomicSwapDatabase, log } from './indexer-utils.js';

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Convert allChunks (from the indexer pipeline) to chunk gram build inputs.
 * allChunks come from the AST chunker with metadata.line_start/line_end fields,
 * or from the LI index with metadata.startLine/endLine.
 */
function extractChunkInputs(allChunks) {
  const inputs = [];
  for (const chunk of allChunks) {
    const file = chunk.file || chunk.metadata?.file;
    const startLine = chunk.metadata?.startLine ?? chunk.metadata?.line_start ?? null;
    const endLine = chunk.metadata?.endLine ?? chunk.metadata?.line_end ?? null;
    if (!file || startLine == null || endLine == null) continue;
    inputs.push({ filePath: file, startLine, endLine });
  }
  return inputs;
}

/**
 * Fallback: read chunk metadata from the vectors table (smaller, may be stale).
 */
async function collectFromVectorsTable() {
  if (!existsSync(DB_PATHS.codebase)) return [];
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(DB_PATHS.codebase, { readonly: true });
  try {
    const chunks = [];
    for (const row of db.prepare('SELECT file_path, metadata FROM vectors').iterate()) {
      try {
        const meta = JSON.parse(row.metadata || '{}');
        if (meta.startLine == null || meta.endLine == null) continue;
        chunks.push({ filePath: row.file_path, startLine: meta.startLine, endLine: meta.endLine });
      } catch { /* skip malformed */ }
    }
    return chunks;
  } finally {
    db.close();
  }
}

/**
 * Build the chunk-level gram index artifact.
 *
 * @param {boolean} dryRun - Skip actual build
 * @param {Array} [allChunks] - Pre-extracted chunk metadata from the indexer pipeline
 *   (from AST chunker or LI index documents). If not provided, falls back to vectors table.
 */
export async function buildChunkGramArtifact(dryRun, allChunks = null) {
  if (dryRun) {
    log('DRY RUN: Skipping chunk gram artifact build', 'magenta');
    return { skipped: true, reason: 'dry_run' };
  }

  if (!hasNativeChunkGramSupport()) {
    log('Skipping chunk gram artifact: native addon unavailable', 'yellow');
    return { skipped: true, reason: 'native_unavailable' };
  }

  const chunks = allChunks
    ? extractChunkInputs(allChunks)
    : await collectFromVectorsTable();

  if (chunks.length === 0) {
    log('Skipping chunk gram artifact: no chunks with line spans', 'yellow');
    return { skipped: true, reason: 'no_chunks' };
  }

  const stagedPath = DB_PATHS.chunkGramIndex + '.tmp';
  await fs.mkdir(path.dirname(stagedPath), { recursive: true });

  try {
    log(`Building chunk gram artifact (${chunks.length} chunks)...`, 'yellow');
    const result = buildChunkGramIndexArtifact({
      projectRoot: PROJECT_ROOT,
      chunks,
      outputPath: stagedPath,
    });
    await atomicSwapDatabase(stagedPath, DB_PATHS.chunkGramIndex);
    log(
      `Chunk gram artifact promoted (${result.chunksIndexed} chunks, ${result.grams} grams, ${result.postings} postings)`,
      'green'
    );
    return result;
  } catch (err) {
    await unlinkIfExists(stagedPath);
    throw err;
  }
}
