#!/usr/bin/env node
/**
 * Diagnostic: Check Int8 embedding computation
 */

import { getEmbedding, truncateForHNSW, floatToInt8, int8CosineSimilarity } from '../core/embedding/index.js';
import { BinaryHNSWIndex } from '../core/vector-store/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function diagnose() {
  console.log('=== INT8 EMBEDDING DIAGNOSTIC ===\n');

  // 1. Get embedding for a test query
  const query = 'how does authentication work';
  console.log(`Query: "${query}"\n`);

  const embedResult = await getEmbedding(query, { isQuery: true });
  console.log(`Float embedding dimension: ${embedResult.embedding.length}`);
  console.log(`First 5 values: ${embedResult.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}`);
  console.log(`Min/Max: ${Math.min(...embedResult.embedding).toFixed(4)} / ${Math.max(...embedResult.embedding).toFixed(4)}`);

  // 2. Truncate to HNSW dimension
  const truncated = truncateForHNSW(embedResult.embedding);
  console.log(`\nTruncated dimension: ${truncated.length}`);
  console.log(`First 5 values: ${truncated.slice(0, 5).map(v => v.toFixed(4)).join(', ')}`);

  // 3. Convert to Int8
  const int8 = floatToInt8(truncated);
  console.log(`\nInt8 dimension: ${int8.length}`);
  console.log(`First 5 values: ${[...int8.slice(0, 5)].join(', ')}`);
  console.log(`Int8 Min/Max: ${Math.min(...int8)} / ${Math.max(...int8)}`);

  // 4. Load BinaryHNSW index and get a candidate's Int8 vector
  const binaryHnswPath = process.argv[2] || path.join(process.cwd(), '.sweet-search/codebase-binary-hnsw.idx');
  console.log(`\nLoading BinaryHNSW from: ${binaryHnswPath}`);

  const binaryHnsw = new BinaryHNSWIndex({ dimensions: 512 });
  await binaryHnsw.load(binaryHnswPath);

  // Get first few vectors to check their Int8 values
  const testIds = binaryHnsw.getAllIds().slice(0, 3);
  console.log(`\nChecking Int8 vectors for ${testIds.length} candidates:`);

  for (const id of testIds) {
    const docInt8 = binaryHnsw.getInt8Vector(id);
    if (docInt8) {
      console.log(`\n  ID: ${id}`);
      console.log(`  Int8 dimension: ${docInt8.length}`);
      console.log(`  First 5 values: ${[...docInt8.slice(0, 5)].join(', ')}`);
      console.log(`  Int8 Min/Max: ${Math.min(...docInt8)} / ${Math.max(...docInt8)}`);

      // Compute cosine similarity
      const score = int8CosineSimilarity(int8, docInt8);
      console.log(`  Cosine similarity with query: ${score.toFixed(6)}`);
    } else {
      console.log(`  ID: ${id} - NO INT8 VECTOR!`);
    }
  }

  // 5. Check: are the vectors unit normalized?
  const queryNorm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  console.log(`\n=== NORMALIZATION CHECK ===`);
  console.log(`Query float L2 norm: ${queryNorm.toFixed(4)}`);

  // Check first document's float norm
  // Int8 vectors should be derived from normalized floats
  const int8Norm = Math.sqrt([...int8].reduce((sum, v) => sum + v * v, 0));
  console.log(`Query Int8 L2 norm: ${int8Norm.toFixed(4)} (max possible: ${Math.sqrt(127 * 127 * int8.length).toFixed(4)})`);
}

diagnose().catch(console.error);
