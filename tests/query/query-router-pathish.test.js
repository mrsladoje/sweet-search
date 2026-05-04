/**
 * Path / file fast-path tests for the production query router.
 *
 * Bug being prevented: the previous fast-path used `/[/\\]/.test(query)`, which
 * fired for any slash and incorrectly routed natural-language queries like
 * "HTTP/2 server setup" to lexical. This suite locks the new heuristic in:
 *
 *   - extension-anchored OR slash-without-whitespace -> lexical fast-path
 *   - natural-language slash phrases -> fall through to the WASM model
 */

import { describe, it, expect } from 'vitest';
import { looksLikePath, routeQuery } from '../../core/query/query-router.js';

const TRUE_PATHS = [
  'src/index.js',
  'core/query/query-router.js',
  'package.json',
  'README.md',
  'foo/bar',
  'foo\\bar',
  '*.test.js',
  'src/server/index.ts',
  'tests/query/query-router-pathish.test.js',
  '.sweet-search/codebase.db',
  './scripts/run.sh',
  '../config/settings.yaml',
];

const NATURAL_LANGUAGE_SLASHES = [
  'HTTP/2 server setup',
  'file/function relationship',
  'and/or behavior',
  'request/response lifecycle',
  'TCP/IP stack overview',
  'how does I/O scheduling work',
  'client/server architecture',
];

const NON_PATH_PLAIN = [
  'AuthService',
  'getUserById',
  'how does authentication work',
  'jwt token',
  'MAX_CONNECTION_POOL_SIZE',
];

describe('looksLikePath helper', () => {
  it('classifies true paths as path-like', () => {
    for (const q of TRUE_PATHS) {
      expect(looksLikePath(q), `expected "${q}" to look like a path`).toBe(true);
    }
  });

  it('does NOT classify natural-language slash phrases as paths', () => {
    for (const q of NATURAL_LANGUAGE_SLASHES) {
      expect(looksLikePath(q), `expected "${q}" to NOT look like a path`).toBe(false);
    }
  });

  it('does NOT classify plain identifier / NL queries as paths', () => {
    for (const q of NON_PATH_PLAIN) {
      expect(looksLikePath(q), `expected "${q}" to NOT look like a path`).toBe(false);
    }
  });

  it('returns false for empty / whitespace inputs', () => {
    expect(looksLikePath('')).toBe(false);
    expect(looksLikePath('   ')).toBe(false);
  });
});

describe('routeQuery — path fast-path attribution', () => {
  it('routes true paths to lexical via file_pattern', () => {
    for (const q of TRUE_PATHS) {
      const r = routeQuery(q);
      expect(r.mode, `path "${q}" should route to lexical`).toBe('lexical');
      expect(r.method, `path "${q}" should be attributed to file_pattern`).toBe('file_pattern');
    }
  });

  it('does NOT fast-path natural-language slash phrases to lexical/file_pattern', () => {
    for (const q of NATURAL_LANGUAGE_SLASHES) {
      const r = routeQuery(q);
      expect(r.method, `"${q}" should not be attributed to file_pattern`).not.toBe('file_pattern');
      // Either WASM picks any of the three classes, or the reject option folds
      // it to hybrid; the only thing we forbid is the fast-path lexical claim.
      expect(['lexical', 'semantic', 'hybrid']).toContain(r.mode);
    }
  });

  it('reports a routingLatency_us for every result shape', () => {
    for (const q of [...TRUE_PATHS, ...NATURAL_LANGUAGE_SLASHES, ...NON_PATH_PLAIN]) {
      const r = routeQuery(q);
      expect(typeof r.routingLatency_us).toBe('number');
      expect(r.routingLatency_us).toBeGreaterThanOrEqual(0);
    }
  });
});
