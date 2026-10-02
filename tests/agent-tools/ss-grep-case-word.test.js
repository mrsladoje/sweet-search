/**
 * ss-grep -i, -w and -i -w through the real tool code and the real engine: a real sparse gram
 * index built over a temp fixture (the unified native path), and the ripgrep path (no index).
 * Nothing is mocked. `-i -w` used to return 0 on both paths: the JS literal extractor turned
 * `(?i)\b(?:express)\b` into ":express", which the gram index proved absent and `rg -F -i`
 * found nowhere.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bareGrep } from '../../core/search/index.js';
import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';
import {
  buildSparseGramIndexArtifact, hasNativeSparseGramSupport,
} from '../../core/infrastructure/native-sparse-gram.js';
import { isRipgrepAvailable } from '../../core/search/search-pattern-ripgrep.js';

const FILES = {
  'lib/app.js': [
    "const express = require('express');",
    '// Express app',
    'const EXPRESS_MODE = 1;',
    'function expressive() {}',
    'module.exports = express;',
  ],
  'lib/router.js': ["const Route = require('./route');", '// express router'],
  'test/app.test.js': ["require('express');", "describe('Express', () => {});"],
  'docs/notes.js': ['// Express is used here.'],
  // U+212A KELVIN SIGN: `(?i)kind` matches it; the ASCII-folded gram index cannot see it.
  'lib/unit.js': ["const unit = 'Kind';"],
};

let base;
let root;
const searchers = {};

beforeAll(async () => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-case-word-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  for (const [rel, lines] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `${lines.join('\n')}\n`);
  }
  const make = (sparseGramIndexPath) => ({
    projectRoot: root, sparseGramIndexPath, hasLateInteractionIndex: false,
    async bareGrep(q, r, o) { return bareGrep.call(this, q, r, o); },
  });
  if (hasNativeSparseGramSupport()) {
    const indexPath = path.join(root, '.sweet-search', 'codebase-sparse-grams.idx');
    buildSparseGramIndexArtifact({ projectRoot: root, files: Object.keys(FILES), outputPath: indexPath });
    searchers.gram = make(indexPath);
  }
  if (await isRipgrepAvailable()) searchers.ripgrep = make(path.join(base, 'absent.idx'));
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function total(searcher, args) {
  const env = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: root,
    SWEET_SEARCH_SOCKET_PATH: path.join(base, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: path.join(base, 'runtime'),
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0', SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
  };
  const r = await runInVirtualProcess({ env, cwd: root },
    () => runAgentTool('grep', args, { getSearcher: () => searcher }));
  const out = r.stdout.toString('utf8');
  const m = /^# ss-grep: (\d+) total match/.exec(out);
  expect(m, out).not.toBeNull();
  return Number(m[1]);
}

// Hit lines per call, counted by hand from FILES (one hit per line).
const CASES = [
  [['express'], 5],
  [['express', '-w'], 4],
  [['express', '-i'], 9],
  [['express', '-i', '-w'], 7],
  [['express', '-iw'], 7],
  [['express', '-i', '-w', '--in', 'lib'], 4],
  [['express', '-i', '-w', '-g', 'lib/*.js'], 4],
  [['express', '-i', '-w', '-g', '!test/**'], 5],
  [['require', '-i', '-w'], 3],
  [['route', '-i', '-w'], 1],
  [['Route', '-w'], 1],
  [['kind', '-i'], 1],
];

for (const pathName of ['gram', 'ripgrep']) {
  describe(`ss-grep -i / -w on the ${pathName} path (real engine)`, () => {
    for (const [args, expected] of CASES) {
      it(`${args.join(' ')} -> ${expected}`, async (ctx) => {
        if (!searchers[pathName]) ctx.skip();
        expect(await total(searchers[pathName], args)).toBe(expected);
      });
    }
  });
}
