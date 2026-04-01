#!/usr/bin/env node

/**
 * Vocabulary Utilities v2.0 - Binary Format + Query Mining + Graph Templates
 *
 * SOTA December 2025 improvements:
 * 1. Query Log Mining - Auto-learns from your frequent queries
 * 2. Matryoshka Truncation - 256d (75% smaller, 4x faster load)
 * 3. Binary mmap Format - Zero-load vocabulary via Float32Array
 * 4. Graph-Aware Templates - Pre-warms structural queries
 *
 * Usage:
 *   node vocabulary-utils.js migrate       # Migrate JSON to binary (one-time)
 *   node vocabulary-utils.js learn         # Learn from query logs
 *   node vocabulary-utils.js warmup        # Full warmup (entities + questions + graph)
 *   node vocabulary-utils.js warmup-inc    # Incremental warmup (changed files only)
 *   node vocabulary-utils.js stats         # Show vocabulary statistics
 *
 * References:
 * - https://blog.voyageai.com/2024/12/04/voyage-code-3/
 * - https://docs.voyageai.com/docs/flexible-dimensions-and-quantization
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../infrastructure/config/index.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Matryoshka dimension (256d = 75% smaller, ~1.5% accuracy loss)
  matryoshkaDimension: 256,

  // Query log mining
  minQueryFrequency: 3,  // Promote queries used 3+ times

  // Graph-aware templates for structural queries (GraphRAG support)
  structuralTemplates: [
    'what calls {name}',
    'who calls {name}',
    '{name} callers',
    'what does {name} call',
    '{name} dependencies',
    'implementations of {name}',
    '{name} implementors',
    'what extends {name}',
    '{name} subclasses',
    'impact of changing {name}',
  ],

  // Standard question templates
  questionTemplates: [
    'what is {name}',
    'how does {name} work',
    'where is {name} defined',
    'where is {name} used',
    '{name} implementation',
  ],

  // Entity types that get question variants
  importantTypes: ['class', 'interface', 'service', 'controller', 'repository'],

  // Batch size for Voyage API
  batchSize: 128,

  // Rate limiting (300 req/min = 200ms between requests)
  rateLimitMs: 200,
};

// =============================================================================
// PATH CONFIGURATION
// =============================================================================

// Project root is resolved in config.js (cwd/env-aware for standalone and host repos).

const PATHS = {
  jsonVocab: path.join(PROJECT_ROOT, '.sweet-search', 'query-vocabulary.json'),
  binaryVocab: path.join(PROJECT_ROOT, '.sweet-search', 'vocabulary.bin'),
  binaryMeta: path.join(PROJECT_ROOT, '.sweet-search', 'vocabulary.meta.json'),
  queryStats: path.join(PROJECT_ROOT, '.sweet-search', 'query-vocabulary-stats.json'),
  codeGraph: path.join(PROJECT_ROOT, '.sweet-search', 'code-graph.db'),
};

// =============================================================================
// BINARY VOCABULARY CLASS
// =============================================================================

/**
 * Binary Vocabulary with Matryoshka truncation
 *
 * Format:
 *   Header (32 bytes): VCAB magic, version, dimension, term count
 *   Embeddings: Float32Array (dimension * termCount * 4 bytes)
 *   Metadata: JSON with term->index mapping
 *
 * Benefits:
 *   - 75% smaller (256d vs 1024d)
 *   - ~4x faster load (binary vs JSON parsing)
 *   - Zero-copy Float32Array views
 */
export class BinaryVocabulary {
  constructor() {
    this.buffer = null;
    this.metadata = null;
    this.termIndex = null;
    this.dimension = CONFIG.matryoshkaDimension;
  }

  async load() {
    if (this.buffer) return true;

    if (!existsSync(PATHS.binaryVocab) || !existsSync(PATHS.binaryMeta)) {
      return false;
    }

    const start = Date.now();

    // Load metadata (small JSON with term→index mapping)
    const metaContent = await fs.readFile(PATHS.binaryMeta, 'utf-8');
    this.metadata = JSON.parse(metaContent);
    this.dimension = this.metadata.dimension;

    // Build term→index lookup
    this.termIndex = new Map();
    for (let i = 0; i < this.metadata.terms.length; i++) {
      this.termIndex.set(this.metadata.terms[i].toLowerCase(), i);
    }

    // Load binary file into buffer (OS mmap's for large files)
    this.buffer = await fs.readFile(PATHS.binaryVocab);

    const loadMs = Date.now() - start;
    return { ok: true, terms: this.termIndex.size, dimension: this.dimension, ms: loadMs };
  }

  get(term) {
    if (!this.buffer || !this.termIndex) return null;

    const normalized = term.toLowerCase().trim();
    const index = this.termIndex.get(normalized);
    if (index === undefined) return null;

    // Skip 32-byte header + (index * dimension * 4 bytes per float)
    const headerSize = 32;
    const offset = headerSize + (index * this.dimension * 4);

    // Create Float32Array view directly on buffer (zero-copy)
    const embedding = new Float32Array(
      this.buffer.buffer,
      this.buffer.byteOffset + offset,
      this.dimension
    );

    return Array.from(embedding);
  }

  has(term) {
    return this.termIndex?.has(term.toLowerCase().trim()) || false;
  }

  size() {
    return this.termIndex?.size || 0;
  }

  async save(embeddings) {
    const terms = Array.from(embeddings.keys());
    const dimension = CONFIG.matryoshkaDimension;

    // Create header
    const header = Buffer.alloc(32);
    Buffer.from('VCAB').copy(header, 0);
    header.writeUInt32LE(2, 4);  // Version
    header.writeUInt32LE(dimension, 8);
    header.writeUInt32LE(terms.length, 12);

    // Create embedding buffer
    const embeddingBuffer = Buffer.alloc(terms.length * dimension * 4);

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const embedding = embeddings.get(term);

      // Truncate to 256d if needed (Matryoshka)
      const truncated = embedding.slice(0, dimension);

      // Write Float32Array
      const offset = i * dimension * 4;
      for (let j = 0; j < dimension; j++) {
        embeddingBuffer.writeFloatLE(truncated[j] || 0, offset + j * 4);
      }
    }

    // Combine and write
    const fullBuffer = Buffer.concat([header, embeddingBuffer]);
    await fs.mkdir(path.dirname(PATHS.binaryVocab), { recursive: true });
    await fs.writeFile(PATHS.binaryVocab, fullBuffer);

    // Write metadata
    const metadata = {
      version: 2,
      dimension,
      termCount: terms.length,
      created: new Date().toISOString(),
      terms,
    };
    await fs.writeFile(PATHS.binaryMeta, JSON.stringify(metadata, null, 2));

    return { terms: terms.length, sizeBytes: fullBuffer.length };
  }
}

// =============================================================================
// QUERY LOG MINING
// =============================================================================

/**
 * Mine query logs to find frequently-used queries that should be pre-warmed.
 * This is the "self-learning" part - the system adapts to your usage patterns.
 */
export async function mineQueryLogs() {
  if (!existsSync(PATHS.queryStats)) {
    return { queries: [], total: 0 };
  }

  const data = JSON.parse(await fs.readFile(PATHS.queryStats, 'utf-8'));
  const queries = data.queries || {};

  // Find queries used >= minQueryFrequency times
  const frequentQueries = [];
  for (const [query, count] of Object.entries(queries)) {
    if (count >= CONFIG.minQueryFrequency) {
      frequentQueries.push({ query, count });
    }
  }

  // Sort by frequency (most used first)
  frequentQueries.sort((a, b) => b.count - a.count);

  return {
    queries: frequentQueries.map(q => q.query),
    total: frequentQueries.length,
    top10: frequentQueries.slice(0, 10),
  };
}

// =============================================================================
// ENTITY EXTRACTION
// =============================================================================

export async function extractEntities() {
  if (!existsSync(PATHS.codeGraph)) {
    return { entities: [], error: 'Code graph not found' };
  }

  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  const db = new Database(PATHS.codeGraph, { readonly: true });
  applyReadPragmas(db);

  const entities = db.prepare(`
    SELECT name, type, COUNT(*) as count
    FROM entities
    GROUP BY name, type
    ORDER BY count DESC
  `).all();

  db.close();

  return { entities, count: entities.length };
}

// =============================================================================
// TEMPLATE GENERATION
// =============================================================================

export function generateAllTerms(entities, frequentQueries) {
  const terms = new Set();
  const stats = { names: 0, questions: 0, structural: 0, learned: 0 };

  // 1. Add all entity names
  for (const entity of entities) {
    terms.add(entity.name);
    stats.names++;
  }

  // 2. Add question templates for important types
  for (const entity of entities) {
    const name = entity.name;
    const type = entity.type?.toLowerCase() || '';

    if (CONFIG.importantTypes.some(t => type.includes(t) || name.toLowerCase().includes(t))) {
      for (const template of CONFIG.questionTemplates) {
        terms.add(template.replace('{name}', name));
        stats.questions++;
      }
    }
  }

  // 3. Add graph-aware structural templates for important entities
  for (const entity of entities) {
    const name = entity.name;
    const type = entity.type?.toLowerCase() || '';

    if (CONFIG.importantTypes.some(t => type.includes(t))) {
      for (const template of CONFIG.structuralTemplates) {
        terms.add(template.replace('{name}', name));
        stats.structural++;
      }
    }
  }

  // 4. Add frequently used queries from log mining
  for (const query of frequentQueries) {
    terms.add(query);
    stats.learned++;
  }

  return { terms: Array.from(terms), stats };
}

// =============================================================================
// VOYAGE API
// =============================================================================

async function getVoyageConfig() {
  const { EMBEDDING_PROVIDERS } = await import('../infrastructure/config/index.js');
  return EMBEDDING_PROVIDERS.voyage;
}

export async function callVoyageAPI(texts, outputDimension = CONFIG.matryoshkaDimension) {
  const config = await getVoyageConfig();

  if (!config.enabled) {
    throw new Error('Voyage API not configured. Set VOYAGEAI_API_KEY.');
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      input_type: 'query',
      output_dimension: outputDimension,  // Matryoshka at API level
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// =============================================================================
// MIGRATION: JSON → BINARY
// =============================================================================

export async function migrateJsonToBinary() {
  if (!existsSync(PATHS.jsonVocab)) {
    return { error: 'No JSON vocabulary found' };
  }

  const start = Date.now();

  // Load JSON
  const jsonData = JSON.parse(await fs.readFile(PATHS.jsonVocab, 'utf-8'));
  const terms = jsonData.terms || {};
  const originalDim = Object.values(terms)[0]?.length || 1024;

  if (originalDim < CONFIG.matryoshkaDimension) {
    return { error: `Original dimension ${originalDim}d < target ${CONFIG.matryoshkaDimension}d` };
  }

  // Truncate and convert to Map
  const embeddings = new Map();
  for (const [term, embedding] of Object.entries(terms)) {
    embeddings.set(term, embedding.slice(0, CONFIG.matryoshkaDimension));
  }

  // Save binary
  const binaryVocab = new BinaryVocabulary();
  const result = await binaryVocab.save(embeddings);

  // Get sizes for comparison
  const jsonSize = statSync(PATHS.jsonVocab).size;
  const binSize = result.sizeBytes;

  return {
    ok: true,
    terms: result.terms,
    jsonSizeMB: (jsonSize / 1024 / 1024).toFixed(1),
    binSizeMB: (binSize / 1024 / 1024).toFixed(1),
    reduction: ((1 - binSize / jsonSize) * 100).toFixed(1) + '%',
    ms: Date.now() - start,
  };
}

// =============================================================================
// WARMUP: FULL
// =============================================================================

export async function warmupFull(options = {}) {
  const { force = false, verbose = false } = options;
  const start = Date.now();
  const log = verbose ? console.log : () => {};

  log('Step 1: Mining query logs...');
  const { queries: frequentQueries, total: learnedCount } = await mineQueryLogs();
  log(`  Found ${learnedCount} frequent queries`);

  log('Step 2: Extracting entities...');
  const { entities, count: entityCount } = await extractEntities();
  log(`  Found ${entityCount} entities`);

  log('Step 3: Generating terms...');
  const { terms: allTerms, stats } = generateAllTerms(entities, frequentQueries);
  log(`  Names: ${stats.names}, Questions: ${stats.questions}, Structural: ${stats.structural}, Learned: ${stats.learned}`);
  log(`  Total unique: ${allTerms.length}`);

  log('Step 4: Loading existing vocabulary...');
  const binaryVocab = new BinaryVocabulary();
  const existingLoaded = force ? false : await binaryVocab.load();

  // Find new terms
  let newTerms = allTerms;
  if (existingLoaded) {
    newTerms = allTerms.filter(t => !binaryVocab.has(t));
    log(`  Existing: ${binaryVocab.size()}, New: ${newTerms.length}`);
  }

  if (newTerms.length === 0) {
    return { ok: true, terms: binaryVocab.size(), newTerms: 0, ms: Date.now() - start };
  }

  log('Step 5: Generating embeddings...');
  const embeddings = new Map();

  // Copy existing
  if (existingLoaded) {
    for (const term of binaryVocab.metadata.terms) {
      embeddings.set(term, binaryVocab.get(term));
    }
  }

  // Generate new in batches
  const batches = [];
  for (let i = 0; i < newTerms.length; i += CONFIG.batchSize) {
    batches.push(newTerms.slice(i, i + CONFIG.batchSize));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const batchEmbeddings = await callVoyageAPI(batch);
      for (let j = 0; j < batch.length; j++) {
        embeddings.set(batch[j].toLowerCase().trim(), batchEmbeddings[j]);
      }
      if (verbose) {
        process.stdout.write(`\r  Batch ${i + 1}/${batches.length}`);
      }
      if (i < batches.length - 1) {
        await new Promise(r => setTimeout(r, CONFIG.rateLimitMs));
      }
    } catch (err) {
      log(`  Batch ${i + 1} failed: ${err.message}`);
    }
  }
  if (verbose) console.log();

  log('Step 6: Saving binary vocabulary...');
  const result = await binaryVocab.save(embeddings);

  return {
    ok: true,
    terms: result.terms,
    newTerms: newTerms.length,
    sizeBytes: result.sizeBytes,
    ms: Date.now() - start,
  };
}

// =============================================================================
// WARMUP: LEARN ONLY
// =============================================================================

export async function warmupLearn(options = {}) {
  const { verbose = false } = options;
  const start = Date.now();
  const log = verbose ? console.log : () => {};

  log('Step 1: Mining query logs...');
  const { queries: frequentQueries, total: learnedCount, top10 } = await mineQueryLogs();

  if (learnedCount === 0) {
    return { ok: true, learned: 0, ms: Date.now() - start };
  }

  log(`  Found ${learnedCount} frequent queries`);
  if (verbose && top10.length > 0) {
    log('  Top 10:');
    for (const { query, count } of top10) {
      log(`    "${query.substring(0, 40)}..." (${count}x)`);
    }
  }

  log('Step 2: Loading existing vocabulary...');
  const binaryVocab = new BinaryVocabulary();
  const loaded = await binaryVocab.load();

  // Find queries not in vocabulary
  const newQueries = frequentQueries.filter(q => !loaded || !binaryVocab.has(q));
  log(`  New queries to embed: ${newQueries.length}`);

  if (newQueries.length === 0) {
    return { ok: true, learned: 0, existing: binaryVocab.size(), ms: Date.now() - start };
  }

  log('Step 3: Generating embeddings...');
  const embeddings = new Map();

  // Copy existing
  if (loaded) {
    for (const term of binaryVocab.metadata.terms) {
      embeddings.set(term, binaryVocab.get(term));
    }
  }

  // Generate new
  const batches = [];
  for (let i = 0; i < newQueries.length; i += CONFIG.batchSize) {
    batches.push(newQueries.slice(i, i + CONFIG.batchSize));
  }

  for (const batch of batches) {
    try {
      const batchEmbeddings = await callVoyageAPI(batch);
      for (let j = 0; j < batch.length; j++) {
        embeddings.set(batch[j].toLowerCase().trim(), batchEmbeddings[j]);
      }
    } catch (err) {
      log(`  Batch failed: ${err.message}`);
    }
  }

  log('Step 4: Saving...');
  const result = await binaryVocab.save(embeddings);

  return {
    ok: true,
    learned: newQueries.length,
    total: result.terms,
    ms: Date.now() - start,
  };
}

// =============================================================================
// STATS
// =============================================================================

export async function getStats() {
  const stats = {};

  // Binary vocabulary
  if (existsSync(PATHS.binaryVocab) && existsSync(PATHS.binaryMeta)) {
    const binSize = statSync(PATHS.binaryVocab).size;
    const meta = JSON.parse(await fs.readFile(PATHS.binaryMeta, 'utf-8'));
    stats.binary = {
      terms: meta.termCount,
      dimension: meta.dimension,
      sizeMB: (binSize / 1024 / 1024).toFixed(1),
      created: meta.created,
    };
  }

  // JSON vocabulary (legacy)
  if (existsSync(PATHS.jsonVocab)) {
    const jsonSize = statSync(PATHS.jsonVocab).size;
    stats.json = {
      sizeMB: (jsonSize / 1024 / 1024).toFixed(1),
    };
  }

  // Query stats
  if (existsSync(PATHS.queryStats)) {
    const data = JSON.parse(await fs.readFile(PATHS.queryStats, 'utf-8'));
    const queries = data.queries || {};
    const counts = Object.values(queries);
    stats.queryLog = {
      uniqueQueries: Object.keys(queries).length,
      totalQueries: counts.reduce((a, b) => a + b, 0),
      frequent: counts.filter(c => c >= CONFIG.minQueryFrequency).length,
    };
  }

  return stats;
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const verbose = args.includes('--verbose') || args.includes('-v');

  switch (cmd) {
    case 'migrate':
      console.log('Migrating JSON vocabulary to binary format...');
      const migrateResult = await migrateJsonToBinary();
      if (migrateResult.error) {
        console.error('Error:', migrateResult.error);
      } else {
        console.log(`Done in ${migrateResult.ms}ms`);
        console.log(`  Terms: ${migrateResult.terms}`);
        console.log(`  JSON: ${migrateResult.jsonSizeMB}MB → Binary: ${migrateResult.binSizeMB}MB`);
        console.log(`  Reduction: ${migrateResult.reduction}`);
      }
      break;

    case 'learn':
      console.log('Learning from query logs...');
      const learnResult = await warmupLearn({ verbose });
      console.log(`Done in ${learnResult.ms}ms`);
      console.log(`  Learned: ${learnResult.learned} queries`);
      console.log(`  Total vocabulary: ${learnResult.total || learnResult.existing || 0} terms`);
      break;

    case 'warmup':
      console.log('Full vocabulary warmup (entities + questions + graph + learned)...');
      const warmupResult = await warmupFull({ verbose, force: args.includes('--force') });
      console.log(`Done in ${warmupResult.ms}ms`);
      console.log(`  Total: ${warmupResult.terms} terms`);
      console.log(`  New: ${warmupResult.newTerms} terms`);
      break;

    case 'warmup-inc':
      console.log('Incremental warmup (learned queries only)...');
      const incResult = await warmupLearn({ verbose });
      console.log(`Done in ${incResult.ms}ms`);
      console.log(`  Learned: ${incResult.learned} queries`);
      break;

    case 'stats':
      const stats = await getStats();
      console.log('Vocabulary Statistics:');
      if (stats.binary) {
        console.log(`  Binary: ${stats.binary.terms} terms (${stats.binary.dimension}d, ${stats.binary.sizeMB}MB)`);
      }
      if (stats.json) {
        console.log(`  JSON (legacy): ${stats.json.sizeMB}MB`);
      }
      if (stats.queryLog) {
        console.log(`  Query log: ${stats.queryLog.uniqueQueries} unique, ${stats.queryLog.frequent} frequent`);
      }
      break;

    default:
      console.log(`
Vocabulary Utilities v2.0

Usage:
  node vocabulary-utils.js migrate       Migrate JSON to binary (75% smaller)
  node vocabulary-utils.js learn         Learn from query logs (self-learning)
  node vocabulary-utils.js warmup        Full warmup (all templates)
  node vocabulary-utils.js warmup-inc    Incremental warmup (learned only)
  node vocabulary-utils.js stats         Show vocabulary statistics

Options:
  --verbose, -v    Show detailed progress
  --force          Force regenerate all embeddings
`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export default {
  BinaryVocabulary,
  mineQueryLogs,
  extractEntities,
  generateAllTerms,
  callVoyageAPI,
  migrateJsonToBinary,
  warmupFull,
  warmupLearn,
  getStats,
  CONFIG,
  PATHS,
};
