#!/usr/bin/env node

/**
 * Comprehensive Training Data Generator
 *
 * Generates a large, balanced dataset for ML query router training.
 * Focus on edge cases and balanced category distribution.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generate comprehensive training data with proper balance.
 */
function generateComprehensiveData() {
  const queries = [];

  // === LEXICAL QUERIES (25% target) ===

  // PascalCase class names - common patterns
  const prefixes = ['Auth', 'User', 'Login', 'Employee', 'Session', 'Token', 'Config', 'Email', 'Notification', 'Report', 'Data', 'File', 'Cache', 'Redis', 'Grpc', 'Rest', 'Http', 'Web', 'Api', 'Database', 'Password', 'Hash', 'Encrypt', 'Event', 'Message', 'Queue', 'Task', 'Log', 'Security', 'Cors', 'Swagger', 'Base', 'Abstract', 'Default', 'Custom'];
  const suffixes = ['Service', 'Controller', 'Repository', 'Manager', 'Handler', 'Validator', 'Util', 'Helper', 'Client', 'Template', 'Config', 'Filter', 'Aspect', 'Factory', 'Builder', 'Provider', 'Listener', 'Publisher', 'Processor', 'Scheduler', 'Mapper', 'Converter', 'Adapter', 'Proxy', 'Interceptor'];

  for (const prefix of prefixes.slice(0, 20)) {
    for (const suffix of suffixes.slice(0, 10)) {
      queries.push({ query: `${prefix}${suffix}`, label: 'LEXICAL', subtype: 'class_name', language: 'en' });
    }
  }

  // camelCase method names
  const methodPrefixes = ['get', 'set', 'find', 'create', 'update', 'delete', 'validate', 'process', 'handle', 'send', 'receive', 'compute', 'calculate', 'parse', 'format', 'convert', 'build', 'load', 'save', 'fetch', 'store', 'cache', 'check', 'verify', 'authenticate', 'authorize'];
  const methodSuffixes = ['User', 'Users', 'ById', 'All', 'Token', 'Session', 'Password', 'Email', 'Data', 'Result', 'Response', 'Request', 'Config', 'Event', 'Message', 'File', 'Report', 'Employee', 'Employees', 'Project', 'Team'];

  for (const prefix of methodPrefixes) {
    for (const suffix of methodSuffixes.slice(0, 8)) {
      queries.push({ query: `${prefix}${suffix}`, label: 'LEXICAL', subtype: 'method_name', language: 'en' });
    }
  }

  // snake_case variables
  const snakeVars = [
    'max_retry_count', 'api_base_url', 'db_pool_size', 'request_timeout', 'cache_ttl',
    'session_duration', 'token_expiry', 'max_connections', 'default_page_size', 'min_password_length',
    'upload_max_size', 'rate_limit', 'batch_size', 'thread_count', 'buffer_size',
    'retry_interval', 'connection_string', 'api_key', 'secret_key', 'access_token',
    'refresh_token', 'user_id', 'session_id', 'request_id', 'trace_id',
  ];
  for (const v of snakeVars) {
    queries.push({ query: v, label: 'LEXICAL', subtype: 'variable', language: 'en' });
  }

  // SCREAMING_SNAKE constants
  const constants = [
    'MAX_CONNECTIONS', 'DEFAULT_TIMEOUT', 'API_VERSION', 'HTTP_OK', 'HTTP_NOT_FOUND',
    'ERROR_CODE', 'SUCCESS_STATUS', 'RETRY_LIMIT', 'BUFFER_SIZE', 'BATCH_SIZE',
    'MAX_RETRIES', 'MIN_THREADS', 'MAX_THREADS', 'CACHE_SIZE', 'PAGE_SIZE',
    'TOKEN_EXPIRY', 'SESSION_TIMEOUT', 'RATE_LIMIT', 'MAX_UPLOAD_SIZE', 'DEBUG_MODE',
  ];
  for (const c of constants) {
    queries.push({ query: c, label: 'LEXICAL', subtype: 'constant', language: 'en' });
  }

  // File paths
  const files = [
    'AuthService.java', 'LoginController.java', 'UserRepository.java', 'EmployeeService.java',
    'config.yml', 'application.properties', 'pom.xml', 'package.json', 'tsconfig.json',
    'src/main/java/service/AuthService.java', 'src/components/Login.tsx', 'src/hooks/useAuth.ts',
    'utils/helpers.ts', 'api/endpoints.js', 'config/database.json', 'proto/events.proto',
    'test/auth.spec.ts', 'src/index.ts', 'lib/utils.js', 'models/User.java',
  ];
  for (const f of files) {
    queries.push({ query: f, label: 'LEXICAL', subtype: 'file_path', language: 'en' });
  }

  // Glob patterns
  const globs = [
    '*Controller.java', '*Service.java', '*Repository.java', '*Handler.java',
    'get*', 'find*', 'validate*', 'process*', 'handle*',
    '*.proto', '*.yml', '*.config', '*.properties',
    'src/**/*.tsx', 'test/**/*.spec.ts', 'lib/**/*.js',
  ];
  for (const g of globs) {
    queries.push({ query: g, label: 'LEXICAL', subtype: 'glob', language: 'en' });
  }

  // Package names
  const packages = [
    'com.example.service', 'com.codolis.sloth.vita', 'org.springframework.security',
    '@angular/core', '@nestjs/common', 'react-router-dom', '@types/node',
    'com.google.protobuf', 'io.grpc', 'javax.validation',
  ];
  for (const p of packages) {
    queries.push({ query: p, label: 'LEXICAL', subtype: 'package', language: 'en' });
  }

  // === SEMANTIC QUERIES (25% target) ===

  // Question patterns - English
  const questionStarts = ['how does', 'what is', 'why do we need', 'where are', 'when should', 'how can', 'what happens when', 'how to'];
  const questionTopics = [
    'authentication work', 'the login process', 'caching', 'errors handled', 'we use JWT', 'session management implemented',
    'password reset flow', 'tokens validated', 'user registration work', 'data validation happen',
    'gRPC streaming work', 'event processing work', 'notifications sent', 'files uploaded',
    'database connections pooled', 'transactions managed', 'exceptions handled', 'logging done',
    'security implemented', 'authorization work', 'rate limiting done', 'caching strategy',
  ];

  for (const start of questionStarts) {
    for (const topic of questionTopics.slice(0, 10)) {
      queries.push({ query: `${start} ${topic}`, label: 'SEMANTIC', subtype: 'question', language: 'en' });
    }
  }

  // Process descriptions
  const processes = [
    'user login flow', 'password reset process', 'data validation workflow', 'authentication process',
    'registration flow', 'checkout process', 'payment processing', 'order fulfillment',
    'notification delivery', 'email sending process', 'file upload workflow', 'data export process',
    'backup procedure', 'deployment pipeline', 'CI/CD workflow', 'testing strategy',
    'error handling strategy', 'logging approach', 'monitoring setup', 'alerting mechanism',
    'caching mechanism', 'session handling', 'token refresh flow', 'OAuth flow',
    'SSO integration', 'LDAP authentication', 'database migration', 'schema evolution',
  ];

  for (const p of processes) {
    queries.push({ query: p, label: 'SEMANTIC', subtype: 'process', language: 'en' });
  }

  // Architecture patterns
  const architecture = [
    'microservices architecture', 'event-driven design', 'CQRS pattern', 'saga pattern',
    'repository pattern', 'factory pattern', 'singleton pattern', 'dependency injection',
    'clean architecture', 'hexagonal architecture', 'layered architecture', 'domain-driven design',
    'API gateway pattern', 'service mesh', 'circuit breaker pattern', 'retry strategy',
    'bulkhead pattern', 'throttling mechanism', 'load balancing strategy', 'caching layer',
  ];

  for (const a of architecture) {
    queries.push({ query: a, label: 'SEMANTIC', subtype: 'architecture', language: 'en' });
  }

  // Serbian semantic
  const serbianSemantic = [
    'како функционише аутентификација', 'шта је процес валидације', 'зашто се користи кеширање',
    'где се обрађују грешке', 'објасни механизам кеширања', 'процес регистрације корисника',
    'како систем шаље обавештења', 'логика за обраду захтева', 'архитектура микросервиса',
    'стратегија руковања грешкама', 'процес пријаве корисника', 'валидација података',
    'управљање сесијама', 'обрада догађаја', 'систем обавештавања', 'безбедносна провера',
  ];
  for (const s of serbianSemantic) {
    queries.push({ query: s, label: 'SEMANTIC', subtype: 'question', language: 'sr' });
  }

  // German semantic
  const germanSemantic = [
    'wie funktioniert die Authentifizierung', 'warum wird Caching benötigt', 'was ist der Login-Prozess',
    'Fehlerbehandlungsstrategie', 'Datenbankverbindungspooling', 'wie werden Tokens validiert',
    'Sitzungsverwaltung', 'Ereignisverarbeitung', 'Nachrichtenwarteschlange',
  ];
  for (const g of germanSemantic) {
    queries.push({ query: g, label: 'SEMANTIC', subtype: 'question', language: 'de' });
  }

  // Chinese semantic
  const chineseSemantic = [
    '身份验证如何工作', '为什么需要缓存', '用户登录流程', '错误处理策略',
    '数据验证机制', '会话管理', '事件处理', '消息队列',
  ];
  for (const c of chineseSemantic) {
    queries.push({ query: c, label: 'SEMANTIC', subtype: 'question', language: 'zh' });
  }

  // Japanese semantic
  const japaneseSemantic = [
    '認証はどのように機能しますか', 'なぜキャッシュが必要ですか', 'ユーザーログインフロー',
    'エラー処理戦略', 'セッション管理', 'イベント処理',
  ];
  for (const j of japaneseSemantic) {
    queries.push({ query: j, label: 'SEMANTIC', subtype: 'question', language: 'ja' });
  }

  // Russian semantic
  const russianSemantic = [
    'как работает аутентификация', 'почему нужно кеширование', 'процесс входа пользователя',
    'стратегия обработки ошибок', 'управление сессиями', 'обработка событий',
  ];
  for (const r of russianSemantic) {
    queries.push({ query: r, label: 'SEMANTIC', subtype: 'question', language: 'ru' });
  }

  // Spanish semantic
  const spanishSemantic = [
    'cómo funciona la autenticación', 'por qué se necesita el caché', 'flujo de inicio de sesión',
    'estrategia de manejo de errores', 'gestión de sesiones', 'procesamiento de eventos',
  ];
  for (const s of spanishSemantic) {
    queries.push({ query: s, label: 'SEMANTIC', subtype: 'question', language: 'es' });
  }

  // === STRUCTURAL QUERIES (25% target) ===

  const structuralEntities = [
    'AuthService', 'UserService', 'LoginController', 'EmployeeRepository', 'SessionManager',
    'TokenValidator', 'ConfigService', 'EmailService', 'NotificationService', 'ReportGenerator',
    'DataExporter', 'FileUploader', 'CacheManager', 'EventPublisher', 'MessageBroker',
    'QueueProcessor', 'TaskScheduler', 'SecurityFilter', 'LoggingAspect', 'BaseController',
  ];

  // Caller patterns
  const callerPatterns = [
    'what calls {}', 'callers of {}', 'who calls {}', 'usages of {}', 'references to {}',
    'where is {} called', 'find callers of {}', 'show usages of {}', 'who uses {}',
    'find references to {}', 'what invokes {}', 'methods calling {}',
  ];

  // Callee patterns
  const calleePatterns = [
    'what does {} call', 'callees of {}', 'dependencies of {}', 'methods called by {}',
    'what {} uses', 'imports of {}', 'what {} depends on', 'outgoing calls from {}',
  ];

  // Implementation patterns
  const implPatterns = [
    'implementations of {}', 'classes implementing {}', 'who extends {}', 'subtypes of {}',
    'subclasses of {}', 'concrete implementations of {}', 'what implements {}',
  ];

  // Impact patterns
  const impactPatterns = [
    'impact of changing {}', 'what depends on {}', 'affected by modifying {}',
    'downstream effects of {} changes', 'will break if {} changes', 'ripple effects of changing {}',
    'what needs to change if {} changes',
  ];

  for (const entity of structuralEntities) {
    for (const pattern of callerPatterns.slice(0, 5)) {
      queries.push({ query: pattern.replace('{}', entity), label: 'STRUCTURAL', subtype: 'callers', language: 'en' });
    }
    for (const pattern of calleePatterns.slice(0, 4)) {
      queries.push({ query: pattern.replace('{}', entity), label: 'STRUCTURAL', subtype: 'callees', language: 'en' });
    }
    for (const pattern of implPatterns.slice(0, 3)) {
      queries.push({ query: pattern.replace('{}', entity), label: 'STRUCTURAL', subtype: 'implementations', language: 'en' });
    }
    for (const pattern of impactPatterns.slice(0, 3)) {
      queries.push({ query: pattern.replace('{}', entity), label: 'STRUCTURAL', subtype: 'impact', language: 'en' });
    }
  }

  // Serbian structural
  const serbianStructuralPatterns = ['шта позива {}', 'ко користи {}', 'зависности од {}', 'имплементације {}', 'утицај промене на {}'];
  for (const entity of structuralEntities.slice(0, 8)) {
    for (const pattern of serbianStructuralPatterns) {
      queries.push({ query: pattern.replace('{}', entity), label: 'STRUCTURAL', subtype: 'structural', language: 'sr' });
    }
  }

  // === HYBRID QUERIES (25% target) - CRITICAL FOR ACCURACY ===

  // Two-word ambiguous patterns (most important for hybrid)
  const twoWordAmbiguous = [
    'session management', 'login validation', 'config encryption', 'screenshot upload',
    'process events', 'employee tracking', 'token refresh', 'password reset',
    'file upload', 'error logging', 'user authentication', 'data validation',
    'cache invalidation', 'rate limiting', 'load balancing', 'health checking',
    'request logging', 'response caching', 'input sanitization', 'output encoding',
    'connection pooling', 'thread management', 'memory allocation', 'garbage collection',
    'event publishing', 'message handling', 'queue processing', 'task scheduling',
    'security scanning', 'vulnerability assessment', 'penetration testing', 'code review',
    'performance tuning', 'query optimization', 'index management', 'schema migration',
    'api versioning', 'endpoint routing', 'request filtering', 'response transformation',
    'state management', 'context switching', 'session handling', 'cookie management',
  ];

  for (const t of twoWordAmbiguous) {
    queries.push({ query: t, label: 'HYBRID', subtype: 'two_word_ambiguous', language: 'en' });
  }

  // Identifier + concept combinations
  for (const entity of structuralEntities.slice(0, 15)) {
    const concepts = ['login flow', 'error handling', 'caching strategy', 'validation logic', 'security checks', 'retry mechanism'];
    for (const concept of concepts) {
      queries.push({ query: `${entity} ${concept}`, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'en' });
    }
  }

  // Question + identifier patterns
  for (const entity of structuralEntities.slice(0, 10)) {
    const questions = ['how {} handles errors', 'what {} does internally', 'how {} validates input'];
    for (const q of questions) {
      queries.push({ query: q.replace('{}', entity), label: 'HYBRID', subtype: 'identifier_with_concept', language: 'en' });
    }
  }

  // Serbian hybrid
  const serbianHybrid = [
    'AuthService механизам пријаве', 'како getUserById обрађује грешке', 'UserRepository стратегија кеширања',
    'процес у LoginController', 'валидација у AuthService', 'руковање грешкама у BaseService',
    'сесија управљање', 'пријава валидација', 'конфигурација шифровање', 'догађај обрада',
  ];
  for (const h of serbianHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'sr' });
  }

  // German hybrid
  const germanHybrid = [
    'AuthService Anmeldeablauf', 'wie getUserById Fehler behandelt', 'SessionService Caching-Strategie',
    'Sitzung Verwaltung', 'Anmeldung Validierung', 'Fehler Protokollierung',
  ];
  for (const h of germanHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'de' });
  }

  // Chinese hybrid
  const chineseHybrid = [
    'AuthService登录流程', 'getUserById如何处理错误', 'UserRepository缓存策略',
    '会话管理', '登录验证', '事件处理',
  ];
  for (const h of chineseHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'zh' });
  }

  // Japanese hybrid
  const japaneseHybrid = [
    'AuthServiceログインフロー', 'getUserByIdエラー処理', 'UserRepositoryキャッシュ戦略',
    'セッション管理', 'ログイン検証',
  ];
  for (const h of japaneseHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'ja' });
  }

  // Russian hybrid
  const russianHybrid = [
    'AuthService процесс входа', 'как getUserById обрабатывает ошибки', 'UserRepository стратегия кеширования',
    'управление сессией', 'валидация входа',
  ];
  for (const h of russianHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'ru' });
  }

  // Spanish hybrid
  const spanishHybrid = [
    'AuthService flujo de inicio de sesión', 'cómo getUserById maneja errores', 'UserRepository estrategia de caché',
    'gestión de sesión', 'validación de inicio',
  ];
  for (const h of spanishHybrid) {
    queries.push({ query: h, label: 'HYBRID', subtype: 'identifier_with_concept', language: 'es' });
  }

  return queries;
}

// Main
function main() {
  const args = process.argv.slice(2);
  let outputPath = 'output/comprehensive_training_data.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Comprehensive Training Data Generator');
  console.log('='.repeat(60));

  const queries = generateComprehensiveData();

  // Shuffle
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }

  // Statistics
  const stats = {
    total: queries.length,
    byLabel: {},
    byLanguage: {},
  };

  for (const q of queries) {
    stats.byLabel[q.label] = (stats.byLabel[q.label] || 0) + 1;
    stats.byLanguage[q.language] = (stats.byLanguage[q.language] || 0) + 1;
  }

  console.log(`\nGenerated ${queries.length} samples\n`);

  console.log('Distribution by label:');
  for (const [label, count] of Object.entries(stats.byLabel).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${label.padEnd(12)}: ${count.toString().padStart(4)} (${pct}%)`);
  }

  console.log('\nDistribution by language:');
  for (const [lang, count] of Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${lang.padEnd(8)}: ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Save
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSamples: queries.length,
      distribution: stats,
      version: '2.0-comprehensive',
    },
    data: queries,
  };

  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved to ${outputPath}`);
}

main();

export { generateComprehensiveData };
