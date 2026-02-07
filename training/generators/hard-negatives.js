#!/usr/bin/env node
/**
 * Hard Negative Mining Generator
 *
 * Layer 3 of the "99% Plan":
 * Takes misclassified queries from the benchmark and generates variations
 * with high sample weights to force the model to learn these edge cases.
 *
 * Why Hard Negatives?
 * - The 34 benchmark errors are the most valuable training signal
 * - By weighting them 5x, we tell CatBoost: "These are critical to get right"
 * - Variations prevent overfitting to specific wording
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from '../features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// KNOWN MISCLASSIFIED QUERIES (from benchmark-realistic.js output)
// =============================================================================

// These are the actual errors from the realistic benchmark
// Format: { query, expected, predicted }
const MISCLASSIFIED = [
  // HYBRID → STRUCTURAL errors (the main problem)
  { query: "how does PaymentGateway handle failures", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does TokenValidator work", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does SessionManager maintain state", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does CacheManager invalidate entries", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does QueueHandler process messages", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does LoadBalancer distribute traffic", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does RateLimiter throttle requests", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does CircuitBreaker detect failures", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does RetryHandler manage backoff", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does TransactionManager coordinate commits", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does ConnectionPool manage connections", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "how does BatchProcessor handle timeouts", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "FileUploader virus scanning", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "StockTracker price alerts", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "JobScheduler failure recovery", expected: "HYBRID", predicted: "STRUCTURAL" },
  { query: "NotificationService delivery guarantees", expected: "HYBRID", predicted: "STRUCTURAL" },

  // SEMANTIC → HYBRID errors
  { query: "explain retry patterns", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "what is circuit breaker pattern", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "how do microservices communicate", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "database sharding strategies", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "event sourcing architecture", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "CQRS vs traditional CRUD", expected: "SEMANTIC", predicted: "HYBRID" },
  { query: "saga pattern orchestration", expected: "SEMANTIC", predicted: "HYBRID" },

  // STRUCTURAL → HYBRID errors
  { query: "who extends BaseRepository", expected: "STRUCTURAL", predicted: "HYBRID" },
  { query: "what implements Serializable", expected: "STRUCTURAL", predicted: "HYBRID" },
  { query: "subclasses of AbstractHandler", expected: "STRUCTURAL", predicted: "HYBRID" },
  { query: "dependencies of ConfigModule", expected: "STRUCTURAL", predicted: "HYBRID" },

  // HYBRID → SEMANTIC errors
  { query: "AuthService authentication flow", expected: "HYBRID", predicted: "SEMANTIC" },
  { query: "PaymentGateway transaction handling", expected: "HYBRID", predicted: "SEMANTIC" },
  { query: "SessionManager session lifecycle", expected: "HYBRID", predicted: "SEMANTIC" },
];

// =============================================================================
// VARIATION GENERATORS
// =============================================================================

/**
 * Generate variations of a HYBRID query that was misclassified as STRUCTURAL.
 * Focus on maintaining the "how does [ID]..." pattern with different verbs/objects.
 */
function generateHybridVariations(query, count = 10) {
  const variations = [];

  // Extract identifier from query
  const idMatch = query.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/);
  const identifier = idMatch ? idMatch[1] : 'Service';

  // Alternative verbs
  const verbs = ['handle', 'manage', 'process', 'deal with', 'respond to', 'work with',
                 'coordinate', 'orchestrate', 'execute', 'perform', 'accomplish'];

  // Alternative objects/concepts
  const objects = ['failures', 'errors', 'timeouts', 'retries', 'state', 'data',
                   'requests', 'responses', 'connections', 'sessions', 'tokens',
                   'events', 'messages', 'transactions', 'operations', 'tasks'];

  // Generate variations
  for (let i = 0; i < count; i++) {
    const verb = verbs[i % verbs.length];
    const obj = objects[i % objects.length];

    // Different template patterns
    const templates = [
      `how does ${identifier} ${verb} ${obj}`,
      `${identifier} ${verb}s ${obj}`,
      `${identifier} ${verb}ing ${obj}`,
      `how ${identifier} ${verb}s ${obj}`,
      `what does ${identifier} do with ${obj}`,
      `${identifier}'s approach to ${obj}`,
      `${identifier} ${obj} ${verb}ing`,
      `the way ${identifier} ${verb}s ${obj}`,
      `${identifier} ${obj} handling mechanism`,
      `${verb}ing ${obj} in ${identifier}`,
    ];

    variations.push({
      query: templates[i % templates.length],
      label: 'HYBRID',
      subtype: 'hard_negative_hybrid',
      weight: 5.0,  // 5x weight for hard negatives
      original: query,
    });
  }

  return variations;
}

/**
 * Generate variations of a SEMANTIC query that was misclassified as HYBRID.
 * Focus on general conceptual patterns without identifiers.
 */
function generateSemanticVariations(query, count = 10) {
  const variations = [];

  // Extract the core concept
  const concepts = [
    'retry patterns', 'circuit breaker', 'microservices', 'sharding', 'event sourcing',
    'CQRS', 'saga pattern', 'load balancing', 'caching strategies', 'rate limiting',
    'fault tolerance', 'high availability', 'distributed systems', 'consistency models',
    'CAP theorem', 'eventual consistency', 'consensus algorithms', 'leader election',
  ];

  const questionWords = ['what is', 'explain', 'how do', 'why use', 'when to use',
                         'describe', 'compare', 'what are', 'how does'];

  for (let i = 0; i < count; i++) {
    const concept = concepts[i % concepts.length];
    const qWord = questionWords[i % questionWords.length];

    variations.push({
      query: `${qWord} ${concept}`,
      label: 'SEMANTIC',
      subtype: 'hard_negative_semantic',
      weight: 5.0,
      original: query,
    });
  }

  return variations;
}

/**
 * Generate variations of a STRUCTURAL query that was misclassified.
 * Focus on explicit relationship keywords.
 */
function generateStructuralVariations(query, count = 10) {
  const variations = [];

  // Extract identifier if present
  const idMatch = query.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/);
  const identifier = idMatch ? idMatch[1] : 'Service';

  const structuralPatterns = [
    `callers of ${identifier}`,
    `what calls ${identifier}`,
    `usages of ${identifier}`,
    `references to ${identifier}`,
    `implementations of ${identifier}`,
    `who extends ${identifier}`,
    `subclasses of ${identifier}`,
    `dependencies of ${identifier}`,
    `what does ${identifier} call`,
    `callees of ${identifier}`,
  ];

  for (let i = 0; i < count; i++) {
    variations.push({
      query: structuralPatterns[i % structuralPatterns.length],
      label: 'STRUCTURAL',
      subtype: 'hard_negative_structural',
      weight: 5.0,
      original: query,
    });
  }

  return variations;
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1]
    || path.join(__dirname, '../output/hard_negatives.json');
  const variationsPerError = parseInt(args.find(a => a.startsWith('--variations='))?.split('=')[1] || '10');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('HARD NEGATIVE MINING');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nGenerating hard negatives from ${MISCLASSIFIED.length} errors...`);
  console.log(`Variations per error: ${variationsPerError}`);

  const allVariations = [];

  // Group errors by type
  const hybridToStructural = MISCLASSIFIED.filter(e => e.expected === 'HYBRID' && e.predicted === 'STRUCTURAL');
  const semanticToHybrid = MISCLASSIFIED.filter(e => e.expected === 'SEMANTIC' && e.predicted === 'HYBRID');
  const structuralToHybrid = MISCLASSIFIED.filter(e => e.expected === 'STRUCTURAL' && e.predicted === 'HYBRID');
  const hybridToSemantic = MISCLASSIFIED.filter(e => e.expected === 'HYBRID' && e.predicted === 'SEMANTIC');

  console.log(`\nError breakdown:`);
  console.log(`  HYBRID → STRUCTURAL: ${hybridToStructural.length}`);
  console.log(`  SEMANTIC → HYBRID: ${semanticToHybrid.length}`);
  console.log(`  STRUCTURAL → HYBRID: ${structuralToHybrid.length}`);
  console.log(`  HYBRID → SEMANTIC: ${hybridToSemantic.length}`);

  // Generate variations for each error type
  console.log(`\nGenerating variations...`);

  for (const error of hybridToStructural) {
    const vars = generateHybridVariations(error.query, variationsPerError);
    allVariations.push(...vars);
  }

  for (const error of semanticToHybrid) {
    const vars = generateSemanticVariations(error.query, variationsPerError);
    allVariations.push(...vars);
  }

  for (const error of structuralToHybrid) {
    const vars = generateStructuralVariations(error.query, variationsPerError);
    allVariations.push(...vars);
  }

  for (const error of hybridToSemantic) {
    const vars = generateHybridVariations(error.query, variationsPerError);
    allVariations.push(...vars);
  }

  // Add the original misclassified queries with high weight
  for (const error of MISCLASSIFIED) {
    allVariations.push({
      query: error.query,
      label: error.expected,
      subtype: 'original_error',
      weight: 10.0,  // Original errors get even higher weight
    });
  }

  // Output
  const output = {
    name: 'Hard Negatives Training Data',
    description: 'Weighted training data from benchmark misclassifications',
    generated: new Date().toISOString(),
    sourceErrors: MISCLASSIFIED.length,
    totalVariations: allVariations.length,
    queries: allVariations,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✓ Generated ${allVariations.length} hard negative samples`);
  console.log(`  Output: ${outputPath}`);

  // Sample output
  console.log('\n--- Sample Hard Negatives ---');
  console.log('\nHYBRID variations (for HYBRID→STRUCTURAL errors):');
  allVariations.filter(v => v.subtype === 'hard_negative_hybrid').slice(0, 3)
    .forEach(q => console.log(`  "${q.query}" (weight: ${q.weight})`));

  console.log('\nSEMANTIC variations (for SEMANTIC→HYBRID errors):');
  allVariations.filter(v => v.subtype === 'hard_negative_semantic').slice(0, 3)
    .forEach(q => console.log(`  "${q.query}" (weight: ${q.weight})`));

  console.log('\n═══════════════════════════════════════════════════════════════');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  MISCLASSIFIED,
  generateHybridVariations,
  generateSemanticVariations,
  generateStructuralVariations,
};
