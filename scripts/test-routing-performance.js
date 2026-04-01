import { QueryRouter } from '../core/query/index.js';

const router = new QueryRouter();

// Test queries covering all 5 fixes
const testQueries = [
  // Fix #1: Identifier + Semantic Intent
  { query: "EmployeeService authentication flow", expected: "semantic" },
  { query: "AuthService login process", expected: "semantic" },
  { query: "handleAuth implementation logic", expected: "semantic" },
  
  // Fix #2: Glob patterns
  { query: "*Controller", expected: "lexical" },
  { query: "get*", expected: "lexical" },
  { query: "*DTO.java", expected: "lexical" },
  
  // Fix #3: Common English words
  { query: "authentication", expected: "lexical" },  // Single word - lexical is OK
  { query: "validation", expected: "lexical" },      // Single word - lexical is OK
  { query: "getUserById", expected: "lexical" },     // Real camelCase - should be lexical
  
  // Fix #4: Imperative commands
  { query: "list all methods", expected: "semantic" },
  { query: "show all classes", expected: "semantic" },
  { query: "find all implementations", expected: "semantic" },
  
  // Fix #5: Code structural keywords
  { query: "private method", expected: "lexical" },
  { query: "public field", expected: "lexical" },
  { query: "abstract class", expected: "lexical" },
];

console.log("Query Router Performance Test");
console.log("=".repeat(80));

let totalLatency = 0;
let passedTests = 0;
let failedTests = 0;

for (const test of testQueries) {
  const analysis = router.route(test.query);
  const passed = analysis.mode === test.expected;
  const status = passed ? "✓" : "✗";
  
  if (passed) passedTests++;
  else failedTests++;
  
  totalLatency += analysis.routingLatency_us;
  
  const latencyColor = analysis.routingLatency_us < 200 ? "" : " ⚠️";
  console.log(`${status} [${analysis.mode.charAt(0).toUpperCase()}] ${analysis.routingLatency_us}μs${latencyColor} | "${test.query}"`);
  if (!passed) {
    console.log(`  Expected: ${test.expected}, Got: ${analysis.mode}`);
  }
}

const avgLatency = Math.round(totalLatency / testQueries.length);
console.log("=".repeat(80));
console.log(`Tests passed: ${passedTests}/${testQueries.length}`);
console.log(`Tests failed: ${failedTests}/${testQueries.length}`);
console.log(`Average latency: ${avgLatency}μs (target: <200μs)`);
console.log(`Total latency: ${totalLatency}μs`);

if (avgLatency > 200) {
  console.log("⚠️  WARNING: Average latency exceeds 200μs target");
}

process.exit(failedTests > 0 ? 1 : 0);
