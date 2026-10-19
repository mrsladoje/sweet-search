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
 * @param {boolean} [options.buildLateInteraction=true]
 * @param {boolean} [options.useLateInteraction=true]
 * @param {string|null} [options.lateInteractionModel=null] - Model ID override (e.g. 'lateon-code-edge')
 * @param {boolean} [options.sqliteFastMode=false]
 * @param {boolean} [options.requireNativeAnn=false]
 * @param {boolean} [options.verbose=false] - Stream indexer output to console in real-time
 * @returns {Promise<{ elapsed: number, indexMode: string, timings: Object }>}
 */
export async function indexCorpus(corpusDir, projectRoot, options = {}) {
  const {
    indexMode = 'single',
    buildLateInteraction = true,
    lateInteractionModel = null,
    sqliteFastMode = false,
    requireNativeAnn = false,
    verbose = false,
  } = options;

  console.log(`\n  Indexing corpus at ${corpusDir} (mode: ${indexMode})...`);
  const start = Date.now();

  const indexer = path.join(projectRoot, 'core', 'indexing', 'index-codebase-v21.js');
  const indexEnv = {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: corpusDir,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'local',
    VOYAGEAI_API_KEY: '',
    // Benchmark indexes are built on the accelerator, never by the index-device
    // speed test (one test on a busy machine could move them to the CPU).
    SWEET_SEARCH_INDEX_DEVICE: process.env.SWEET_SEARCH_INDEX_DEVICE || 'accelerator',
  };
  if (sqliteFastMode) {
    indexEnv.SWEET_SEARCH_SQLITE_FAST_MODE = '1';
  } else {
    // Prevent parent-shell leakage from accidentally enabling unsafe mode.
    delete indexEnv.SWEET_SEARCH_SQLITE_FAST_MODE;
  }

  let graphPhaseMs = null;
  let vectorsPhaseMs = null;

  // Set late interaction model env var if specified (overrides config.js default)
  if (lateInteractionModel) {
    indexEnv.SWEET_SEARCH_LATE_INTERACTION_MODEL = lateInteractionModel;
  }

  const streamOutput = !!options.verbose;

  if (indexMode === 'two-phase') {
    // Phase 1: Code graph only
    const graphStart = Date.now();
    const graphArgs = ['--graph-only'];
    if (!streamOutput) graphArgs.push('--quiet');
    if (requireNativeAnn) graphArgs.push('--require-native-ann');
    await runIndexerPhase(indexer, graphArgs, corpusDir, indexEnv, 'graph', { streamOutput });
    graphPhaseMs = Date.now() - graphStart;

    // Delete merkle state so vectors phase sees all files as new
    const merkleState = path.join(corpusDir, '.sweet-search', 'merkle-state.json');
    try { await fs.unlink(merkleState); } catch {}

    // Phase 2: Vectors + HNSW + Late Interaction
    const vectorsStart = Date.now();
    const vectorArgs = ['--vectors-only'];
    if (!streamOutput) vectorArgs.push('--quiet');
    if (!buildLateInteraction) vectorArgs.push('--no-late-interaction');
    else if (lateInteractionModel) vectorArgs.push(`--late-interaction-model=${lateInteractionModel}`);
    if (requireNativeAnn) vectorArgs.push('--require-native-ann');
    await runIndexerPhase(indexer, vectorArgs, corpusDir, indexEnv, 'vectors', { streamOutput });
    vectorsPhaseMs = Date.now() - vectorsStart;
  } else {
    // Single-pass mode: one indexer invocation handles everything
    const args = [];
    if (!streamOutput) args.push('--quiet');
    if (!buildLateInteraction) args.push('--no-late-interaction');
    else if (lateInteractionModel) args.push(`--late-interaction-model=${lateInteractionModel}`);
    if (requireNativeAnn) args.push('--require-native-ann');
    await runIndexerPhase(indexer, args, corpusDir, indexEnv, 'index', { streamOutput });
  }

  if (indexEnv.SWEET_SEARCH_INDEX_DEVICE === 'accelerator') {
    await assertAcceleratorProvenance(corpusDir);
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
 * Refuse a benchmark index that an accelerator host wrote on ORT CPU only
 * (the accelerator pin did not hold). Hosts with no accelerator pass.
 */
async function assertAcceleratorProvenance(corpusDir) {
  const { hasIndexAcceleratorHardware } = await import(new URL('../../core/indexing/model-pool.js', import.meta.url));
  if (!hasIndexAcceleratorHardware()) return;
  const { acceleratorProvenanceProblem } = await import(new URL('../../core/indexing/index-device-choice.js', import.meta.url));
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(corpusDir, '.sweet-search', 'reconcile-manifest.json'), 'utf8'));
  } catch {
    return; // no manifest (old layout): nothing recorded to check
  }
  const problem = acceleratorProvenanceProblem(manifest);
  if (problem) {
    throw new Error(`Benchmark index at ${corpusDir}: ${problem}. Set SWEET_SEARCH_INDEX_DEVICE=cpu to accept a CPU-built index.`);
  }
}

/**
 * Initialize Sweet Search for querying.
 *
 * @param {string} corpusDir - Directory containing .sweet-search/ index
 * @param {string} projectRoot - Sweet Search project root
 * @param {Object} [options]
 * @param {boolean} [options.useLateInteraction=true]
 * @param {string|null} [options.lateInteractionModel=null] - Model ID override
 * @returns {Promise<Object>} Initialized SweetSearch instance
 */
export async function initSearch(corpusDir, projectRoot, options = {}) {
  const {
    useLateInteraction = true,
    lateInteractionModel = null,
    stage3Candidates = null,    // null → use production default (30)
  } = options;

  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';
  if (lateInteractionModel) {
    process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = lateInteractionModel;
  }

  const dataDir = path.join(corpusDir, '.sweet-search');
  const { SweetSearch } = await import(path.join(projectRoot, 'core', 'search', 'sweet-search.js'));

  const search = new SweetSearch({
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    useLateInteraction,
    ...(stage3Candidates != null ? { stage3Candidates } : {}),
    verbose: false,
    timing: false,
  });

  await search.init();
  return search;
}

function runIndexerPhase(indexer, args, corpusDir, env, phaseName, { streamOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const stdio = streamOutput
      ? ['pipe', 'inherit', 'inherit']   // Stream stdout+stderr to console in real-time
      : ['pipe', 'pipe', 'pipe'];

    const child = spawn('node', [indexer, ...args], {
      cwd: corpusDir,
      env,
      stdio,
    });

    let stdout = '';
    let stderr = '';
    if (!streamOutput) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        console.error(`  Indexer ${phaseName} failed (exit code ${code})`);
        if (!streamOutput) {
          console.error(`  stdout: ${stdout.slice(-500)}`);
          console.error(`  stderr: ${stderr.slice(-500)}`);
        }
        reject(new Error(`Indexer ${phaseName} exited with code ${code}: ${stderr.slice(-200)}`));
      }
    });
  });
}
