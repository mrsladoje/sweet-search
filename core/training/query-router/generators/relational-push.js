#!/usr/bin/env node
/**
 * Relational Push Generator for Query Router Training
 *
 * The "Final Push" for 99%+ accuracy:
 * Generates 1,000 STRUCTURAL samples with passive/complex phrasings.
 *
 * Target errors like:
 *   - "what invokes the webhook handler" → SEMANTIC (wrong!)
 *   - "classes implementing Repository" → SEMANTIC (wrong!)
 *   - "what breaks if I change UserEntity" → HYBRID (wrong!)
 *
 * These should all be STRUCTURAL.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// IDENTIFIER CORPUS
// =============================================================================

const IDENTIFIERS = [
  // Services
  'AuthService', 'UserService', 'PaymentGateway', 'OrderProcessor', 'EmailSender',
  'SessionManager', 'TokenValidator', 'DatabaseConnector', 'CacheManager', 'QueueHandler',
  'NotificationService', 'ReportGenerator', 'FileUploader', 'ImageProcessor', 'SearchEngine',
  'AnalyticsTracker', 'LoggingService', 'ConfigManager', 'SecurityChecker', 'RateLimiter',
  'BotDetectionService', 'FraudDetector', 'SpamFilter', 'ContentModerator', 'AccessController',

  // Controllers
  'LoginController', 'RegistrationController', 'DashboardController', 'ProfileController',
  'CheckoutController', 'CartController', 'ProductController', 'OrderController',
  'WebhookController', 'ApiController', 'AdminController',

  // Handlers
  'RequestHandler', 'ResponseHandler', 'ErrorHandler', 'EventHandler', 'WebhookHandler',
  'MessageHandler', 'CommandHandler', 'QueryHandler', 'PaymentProcessor',

  // Methods/Functions
  'validateOrder', 'processPayment', 'sendNotification', 'calculateTax', 'handleError',
  'authenticateUser', 'authorizeRequest', 'logEvent', 'cacheResult', 'retryOperation',
  'sendEmail', 'generateReport', 'exportData', 'importData', 'syncRecords',

  // Repositories/Interfaces
  'UserRepository', 'OrderRepository', 'ProductRepository', 'PaymentProvider',
  'NotificationChannel', 'BaseHandler', 'AbstractService', 'Repository',

  // Entities/Models
  'UserEntity', 'OrderStatus', 'PaymentResult', 'SessionToken', 'DatabaseConnection',
  'PriceCalculator', 'TaxCalculator', 'DiscountEngine', 'ShippingCalculator',
];

// =============================================================================
// GENERIC NOUNS (for "the X handler" patterns)
// =============================================================================

const GENERIC_NOUNS = [
  'webhook', 'email', 'payment', 'order', 'user', 'session', 'token',
  'request', 'response', 'error', 'event', 'message', 'notification',
  'data', 'file', 'image', 'report', 'log', 'cache', 'queue',
  'job', 'task', 'process', 'thread', 'connection', 'transaction',
];

// =============================================================================
// RANDOM UTILITIES
// =============================================================================

function seededRandom(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(arr, rng) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// RELATIONAL PUSH GENERATORS
// =============================================================================

/**
 * Generate passive "what invokes/calls/uses the X" STRUCTURAL queries.
 *
 * These use indirect phrasing that was confusing the model.
 */
function generatePassiveCallerQueries(count, seed = 11111) {
  const rng = seededRandom(seed);
  const queries = [];

  const templates = [
    // "what [verb]s the [noun] [handler/processor]"
    (noun) => `what invokes the ${noun} handler`,
    (noun) => `what calls the ${noun} processor`,
    (noun) => `what triggers the ${noun} service`,
    (noun) => `what uses the ${noun} manager`,
    (noun) => `what accesses the ${noun} controller`,
    (noun) => `what activates the ${noun} listener`,

    // "where is [noun] [handler] invoked/called"
    (noun) => `where is the ${noun} handler called`,
    (noun) => `where is the ${noun} processor invoked`,
    (noun) => `where is the ${noun} service triggered`,
    (noun) => `where does the ${noun} handler get called`,

    // Using identifiers
    (id) => `what invokes ${id}`,
    (id) => `what triggers ${id}`,
    (id) => `what activates ${id}`,
    (id) => `where is ${id} called from`,
    (id) => `where does ${id} get invoked`,
  ];

  for (let i = 0; i < count; i++) {
    const template = pickRandom(templates, rng);
    // Decide whether to use a generic noun or identifier
    const useIdentifier = rng() > 0.5;
    const arg = useIdentifier ? pickRandom(IDENTIFIERS, rng) : pickRandom(GENERIC_NOUNS, rng);

    const query = template(arg);
    queries.push({
      query,
      label: 'STRUCTURAL',
      subtype: 'passive_caller',
      lang: 'en',
    });
  }

  return queries;
}

/**
 * Generate "what does X [use/call/depend on]" callee queries.
 */
function generateCalleeQueries(count, seed = 22222) {
  const rng = seededRandom(seed);
  const queries = [];

  const templates = [
    (id) => `what does ${id} use`,
    (id) => `what does ${id} call`,
    (id) => `what does ${id} depend on`,
    (id) => `what does ${id} import`,
    (id) => `what does ${id} require`,
    (id) => `what methods does ${id} call`,
    (id) => `what services does ${id} use`,
    (id) => `what does the ${id.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2')} use`,
    (noun) => `what does the ${noun} handler call`,
    (noun) => `what does the ${noun} service depend on`,
    (noun) => `what does the ${noun} processor use`,
  ];

  for (let i = 0; i < count; i++) {
    const template = pickRandom(templates, rng);
    const useIdentifier = rng() > 0.3;
    const arg = useIdentifier ? pickRandom(IDENTIFIERS, rng) : pickRandom(GENERIC_NOUNS, rng);

    const query = template(arg);
    queries.push({
      query,
      label: 'STRUCTURAL',
      subtype: 'callee_query',
      lang: 'en',
    });
  }

  return queries;
}

/**
 * Generate "classes/implementations of X" queries.
 */
function generateImplementationQueries(count, seed = 33333) {
  const rng = seededRandom(seed);
  const queries = [];

  const interfaces = [
    'Repository', 'Service', 'Handler', 'Provider', 'Factory', 'Builder',
    'Validator', 'Processor', 'Controller', 'Manager', 'Strategy', 'Observer',
    'Listener', 'Adapter', 'Decorator', 'Middleware', 'Filter', 'Interceptor',
    'BaseHandler', 'AbstractService', 'PaymentProvider', 'NotificationChannel',
  ];

  const templates = [
    (iface) => `classes implementing ${iface}`,
    (iface) => `implementations of ${iface}`,
    (iface) => `what implements ${iface}`,
    (iface) => `who implements ${iface}`,
    (iface) => `what classes implement ${iface}`,
    (iface) => `all implementations of ${iface}`,
    (iface) => `list implementations of ${iface}`,
    (iface) => `subtypes of ${iface}`,
    (iface) => `subclasses of ${iface}`,
    (iface) => `what extends ${iface}`,
    (iface) => `classes extending ${iface}`,
    (iface) => `derived classes of ${iface}`,
    (iface) => `children of ${iface}`,
    (iface) => `find all ${iface} implementations`,
  ];

  for (let i = 0; i < count; i++) {
    const template = pickRandom(templates, rng);
    const iface = pickRandom(interfaces, rng);

    const query = template(iface);
    queries.push({
      query,
      label: 'STRUCTURAL',
      subtype: 'implementation_query',
      lang: 'en',
    });
  }

  return queries;
}

/**
 * Generate "impact of changing X" / "what breaks if I change X" queries.
 */
function generateImpactQueries(count, seed = 44444) {
  const rng = seededRandom(seed);
  const queries = [];

  const templates = [
    (id) => `what breaks if I change ${id}`,
    (id) => `what breaks if I modify ${id}`,
    (id) => `what breaks if I rename ${id}`,
    (id) => `what breaks if I delete ${id}`,
    (id) => `what is affected if I change ${id}`,
    (id) => `what depends on ${id}`,
    (id) => `impact of changing ${id}`,
    (id) => `impact of modifying ${id}`,
    (id) => `downstream effects of changing ${id}`,
    (id) => `affected by changes to ${id}`,
    (id) => `what would break if ${id} changes`,
    (id) => `blast radius of ${id}`,
    (id) => `ripple effects of modifying ${id}`,
    (id) => `consequences of changing ${id}`,
    (id) => `who relies on ${id}`,
    (id) => `what uses ${id}`,
  ];

  for (let i = 0; i < count; i++) {
    const template = pickRandom(templates, rng);
    const id = pickRandom(IDENTIFIERS, rng);

    const query = template(id);
    queries.push({
      query,
      label: 'STRUCTURAL',
      subtype: 'impact_query',
      lang: 'en',
    });
  }

  return queries;
}

/**
 * Generate "find all usages of X" queries.
 */
function generateUsageQueries(count, seed = 55555) {
  const rng = seededRandom(seed);
  const queries = [];

  const templates = [
    (id) => `find all usages of ${id}`,
    (id) => `find usages of ${id}`,
    (id) => `usages of ${id}`,
    (id) => `all usages of ${id}`,
    (id) => `references to ${id}`,
    (id) => `all references to ${id}`,
    (id) => `find references to ${id}`,
    (id) => `where is ${id} used`,
    (id) => `where is ${id} referenced`,
    (id) => `everywhere ${id} is used`,
    (id) => `every usage of ${id}`,
    (id) => `all places using ${id}`,
  ];

  for (let i = 0; i < count; i++) {
    const template = pickRandom(templates, rng);
    const id = pickRandom(IDENTIFIERS, rng);

    const query = template(id);
    queries.push({
      query,
      label: 'STRUCTURAL',
      subtype: 'usage_query',
      lang: 'en',
    });
  }

  return queries;
}

/**
 * Main generator: Relational Push (combines all patterns)
 */
function generateRelationalPushQueries(totalCount = 1000, seed = 88888) {
  const rng = seededRandom(seed);

  // Distribution: 25% passive caller, 20% callee, 20% implementation, 20% impact, 15% usage
  const counts = {
    passiveCaller: Math.floor(totalCount * 0.25),
    callee: Math.floor(totalCount * 0.20),
    implementation: Math.floor(totalCount * 0.20),
    impact: Math.floor(totalCount * 0.20),
    usage: totalCount - Math.floor(totalCount * 0.85),
  };

  const passiveCaller = generatePassiveCallerQueries(counts.passiveCaller, seed);
  const callee = generateCalleeQueries(counts.callee, seed + 1000);
  const implementation = generateImplementationQueries(counts.implementation, seed + 2000);
  const impact = generateImpactQueries(counts.impact, seed + 3000);
  const usage = generateUsageQueries(counts.usage, seed + 4000);

  const combined = [...passiveCaller, ...callee, ...implementation, ...impact, ...usage];
  return shuffle(combined, rng);
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1]
    || path.join(__dirname, '../output/relational_push.json');

  const totalCount = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '1000');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RELATIONAL PUSH GENERATOR (Final Push)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\nGenerating ${totalCount} passive/complex STRUCTURAL queries...\n`);

  const queries = generateRelationalPushQueries(totalCount);

  // Count subtypes
  const subtypeCounts = {};
  for (const q of queries) {
    subtypeCounts[q.subtype] = (subtypeCounts[q.subtype] || 0) + 1;
  }

  console.log('  Subtype distribution:');
  for (const [subtype, count] of Object.entries(subtypeCounts)) {
    console.log(`    ${subtype}: ${count}`);
  }

  // Output
  const output = {
    name: 'Relational Push STRUCTURAL Training Data',
    description: 'Teaching the model passive/complex STRUCTURAL patterns',
    generated: new Date().toISOString(),
    counts: {
      total: queries.length,
      bySubtype: subtypeCounts,
    },
    queries,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✓ Generated ${queries.length} Relational Push STRUCTURAL queries`);
  console.log(`  Output: ${outputPath}`);

  // Sample output
  console.log('\n--- Sample Queries ---');
  queries.slice(0, 15).forEach(q => console.log(`  "${q.query}" [${q.subtype}]`));

  console.log('\n═══════════════════════════════════════════════════════════════');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  generateRelationalPushQueries,
  generatePassiveCallerQueries,
  generateCalleeQueries,
  generateImplementationQueries,
  generateImpactQueries,
  generateUsageQueries,
  IDENTIFIERS,
  GENERIC_NOUNS,
};
