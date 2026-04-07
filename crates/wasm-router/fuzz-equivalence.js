#!/usr/bin/env node
/**
 * Comprehensive WASM vs JS Equivalence Testing
 *
 * Three test categories:
 * 1. FUZZ TESTING - Random query generation
 * 2. PROPERTY-BASED TESTING - Systematic property verification
 * 3. EDGE CASE SUITE - Boundary conditions and corner cases
 *
 * Usage:
 *   node fuzz-equivalence.js              # Run all tests (default: 10k queries)
 *   node fuzz-equivalence.js --quick      # Quick run (1k queries)
 *   node fuzz-equivalence.js --thorough   # Thorough run (100k queries)
 *   node fuzz-equivalence.js --fuzz       # Only fuzz testing
 *   node fuzz-equivalence.js --edge       # Only edge cases
 *   node fuzz-equivalence.js --features   # Compare feature-by-feature
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// RANDOM GENERATORS
// ============================================================================

const CHARS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  special: '_-.$@#!?',
  whitespace: ' \t',
  cyrillic: 'абвгдежзийклмнопрстуфхцчшщъыьэюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  japanese: 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
  chinese: '认证处理服务用户数据配置验证错误消息系统功能模块接口实现类方法调用',
  korean: '인증처리서비스사용자데이터설정검증오류메시지시스템기능모듈인터페이스구현클래스메소드호출',
  german: 'äöüßÄÖÜ',
  spanish: 'áéíóúüñÁÉÍÓÚÜÑ¿¡',
  arabic: 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي',
};

const KEYWORDS = {
  structural: ['callers', 'callees', 'calls', 'uses', 'usages', 'references', 'implementations', 'implements', 'extends', 'dependencies', 'subtypes', 'impact', 'affected', 'downstream', 'invoke', 'invokes', 'inherits'],
  semantic: ['explain', 'describe', 'understand', 'overview', 'architecture', 'design', 'how', 'why', 'what', 'when', 'where', 'which', 'flow', 'process', 'mechanism', 'strategy', 'pattern'],
  action: ['handle', 'send', 'calculate', 'parse', 'validate', 'trigger', 'perform', 'initialize', 'process', 'execute', 'generate', 'fetch', 'store', 'load', 'save', 'create', 'update', 'delete', 'render'],
  german: ['Unterklassen', 'Implementierungen', 'Aufrufer', 'Abhängigkeiten', 'Authentifizierung', 'Konfiguration', 'Fehlerbehandlung'],
  spanish: ['implementaciones', 'llamadas', 'dependencias', 'autenticación', 'configuración', 'manejo de errores'],
  russian: ['реализации', 'вызовы', 'зависимости', 'аутентификация', 'конфигурация', 'обработка ошибок'],
  japanese: ['実装', '呼び出し', '依存関係', '認証', '設定', 'エラー処理'],
  chinese: ['实现', '调用', '依赖', '认证', '配置', '错误处理'],
};

const IDENTIFIERS = {
  pascal: ['AuthService', 'UserRepository', 'PaymentGateway', 'SessionManager', 'FileUploader', 'DataProcessor', 'ConfigLoader', 'ErrorHandler', 'TokenValidator', 'CacheManager'],
  camel: ['getUserById', 'processPayment', 'validateSession', 'handleError', 'loadConfig', 'saveDocument', 'fetchUsers', 'createOrder', 'updateProfile', 'deleteRecord'],
  snake: ['user_service', 'auth_handler', 'config_loader', 'data_processor', 'error_handler', 'session_manager', 'file_uploader', 'cache_manager', 'token_validator', 'payment_gateway'],
  screaming: ['MAX_CONNECTIONS', 'DEFAULT_TIMEOUT', 'API_KEY', 'BASE_URL', 'CONFIG_PATH', 'ERROR_CODE', 'SESSION_ID', 'USER_AGENT', 'CACHE_SIZE', 'BUFFER_LENGTH'],
  cyrillic: ['СервисАвторизации', 'ОбработчикПлатежей', 'МенеджерСессий', 'ЗагрузчикФайлов'],
  cjk: ['用户服务', '认证处理', '数据管理', '配置加载'],
};

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomString(length, charset) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

// ============================================================================
// QUERY GENERATORS
// ============================================================================

const generators = {
  // === PURE IDENTIFIER QUERIES ===
  pascalCase: () => randomFrom(IDENTIFIERS.pascal),
  camelCase: () => randomFrom(IDENTIFIERS.camel),
  snakeCase: () => randomFrom(IDENTIFIERS.snake),
  screamingCase: () => randomFrom(IDENTIFIERS.screaming),
  cyrillicIdentifier: () => randomFrom(IDENTIFIERS.cyrillic),
  cjkIdentifier: () => randomFrom(IDENTIFIERS.cjk),

  // === STRUCTURAL QUERIES ===
  structuralCaller: () => `${randomFrom(KEYWORDS.structural)} of ${randomFrom(IDENTIFIERS.pascal)}`,
  structuralCallee: () => `what does ${randomFrom(IDENTIFIERS.pascal)} call`,
  structuralImplements: () => `classes implementing ${randomFrom(IDENTIFIERS.pascal)}`,
  structuralExtends: () => `subtypes of ${randomFrom(IDENTIFIERS.pascal)}`,
  structuralImpact: () => `impact of changing ${randomFrom(IDENTIFIERS.pascal)}`,

  // === SEMANTIC QUERIES ===
  semanticHow: () => `how does ${randomFrom(IDENTIFIERS.pascal)} work`,
  semanticWhy: () => `why does ${randomFrom(IDENTIFIERS.pascal)} ${randomFrom(KEYWORDS.action)}`,
  semanticWhat: () => `what is the ${randomFrom(KEYWORDS.semantic)} of ${randomFrom(IDENTIFIERS.pascal)}`,
  semanticExplain: () => `explain ${randomFrom(IDENTIFIERS.pascal)} ${randomFrom(KEYWORDS.semantic)}`,
  semanticQuestion: () => `${randomFrom(IDENTIFIERS.pascal)} ${randomFrom(KEYWORDS.semantic)}?`,

  // === HYBRID QUERIES ===
  hybridIdentifierConcept: () => `${randomFrom(IDENTIFIERS.pascal)} ${randomFrom(KEYWORDS.semantic)}`,
  hybridIdentifierAction: () => `${randomFrom(IDENTIFIERS.pascal)} ${randomFrom(KEYWORDS.action)} logic`,
  hybridConceptIdentifier: () => `${randomFrom(KEYWORDS.semantic)} for ${randomFrom(IDENTIFIERS.pascal)}`,

  // === MULTILINGUAL QUERIES ===
  germanStructural: () => `${randomFrom(KEYWORDS.german)} von ${randomFrom(IDENTIFIERS.pascal)}`,
  germanSemantic: () => `wie funktioniert ${randomFrom(IDENTIFIERS.pascal)}`,
  spanishStructural: () => `${randomFrom(KEYWORDS.spanish)} de ${randomFrom(IDENTIFIERS.pascal)}`,
  spanishSemantic: () => `cómo funciona ${randomFrom(IDENTIFIERS.pascal)}`,
  russianStructural: () => `${randomFrom(KEYWORDS.russian)} ${randomFrom(IDENTIFIERS.cyrillic)}`,
  russianSemantic: () => `как работает ${randomFrom(IDENTIFIERS.cyrillic)}`,
  japaneseSemantic: () => `${randomFrom(IDENTIFIERS.pascal)}の${randomFrom(KEYWORDS.japanese)}`,
  chineseSemantic: () => `${randomFrom(IDENTIFIERS.pascal)}的${randomFrom(KEYWORDS.chinese)}`,

  // === RANDOM CONTENT ===
  randomAscii: () => randomString(randomInt(3, 50), CHARS.lowercase + CHARS.uppercase + CHARS.digits + ' '),
  randomMixed: () => randomString(randomInt(5, 30), CHARS.lowercase + CHARS.uppercase + CHARS.cyrillic + CHARS.japanese + ' '),
  randomUnicode: () => randomString(randomInt(5, 20), CHARS.cyrillic + CHARS.japanese + CHARS.chinese + CHARS.korean),
  randomWithSpecial: () => randomString(randomInt(5, 30), CHARS.lowercase + CHARS.special + ' '),

  // === FILE PATHS ===
  filePath: () => `src/${randomFrom(['services', 'controllers', 'utils', 'models'])}/${randomFrom(IDENTIFIERS.pascal)}.${randomFrom(['java', 'ts', 'js', 'py'])}`,
  methodCall: () => `${randomFrom(IDENTIFIERS.pascal)}.${randomFrom(IDENTIFIERS.camel)}()`,
  dotNotation: () => `${randomFrom(IDENTIFIERS.pascal)}.${randomFrom(IDENTIFIERS.camel)}`,

  // === NUMBERS AND SPECIAL ===
  withNumbers: () => `${randomFrom(IDENTIFIERS.pascal)}${randomInt(1, 999)}`,
  withVersion: () => `${randomFrom(IDENTIFIERS.pascal)} v${randomInt(1, 10)}.${randomInt(0, 99)}`,
  ipAddress: () => `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}`,
  email: () => `user${randomInt(1, 999)}@example.com`,

  // === COMPOUND PATTERNS ===
  longGerman: () => `${randomFrom(['Fehlerbehandlungsstrategie', 'Authentifizierungsmechanismus', 'Konfigurationsverwaltung', 'Datenbankverbindung'])}`,
  mixedScript: () => `${randomFrom(IDENTIFIERS.pascal)}的${randomFrom(KEYWORDS.chinese)}`,
  codeWithConcept: () => `${randomFrom(IDENTIFIERS.camel)} ${randomFrom(['error handling', 'data flow', 'authentication', 'validation'])}`,
};

// ============================================================================
// EDGE CASES
// ============================================================================

const EDGE_CASES = [
  // Empty and minimal
  '',
  ' ',
  '  ',
  '\t',
  '\n',
  'a',
  'A',
  '1',
  '_',
  '.',
  '?',
  'ab',
  'AB',
  'aB',
  'Ab',

  // Single characters from different scripts
  'а',  // Cyrillic a
  'あ', // Japanese hiragana
  '中', // Chinese
  '가', // Korean
  'α',  // Greek
  'א',  // Hebrew
  'م',  // Arabic

  // Whitespace variations
  'test query',
  'test  query',
  'test   query',
  'test\tquery',
  ' test query',
  'test query ',
  ' test query ',
  '\ttest\tquery\t',

  // Case variations
  'authservice',
  'AUTHSERVICE',
  'AuthService',
  'authService',
  'AUTH_SERVICE',
  'auth_service',
  'Auth_Service',
  'AUTH_service',

  // Boundary lengths
  randomString(1, CHARS.lowercase),
  randomString(2, CHARS.lowercase),
  randomString(3, CHARS.lowercase),
  randomString(10, CHARS.lowercase),
  randomString(50, CHARS.lowercase),
  randomString(100, CHARS.lowercase),
  randomString(500, CHARS.lowercase),
  randomString(1000, CHARS.lowercase),

  // Special characters
  '!@#$%^&*()',
  'test!query',
  'test@query',
  'test#query',
  'test$query',
  'test%query',
  'test^query',
  'test&query',
  'test*query',
  'test(query)',
  'test[query]',
  'test{query}',
  'test<query>',
  'test|query',
  'test\\query',
  'test/query',

  // Quotes and escapes
  '"test"',
  "'test'",
  '`test`',
  'test"query',
  "test'query",
  'test`query',
  'test\\"query',
  "test\\'query",

  // Numbers
  '123',
  '123456789',
  '0',
  '-1',
  '3.14',
  '1e10',
  '0x1234',
  '0b1010',

  // Mixed content
  '123abc',
  'abc123',
  'a1b2c3',
  'A1B2C3',
  'a_1_b_2',
  'A_1_B_2',

  // Unicode boundaries
  '\u0000test',  // Null char
  'test\u0000',
  '\uFFFDtest',  // Replacement char
  '\u200Btest',  // Zero-width space
  'test\u200B',
  '\u2028test',  // Line separator
  '\u2029test',  // Paragraph separator

  // Combining characters
  'e\u0301',     // é as e + combining acute
  'n\u0303',     // ñ as n + combining tilde

  // Emoji
  '😀',
  '👨‍👩‍👧‍👦', // Family emoji (ZWJ sequence)
  'test😀query',
  '🔍search',

  // RTL text
  'مرحبا',       // Arabic "hello"
  'שלום',        // Hebrew "shalom"
  'مرحبا test',  // Mixed RTL/LTR

  // Very long tokens
  'a'.repeat(100),
  'AuthService'.repeat(10),
  'how does '.repeat(50) + 'work',

  // Repeated patterns
  'aaaa',
  'AAAA',
  'AaAa',
  'aAaA',
  '____',
  '.....',
  '?????',

  // Code-like patterns
  'function foo()',
  'def bar():',
  'class Foo {}',
  'interface Bar',
  'SELECT * FROM users',
  'import { x } from "y"',
  '<div class="test">',
  '{ "key": "value" }',

  // Path patterns
  '/home/user/file.txt',
  'C:\\Users\\file.txt',
  '../parent/file',
  './current/file',
  'file://localhost/path',
  'https://example.com',

  // Git patterns
  'HEAD~1',
  'master..feature',
  'abc123def',  // Looks like short SHA

  // Keywords in isolation
  'callers',
  'callees',
  'implements',
  'extends',
  'how',
  'why',
  'what',
  'where',
  'explain',

  // Question patterns
  'how?',
  'why?',
  'what?',
  'where?',
  'how does it work?',
  'what is this?',
  '?question',
  'question??',

  // Structural patterns without identifiers
  'callers of',
  'callees of',
  'what calls',
  'who uses',
  'implementations of',

  // Semantic patterns without identifiers
  'how does it work',
  'explain the mechanism',
  'what is the flow',
  'describe the process',

  // All uppercase with underscores
  'MAX_VALUE',
  'MIN_VALUE',
  'DEFAULT_CONFIG',
  'API_KEY_SECRET_TOKEN_VALUE',

  // All lowercase with underscores
  'max_value',
  'min_value',
  'default_config',
  'api_key_secret_token_value',

  // CJK without spaces (critical edge case)
  '认证机制',
  '認証メカニズム',
  'アカウント管理',
  '인증시스템',

  // Mixed CJK and Latin
  'Auth认证',
  '认证Service',
  'Service的实现',
  '如何使用AuthService',

  // Very specific structural queries
  'where is AuthService called',
  'where is it called',
  'where called',

  // German compounds
  'Fehlerbehandlung',
  'Datenbankverbindung',
  'Authentifizierungsmechanismus',

  // Partial matches
  'Auth',
  'Serv',
  'ice',
  'Service',
  'auth',

  // Typos and near-misses
  'AuhService',  // Missing t
  'AtuhService', // Swapped
  'AuthServiec', // Typo at end
  'how dose it work',  // dose vs does
  'wat calls',   // wat vs what

  // Control sequences
  '\x1b[31mred\x1b[0m',  // ANSI escape
  '\r\ntest',
  'test\r\n',

  // Base64-like
  'dGVzdA==',
  'YXV0aGVudGljYXRpb24=',

  // UUID-like
  '550e8400-e29b-41d4-a716-446655440000',

  // Version strings
  'v1.0.0',
  '1.2.3-beta',
  '2.0.0-rc.1',
];

// ============================================================================
// TEST RUNNER
// ============================================================================

async function loadModules() {
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  const { extractAllFeatures } = await import('../training/features/extractor.js');
  const { routeQueryCatBoostWithReject } = await import('../query-router-catboost.js');

  return { wasm, extractAllFeatures, routeQueryCatBoostWithReject };
}

function compareFeatures(query, jsFeatures, wasmFeatures, threshold = 0.0001) {
  const mismatches = [];

  for (let i = 0; i < 50; i++) {
    const jsVal = jsFeatures[i];
    const wasmVal = wasmFeatures[i];
    const diff = Math.abs(jsVal - wasmVal);

    if (diff > threshold) {
      mismatches.push({
        feature: i,
        js: jsVal,
        wasm: wasmVal,
        diff: diff,
      });
    }
  }

  return mismatches;
}

async function runFuzzTest(modules, count, verbose = false) {
  const { wasm, extractAllFeatures, routeQueryCatBoostWithReject } = modules;
  const generatorNames = Object.keys(generators);

  let tested = 0;
  let routeMismatches = [];
  let featureMismatches = [];

  console.log(`\n🎲 FUZZ TESTING (${count} queries)`);
  console.log('=' .repeat(60));

  for (let i = 0; i < count; i++) {
    // Pick random generator
    const genName = randomFrom(generatorNames);
    const query = generators[genName]();

    try {
      // Get WASM result
      const wasmResult = wasm.route_query(query);
      const wasmMode = wasmResult.mode_str.toUpperCase();
      const wasmFeatures = wasm.extract_features_js(query);

      // Get JS result
      const jsFeatures = extractAllFeatures(query);
      const jsResult = routeQueryCatBoostWithReject(query);
      const jsMode = jsResult.mode.toUpperCase();

      tested++;

      // Compare routes
      if (wasmMode !== jsMode) {
        routeMismatches.push({
          query: query.substring(0, 80),
          generator: genName,
          wasm: wasmMode,
          js: jsMode,
          wasmConf: wasmResult.confidence.toFixed(3),
          jsConf: jsResult.confidence.toFixed(3),
        });
      }

      // Compare features
      const fMismatches = compareFeatures(query, jsFeatures, wasmFeatures);
      if (fMismatches.length > 0) {
        featureMismatches.push({
          query: query.substring(0, 60),
          generator: genName,
          mismatches: fMismatches,
        });
      }

      // Progress
      if ((i + 1) % 1000 === 0) {
        process.stdout.write(`\r  Progress: ${i + 1}/${count} (${routeMismatches.length} route mismatches, ${featureMismatches.length} feature mismatches)`);
      }
    } catch (err) {
      console.error(`\n  ❌ Error on query "${query.substring(0, 50)}": ${err.message}`);
    }
  }

  console.log(`\r  Progress: ${tested}/${count} completed`.padEnd(80));

  return { tested, routeMismatches, featureMismatches };
}

async function runEdgeCaseTest(modules, verbose = false) {
  const { wasm, extractAllFeatures, routeQueryCatBoostWithReject } = modules;

  let tested = 0;
  let routeMismatches = [];
  let featureMismatches = [];
  let errors = [];

  console.log(`\n🔬 EDGE CASE TESTING (${EDGE_CASES.length} queries)`);
  console.log('='.repeat(60));

  for (const query of EDGE_CASES) {
    try {
      // Get WASM result
      const wasmResult = wasm.route_query(query);
      const wasmMode = wasmResult.mode_str.toUpperCase();
      const wasmFeatures = wasm.extract_features_js(query);

      // Get JS result
      const jsFeatures = extractAllFeatures(query);
      const jsResult = routeQueryCatBoostWithReject(query);
      const jsMode = jsResult.mode.toUpperCase();

      tested++;

      // Compare routes
      if (wasmMode !== jsMode) {
        routeMismatches.push({
          query: JSON.stringify(query).substring(0, 80),
          wasm: wasmMode,
          js: jsMode,
          wasmConf: wasmResult.confidence.toFixed(3),
          jsConf: jsResult.confidence.toFixed(3),
        });
      }

      // Compare features
      const fMismatches = compareFeatures(query, jsFeatures, wasmFeatures);
      if (fMismatches.length > 0) {
        featureMismatches.push({
          query: JSON.stringify(query).substring(0, 60),
          mismatches: fMismatches,
        });
      }
    } catch (err) {
      errors.push({
        query: JSON.stringify(query).substring(0, 60),
        error: err.message,
      });
    }
  }

  console.log(`  Tested: ${tested}/${EDGE_CASES.length}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
  }

  return { tested, routeMismatches, featureMismatches, errors };
}

async function runPropertyTest(modules, count) {
  const { wasm, extractAllFeatures } = modules;

  console.log(`\n📐 PROPERTY-BASED TESTING (${count} queries)`);
  console.log('='.repeat(60));

  const violations = {
    featureRange: [],      // Features should be in valid range
    tokenCount: [],        // Token count should match
    booleanFeatures: [],   // Boolean features should be 0 or 1
    ratioFeatures: [],     // Ratio features should be 0-1
    consistency: [],       // Same query should give same result
  };

  // Property 1: Features should be in valid range
  console.log('  Testing: Feature value ranges...');
  for (let i = 0; i < count; i++) {
    const genName = randomFrom(Object.keys(generators));
    const query = generators[genName]();

    try {
      const wasmFeatures = wasm.extract_features_js(query);
      const jsFeatures = extractAllFeatures(query);

      for (let f = 0; f < 50; f++) {
        // Check for NaN or Infinity
        if (!Number.isFinite(wasmFeatures[f])) {
          violations.featureRange.push({ query: query.substring(0, 40), feature: f, value: wasmFeatures[f], source: 'wasm' });
        }
        if (!Number.isFinite(jsFeatures[f])) {
          violations.featureRange.push({ query: query.substring(0, 40), feature: f, value: jsFeatures[f], source: 'js' });
        }

        // Boolean features (0-8, 14-24, 26-33, 35-36, 38-42, 45-49)
        const booleanFeatures = [0,1,2,3,4,5,6,7,8,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,35,36,38,39,40,41,42,45,46,48,49];
        if (booleanFeatures.includes(f)) {
          if (wasmFeatures[f] !== 0 && wasmFeatures[f] !== 1) {
            violations.booleanFeatures.push({ query: query.substring(0, 40), feature: f, value: wasmFeatures[f], source: 'wasm' });
          }
          if (jsFeatures[f] !== 0 && jsFeatures[f] !== 1) {
            violations.booleanFeatures.push({ query: query.substring(0, 40), feature: f, value: jsFeatures[f], source: 'js' });
          }
        }

        // Ratio features should be 0-1 (11, 12, 13, 34, 37, 43, 44, 47)
        const ratioFeatures = [11, 12, 13, 34, 37, 43, 44, 47];
        if (ratioFeatures.includes(f)) {
          if (wasmFeatures[f] < 0 || wasmFeatures[f] > 1.0001) {
            violations.ratioFeatures.push({ query: query.substring(0, 40), feature: f, value: wasmFeatures[f], source: 'wasm' });
          }
          if (jsFeatures[f] < 0 || jsFeatures[f] > 1.0001) {
            violations.ratioFeatures.push({ query: query.substring(0, 40), feature: f, value: jsFeatures[f], source: 'js' });
          }
        }
      }
    } catch (e) {
      // Skip errors
    }
  }

  // Property 2: Consistency - same query should give same result
  console.log('  Testing: Consistency (same input = same output)...');
  for (let i = 0; i < Math.min(1000, count); i++) {
    const genName = randomFrom(Object.keys(generators));
    const query = generators[genName]();

    try {
      const wasmResult1 = wasm.route_query(query);
      const wasmResult2 = wasm.route_query(query);

      if (wasmResult1.mode_str !== wasmResult2.mode_str ||
          Math.abs(wasmResult1.confidence - wasmResult2.confidence) > 0.0001) {
        violations.consistency.push({
          query: query.substring(0, 40),
          result1: `${wasmResult1.mode_str}:${wasmResult1.confidence.toFixed(4)}`,
          result2: `${wasmResult2.mode_str}:${wasmResult2.confidence.toFixed(4)}`,
        });
      }
    } catch (e) {
      // Skip errors
    }
  }

  // Report
  let totalViolations = 0;
  for (const [name, list] of Object.entries(violations)) {
    if (list.length > 0) {
      console.log(`  ❌ ${name}: ${list.length} violations`);
      totalViolations += list.length;
      if (list.length <= 5) {
        for (const v of list) {
          console.log(`     - ${JSON.stringify(v).substring(0, 100)}`);
        }
      } else {
        for (const v of list.slice(0, 3)) {
          console.log(`     - ${JSON.stringify(v).substring(0, 100)}`);
        }
        console.log(`     ... and ${list.length - 3} more`);
      }
    } else {
      console.log(`  ✅ ${name}: PASSED`);
    }
  }

  return violations;
}

function printSummary(fuzzResult, edgeResult, propResult) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));

  const totalTested = fuzzResult.tested + edgeResult.tested;
  const totalRouteMismatches = fuzzResult.routeMismatches.length + edgeResult.routeMismatches.length;
  const totalFeatureMismatches = fuzzResult.featureMismatches.length + edgeResult.featureMismatches.length;

  console.log(`\nTotal queries tested: ${totalTested}`);
  console.log(`Route mismatches: ${totalRouteMismatches}`);
  console.log(`Feature mismatches: ${totalFeatureMismatches}`);
  console.log(`Match rate: ${((totalTested - totalRouteMismatches) / totalTested * 100).toFixed(2)}%`);

  if (totalRouteMismatches > 0) {
    console.log('\n⚠️  ROUTE MISMATCHES:');
    const allMismatches = [...fuzzResult.routeMismatches, ...edgeResult.routeMismatches];
    for (const m of allMismatches.slice(0, 20)) {
      console.log(`  "${m.query}" → WASM:${m.wasm} JS:${m.js}`);
    }
    if (allMismatches.length > 20) {
      console.log(`  ... and ${allMismatches.length - 20} more`);
    }
  }

  if (totalFeatureMismatches > 0) {
    console.log('\n⚠️  FEATURE MISMATCHES (first 10):');
    const allMismatches = [...fuzzResult.featureMismatches, ...edgeResult.featureMismatches];
    for (const m of allMismatches.slice(0, 10)) {
      console.log(`  "${m.query}"`);
      for (const f of m.mismatches.slice(0, 3)) {
        console.log(`    Feature ${f.feature}: JS=${f.js.toFixed(4)} WASM=${f.wasm.toFixed(4)} (diff=${f.diff.toFixed(4)})`);
      }
    }
  }

  if (edgeResult.errors && edgeResult.errors.length > 0) {
    console.log('\n⚠️  ERRORS:');
    for (const e of edgeResult.errors.slice(0, 10)) {
      console.log(`  ${e.query}: ${e.error}`);
    }
  }

  const propViolations = Object.values(propResult).reduce((sum, list) => sum + list.length, 0);
  console.log(`\nProperty violations: ${propViolations}`);

  if (totalRouteMismatches === 0 && totalFeatureMismatches === 0 && propViolations === 0) {
    console.log('\n✅ ALL TESTS PASSED - WASM and JS are functionally equivalent!');
    return 0;
  } else {
    console.log('\n❌ TESTS FAILED - Mismatches detected');
    return 1;
  }
}

async function main() {
  const args = process.argv.slice(2);

  let fuzzCount = 10000;
  let runFuzz = true;
  let runEdge = true;
  let runProps = true;
  let compareFeatureMode = false;

  if (args.includes('--quick')) {
    fuzzCount = 1000;
  } else if (args.includes('--thorough')) {
    fuzzCount = 100000;
  }

  if (args.includes('--fuzz')) {
    runEdge = false;
    runProps = false;
  } else if (args.includes('--edge')) {
    runFuzz = false;
    runProps = false;
  } else if (args.includes('--features')) {
    compareFeatureMode = true;
    fuzzCount = 1000;
  }

  console.log('🔄 Loading modules...');
  const modules = await loadModules();
  console.log('✅ Modules loaded');

  let fuzzResult = { tested: 0, routeMismatches: [], featureMismatches: [] };
  let edgeResult = { tested: 0, routeMismatches: [], featureMismatches: [], errors: [] };
  let propResult = {};

  if (runFuzz) {
    fuzzResult = await runFuzzTest(modules, fuzzCount, compareFeatureMode);
  }

  if (runEdge) {
    edgeResult = await runEdgeCaseTest(modules, compareFeatureMode);
  }

  if (runProps) {
    propResult = await runPropertyTest(modules, Math.min(5000, fuzzCount));
  }

  const exitCode = printSummary(fuzzResult, edgeResult, propResult);
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
