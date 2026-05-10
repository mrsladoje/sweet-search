#!/usr/bin/env node

/**
 * Training Data Generator for Query Router ML Model (Phase 3: Multilingual)
 *
 * Generates training data using templates and optional LLM augmentation.
 * Supports: 15+ Unicode scripts and 15+ natural languages.
 *
 * Usage:
 *   node generate.js --output raw_data.json --samples 1000
 *   node generate.js --multilingual --samples 5000 --output multilingual.json
 *   node generate.js --scripts cyrillic-sr,cjk --samples 500
 *   node generate.js --all --samples 5000 --output training_data.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  IDENTIFIERS_BY_SCRIPT,
  getRandomIdentifier,
  getAvailableScripts,
  countIdentifiers,
} from './multilingual-identifiers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const EVAL_DIR = path.join(__dirname, '../validation');

// Language configurations with script mappings
const LANGUAGE_CONFIGS = {
  en: { scripts: ['latin-en'], weight: 35 },
  de: { scripts: ['latin-de'], weight: 8 },
  es: { scripts: ['latin-es'], weight: 6 },
  sr: { scripts: ['cyrillic-sr'], weight: 10 },
  ru: { scripts: ['cyrillic-ru'], weight: 8 },
  zh: { scripts: ['cjk'], weight: 8 },
  ja: { scripts: ['japanese'], weight: 6 },
  ko: { scripts: ['korean'], weight: 5 },
  ar: { scripts: ['arabic'], weight: 4 },
  hi: { scripts: ['hindi'], weight: 3 },
  th: { scripts: ['thai'], weight: 2 },
  vi: { scripts: ['vietnamese'], weight: 3 },
  el: { scripts: ['greek'], weight: 1 },
  he: { scripts: ['hebrew'], weight: 1 },
};

// Category distribution (total = 100%)
const CATEGORY_DISTRIBUTION = {
  LEXICAL: 30,
  SEMANTIC: 30,
  STRUCTURAL: 20,
  HYBRID: 20,
};

// Difficulty levels
const DIFFICULTY_WEIGHTS = {
  easy: 50,
  medium: 35,
  hard: 15,
};

/**
 * Load template file
 */
function loadTemplate(filename) {
  const filePath = path.join(TEMPLATES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Load eval queries to prevent leaks
 */
function loadEvalQueries() {
  const evalQueries = new Set();
  const evalDir = path.join(__dirname, '../query-sets');

  if (!fs.existsSync(evalDir)) {
    return evalQueries;
  }

  const files = fs.readdirSync(evalDir).filter(f => f.endsWith('.json') && f !== 'schema.json');

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(evalDir, file), 'utf-8'));
      const queries = data.queries || [];
      for (const item of queries) {
        const query = typeof item === 'string' ? item : item.query;
        if (query) {
          evalQueries.add(normalizeQuery(query));
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return evalQueries;
}

/**
 * Normalize query for comparison
 */
function normalizeQuery(query) {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Weighted random selection
 */
function weightedRandom(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;

  for (const [key, weight] of Object.entries(weights)) {
    r -= weight;
    if (r <= 0) return key;
  }

  return Object.keys(weights)[0];
}

/**
 * Generate LEXICAL queries (identifiers, file paths, etc.)
 */
function generateLexicalQueries(count, scripts, evalQueries) {
  const queries = [];

  // PascalCase class names (English)
  const classNames = [
    'AuthService', 'UserService', 'LoginController', 'EmployeeService',
    'SessionManager', 'TokenValidator', 'ConfigService', 'EmailService',
    'NotificationService', 'ReportGenerator', 'DataExporter', 'FileUploader',
    'UserRepository', 'EmployeeRepository', 'ProjectRepository', 'TeamRepository',
    'BaseController', 'AbstractService', 'DefaultHandler', 'CustomValidator',
    'HttpClient', 'WebSocketHandler', 'GrpcClient', 'RestTemplate',
    'JwtTokenUtil', 'PasswordEncoder', 'HashingService', 'EncryptionUtil',
    'CacheManager', 'RedisClient', 'DatabasePool', 'QueryExecutor',
    'EventPublisher', 'MessageBroker', 'QueueProcessor', 'TaskScheduler',
    'LoggingAspect', 'SecurityFilter', 'CorsConfig', 'SwaggerConfig',
    'BotDetectionService', 'ActivityTracker', 'ProcessMonitor', 'ScreenshotUploader',
  ];

  // camelCase method names
  const methodNames = [
    'getUserById', 'findAllEmployees', 'validateToken', 'createSession',
    'updateProfile', 'deleteAccount', 'handleRequest', 'processEvent',
    'authenticate', 'authorize', 'logout', 'refreshToken',
    'sendEmail', 'generateReport', 'exportData', 'uploadFile',
    'calculateSalary', 'computeMetrics', 'aggregateStats', 'parseInput',
    'getConnection', 'closeConnection', 'executeQuery', 'fetchResults',
    'encryptPassword', 'decryptData', 'hashValue', 'verifySignature',
    'trackActivity', 'logProcess', 'captureScreenshot', 'detectBot',
  ];

  // snake_case variables
  const snakeNames = [
    'max_retry_count', 'api_base_url', 'db_pool_size', 'request_timeout',
    'cache_ttl', 'session_duration', 'token_expiry', 'max_connections',
    'default_page_size', 'min_password_length', 'upload_max_size', 'rate_limit',
    'employee_id', 'project_data', 'config_settings', 'notification_queue',
  ];

  // SCREAMING_SNAKE constants
  const constantNames = [
    'MAX_CONNECTIONS', 'DEFAULT_TIMEOUT', 'API_VERSION', 'HTTP_OK',
    'ERROR_CODE', 'SUCCESS_STATUS', 'RETRY_LIMIT', 'BUFFER_SIZE',
    'JWT_SECRET', 'DB_HOST', 'REDIS_URL', 'GRPC_PORT',
  ];

  // File paths
  const filePaths = [
    'AuthService.java', 'LoginController.java', 'UserRepository.java',
    'config.yml', 'application.properties', 'pom.xml',
    'src/main/java/service/AuthService.java',
    'src/components/Login.tsx', 'src/hooks/useAuth.ts',
    'utils/helpers.ts', 'api/endpoints.js', 'config/database.json',
    'EmployeeService.java', 'SessionManager.java', 'BotDetection.java',
  ];

  // Glob patterns
  const globPatterns = [
    '*Controller.java', '*Service.java', '*Repository.java',
    'get*', 'find*', 'validate*', 'process*',
    '*.proto', '*.yml', '*.config',
    'src/**/*.tsx', 'test/**/*.spec.ts',
    '*Manager.java', '*Handler.java',
  ];

  // Add English lexical queries
  const lexicalItems = [
    ...classNames.map(q => ({ query: q, subtype: 'class_name', lang: 'en' })),
    ...methodNames.map(q => ({ query: q, subtype: 'method_name', lang: 'en' })),
    ...snakeNames.map(q => ({ query: q, subtype: 'variable', lang: 'en' })),
    ...constantNames.map(q => ({ query: q, subtype: 'constant', lang: 'en' })),
    ...filePaths.map(q => ({ query: q, subtype: 'file_path', lang: 'en' })),
    ...globPatterns.map(q => ({ query: q, subtype: 'glob', lang: 'en' })),
  ];

  // Add non-ASCII lexical queries from scripts
  for (const script of scripts) {
    const identifiers = IDENTIFIERS_BY_SCRIPT[script];
    if (!identifiers) continue;

    const lang = script.split('-')[1] || script.slice(0, 2);

    for (const cls of identifiers.classes || []) {
      lexicalItems.push({ query: cls, subtype: 'class_name', lang, script });
    }
    for (const method of identifiers.methods || []) {
      lexicalItems.push({ query: method, subtype: 'method_name', lang, script });
    }
    for (const variable of identifiers.variables || []) {
      lexicalItems.push({ query: variable, subtype: 'variable', lang, script });
    }
    for (const constant of identifiers.constants || []) {
      lexicalItems.push({ query: constant, subtype: 'constant', lang, script });
    }
  }

  // Shuffle and sample
  const shuffled = lexicalItems.sort(() => Math.random() - 0.5);

  for (let i = 0; i < Math.min(count, shuffled.length); i++) {
    const item = shuffled[i];
    const normalized = normalizeQuery(item.query);

    if (evalQueries.has(normalized)) {
      continue; // Skip eval queries
    }

    queries.push({
      query: item.query,
      label: 'LEXICAL',
      subtype: item.subtype,
      language: item.lang,
      script: item.script || 'latin',
      difficulty: item.query.length < 15 ? 'easy' : 'medium',
      source: 'generated',
    });
  }

  return queries;
}

/**
 * Generate SEMANTIC queries using templates
 */
function generateSemanticQueries(count, languages, evalQueries) {
  const queries = [];
  const template = loadTemplate('semantic-multilingual.json');

  if (!template) {
    console.warn('Warning: semantic-multilingual.json not found');
    return queries;
  }

  const concepts = template.concepts || [
    'authentication', 'authorization', 'session', 'login', 'logout',
    'user registration', 'password reset', 'token refresh',
    'data validation', 'input sanitization', 'error handling',
    'caching', 'logging', 'monitoring', 'rate limiting',
  ];

  // Collect all templates by language
  const templatesByLang = {};

  for (const [category, templates] of Object.entries(template.templates || {})) {
    for (const t of templates) {
      const lang = t.lang || 'en';
      if (!templatesByLang[lang]) {
        templatesByLang[lang] = [];
      }
      templatesByLang[lang].push({ ...t, category });
    }
  }

  // Generate queries
  let generated = 0;
  const targetByLang = {};
  const totalWeight = Object.values(LANGUAGE_CONFIGS).reduce((a, c) => a + c.weight, 0);

  for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
    targetByLang[lang] = Math.ceil(count * (config.weight / totalWeight));
  }

  for (const lang of languages) {
    // P0 Fix: Check if templates exist for this language, or fall back to English
    const hasNativeTemplates = templatesByLang[lang] && templatesByLang[lang].length > 0;
    const templates = hasNativeTemplates ? templatesByLang[lang] : templatesByLang['en'];
    if (!templates || templates.length === 0) continue;

    const target = targetByLang[lang] || Math.ceil(count / languages.length);

    for (let i = 0; i < target && generated < count; i++) {
      const t = templates[Math.floor(Math.random() * templates.length)];
      const concept = concepts[Math.floor(Math.random() * concepts.length)];

      let query = t.template
        .replace(/{concept}/g, concept)
        .replace(/{identifier}/g, concept.replace(/\s+/g, '_'))
        .replace(/{action}/g, 'that');

      const normalized = normalizeQuery(query);
      if (evalQueries.has(normalized)) continue;

      // P0 Fix: Use template's actual language, not the loop variable
      const actualLanguage = t.lang || (hasNativeTemplates ? lang : 'en');

      queries.push({
        query,
        label: 'SEMANTIC',
        subtype: t.category,
        language: actualLanguage,
        difficulty: query.length < 30 ? 'easy' : 'medium',
        source: 'generated',
      });
      generated++;
    }
  }

  return queries;
}

/**
 * Generate STRUCTURAL queries using templates
 */
function generateStructuralQueries(count, scripts, languages, evalQueries) {
  const queries = [];
  const template = loadTemplate('structural-multilingual.json');

  if (!template) {
    console.warn('Warning: structural-multilingual.json not found');
    return queries;
  }

  // Collect all templates by language
  const templatesByLang = {};

  for (const [category, templates] of Object.entries(template.templates || {})) {
    for (const t of templates) {
      const lang = t.lang || 'en';
      if (!templatesByLang[lang]) {
        templatesByLang[lang] = [];
      }
      templatesByLang[lang].push({ ...t, category });
    }
  }

  // Get identifiers from selected scripts
  const identifiersByLang = {};

  for (const script of scripts) {
    const identifiers = IDENTIFIERS_BY_SCRIPT[script];
    if (!identifiers) continue;

    const lang = script.includes('-') ? script.split('-')[1] : script.slice(0, 2);
    if (!identifiersByLang[lang]) {
      identifiersByLang[lang] = [];
    }
    identifiersByLang[lang].push(...(identifiers.classes || []));
  }

  // Add English identifiers as fallback
  if (!identifiersByLang['en']) {
    identifiersByLang['en'] = IDENTIFIERS_BY_SCRIPT['latin-en']?.classes || [];
  }

  // Generate queries
  let generated = 0;

  for (const lang of languages) {
    // P0 Fix: Check if templates exist for this language, or fall back to English
    const hasNativeTemplates = templatesByLang[lang] && templatesByLang[lang].length > 0;
    const templates = hasNativeTemplates ? templatesByLang[lang] : templatesByLang['en'];
    const identifiers = identifiersByLang[lang] || identifiersByLang['en'];

    if (!templates || templates.length === 0) continue;
    if (!identifiers || identifiers.length === 0) continue;

    const target = Math.ceil(count / languages.length);

    for (let i = 0; i < target && generated < count; i++) {
      const t = templates[Math.floor(Math.random() * templates.length)];
      const identifier = identifiers[Math.floor(Math.random() * identifiers.length)];

      const query = t.template.replace(/{identifier}/g, identifier);
      const normalized = normalizeQuery(query);

      if (evalQueries.has(normalized)) continue;

      // P0 Fix: Use template's actual language, not the loop variable
      // This prevents English templates from being tagged with non-English language codes
      const actualLanguage = t.lang || (hasNativeTemplates ? lang : 'en');

      queries.push({
        query,
        label: 'STRUCTURAL',
        subtype: t.category,
        language: actualLanguage,
        difficulty: 'medium',
        source: 'generated',
      });
      generated++;
    }
  }

  return queries;
}

/**
 * Generate HYBRID queries (identifier + concept)
 */
function generateHybridQueries(count, scripts, languages, evalQueries) {
  const queries = [];

  // Concepts to combine with identifiers
  const concepts = [
    'login flow', 'authentication process', 'error handling',
    'caching strategy', 'validation logic', 'security checks',
    'database queries', 'API requests', 'token management',
    'session handling', 'password reset', 'user registration',
    'механизам пријаве', 'обрада грешака', 'валидација',  // Serbian
    'логика аутентификације', 'безбедносне провере',
    'Anmeldeablauf', 'Fehlerbehandlung', 'Validierungslogik',  // German
    '登录流程', '错误处理', '验证逻辑',  // Chinese
    'ログインフロー', 'エラー処理',  // Japanese
    'proceso de inicio', 'manejo de errores',  // Spanish
  ];

  // Get identifiers from all scripts
  const allIdentifiers = [];

  for (const script of scripts) {
    const identifiers = IDENTIFIERS_BY_SCRIPT[script];
    if (!identifiers) continue;

    const lang = script.includes('-') ? script.split('-')[1] : script.slice(0, 2);

    for (const cls of (identifiers.classes || []).slice(0, 10)) {
      allIdentifiers.push({ identifier: cls, lang, script });
    }
  }

  // Add English identifiers
  allIdentifiers.push(
    { identifier: 'AuthService', lang: 'en', script: 'latin' },
    { identifier: 'UserService', lang: 'en', script: 'latin' },
    { identifier: 'LoginController', lang: 'en', script: 'latin' },
    { identifier: 'SessionManager', lang: 'en', script: 'latin' },
    { identifier: 'TokenValidator', lang: 'en', script: 'latin' },
  );

  // Generate hybrid queries
  let generated = 0;

  while (generated < count) {
    const id = allIdentifiers[Math.floor(Math.random() * allIdentifiers.length)];
    const concept = concepts[Math.floor(Math.random() * concepts.length)];

    // Different combination patterns
    const patterns = [
      `${id.identifier} ${concept}`,
      `how ${id.identifier} handles ${concept.split(' ')[0]}`,
      `${concept} in ${id.identifier}`,
      `${id.identifier} ${concept.split(' ')[0]} logic`,
    ];

    const query = patterns[Math.floor(Math.random() * patterns.length)];
    const normalized = normalizeQuery(query);

    if (evalQueries.has(normalized)) continue;

    queries.push({
      query,
      label: 'HYBRID',
      subtype: 'identifier_with_concept',
      language: id.lang,
      script: id.script,
      difficulty: 'medium',
      source: 'generated',
    });
    generated++;
  }

  return queries;
}

/**
 * Generate comprehensive training data
 */
function generateTrainingData(totalSamples, options = {}) {
  const {
    multilingual = true,
    scripts = null,
    languages = null,
    verbose = false,
  } = options;

  // Load eval queries to prevent leaks
  const evalQueries = loadEvalQueries();
  if (verbose) {
    console.log(`  Loaded ${evalQueries.size} eval queries for leak prevention`);
  }

  // Determine scripts to use
  const selectedScripts = scripts
    ? scripts.split(',').map(s => s.trim())
    : multilingual
      ? getAvailableScripts()
      : ['latin-en'];

  // Determine languages to use
  const selectedLanguages = languages
    ? languages.split(',').map(l => l.trim())
    : multilingual
      ? Object.keys(LANGUAGE_CONFIGS)
      : ['en'];

  if (verbose) {
    console.log(`  Scripts: ${selectedScripts.join(', ')}`);
    console.log(`  Languages: ${selectedLanguages.join(', ')}`);
  }

  // Calculate counts per category
  const counts = {
    LEXICAL: Math.round(totalSamples * (CATEGORY_DISTRIBUTION.LEXICAL / 100)),
    SEMANTIC: Math.round(totalSamples * (CATEGORY_DISTRIBUTION.SEMANTIC / 100)),
    STRUCTURAL: Math.round(totalSamples * (CATEGORY_DISTRIBUTION.STRUCTURAL / 100)),
    HYBRID: Math.round(totalSamples * (CATEGORY_DISTRIBUTION.HYBRID / 100)),
  };

  // Generate each category
  const allQueries = [];

  if (verbose) console.log('\nGenerating LEXICAL queries...');
  const lexicalQueries = generateLexicalQueries(counts.LEXICAL, selectedScripts, evalQueries);
  allQueries.push(...lexicalQueries);
  if (verbose) console.log(`  Generated ${lexicalQueries.length} LEXICAL queries`);

  if (verbose) console.log('\nGenerating SEMANTIC queries...');
  const semanticQueries = generateSemanticQueries(counts.SEMANTIC, selectedLanguages, evalQueries);
  allQueries.push(...semanticQueries);
  if (verbose) console.log(`  Generated ${semanticQueries.length} SEMANTIC queries`);

  if (verbose) console.log('\nGenerating STRUCTURAL queries...');
  const structuralQueries = generateStructuralQueries(counts.STRUCTURAL, selectedScripts, selectedLanguages, evalQueries);
  allQueries.push(...structuralQueries);
  if (verbose) console.log(`  Generated ${structuralQueries.length} STRUCTURAL queries`);

  if (verbose) console.log('\nGenerating HYBRID queries...');
  const hybridQueries = generateHybridQueries(counts.HYBRID, selectedScripts, selectedLanguages, evalQueries);
  allQueries.push(...hybridQueries);
  if (verbose) console.log(`  Generated ${hybridQueries.length} HYBRID queries`);

  // Shuffle all queries
  const shuffled = allQueries.sort(() => Math.random() - 0.5);

  return shuffled;
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let totalSamples = 500;
  let outputPath = 'raw_data.json';
  let multilingual = false;
  let scripts = null;
  let languages = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--samples' && args[i + 1]) {
      totalSamples = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--multilingual' || args[i] === '--all') {
      multilingual = true;
    } else if (args[i] === '--scripts' && args[i + 1]) {
      scripts = args[i + 1];
      multilingual = true;
      i++;
    } else if (args[i] === '--languages' && args[i + 1]) {
      languages = args[i + 1];
      multilingual = true;
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Training Data Generator (Phase 3: Multilingual)

Usage:
  node generate.js --samples 1000 --output raw_data.json
  node generate.js --multilingual --samples 5000 --output multilingual.json
  node generate.js --scripts cyrillic-sr,cjk --samples 500

Options:
  --samples <n>       Number of samples to generate (default: 500)
  --output <file>     Output file path (default: raw_data.json)
  --multilingual      Enable multilingual generation (all scripts)
  --all               Alias for --multilingual
  --scripts <list>    Comma-separated list of scripts (implies --multilingual)
                      Available: ${getAvailableScripts().join(', ')}
  --languages <list>  Comma-separated list of languages
                      Available: ${Object.keys(LANGUAGE_CONFIGS).join(', ')}
  --verbose, -v       Show verbose output

Distribution:
  LEXICAL:    ${CATEGORY_DISTRIBUTION.LEXICAL}%
  SEMANTIC:   ${CATEGORY_DISTRIBUTION.SEMANTIC}%
  STRUCTURAL: ${CATEGORY_DISTRIBUTION.STRUCTURAL}%
  HYBRID:     ${CATEGORY_DISTRIBUTION.HYBRID}%

Examples:
  node generate.js --samples 1000                          # English only
  node generate.js --multilingual --samples 5000           # All languages
  node generate.js --scripts cyrillic-sr,cyrillic-ru       # Serbian + Russian
  node generate.js --languages en,sr,zh --samples 3000     # Specific languages
`);
      process.exit(0);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Sweet Search Training Data Generator (Phase 3)');
  console.log('='.repeat(60));
  console.log(`Target: ${totalSamples} samples`);
  console.log(`Output: ${outputPath}`);
  console.log(`Multilingual: ${multilingual}`);
  if (scripts) console.log(`Scripts: ${scripts}`);
  if (languages) console.log(`Languages: ${languages}`);

  // Generate training data
  console.log('\nGenerating training data...');
  const startTime = performance.now();

  const samples = generateTrainingData(totalSamples, {
    multilingual,
    scripts,
    languages,
    verbose,
  });

  const genTime = performance.now() - startTime;
  console.log(`\nGenerated ${samples.length} samples in ${genTime.toFixed(0)}ms`);

  // Calculate statistics
  const stats = {
    total: samples.length,
    byLabel: {},
    byLanguage: {},
    byScript: {},
    byDifficulty: {},
  };

  for (const sample of samples) {
    stats.byLabel[sample.label] = (stats.byLabel[sample.label] || 0) + 1;
    stats.byLanguage[sample.language] = (stats.byLanguage[sample.language] || 0) + 1;
    if (sample.script) {
      stats.byScript[sample.script] = (stats.byScript[sample.script] || 0) + 1;
    }
    stats.byDifficulty[sample.difficulty] = (stats.byDifficulty[sample.difficulty] || 0) + 1;
  }

  // Print distribution
  console.log('\nDistribution by label:');
  for (const [label, count] of Object.entries(stats.byLabel).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${label.padEnd(12)}: ${count.toString().padStart(5)} (${pct}%)`);
  }

  console.log('\nDistribution by language:');
  for (const [lang, count] of Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${lang.padEnd(8)}: ${count.toString().padStart(5)} (${pct}%)`);
  }

  if (Object.keys(stats.byScript).length > 1) {
    console.log('\nDistribution by script:');
    for (const [script, count] of Object.entries(stats.byScript).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / stats.total) * 100).toFixed(1);
      console.log(`  ${script.padEnd(15)}: ${count.toString().padStart(5)} (${pct}%)`);
    }
  }

  // Write output
  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSamples: samples.length,
      multilingual,
      scripts: scripts || (multilingual ? 'all' : 'latin-en'),
      languages: languages || (multilingual ? 'all' : 'en'),
      distribution: stats,
      version: '3.0',
    },
    data: samples,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved ${samples.length} samples to ${outputPath}`);

  // Identifier counts
  const idCounts = countIdentifiers();
  console.log(`\nIdentifier library: ${idCounts.total} identifiers across ${Object.keys(idCounts.byScript).length} scripts`);
}

// CLI entry point
main().catch(console.error);

export {
  generateTrainingData,
  generateLexicalQueries,
  generateSemanticQueries,
  generateStructuralQueries,
  generateHybridQueries,
  loadEvalQueries,
  LANGUAGE_CONFIGS,
  CATEGORY_DISTRIBUTION,
};
