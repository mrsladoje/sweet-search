import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { CODE_FILE_EXTENSIONS } from '../infrastructure/constants.js';
import {
  buildSparseGramIndexArtifact,
  hasNativeSparseGramSupport,
  resolveSparseSymbolMask,
} from '../infrastructure/native-sparse-gram.js';
import { contentHash } from '../incremental-indexing/infrastructure/hashing.mjs';
import { FALLBACK_WEIGHTS_ID } from '../incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { atomicSwapDatabase, log } from './indexer-utils.js';

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function collectFileSymbolMasks(codeFiles) {
  const masks = new Map(codeFiles.map((filePath) => [filePath, 0]));
  if (!existsSync(DB_PATHS.codebase)) {
    return codeFiles.map(() => 0);
  }
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(DB_PATHS.codebase, { readonly: true });

  try {
    collectFileSymbolMasksFromDb(db, codeFiles, masks);
  } finally {
    db.close();
  }

  return codeFiles.map((filePath) => masks.get(filePath) || 0);
}

async function resolveSparseGramWeightsId(result, artifactPath) {
  if (typeof result?.weightsId === 'string' && result.weightsId) {
    return result.weightsId;
  }
  if (typeof result?.weights_id === 'string' && result.weights_id) {
    return result.weights_id;
  }
  if (result?.usedFallbackWeights) return FALLBACK_WEIGHTS_ID;
  const artifactBytes = await fs.readFile(artifactPath);
  return `corpus-bigram-v1-${await contentHash(artifactBytes)}`;
}

function collectFileSymbolMasksFromDb(db, codeFiles, existingMasks = null) {
  const masks = existingMasks || new Map(codeFiles.map((filePath) => [filePath, 0]));
  const liveSql = liveVectorSql(db);
  const rows = db.prepare(`SELECT file_path, metadata FROM vectors WHERE ${liveSql}`).iterate();
  for (const row of rows) {
    if (!masks.has(row.file_path)) continue;
    try {
      const metadata = JSON.parse(row.metadata || '{}');
      const typeMask = resolveSparseSymbolMask(metadata.type);
      if (typeMask === 0) continue;
      masks.set(row.file_path, masks.get(row.file_path) | typeMask);
    } catch {
      // Ignore malformed metadata rows; sparse gram build is best effort.
    }
  }
  return codeFiles.map((filePath) => masks.get(filePath) || 0);
}

function hasVectorColumn(db, column) {
  try {
    return db.prepare('PRAGMA table_info(vectors)').all().some((col) => col.name === column);
  } catch (_err) {
    return false;
  }
}

function liveVectorSql(db) {
  return hasVectorColumn(db, 'epoch_retired') ? 'epoch_retired IS NULL' : '1=1';
}

export async function buildSparseGramArtifact(allFiles, dryRun) {
  if (dryRun) {
    log('DRY RUN: Skipping sparse gram artifact build', 'magenta');
    return { skipped: true, reason: 'dry_run' };
  }

  if (!Array.isArray(allFiles) || allFiles.length === 0) {
    log('Skipping sparse gram artifact: no files discovered', 'yellow');
    return { skipped: true, reason: 'no_files' };
  }

  const codeFiles = allFiles.filter((filePath) => {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return CODE_FILE_EXTENSIONS.has(ext);
  });

  if (codeFiles.length === 0) {
    log('Skipping sparse gram artifact: no code-search files discovered', 'yellow');
    return { skipped: true, reason: 'no_code_files' };
  }

  if (!hasNativeSparseGramSupport()) {
    log('Skipping sparse gram artifact: native addon unavailable', 'yellow');
    return { skipped: true, reason: 'native_unavailable' };
  }

  const stagedPath = DB_PATHS.sparseGramIndex + '.tmp';
  await fs.mkdir(path.dirname(stagedPath), { recursive: true });

  try {
    const fileSymbolMasks = await collectFileSymbolMasks(codeFiles);
    log('Building sparse gram artifact...', 'yellow');
    const result = buildSparseGramIndexArtifact({
      projectRoot: PROJECT_ROOT,
      files: codeFiles,
      fileSymbolMasks,
      outputPath: stagedPath,
    });
    const weightsId = await resolveSparseGramWeightsId(result, stagedPath);
    await atomicSwapDatabase(stagedPath, DB_PATHS.sparseGramIndex);
    log(
      `Sparse gram artifact promoted (${result.filesIndexed} files, ${result.grams} grams, ${result.postings} postings)`,
      'green'
    );
    return { ...result, weightsId };
  } catch (err) {
    await unlinkIfExists(stagedPath);
    throw err;
  }
}

export const __TEST__ = {
  collectFileSymbolMasks,
  collectFileSymbolMasksFromDb,
  liveVectorSql,
  resolveSparseGramWeightsId,
};
