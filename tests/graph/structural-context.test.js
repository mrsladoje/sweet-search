import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StructuralContextBuilder, formatStructuralContext } from '../../core/graph/index.js';
import { callsiteHints } from '../../core/graph/structural-callsite-hints.js';
import { extractHeaderContext } from '../../core/graph/structural-header-context.js';

function writeFileLines(root, file, lines) {
  const abs = join(root, file);
  mkdirSync(abs.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(abs, lines.join('\n'));
}

function filler(prefix, count) {
  return Array.from({ length: count }, (_, i) => `  ${prefix}${i}();`);
}

function createGraphDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      signature TEXT,
      doc_comment TEXT,
      summary TEXT,
      package TEXT,
      parent_class TEXT,
      search_text TEXT,
      name_alias TEXT,
      stale_since INTEGER DEFAULT NULL
    );
    CREATE TABLE relationships (
      id INTEGER PRIMARY KEY,
      source_id INTEGER,
      target_id INTEGER,
      target_name TEXT,
      type TEXT,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT
    );
  `);
  const ent = db.prepare(`
    INSERT INTO entities
      (id, name, type, file_path, start_line, end_line, signature, summary, search_text, stale_since)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  ent.run(1, 'processOrder', 'function', 'src/order.js', 1, 16, 'export function processOrder(order) {', 'Coordinates validation and commit', '');
  ent.run(2, 'handleSubmit', 'function', 'src/controller.js', 1, 14, 'export function handleSubmit(req) {', 'Controller submits an order', '');
  ent.run(3, 'webhookHandler', 'function', 'src/webhook.js', 1, 9, 'export function webhookHandler(event) {', 'Webhook entry point', '');
  ent.run(4, 'validateOrder', 'function', 'src/validator.js', 1, 8, 'export function validateOrder(order) {', 'Validates order', '');
  ent.run(5, 'commitOrder', 'function', 'src/db.js', 1, 8, 'export function commitOrder(order) {', 'Persists order', '');
  ent.run(6, 'dispatch', 'function', 'src/api.js', 1, 10, 'export function dispatch(req) {', 'Top-level API dispatch', '');
  ent.run(7, 'processOrderSpec', 'function', 'tests/order.test.js', 1, 8, 'function processOrderSpec() {', 'Test caller', '');
  ent.run(8, 'make_response', 'function', 'src/helpers.py', 1, 5, 'def make_response(*args):', 'Public response helper wrapper', '');
  ent.run(9, 'make_response', 'method', 'src/app.py', 1, 9, 'def make_response(self, rv):', 'Converts return values into Response objects', '');
  ent.run(10, 'validate', 'method', 'tests/schema.test.js', 1, 1, 'validate () { return true }', 'Fixture validator', '');
  ent.run(11, 'validate', 'function', 'src/validation.js', 1, 4, 'function validate(request) {', 'Validates params body querystring headers', '');
  ent.run(12, 'preValidationCallback', 'function', 'src/handle.js', 3, 5, 'function preValidationCallback(request) {', 'Calls imported validation alias', '');
  ent.run(13, 'locate', 'function', 'src/lines.rs', 1, 3, 'pub(crate) fn locate() -> Match {', 'Computes line boundaries', '');
  ent.run(14, 'find_candidate_line_fast', 'function', 'src/core.rs', 1, 4, 'fn find_candidate_line_fast() {', 'Calls namespaced locate', '');
  ent.run(15, 'ErrorKind', 'enum', 'src/pcre2/error.rs', 1, 3, 'pub enum ErrorKind {', 'PCRE2 regex error', '');
  ent.run(16, 'ErrorKind', 'enum', 'src/regex/error.rs', 1, 5, 'pub enum ErrorKind {', 'Regex parser variants', '');
  ent.run(18, 'Abort', 'method', 'src/context.go', 3, 5, 'func (c *Context) Abort() {', 'Stops pending handlers', '');
  ent.run(19, 'Legacy', 'class', 'src/legacy.js', 1, 13, 'function Legacy() {}', 'Legacy constructor', '');
  ent.run(20, 'send', 'method', 'src/legacy.js', 7, 9, 'Legacy.prototype.send = function () {', 'Sends legacy response', '');
  ent.run(21, 'helper', 'function', 'src/legacy.js', 11, 13, 'function helper() {', 'Legacy helper', '');
  ent.run(22, 'flush', 'method', 'src/legacy.js', 3, 6, 'Legacy.prototype.flush = function () {', 'Flushes legacy response', '');
  ent.run(23, 'render', 'method', 'tests/response.test.js', 1, 3, 'render: function () {', 'Test render helper', '');
  ent.run(24, 'pageHandler', 'function', 'src/page.js', 1, 4, 'function pageHandler(req, res) {', 'Calls response render', '');
  ent.run(25, 'renderSentinel', 'function', 'src/response.js', 7, 9, 'function renderSentinel() {', 'Keeps response file in graph', '');

  const rel = db.prepare(`
    INSERT INTO relationships (source_id, target_id, target_name, type, weight, context_line)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  rel.run(2, 1, 'processOrder', 'calls', 1, 4);
  rel.run(3, 1, 'processOrder', 'calls', 1, 4);
  rel.run(7, 1, 'processOrder', 'calls', 1, 4);
  rel.run(1, 4, 'validateOrder', 'calls', 1, 3);
  rel.run(1, 5, 'commitOrder', 'calls', 1, 6);
  rel.run(6, 2, 'handleSubmit', 'calls', 1, 5);
  rel.run(8, 8, 'current_app.make_response', 'calls', 1, 4);
  rel.run(24, null, 'res.render', 'calls', 1, 3);
  db.close();
}

describe('StructuralContextBuilder', () => {
  let root;
  let dbPath;
  let builder;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sweet-trace-'));
    dbPath = join(root, 'code-graph.db');
    createGraphDb(dbPath);
    writeFileLines(root, 'src/order.js', [
      'export function processOrder(order) {',
      '  const valid = validateOrder(order)',
      '  if (!valid) return null',
      '  audit(order)',
      '  normalize(order)',
      '  return commitOrder(order)',
      ...filler('step', 8),
      '}',
    ]);
    writeFileLines(root, 'src/controller.js', [
      'export function handleSubmit(req) {',
      '  const order = req.body',
      '  ensureUser(req.user)',
      '  return processOrder(order)',
      ...filler('after', 8),
      '}',
    ]);
    writeFileLines(root, 'src/webhook.js', [
      'export function webhookHandler(event) {',
      '  const order = fromWebhook(event)',
      '  track(event)',
      '  return processOrder(order)',
      '}',
    ]);
    writeFileLines(root, 'src/validator.js', ['export function validateOrder(order) {', '  return Boolean(order.id)', '}']);
    writeFileLines(root, 'src/db.js', ['export function commitOrder(order) {', '  return db.orders.insert(order)', '}']);
    writeFileLines(root, 'src/api.js', ['export function dispatch(req) {', '  authorize(req)', '  route(req)', '  parse(req)', '  return handleSubmit(req)', '}']);
    writeFileLines(root, 'tests/order.test.js', ['function processOrderSpec() {', '  const result = processOrder({ id: 1 })', '  expect(result).toBeTruthy()', '}']);
    writeFileLines(root, 'src/helpers.py', ['def make_response(*args):', '    if len(args) == 1:', '        args = args[0]', '    return current_app.make_response(args)', '']);
    writeFileLines(root, 'src/app.py', ['def make_response(self, rv):', '    if isinstance(rv, tuple):', '        rv = unpack_tuple(rv)', '    if isinstance(rv, dict):', '        rv = self.json.response(rv)', '    return self.response_class(rv)', '']);
    writeFileLines(root, 'tests/schema.test.js', ['validate () { return true }']);
    writeFileLines(root, 'src/validation.js', [
      'function validate(request) {',
      '  validateParam(request.params)',
      '  validateParam(request.body)',
      '  validateParam(context[querystringSchema], request.query)',
      '}',
    ]);
    writeFileLines(root, 'src/handle.js', ['const { validate: validateSchema } = require(\'./validation\')', '', 'function preValidationCallback(request) {', '  return validateSchema(request)', '}']);
    writeFileLines(root, 'src/lines.rs', ['pub(crate) fn locate() -> Match {', '    Match::zero(0)', '}']);
    writeFileLines(root, 'src/core.rs', ['fn find_candidate_line_fast() {', '    let line = lines::locate();', '}']);
    writeFileLines(root, 'src/pcre2/error.rs', ['pub enum ErrorKind {', '    Regex(String),', '}']);
    writeFileLines(root, 'src/regex/error.rs', ['pub enum ErrorKind {', '    NotAllowed,', '    InvalidClass,', '}']);
    writeFileLines(root, 'src/context.go', ['const abortIndex int8 = 63', '', 'func (c *Context) Abort() {', '    c.index = abortIndex', '}']);
    writeFileLines(root, 'src/legacy.js', [
      'function Legacy() {}',
      '',
      'Legacy.prototype.flush = function () {',
      '  this.send()',
      '  helper()',
      '}',
      'Legacy.prototype.send = function () {',
      '  return true',
      '}',
      '',
      'function helper() {',
      '  return true',
      '}',
    ]);
    writeFileLines(root, 'src/response.js', [
      'var res = {}',
      '',
      'res.render = function render(view, options) {',
      '  return this.app.render(view, options)',
      '}',
    ]);
    writeFileLines(root, 'src/page.js', [
      'function pageHandler(req, res) {',
      '  res.render("home", req.locals)',
      '}',
    ]);
    writeFileLines(root, 'tests/response.test.js', ['render: function () {', '  done()', '}']);
    builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
  });

  afterEach(() => {
    builder?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns one ranked package with callers, callees, and impact paths', () => {
    const result = builder.build('processOrder', { tokenBudget: 4000, maxDepth: 2 });

    expect(result.format).toBe('structural_context');
    expect(result.target.name).toBe('processOrder');
    expect(result.sections.callers.total).toBe(3);
    expect(result.sections.callees.total).toBe(2);
    expect(result.sections.impact.total).toBeGreaterThan(0);
    expect(result.sections.callers.items[0].file).not.toMatch(/^tests\//);
    expect(result.sections.impact.paths[0].path).toContain('processOrder');
    expect(result.sections.impact.paths.some(p => p.direction === 'downstream' && p.path.includes('validateOrder'))).toBe(true);
    expect(result.answerCues.targetTerms).toContain('validateOrder');
    expect(result.answerCues.keySymbols).toContain('processOrder');
    expect(result.answerCues.topCallers.join(' ')).not.toContain('tests/order.test.js');
    expect(result.answerCues.criticalPaths.some(p => p.includes('processOrder'))).toBe(true);
    expect(result.tokensUsed).toBeLessThanOrEqual(result.tokenBudget);
  });

  it('uses structural sandwiches for large callers while preserving call lines', () => {
    const result = builder.build('processOrder', { tokenBudget: 1600, maxDepth: 1 });
    const controller = result.sections.callers.items.find(item => item.name === 'handleSubmit');

    expect(controller.code).toContain('export function handleSubmit');
    expect(controller.code).toContain('processOrder(order)');
    expect(controller.presentation).toMatch(/full|preview/);
  });

  it('formats trace output for agent-readable CLI use', () => {
    const text = formatStructuralContext(builder.build('processOrder', { tokenBudget: 4000 }));

    expect(text).toContain('# trace processOrder');
    expect(text).toContain('## callers');
    expect(text).toContain('## callees');
    expect(text).toContain('## impact paths');
    expect(text).toContain('answer cues: target terms=');
  });

  it('resolves proxy-style qualified self-loop callees to concrete alternatives', () => {
    const result = builder.build('make_response', {
      queryHint: 'public response helper wrapper current_app',
      tokenBudget: 4000,
      maxDepth: 2,
    });

    expect(result.target.filePath).toBe('src/helpers.py');
    expect(result.sections.callees.items.some(item => item.file === 'src/app.py')).toBe(true);
    expect(result.sections.callees.items.some(item => item.id === result.target.id)).toBe(false);
    expect(result.sections.impact.paths.some(path => path.path.includes('src/app.py'))).toBe(true);
  });

  it('prefers concrete implementations over wrappers for callee-style hints', () => {
    const result = builder.build('make_response', {
      queryHint: 'response conversion helpers callees',
      tokenBudget: 4000,
      maxDepth: 2,
    });

    expect(result.target.filePath).toBe('src/app.py');
    expect(formatStructuralContext(result)).toContain('answer checklist: branch terms to preserve=tuple, dict');
    expect(formatStructuralContext(result)).toContain('answer checklist: branch code=');
  });

  it('prefers production definitions over test fixtures for ambiguous symbols', () => {
    const result = builder.build('validate', {
      queryHint: 'request parts params body querystring headers',
      tokenBudget: 4000,
    });

    expect(result.target.filePath).toBe('src/validation.js');
    expect(result.disambiguation[0].file).toBe('tests/schema.test.js');
    expect(result.answerCues.branchTerms).toEqual(expect.arrayContaining(['params', 'body', 'querystring']));
    expect(result.answerCues.branchSnippets.join(' ')).toContain('querystring');
  });

  it('adds callers through local import aliases when graph calls are unresolved', () => {
    const result = builder.build('validate', {
      queryHint: 'who calls validate request parts',
      tokenBudget: 4000,
    });

    expect(result.sections.callers.items.some(item => item.name === 'preValidationCallback')).toBe(true);
  });

  it('resolves Rust namespace separators in caller and callee relationships', () => {
    const result = builder.build('locate', {
      queryHint: 'where locate is used for line boundaries',
      tokenBudget: 4000,
    });

    expect(result.sections.callers.items.some(item => item.name === 'find_candidate_line_fast')).toBe(true);
  });

  it('uses query hints to disambiguate duplicate exact symbols', () => {
    const result = builder.build('ErrorKind', {
      queryHint: 'enum variants NotAllowed InvalidClass',
      tokenBudget: 4000,
    });

    expect(result.target.filePath).toBe('src/regex/error.rs');
  });

  it('surfaces same-file related definitions from target identifiers', () => {
    const result = builder.build('Abort', {
      queryHint: 'abort index sentinel',
      tokenBudget: 4000,
    });

    expect(result.answerCues.relatedDefinitions.some(x => x.includes('abortIndex'))).toBe(true);
  });

  it('uses member callsite hints when outgoing graph edges are missing', () => {
    const result = builder.build('flush', {
      queryHint: 'Legacy flush receiver send helper',
      tokenBudget: 4000,
    });

    expect(result.target.name).toBe('flush');
    expect(result.target.callsiteHints).toEqual(expect.arrayContaining(['helper', 'send']));
    expect(result.target.callsiteHints).not.toContain('function');
    expect(result.sections.callees.items.map(item => item.name)).toEqual(expect.arrayContaining(['helper', 'send']));
  });

  it('uses source member assignments ahead of test fixtures for missed JavaScript methods', () => {
    const result = builder.build('render', {
      queryHint: 'response render view app',
      tokenBudget: 4000,
    });

    expect(result.target.filePath).toBe('src/response.js');
    expect(result.target.signature).toBe('res.render = function render(view, options) {');
    expect(result.disambiguation[0].file).toBe('tests/response.test.js');
    expect(result.sections.callers.items.some(item => item.name === 'pageHandler')).toBe(true);
  });

  it('ignores docstring examples when extracting callsite hints', () => {
    const hints = callsiteHints('def make_response():\n    """\n    def index():\n        return render_template("index.html")\n    """\n    return current_app.make_response(args)');

    expect(hints).toContain('make_response');
    expect(hints).not.toContain('index');
    expect(hints).not.toContain('render_template');
  });

  it('extracts compact import context for target sandwiches', () => {
    const header = extractHeaderContext((file, start, end) => {
      expect(file).toBe('src/session.py');
      expect(start).toBe(1);
      expect(end).toBe(100);
      return [
        'import itsdangerous',
        'from flask.json.tag import TaggedJSONSerializer',
        '',
        'class SecureCookieSessionInterface:',
        '    pass',
      ].join('\n');
    }, 'src/session.py');

    expect(header).toContain('import itsdangerous');
    expect(header).toContain('TaggedJSONSerializer');
    expect(header).not.toContain('class SecureCookieSessionInterface');
  });

});
