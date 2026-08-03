import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SEARCH_BATCH_DEFAULT_MAX_CHARS,
  SEARCH_BATCH_MAX_MAX_CHARS,
  SEARCH_BATCH_MIN_MAX_CHARS,
  allocateSearchBatchChars,
  executeSearchBatch,
  packageSearchBatchResults,
  runSearchBatchOperations,
  validateSearchBatchRequest,
} from '../../core/search/search-batch.js';
import { renderSearchBatchCliResult } from '../../core/search/search-batch-format.js';
import {
  SEARCH_BATCH_BODY_MAX_BYTES,
  buildSearchBatchDaemonResponse,
  readBoundedJsonBody,
} from '../../core/search/search-server.js';

const repoRoot = realpathSync.native(process.cwd());
const tempDirs = [];

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return realpathSync.native(dir);
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const readOperation = (id = 'readOne', file = 'package.json') => ({
  id, tool: 'read', args: { path: file, startLine: 1, endLine: 2 },
});

function request(operations, extra = {}) {
  return { version: 1, projectRoot: repoRoot, operations, ...extra };
}

function validate(payload) {
  return validateSearchBatchRequest(payload, { daemonProjectRoot: payload.projectRoot });
}

describe('search-batch request validation', () => {
  it('pins version, operation count, IDs, tools, unknown fields, and budget bounds', () => {
    const valid = request([readOperation('one'), readOperation('two')]);
    expect(validate(valid).maxChars).toBe(16_000);
    expect(SEARCH_BATCH_DEFAULT_MAX_CHARS).toBe(16_000);
    expect(SEARCH_BATCH_MIN_MAX_CHARS).toBe(1024);
    expect(SEARCH_BATCH_MAX_MAX_CHARS).toBe(64_000);
    expect(validate({ ...valid, maxChars: 1024 }).maxChars).toBe(1024);
    expect(validate({ ...valid, maxChars: 64_000 }).maxChars).toBe(64_000);

    expect(() => validate({ ...valid, version: 2 })).toThrow(/version/);
    expect(() => validate({ ...valid, operations: [readOperation('one')] })).toThrow(/exactly 2 or 3/);
    expect(() => validate({ ...valid, operations: [readOperation('a'), readOperation('b'), readOperation('c'), readOperation('d')] })).toThrow(/exactly 2 or 3/);
    expect(() => validate({ ...valid, operations: [readOperation('same'), readOperation('same')] })).toThrow(/unique/);
    expect(() => validate({ ...valid, operations: [{ id: '1bad', tool: 'read', args: { path: 'x' } }, readOperation()] })).toThrow(/id is invalid/);
    expect(() => validate({ ...valid, operations: [{ id: 'bad', tool: 'write', args: {} }, readOperation()] })).toThrow(/tool is invalid/);
    expect(() => validate({ ...valid, surprise: true })).toThrow(/unknown field/);
    expect(() => validate({ ...valid, maxChars: 1023 })).toThrow(/1024 to 64000/);
    expect(() => validate({ ...valid, maxChars: 64_001 })).toThrow(/1024 to 64000/);
  });

  it('accepts the exact typed schemas for all six tools', () => {
    const groups = [
      [
        { id: 'searchOne', tool: 'search', args: { query: 'request routing', k: 20, mode: 'hybrid' } },
        { id: 'grepOne', tool: 'grep', args: { pattern: 'handleRequest$', in: 'core/search', k: 20, contextLines: 20, fixedString: false } },
      ],
      [
        { id: 'findOne', tool: 'find', args: { query: 'find handler', regex: '\\bhandleRequest\\b', in: 'core/search', k: 20 } },
        { id: 'readOne', tool: 'read', args: { path: 'package.json', startLine: 1, endLine: 10 } },
      ],
      [
        { id: 'semanticOne', tool: 'semantic', args: { path: 'package.json', query: 'package name', topK: 20, threshold: 1, contextLines: 20 } },
        { id: 'traceOne', tool: 'trace', args: { symbol: 'startServer', file: 'core/search/search-server.js', hint: 'callers', depth: 4, budget: 16_000 } },
      ],
    ];
    for (const operations of groups) expect(validate(request(operations)).operations).toHaveLength(2);
  });

  it.each([
    [{ id: 'bad', tool: 'search', args: { query: 'x', k: 0 } }, /1 to 20/],
    [{ id: 'bad', tool: 'search', args: { query: 'x', mode: 'pattern' } }, /mode is invalid/],
    [{ id: 'bad', tool: 'grep', args: { pattern: 'x', contextLines: 21 } }, /0 to 20/],
    [{ id: 'bad', tool: 'grep', args: { pattern: 'x', fixedString: 'yes' } }, /boolean/],
    [{ id: 'bad', tool: 'find', args: { query: 'x', regex: '' } }, /non-empty string/],
    [{ id: 'bad', tool: 'read', args: { path: 'x', endLine: 2 } }, /requires startLine/],
    [{ id: 'bad', tool: 'read', args: { path: 'x', startLine: 3, endLine: 2 } }, />= startLine/],
    [{ id: 'bad', tool: 'semantic', args: { path: 'x', query: 'q', threshold: 1.1 } }, /0 to 1/],
    [{ id: 'bad', tool: 'trace', args: { symbol: 'x', depth: 5 } }, /1 to 4/],
    [{ id: 'bad', tool: 'trace', args: { symbol: 'x', budget: 999 } }, /1000 to 16000/],
  ])('rejects per-tool type/boundary violations', (operation, message) => {
    expect(() => validate(request([operation, readOperation('other')]))).toThrow(message);
  });

  it('rejects unknown per-tool fields', () => {
    const operation = { id: 'bad', tool: 'search', args: { query: 'x', shell: true } };
    expect(() => validate(request([operation, readOperation('other')]))).toThrow(/unknown field: shell/);
  });

  it('requires an existing canonical projectRoot equal to the daemon root', () => {
    const other = tempDir('batch-other-');
    const valid = request([readOperation('one'), readOperation('two')]);
    expect(() => validateSearchBatchRequest(valid, { daemonProjectRoot: other })).toThrow(/mismatch/);
    expect(() => validateSearchBatchRequest({ ...valid, projectRoot: `${repoRoot}${path.sep}` }, { daemonProjectRoot: repoRoot })).toThrow(/canonical/);
    expect(() => validateSearchBatchRequest({ ...valid, projectRoot: 'relative' }, { daemonProjectRoot: repoRoot })).toThrow(/absolute canonical/);
  });

  it('rejects absolute, traversal, NUL, and symlink-out operation paths', () => {
    const root = tempDir('batch-root-');
    const outside = tempDir('batch-outside-');
    mkdirSync(path.join(root, 'inside'));
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(root, 'escape'), 'dir');
    const payload = (file) => ({
      version: 1,
      projectRoot: root,
      operations: [readOperation('one', file), readOperation('two', 'inside/file.txt')],
    });
    const opts = { daemonProjectRoot: root };
    expect(() => validateSearchBatchRequest(payload('/etc/passwd'), opts)).toThrow(/relative/);
    expect(() => validateSearchBatchRequest(payload('../secret'), opts)).toThrow(/traversal/);
    expect(() => validateSearchBatchRequest(payload('inside\0secret'), opts)).toThrow(/NUL/);
    expect(() => validateSearchBatchRequest(payload('escape/secret.txt'), opts)).toThrow(/outside projectRoot/);
  });

  it('enforces the frozen placeholder/reference grammar without rejecting ordinary syntax', () => {
    const payload = (pattern) => request([
      { id: 'first', tool: 'grep', args: { pattern } },
      { id: 'second', tool: 'grep', args: { pattern: 'safe' } },
    ]);
    for (const allowed of ['foo$', '<div>', '$open', '$first/path']) expect(() => validate(payload(allowed))).not.toThrow();
    for (const rejected of ['${first.output}', '{{first}}', '$first', '$first.output', '$first[0]', '$first:value', '$first{value}', '$first_more', '$first-2', '$first2']) {
      expect(() => validate(payload(rejected))).toThrow(/placeholder|references operation/);
    }
    const refKey = request([{ id: 'first', tool: 'grep', args: { pattern: 'x', ref: 'second' } }, readOperation('second')]);
    expect(() => validate(refKey)).toThrow(/reference-shaped field/);
    const nestedKey = request([{ id: 'first', tool: 'grep', args: { pattern: 'x', extra: { fromOperation: 'second' } } }, readOperation('second')]);
    expect(() => validate(nestedKey)).toThrow(/reference-shaped field/);
    const nestedToken = request([{ id: 'first', tool: 'search', args: { query: { nested: '$second.output' } } }, readOperation('second')]);
    expect(() => validate(nestedToken)).toThrow(/references operation second/);
  });
});

describe('search-batch execution and adapter isolation', () => {
  it('uses searcher.search for search, grep, and ranked pattern find', async () => {
    const calls = [];
    const searcher = {
      search: async (query, options) => {
        calls.push({ query, options });
        return { results: [{ file: 'core/search/search-server.js', startLine: 1, endLine: 2, code: query }] };
      },
    };
    const payload = request([
      { id: 'searchOne', tool: 'search', args: { query: 'alpha', mode: 'lexical', k: 3 } },
      { id: 'grepOne', tool: 'grep', args: { pattern: 'beta', in: 'core/search', k: 4 } },
      { id: 'findOne', tool: 'find', args: { query: 'gamma', regex: '\\bgamma\\b', k: 5 } },
    ]);
    await executeSearchBatch(payload, { daemonProjectRoot: repoRoot, searcher });
    expect(calls.map(({ query }) => query)).toEqual(['alpha', 'beta', 'gamma']);
    expect(calls[0].options).toMatchObject({ mode: 'lexical', k: 3, format: 'agent' });
    expect(calls[1].options).toMatchObject({ mode: 'grep', regex: 'beta', fileFilter: 'core/search', maxMatches: 4 });
    expect(calls[2].options).toMatchObject({ mode: 'pattern', regex: '\\bgamma\\b', k: 5, format: 'agent' });
  });

  it('keeps declared order and statuses when one sibling fails', async () => {
    const payload = request([
      { id: 'broken', tool: 'search', args: { query: 'x' } },
      readOperation('reader'),
      { id: 'empty', tool: 'grep', args: { pattern: 'absent' } },
    ]);
    const result = await executeSearchBatch(payload, {
      daemonProjectRoot: repoRoot,
      adapters: {
        search: async () => { throw new Error('search exploded'); },
        read: async () => ({ files: [{ ok: true, file: 'package.json', range: { startLine: 1, endLine: 2 }, text: 'read survived', totalLines: 2 }] }),
        grep: async () => ({ results: [] }),
      },
    });
    expect(result.operations.map(({ id }) => id)).toEqual(['broken', 'reader', 'empty']);
    expect(result.operations.map(({ status }) => status)).toEqual(['error', 'ok', 'no_match']);
    expect(result.operations[0].output).toContain('search exploded');
    expect(result.operations[1].output).toContain('read survived');
  });

  it('runs read adapters concurrently but serializes shared searcher adapters', async () => {
    const readPlan = validate(request([readOperation('one'), readOperation('two')]));
    let readActive = 0;
    let maxReadActive = 0;
    await runSearchBatchOperations(readPlan, {
      adapters: {
        read: async (args) => {
          readActive++;
          maxReadActive = Math.max(maxReadActive, readActive);
          await new Promise((resolve) => setTimeout(resolve, 5));
          readActive--;
          return { files: [{ ok: true, file: args.path, text: 'x', totalLines: 1 }] };
        },
      },
    });
    expect(maxReadActive).toBe(2);

    const searchPlan = validate(request([
      { id: 'one', tool: 'search', args: { query: 'one' } },
      { id: 'two', tool: 'search', args: { query: 'two' } },
    ]));
    let searchActive = 0;
    let maxSearchActive = 0;
    await runSearchBatchOperations(searchPlan, {
      adapters: {
        search: async () => {
          searchActive++;
          maxSearchActive = Math.max(maxSearchActive, searchActive);
          await new Promise((resolve) => setTimeout(resolve, 5));
          searchActive--;
          return { results: [] };
        },
      },
    });
    expect(maxSearchActive).toBe(1);
  });

  it('normalizes read, semantic, and real trace-shaped spans into provenance metadata', async () => {
    const payload = request([
      readOperation('readOne'),
      { id: 'semanticOne', tool: 'semantic', args: { path: 'package.json', query: 'name' } },
      { id: 'traceOne', tool: 'trace', args: { symbol: 'startServer' } },
    ]);
    const result = await executeSearchBatch(payload, {
      daemonProjectRoot: repoRoot,
      adapters: {
        read: async () => ({ files: [{ ok: true, file: 'package.json', text: 'read', totalLines: 5 }] }),
        semantic: async () => ({ ok: true, file: 'package.json', spans: [{ startLine: 2, endLine: 3, symbols: ['name'], text: 'semantic' }] }),
        trace: async () => ({
          target: { name: 'startServer', type: 'function', filePath: 'core/search/search-server.js', startLine: 640, endLine: 700, code: 'target' },
          sections: {
            callers: { items: [{ name: 'runCli', type: 'function', file: 'core/search/search-cli.js', startLine: 28, endLine: 40, code: 'caller' }] },
            callees: { items: [{ name: 'init', type: 'method', file: 'core/search/sweet-search.js', startLine: 300, endLine: 320, code: 'callee' }] },
            impact: { paths: [{ path: 'runCli -> startServer' }] },
          },
        }),
      },
    });
    expect(result.operations[0].meta.spans[0]).toMatchObject({ file: 'package.json', startLine: 1, endLine: 5, rank: 1 });
    expect(result.operations[1].meta.spans[0]).toMatchObject({ file: 'package.json', startLine: 2, endLine: 3, rank: 1 });
    expect(result.operations[2].meta.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'startServer', type: 'function', rank: 1 }),
      expect.objectContaining({ symbol: 'runCli', type: 'function', rank: 2 }),
      expect.objectContaining({ symbol: 'init', type: 'method', rank: 3 }),
    ]));
  });
});

describe('search-batch post-ranking dedup and shared budget', () => {
  const span = (file, startLine, endLine, rank, text, symbol) => ({ file, startLine, endLine, rank, text, symbol });

  it('deduplicates a fully-covered lower-priority span after per-operation ranking', () => {
    const result = packageSearchBatchResults([
      { id: 'first', tool: 'search', status: 'ok', spans: [
        span('a.js', 1, 5, 1, 'FIRST', 'first'),
        span('shared.js', 10, 20, 2, 'LOWER_RANK_DUP', 'lower'),
      ] },
      { id: 'second', tool: 'semantic', status: 'ok', spans: [
        span('shared.js', 8, 25, 1, 'TOP_RANK', 'top'),
      ] },
    ]);
    expect(result.dedup).toMatchObject({ inputSpanCount: 3, keptSpanCount: 2, duplicateSpanCount: 1 });
    expect(result.operations[0].meta.spans).toHaveLength(2);
    expect(result.operations[0].meta.omittedSpans).toContainEqual(expect.objectContaining({
      file: 'shared.js', startLine: 10, endLine: 20, rank: 2, reason: 'duplicate',
      duplicateOf: { operationId: 'second', rank: 1 },
    }));
    expect(result.operations[0].output).not.toContain('LOWER_RANK_DUP');
    expect(result.operations[1].output).toContain('TOP_RANK');
  });

  it('retains partially overlapping spans so unique tail lines are never lost', () => {
    const result = packageSearchBatchResults([
      { id: 'left', tool: 'read', status: 'ok', spans: [span('a.js', 1, 10, 1, 'LINES_1_10')] },
      { id: 'right', tool: 'read', status: 'ok', spans: [span('a.js', 8, 20, 1, 'LINES_8_20')] },
    ]);
    expect(result.dedup.duplicateSpanCount).toBe(0);
    expect(result.operations[0].output).toContain('LINES_1_10');
    expect(result.operations[1].output).toContain('LINES_8_20');
    expect(result.operations.flatMap(({ meta }) => meta.omittedSpans)).toEqual([]);
  });

  it('enforces a fair nonzero floor, shared cap, explicit budget omissions, and matching status labels', () => {
    const large = 'x'.repeat(2000);
    const result = packageSearchBatchResults([
      { id: 'one', tool: 'search', status: 'ok', spans: [span('one.js', 1, 10, 1, large)] },
      { id: 'two', tool: 'search', status: 'ok', spans: [span('two.js', 1, 10, 1, large)] },
    ], { maxChars: 1024 });
    expect(result.sharedBudget).toEqual({ maxChars: 1024, usedChars: 1024, truncated: true });
    for (const operation of result.operations) {
      expect(operation.meta.floorChars).toBe(512);
      expect(operation.meta.floorChars).toBeLessThanOrEqual(1024 / 2);
      expect(operation.meta.allocatedChars).toBe(512);
      expect(operation.status).toBe('truncated');
      expect(operation.truncated).toBe(true);
      expect(operation.output).toContain('status=truncated');
      expect(operation.output).not.toContain('status=ok');
      expect(operation.meta.omittedSpans).toContainEqual(expect.objectContaining({ reason: 'budget', partial: true }));
    }
  });

  it('returns deterministic floor allocations at both 2- and 3-operation widths', () => {
    expect(allocateSearchBatchChars([10_000, 10_000], 1024)).toEqual({ floorChars: 512, allocations: [512, 512] });
    expect(allocateSearchBatchChars([10_000, 10_000, 10_000], 1024)).toEqual({ floorChars: 341, allocations: [342, 341, 341] });
    const shortFirst = allocateSearchBatchChars([10, 10_000], 1024);
    expect(shortFirst.floorChars).toBe(512);
    expect(shortFirst.allocations).toEqual([10, 1014]);
  });
});

describe('search-batch CLI presentation', () => {
  const packed = {
    version: 1,
    operationCount: 2,
    sharedBudget: { maxChars: 24_000, usedChars: 4312, truncated: true },
    dedup: { duplicateSpanCount: 2 },
    operations: [
      {
        id: 'first op\n', tool: 'search tool\t', status: 'ok\nstatus', truncated: false,
        output: 'alpha()\n  beta()\t// real code\n',
        meta: {
          sourceSpanCount: 3, emittedSpanCount: 2, duplicateSpanCount: 1,
          budgetOmittedSpanCount: 1, floorChars: 1024, allocatedChars: 4096,
          fullOutputChars: 5000, outputChars: 4000,
          omittedSpans: [
            {
              reason: 'duplicate\nspan', file: 'src/a file\none.js', startLine: 4,
              endLine: 9, rank: 2, duplicateOf: { operationId: 'second op\n', rank: 1 },
            },
            { reason: 'budget cap', file: 'src/b file.js', startLine: 20, endLine: 30, rank: 3, partial: true },
          ],
        },
      },
      {
        id: 'second', tool: 'read', status: 'truncated', truncated: true,
        output: 'omega()',
        meta: { omittedSpans: [{ reason: 'budget', file: 'src/c.js', startLine: 1, endLine: 2, rank: 1 }] },
      },
    ],
  };

  it('frames real-newline operation output in declared order with encoded machine values', () => {
    const rendered = renderSearchBatchCliResult(packed);
    expect(rendered).toMatch(/^\[ss-batch\] version=1 operation_count=2 shared_max_chars=24000 shared_used_chars=4312 shared_truncated=true dedup_count=2\n/);
    expect(rendered).toContain('[ss-batch operation] id=first%20op%0A tool=search%20tool%09 status=ok%0Astatus truncated=false');
    expect(rendered).toContain('source_span_count=3 emitted_span_count=2 duplicate_span_count=1 budget_omitted_span_count=1 floor_chars=1024 allocated_chars=4096 full_output_chars=5000 output_chars=4000');
    expect(rendered).toContain('alpha()\n  beta()\t// real code\n');
    expect(rendered).not.toContain('alpha()\\n  beta()');
    expect(rendered.indexOf('alpha()')).toBeLessThan(rendered.indexOf('omega()'));
    expect(rendered.endsWith('[ss-batch end] operation_count=2')).toBe(true);
  });

  it('emits one encoded machine line for every omission', () => {
    const lines = renderSearchBatchCliResult(packed).split('\n');
    const omitted = lines.filter((line) => line.startsWith('[ss-batch omitted]'));
    expect(omitted).toHaveLength(3);
    expect(omitted[0]).toContain('operation_id=first%20op%0A reason=duplicate%0Aspan file=src%2Fa%20file%0Aone.js start=4 end=9 rank=2 partial=false');
    expect(omitted[0]).toContain('duplicate_operation_id=second%20op%0A duplicate_rank=1');
    expect(omitted[1]).toContain('reason=budget%20cap file=src%2Fb%20file.js start=20 end=30 rank=3 partial=true');
    expect(omitted[2]).toContain('operation_id=second reason=budget file=src%2Fc.js start=1 end=2 rank=1 partial=false');
  });
});

describe('POST /batch endpoint builder and body bound', () => {
  const reads = request([readOperation('one'), readOperation('two')]);

  it('rejects TCP before execution and project mismatches with 409', async () => {
    let calls = 0;
    const tcp = await buildSearchBatchDaemonResponse(reads, {
      isUnixSocket: false,
      serverReady: true,
      searcher: { projectRoot: repoRoot },
      executeBatchFn: async () => { calls++; },
    });
    expect(tcp.status).toBe(403);
    expect(calls).toBe(0);

    const other = tempDir('batch-server-other-');
    const mismatch = await buildSearchBatchDaemonResponse(reads, {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: other },
    });
    expect(mismatch.status).toBe(409);
  });

  it('serves read-only batches before readiness but gates index-backed batches', async () => {
    const readResponse = await buildSearchBatchDaemonResponse(reads, {
      isUnixSocket: true,
      serverReady: false,
      searcher: { projectRoot: repoRoot },
      executeBatchFn: async () => ({ version: 1, operationCount: 2 }),
    });
    expect(readResponse.status).toBe(200);
    expect(readResponse.contentType).toBe('application/json');
    const responseBody = JSON.parse(readResponse.body);
    expect(responseBody.cliOutput).toBe('[ss-batch] version=1 operation_count=2 shared_max_chars=0 shared_used_chars=0 shared_truncated=false dedup_count=0\n[ss-batch end] operation_count=2');

    const indexed = request([
      { id: 'searchOne', tool: 'search', args: { query: 'x' } },
      readOperation('readOne'),
    ]);
    const indexedResponse = await buildSearchBatchDaemonResponse(indexed, {
      isUnixSocket: true,
      serverReady: false,
      searcher: { projectRoot: repoRoot },
    });
    expect(indexedResponse.status).toBe(503);
  });

  it('enforces the 64KiB JSON body limit from both Content-Length and streamed bytes', async () => {
    expect(SEARCH_BATCH_BODY_MAX_BYTES).toBe(64 * 1024);
    const declared = {
      headers: { 'content-length': String(SEARCH_BATCH_BODY_MAX_BYTES + 1) },
      async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); },
    };
    await expect(readBoundedJsonBody(declared, SEARCH_BATCH_BODY_MAX_BYTES)).rejects.toMatchObject({ status: 413 });

    const streamed = {
      headers: {},
      async *[Symbol.asyncIterator]() { yield Buffer.alloc(SEARCH_BATCH_BODY_MAX_BYTES + 1, 0x20); },
    };
    await expect(readBoundedJsonBody(streamed, SEARCH_BATCH_BODY_MAX_BYTES)).rejects.toMatchObject({ status: 413 });
  });
});
