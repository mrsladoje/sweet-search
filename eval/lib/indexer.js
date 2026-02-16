/**
 * Sweet Search indexing and initialization for benchmark evaluation.
 */

import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

/**
 * Run Sweet Search indexer on a corpus directory.
 *
 * @param {string} corpusDir - Directory containing corpus files
 * @param {string} projectRoot - Sweet Search project root
 * @param {Object} [options]
 * @param {string} [options.indexMode='single'] - 'single' or 'two-phase'
 * @param {boolean} [options.buildColBERT=true]
 * @param {boolean} [options.useColBERT=true]
 * @param {boolean} [options.sqliteFastMode=false]
 * @param {boolean} [options.requireNativeAnn=false]
 * @returns {Promise<{ elapsed: number, indexMode: string, timings: Object }>}
 */
export async function indexCorpus(corpusDir, projectRoot, options = {}) {
  const {
    indexMode = 'single',
    buildColBERT = true,
    sqliteFastMode = false,
    requireNativeAnn = false,
  } = options;

  console.log(`\n  Indexing corpus at ${corpusDir} (mode: ${indexMode})...`);
  const start = Date.now();

  const indexer = path.join(projectRoot, 'core', 'index-codebase-v21.js');
  const indexEnv = {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: corpusDir,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'local',
    VOYAGEAI_API_KEY: '',
  };
  if (sqliteFastMode) {
    indexEnv.SWEET_SEARCH_SQLITE_FAST_MODE = '1';
  } else {
    // Prevent parent-shell leakage from accidentally enabling unsafe mode.
    delete indexEnv.SWEET_SEARCH_SQLITE_FAST_MODE;
  }

  let graphPhaseMs = null;
  let vectorsPhaseMs = null;

  if (indexMode === 'two-phase') {
    // Phase 1: Code graph only
    const graphStart = Date.now();
    const graphArgs = ['--graph-only', '--quiet'];
    if (requireNativeAnn) graphArgs.push('--require-native-ann');
    await runIndexerPhase(indexer, graphArgs, corpusDir, indexEnv, 'graph');
    graphPhaseMs = Date.now() - graphStart;

    // Delete merkle state so vectors phase sees all files as new
    const merkleState = path.join(corpusDir, '.sweet-search', 'merkle-state.json');
    try { await fs.unlink(merkleState); } catch {}

    // Phase 2: Vectors + HNSW + ColBERT
    const vectorsStart = Date.now();
    const vectorArgs = ['--vectors-only', '--quiet'];
    if (!buildColBERT) vectorArgs.push('--no-colbert');
    if (requireNativeAnn) vectorArgs.push('--require-native-ann');
    await runIndexerPhase(indexer, vectorArgs, corpusDir, indexEnv, 'vectors');
    vectorsPhaseMs = Date.now() - vectorsStart;
  } else {
    // Single-pass mode: one indexer invocation handles everything
    const args = ['--quiet'];
    if (!buildColBERT) args.push('--no-colbert');
    if (requireNativeAnn) args.push('--require-native-ann');
    await runIndexerPhase(indexer, args, corpusDir, indexEnv, 'index');
  }

  const totalMs = Date.now() - start;
  const elapsed = parseFloat((totalMs / 1000).toFixed(1));
  console.log(`  Indexing completed in ${elapsed}s`);

  return {
    elapsed,
    indexMode,
    timings: {
      total: totalMs,
      graphPhase: graphPhaseMs,
      vectorsPhase: vectorsPhaseMs,
    },
  };
}

/**
 * Initialize Sweet Search for querying.
 *
 * @param {string} corpusDir - Directory containing .sweet-search/ index
 * @param {string} projectRoot - Sweet Search project root
 * @param {Object} [options]
 * @param {boolean} [options.useColBERT=true]
 * @returns {Promise<Object>} Initialized SweetSearch instance
 */
export async function initSearch(corpusDir, projectRoot, options = {}) {
  const { useColBERT = true } = options;

  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';

  const dataDir = path.join(corpusDir, '.sweet-search');
  const { SweetSearch } = await import(path.join(projectRoot, 'core', 'sweet-search.js'));

  const search = new SweetSearch({
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    useColBERT,
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
