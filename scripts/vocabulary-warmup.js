#!/usr/bin/env node

/**
 * Vocabulary Warmup v1.0 - Proactive Embedding Pre-computation
 *
 * Pre-computes Voyage embeddings for ALL entity names in the codebase,
 * plus common query variants. This means ~80% of likely queries are
 * sub-millisecond (vocabulary cache hit).
 *
 * What it does:
 * 1. Extracts all entity names from code-graph.db (classes, methods, etc.)
 * 2. Generates question variants ("what is X", "how does X work")
 * 3. Computes Voyage embeddings in batches
 * 4. Stores in vocabulary.json for instant lookup
 *
 * Run after indexing: node vocabulary-warmup.js
 * Run with questions:  node vocabulary-warmup.js --with-questions
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { DB_PATHS, EMBEDDING_CONFIG, EMBEDDING_PROVIDERS } from '../core/config.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const QUESTION_TEMPLATES = [
  'what is {name}',
  'how does {name} work',
  'where is {name} defined',
  'where is {name} used',
  '{name} implementation',
  '{name} class',
  '{name} method',
];

// Types to generate question variants for
const IMPORTANT_TYPES = ['class', 'interface', 'service', 'controller', 'repository'];

// =============================================================================
// ENTITY EXTRACTION
// =============================================================================

async function extractEntities() {
  if (!existsSync(DB_PATHS.codeGraph)) {
    throw new Error('Code graph not found. Run indexing first.');
  }

  const db = new Database(DB_PATHS.codeGraph, { readonly: true });
  const { applyReadPragmas } = await import('../core/infrastructure/index.js');
  applyReadPragmas(db);

  const entities = db.prepare(`
    SELECT name, type, COUNT(*) as count
    FROM entities
    GROUP BY name, type
    ORDER BY count DESC
  `).all();

  db.close();

  console.log(`Extracted ${entities.length} unique entity names`);
  return entities;
}

// =============================================================================
// QUESTION GENERATION
// =============================================================================

function generateQuestions(entities) {
  const questions = new Set();

  for (const entity of entities) {
    const name = entity.name;
    const type = entity.type?.toLowerCase() || '';

    // Add the entity name itself
    questions.add(name);

    // For important types, add question variants
    if (IMPORTANT_TYPES.some(t => type.includes(t) || name.toLowerCase().includes(t))) {
      for (const template of QUESTION_TEMPLATES) {
        questions.add(template.replace('{name}', name));
      }
    }
  }

  console.log(`Generated ${questions.size} terms (entities + questions)`);
  return Array.from(questions);
}

// =============================================================================
// VOYAGE API BATCHED EMBEDDING
// =============================================================================

async function callVoyageAPIBatch(texts, config) {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      input_type: 'query',  // Use query type for better matching
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

async function generateEmbeddings(terms, batchSize = 128) {
  const voyageConfig = EMBEDDING_PROVIDERS.voyage;

  if (!voyageConfig.enabled) {
    throw new Error('Voyage API not configured. Set VOYAGEAI_API_KEY.');
  }

  const embeddings = new Map();
  const batches = [];

  // Split into batches
  for (let i = 0; i < terms.length; i += batchSize) {
    batches.push(terms.slice(i, i + batchSize));
  }

  console.log(`Processing ${batches.length} batches of ${batchSize} terms...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const start = Date.now();

    try {
      const batchEmbeddings = await callVoyageAPIBatch(batch, voyageConfig);

      for (let j = 0; j < batch.length; j++) {
        embeddings.set(batch[j].toLowerCase().trim(), batchEmbeddings[j]);
      }

      const elapsed = Date.now() - start;
      const progress = ((i + 1) / batches.length * 100).toFixed(1);
      process.stdout.write(`\r[${progress}%] Batch ${i + 1}/${batches.length} (${elapsed}ms)`);

      // Rate limiting: 300 requests/min = 200ms between requests
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error(`\nBatch ${i + 1} failed: ${err.message}`);
      // Continue with next batch
    }
  }

  console.log(`\nGenerated ${embeddings.size} embeddings`);
  return embeddings;
}

// =============================================================================
// VOCABULARY STORAGE
// =============================================================================

async function loadExistingVocabulary() {
  try {
    if (existsSync(DB_PATHS.vocabulary)) {
      const data = JSON.parse(await fs.readFile(DB_PATHS.vocabulary, 'utf-8'));
      return new Map(Object.entries(data.terms || {}));
    }
  } catch (err) {
    console.log(`No existing vocabulary: ${err.message}`);
  }
  return new Map();
}

async function saveVocabulary(embeddings) {
  const data = {
    metadata: {
      version: 2,
      provider: EMBEDDING_CONFIG.provider,
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      termCount: embeddings.size,
      source: 'vocabulary-warmup',
    },
    terms: Object.fromEntries(embeddings),
  };

  await fs.mkdir(path.dirname(DB_PATHS.vocabulary), { recursive: true });
  await fs.writeFile(DB_PATHS.vocabulary, JSON.stringify(data, null, 2));

  console.log(`Saved vocabulary: ${embeddings.size} terms`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const withQuestions = args.includes('--with-questions');
  const forceAll = args.includes('--force');

  console.log('='.repeat(60));
  console.log('VOCABULARY WARMUP - Proactive Embedding Pre-computation');
  console.log('='.repeat(60));
  console.log(`Mode: ${withQuestions ? 'Entities + Questions' : 'Entities only'}`);
  console.log();

  // Step 1: Extract entities
  console.log('Step 1: Extracting entities from code graph...');
  const entities = await extractEntities();

  // Step 2: Generate terms (with or without questions)
  console.log('\nStep 2: Generating terms...');
  let terms;
  if (withQuestions) {
    terms = generateQuestions(entities);
  } else {
    terms = [...new Set(entities.map(e => e.name))];
    console.log(`${terms.length} unique entity names`);
  }

  // Step 3: Load existing vocabulary
  console.log('\nStep 3: Loading existing vocabulary...');
  const existing = await loadExistingVocabulary();
  console.log(`Existing: ${existing.size} terms`);

  // Step 4: Find new terms
  const newTerms = forceAll ? terms : terms.filter(t => !existing.has(t.toLowerCase().trim()));
  console.log(`New terms to embed: ${newTerms.length}`);

  if (newTerms.length === 0) {
    console.log('\nAll terms already in vocabulary. Use --force to re-compute all.');
    return;
  }

  // Step 5: Generate embeddings
  console.log('\nStep 4: Generating Voyage embeddings...');
  const newEmbeddings = await generateEmbeddings(newTerms);

  // Step 6: Merge and save
  console.log('\nStep 5: Merging and saving vocabulary...');
  const merged = new Map([...existing, ...newEmbeddings]);
  await saveVocabulary(merged);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VOCABULARY WARMUP COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total terms: ${merged.size}`);
  console.log(`New terms added: ${newEmbeddings.size}`);
  console.log(`File: ${DB_PATHS.vocabulary}`);
  console.log();
  console.log('These queries are now sub-millisecond:');
  console.log('  - All class/method/interface names');
  if (withQuestions) {
    console.log('  - "what is X", "how does X work" variants');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
