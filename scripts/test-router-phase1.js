#!/usr/bin/env node

/**
 * Phase 1 Router Test Script
 *
 * Tests the query router fixes from ROUTING_MASTER_PLAN.md Phase 1:
 * - Fix 1: Expanded structural patterns
 * - Fix 2: Short query heuristic fix
 * - Fix 3: Enhanced semantic words
 * - Fix 4: Performance optimizations
 *
 * Target: >90% accuracy (27/30 tests)
 */

import { QueryRouter } from '../core/query-router.js';

const router = new QueryRouter();

const tests = [
  // === STRUCTURAL (10 tests) - Should all route to 'structural' ===
  { query: 'callers of SessionService', expected: 'structural', category: 'structural' },
  { query: 'callees of EmailService', expected: 'structural', category: 'structural' },
  { query: 'what uses NotificationService', expected: 'structural', category: 'structural' },
  { query: 'classes implementing JpaRepository', expected: 'structural', category: 'structural' },
  { query: 'affected by modifying Employee entity', expected: 'structural', category: 'structural' },
  { query: 'downstream effects of NotificationService changes', expected: 'structural', category: 'structural' },
  { query: 'where is BotDetectionService called', expected: 'structural', category: 'structural' },
  { query: 'usages of AuthConfig', expected: 'structural', category: 'structural' },
  { query: 'references to JwtTokenUtil', expected: 'structural', category: 'structural' },
  { query: 'definition of LoginController', expected: 'structural', category: 'structural' },

  // === CONCEPTUAL (6 tests) - Should all route to 'semantic' ===
  { query: 'password reset flow', expected: 'semantic', category: 'conceptual' },
  { query: 'how does authentication work', expected: 'semantic', category: 'conceptual' },
  { query: 'JWT token refresh mechanism', expected: 'semantic', category: 'conceptual' },
  { query: 'process monitoring system', expected: 'semantic', category: 'conceptual' },
  { query: 'employee absence calculation', expected: 'semantic', category: 'conceptual' },
  { query: 'keyboard and mouse event capture', expected: 'semantic', category: 'conceptual' },

  // === MIXED (6 tests) - Should all route to 'hybrid' ===
  { query: 'session management', expected: 'hybrid', category: 'mixed' },
  { query: 'screenshot upload', expected: 'hybrid', category: 'mixed' },
  { query: 'login validation', expected: 'hybrid', category: 'mixed' },
  { query: 'config encryption', expected: 'hybrid', category: 'mixed' },
  { query: 'process events', expected: 'hybrid', category: 'mixed' },
  { query: 'employee tracking', expected: 'hybrid', category: 'mixed' },

  // === IDENTIFIER (8 tests) - Should stay 'lexical' (REGRESSION CHECK) ===
  { query: 'AuthService', expected: 'lexical', category: 'identifier' },
  { query: 'EmployeeController', expected: 'lexical', category: 'identifier' },
  { query: 'getUserById', expected: 'lexical', category: 'identifier' },
  { query: 'get_user_by_id', expected: 'lexical', category: 'identifier' },
  { query: 'MAX_CONNECTIONS', expected: 'lexical', category: 'identifier' },
  { query: 'LoginController.java', expected: 'lexical', category: 'identifier' },
  { query: 'sloth_api.conf', expected: 'lexical', category: 'identifier' },
  { query: 'com.codolis.sloth.vita', expected: 'lexical', category: 'identifier' },
];

// Track results by category
const results = {
  structural: { correct: 0, total: 0 },
  conceptual: { correct: 0, total: 0 },
  mixed: { correct: 0, total: 0 },
  identifier: { correct: 0, total: 0 },
};

console.log('SEARCH 100x Router Phase 1 Tests');
console.log('='.repeat(95));
console.log('Query                                          | Expected    | Actual      | Match | Latency');
console.log('='.repeat(95));

let totalCorrect = 0;
let totalLatency = 0;

for (const test of tests) {
  const result = router.route(test.query);
  const match = result.mode === test.expected;
  const icon = match ? '✓' : '✗';

  if (match) {
    totalCorrect++;
    results[test.category].correct++;
  }
  results[test.category].total++;
  totalLatency += result.routingLatency_us || 0;

  console.log(
    `${test.query.padEnd(45)} | ${test.expected.padEnd(11)} | ${result.mode.padEnd(11)} | ${icon}     | ${(result.routingLatency_us || 0).toString().padStart(3)}μs`
  );
}

console.log('='.repeat(95));
console.log();

// Category breakdown
console.log('Category Breakdown:');
console.log('-'.repeat(50));
for (const [category, data] of Object.entries(results)) {
  const pct = ((data.correct / data.total) * 100).toFixed(1);
  const status = data.correct === data.total ? '✓' : '✗';
  console.log(`  ${category.padEnd(12)}: ${data.correct}/${data.total} (${pct}%) ${status}`);
}
console.log('-'.repeat(50));

// Overall results
const overallPct = ((totalCorrect / tests.length) * 100).toFixed(1);
const avgLatency = Math.round(totalLatency / tests.length);

console.log();
console.log(`Overall Accuracy: ${totalCorrect}/${tests.length} (${overallPct}%)`);
console.log(`Target: >90% (${Math.ceil(tests.length * 0.9)}/${tests.length})`);
console.log(`Average Latency: ${avgLatency}μs`);
console.log();

// Pass/fail determination
const passed = totalCorrect >= tests.length * 0.9;
if (passed) {
  console.log('✅ PHASE 1 PASSED - Ready for Phase 2 (ML Classifier)');
} else {
  console.log('❌ PHASE 1 FAILED - Need more fixes');
  console.log();
  console.log('Failing tests:');
  for (const test of tests) {
    const result = router.route(test.query);
    if (result.mode !== test.expected) {
      console.log(`  - "${test.query}" → expected ${test.expected}, got ${result.mode}`);
      if (result.signals.length > 0) {
        console.log(`    Signals: ${result.signals.map(s => s.reason || s.type).join(', ')}`);
      }
    }
  }
}

process.exit(passed ? 0 : 1);
