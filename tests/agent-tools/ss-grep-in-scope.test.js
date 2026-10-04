/**
 * `--in` is root-anchored when the scope exists at the repository root.
 *
 * r3-grdb: `Tests/CustomSQLite/GRDB -> ../..` puts a copy of the whole repository under
 * Tests/, and the index followed it. `--in GRDB/Core/TransactionObserver.swift` matched its
 * segments anywhere in a path, so 33 copies of the file answered (1,716 hits). A scope that
 * exists at the root now means that path only; a scope that does not keeps the segment match.
 * Unit tests of the predicate, then the real tool and engine on a fixture with the same loop.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bareGrep } from '../../core/search/index.js';
import { runInVirtualProcess } from '../../core/agent-tools/virtual-process.js';
import { grepHitCount } from './grep-listing-helpers.js';
import { runAgentTool } from '../../eval/agent-read-workflows/bin/_ss-helpers.mjs';
import { grepFileFilterPredicate, matchesGrepFileFilter } from '../../core/search/grep-output-shaping.js';
import {
  buildSparseGramIndexArtifact, hasNativeSparseGramSupport,
} from '../../core/infrastructure/native-sparse-gram.js';
import { isRipgrepAvailable } from '../../core/search/search-pattern-ripgrep.js';

const OBSERVER = 'GRDB/Core/TransactionObserver.swift';
const NESTED = `Tests/CustomSQLite/GRDB/${OBSERVER}`;

let base;
let root;

beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-grep-in-scope-')));
  root = path.join(base, 'repo');
  mkdirSync(path.join(root, 'GRDB', 'Core'), { recursive: true });
  mkdirSync(path.join(root, 'Tests', 'CustomSQLite'), { recursive: true });
  mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(root, '.sweet-search', 'codebase.db'), '');
  writeFileSync(path.join(root, OBSERVER),
    'sqlite3_commit_hook(db, a)\nlet x = 1\nsqlite3_commit_hook(db, b)\nsqlite3_commit_hook(db, c)\n');
  writeFileSync(path.join(root, 'GRDB/Core/Database.swift'), '// sqlite3_commit_hook is set in the observer\n');
  symlinkSync('../..', path.join(root, 'Tests', 'CustomSQLite', 'GRDB'));
});

afterAll(() => {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('grepFileFilterPredicate: root-anchored when the scope exists at the root', () => {
  it('a file or directory at the root matches only itself, not a nested copy', () => {
    expect(matchesGrepFileFilter(OBSERVER, OBSERVER, root)).toBe(true);
    expect(matchesGrepFileFilter(NESTED, OBSERVER, root)).toBe(false);
    expect(matchesGrepFileFilter(`./${OBSERVER}`, `./${OBSERVER}`, root)).toBe(true);
    const inCore = grepFileFilterPredicate('GRDB/Core', root);
    expect(inCore('GRDB/Core/Database.swift')).toBe(true);
    expect(inCore('Tests/CustomSQLite/GRDB/GRDB/Core/Database.swift')).toBe(false);
    expect(inCore('GRDB/CoreData/x.swift')).toBe(false);
  });

  it('a scope that does not exist at the root keeps the segment match', () => {
    expect(matchesGrepFileFilter(OBSERVER, 'Core/TransactionObserver.swift', root)).toBe(true);
    expect(matchesGrepFileFilter(NESTED, 'Core/TransactionObserver.swift', root)).toBe(true);
    expect(matchesGrepFileFilter(NESTED, 'TransactionObserver.swift', root)).toBe(true);
  });

  it('without a root, or with several scopes, each scope keeps its own rule', () => {
    expect(matchesGrepFileFilter(NESTED, OBSERVER)).toBe(true);           // no root: segment match
    const either = grepFileFilterPredicate([OBSERVER, 'Database.swift'], root);
    expect(either(OBSERVER)).toBe(true);
    expect(either(NESTED)).toBe(false);
    expect(either('Tests/CustomSQLite/GRDB/GRDB/Core/Database.swift')).toBe(true);
  });
});

describe('ss-grep --in on a repository that contains a copy of itself (real engine)', () => {
  const searchers = {};

  beforeAll(async () => {
    const make = (sparseGramIndexPath) => ({
      projectRoot: root, sparseGramIndexPath, hasLateInteractionIndex: false,
      async bareGrep(q, r, o) { return bareGrep.call(this, q, r, o); },
    });
    if (hasNativeSparseGramSupport()) {
      // The index lists the copies, as the r3-grdb index did.
      const files = [OBSERVER, 'GRDB/Core/Database.swift', NESTED, 'Tests/CustomSQLite/GRDB/GRDB/Core/Database.swift'];
      const indexPath = path.join(root, '.sweet-search', 'codebase-sparse-grams.idx');
      buildSparseGramIndexArtifact({ projectRoot: root, files, outputPath: indexPath });
      searchers.gram = make(indexPath);
    }
    if (await isRipgrepAvailable()) searchers.ripgrep = make(path.join(base, 'absent.idx'));
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
    return { n: grepHitCount(out), out };
  }

  it('gram path: a root path scope returns the root file only', async (ctx) => {
    if (!searchers.gram) ctx.skip();
    // The index lists the loop copies; grep drops every hit reached through the symlink.
    expect((await total(searchers.gram, ['sqlite3_commit_hook'])).n).toBe(4);
    const one = await total(searchers.gram, ['sqlite3_commit_hook', '--in', OBSERVER]);
    expect(one.n).toBe(3);
    expect(one.out).not.toContain('Tests/');
    expect((await total(searchers.gram, ['sqlite3_commit_hook', '--in', 'GRDB/Core'])).n).toBe(4);
    // not at the root: the segment match, which no longer sees the loop copies
    expect((await total(searchers.gram, ['sqlite3_commit_hook', '--in', 'Core/TransactionObserver.swift'])).n).toBe(3);
  });

  it('a correct zero (`statementDidFail\\(`, unpaired escaped paren) prints no regex note', async () => {
    for (const searcher of Object.values(searchers)) {
      const zero = await total(searcher, ['statementDidFail\\(', '--in', 'GRDB/Core/Database.swift']);
      expect(zero.n).toBe(0);
      expect(zero.out).toContain('(no matches)');
      expect(zero.out).not.toContain('regex note');
    }
  }, 60_000); // a zero also runs the unindexed-file fallback; slow on a loaded machine

  it('ripgrep path: the same scopes give the root file', async (ctx) => {
    if (!searchers.ripgrep) ctx.skip();
    expect((await total(searchers.ripgrep, ['sqlite3_commit_hook', '--in', OBSERVER])).n).toBe(3);
    expect((await total(searchers.ripgrep, ['sqlite3_commit_hook', '--in', 'GRDB/Core'])).n).toBe(4);
  });
});
