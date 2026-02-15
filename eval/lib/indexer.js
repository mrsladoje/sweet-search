/**
 * Sweet Search indexing and initialization for benchmark evaluation.
 */

import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

/**
 * Run Sweet Search indexer on a corpus directory.
 * Uses two-phase indexing to avoid ONNX model loading conflicts.
 *
 * @param {string} corpusDir - Directory containing corpus files
 * @param {string} projectRoot - Sweet Search project root
 */
export async function indexCorpus(corpusDir, projectRoot) {
  console.log(`\n  Indexing corpus at ${corpusDir}...`);
  const start = Date.now();

  const indexer = path.join(projectRoot, 'core', 'index-codebase-v21.js');
  const indexEnv = {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: corpusDir,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'local',
    VOYAGEAI_API_KEY: '',
  };

  // Phase 1: Code graph only
  await runIndexerPhase(indexer, ['--graph-only', '--quiet'], corpusDir, indexEnv, 'graph');

  // Delete merkle state so vectors phase sees all files as new
  const merkleState = path.join(corpusDir, '.sweet-search', 'merkle-state.json');
  try { await fs.unlink(merkleState); } catch {}

  // Phase 2: Vectors + HNSW + ColBERT
  await runIndexerPhase(indexer, ['--vectors-only', '--quiet'], corpusDir, indexEnv, 'vectors');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Indexing completed in ${elapsed}s`);
}

/**
 * Initialize Sweet Search pointed at a corpus index.
 *
 * @param {string} corpusDir - Directory containing .sweet-search/ index
 * @param {string} projectRoot - Sweet Search project root
 * @returns {Object} Initialized SweetSearch instance
 */
export async function initSearch(corpusDir, projectRoot) {
  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';

  const dataDir = path.join(corpusDir, '.sweet-search');
  const { SweetSearch } = await import(path.join(projectRoot, 'core', 'sweet-search.js'));

  const search = new SweetSearch({
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    useColBERT: true,
    verbose: false,
    timing: false,
  });

  await search.init();
  return search;
}

function runIndexerPhase(indexer, args, corpusDir, env, phaseName) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [indexer, ...args], {
      cwd: corpusDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        console.error(`  Indexer ${phaseName} failed (exit code ${code})`);
        console.error(`  stdout: ${stdout.slice(-500)}`);
        console.error(`  stderr: ${stderr.slice(-500)}`);
        reject(new Error(`Indexer ${phaseName} exited with code ${code}: ${stderr.slice(-200)}`));
      }
    });
  });
}
