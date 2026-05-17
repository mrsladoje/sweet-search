/**
 * v6.2 LI input policy tests.
 *
 * Locks the language-family-conditioned routing so that:
 *   - Python and the Java family read chunk.li_text
 *   - JS family / Ruby / Go / unknown read chunk.embedding_text
 * and the byte content of li_text matches the per-language path policy
 * (no path for Python, slug-stripped path for Java family, full path
 * for everything else).
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { ASTChunker, JAVA_FAMILY, normalizePathSlug } from '../../core/indexing/ast-chunker.js';
import { pickLiInput, __TEST__ as indexerAnnTest } from '../../core/indexing/indexer-ann.js';
import { applyIndexingChunkPolicy, _internals as indexingPolicyInternals } from '../../core/indexing/indexing-file-policy.js';

const PROJECT_ROOT = process.cwd();

function makeChunk({ language, symbol = 'doStuff', file = 'src/x_abcdef12.ext', parent = null, content = 'function doStuff() { return 1; }' }) {
  const chunker = new ASTChunker({ projectRoot: PROJECT_ROOT });
  return chunker.buildChunk(
    content,
    `${PROJECT_ROOT}/${file}`,
    language,
    'function',
    symbol,
    0,
    5,
    parent,
  );
}

describe('LI text policy v6.2', () => {
  describe('normalizePathSlug', () => {
    it('strips trailing _<hex> slug from a basename', () => {
      expect(normalizePathSlug('repo/Table_366c13.js')).toBe('repo/Table.js');
      expect(normalizePathSlug('repo/parse_url_5b7c8d9e.py')).toBe('repo/parse_url.py');
    });
    it('leaves real-world paths untouched', () => {
      expect(normalizePathSlug('src/components/Button.tsx')).toBe('src/components/Button.tsx');
      expect(normalizePathSlug('lib/foo/bar.go')).toBe('lib/foo/bar.go');
    });
    it('does not strip non-hex slugs', () => {
      expect(normalizePathSlug('src/version_v2.js')).toBe('src/version_v2.js');
    });
    it('handles empty/null', () => {
      expect(normalizePathSlug('')).toBe('');
      expect(normalizePathSlug(null)).toBe(null);
    });
  });

  describe('JAVA_FAMILY membership', () => {
    it('contains Java, PHP, C#, Kotlin, Scala', () => {
      expect(JAVA_FAMILY.has('java')).toBe(true);
      expect(JAVA_FAMILY.has('php')).toBe(true);
      expect(JAVA_FAMILY.has('csharp')).toBe(true);
      expect(JAVA_FAMILY.has('c#')).toBe(true);
      expect(JAVA_FAMILY.has('kotlin')).toBe(true);
      expect(JAVA_FAMILY.has('scala')).toBe(true);
    });
    it('does not contain JS family / Ruby / Go / Python', () => {
      for (const l of ['python', 'javascript', 'typescript', 'jsx', 'tsx', 'ruby', 'go', 'c', 'cpp', 'rust']) {
        expect(JAVA_FAMILY.has(l)).toBe(false);
      }
    });
  });

  describe('chunk.li_text per-language path policy', () => {
    it('Python: no path line in li_text', () => {
      const c = makeChunk({ language: 'python', file: 'src/parse_url_abcdef12.py', symbol: 'parse_url' });
      expect(c.li_text).not.toMatch(/# .*\.py/);
      expect(c.li_text).toMatch(/# function: parse_url/);
      expect(c.li_text).toMatch(/# Language: python/);
    });

    it('Java: slug-stripped path in li_text', () => {
      const c = makeChunk({ language: 'java', file: 'app/Foo_abcdef12.java', symbol: 'doStuff', parent: { parentSymbol: 'Foo', parentType: 'class' } });
      expect(c.li_text).toMatch(/# app\/Foo\.java/);
      expect(c.li_text).not.toMatch(/_abcdef12/);
      expect(c.li_text).toMatch(/# Parent: class Foo/);
    });

    it('PHP, C#, Kotlin, Scala: also slug-stripped', () => {
      for (const lang of ['php', 'csharp', 'c#', 'kotlin', 'scala']) {
        const c = makeChunk({ language: lang, file: `app/Foo_abcdef12.ext`, symbol: 'doStuff' });
        expect(c.li_text).toMatch(/# app\/Foo\.ext/);
        expect(c.li_text).not.toMatch(/_abcdef12/);
      }
    });

    it('JavaScript / Ruby / Go: full raw path with slug', () => {
      for (const lang of ['javascript', 'ruby', 'go']) {
        const c = makeChunk({ language: lang, file: `repo/file_abcdef12.ext`, symbol: 'fn' });
        expect(c.li_text).toMatch(/# repo\/file_abcdef12\.ext/);
      }
    });
  });

  describe('pickLiInput routing', () => {
    it('Python and Java family route to chunk.li_text', () => {
      for (const lang of ['python', 'java', 'php', 'csharp', 'c#', 'kotlin', 'scala']) {
        const c = makeChunk({ language: lang, file: `src/x_abcdef12.ext`, symbol: 'fn' });
        expect(pickLiInput(c)).toBe(c.li_text);
      }
    });

    it('JS family / Ruby / Go route to chunk.embedding_text (greedy enriched)', () => {
      for (const lang of ['javascript', 'typescript', 'jsx', 'tsx', 'ruby', 'go', 'c', 'cpp', 'rust']) {
        const c = makeChunk({ language: lang, file: `src/x_abcdef12.ext`, symbol: 'fn' });
        expect(pickLiInput(c)).toBe(c.embedding_text);
      }
    });

    it('Unknown language falls back to chunk.embedding_text (greedy)', () => {
      const c = makeChunk({ language: 'someEsotericLang', file: `src/x.ext`, symbol: 'fn' });
      expect(pickLiInput(c)).toBe(c.embedding_text);
    });

    it('Falls back through embedding_text -> text -> content for missing fields', () => {
      const fakeChunk = { metadata: { language: 'javascript' }, embedding_text: null, text: 'raw', content: 'inner' };
      expect(pickLiInput(fakeChunk)).toBe('raw');
      const fakeChunk2 = { metadata: { language: 'javascript' }, embedding_text: null, text: null, content: 'inner' };
      expect(pickLiInput(fakeChunk2)).toBe('inner');
    });

    it('Routes by metadata.language even with no chunk-level lang field', () => {
      const c = makeChunk({ language: 'python', file: 'src/x.py', symbol: 'fn' });
      // Sanity: metadata.language is what pickLiInput reads
      expect(c.metadata.language).toBe('python');
      expect(pickLiInput(c)).toBe(c.li_text);
    });

    it('resolves canonical metadata paths before chunk.file for LI metadata', () => {
      expect(indexerAnnTest.chunkFilePath({
        file: 'x.py',
        metadata: { path: 'src/x.py', language: 'python' },
      })).toBe('src/x.py');
      expect(indexerAnnTest.chunkFilePath({
        file: 'ignored.py',
        metadata: { relative_path: 'pkg/x.py', path: 'src/x.py' },
      })).toBe('pkg/x.py');
    });

    it('ignores traversal-looking metadata paths before falling back to chunk.file', () => {
      expect(indexerAnnTest.chunkFilePath({
        file: 'http.js',
        metadata: { path: '../../../../private/var/tmp/project/http.js' },
      })).toBe('http.js');
    });
  });

  describe('byte-for-byte parity with greedy R2 for JS/Ruby/Go', () => {
    it('returns identical bytes to chunk.embedding_text for 20 sampled chunks', () => {
      const samples = Array.from({ length: 20 }, (_, i) => {
        const lang = ['javascript', 'ruby', 'go'][i % 3];
        return makeChunk({
          language: lang,
          file: `repo/sample${i}_abcdef12.ext`,
          symbol: `fn_${i}`,
          parent: i % 2 ? { parentSymbol: `Klass${i}`, parentType: 'class' } : null,
        });
      });
      for (const c of samples) {
        expect(pickLiInput(c)).toBe(c.embedding_text);
      }
    });
  });

  describe('shared indexing path policy', () => {
    it('applies LI skip patterns to canonical metadata paths before chunk.file', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweet-search-li-skip-'));
      const oldSkipFile = process.env.SWEET_SEARCH_LI_SKIP_FILE;
      try {
        const skipFile = path.join(tmpDir, 'li-skip.txt');
        await fs.writeFile(skipFile, 'src/generated/**\n');
        process.env.SWEET_SEARCH_LI_SKIP_FILE = skipFile;
        indexingPolicyInternals.resetCache();

        const result = applyIndexingChunkPolicy([{
          file: 'x.js',
          text: 'export const x = 1;',
          metadata: { path: 'src/generated/x.js' },
        }]);

        expect(result.kept).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(result.stats).toMatchObject({ excluded: 1, skippedFiles: 1 });
      } finally {
        if (oldSkipFile === undefined) delete process.env.SWEET_SEARCH_LI_SKIP_FILE;
        else process.env.SWEET_SEARCH_LI_SKIP_FILE = oldSkipFile;
        indexingPolicyInternals.resetCache();
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('does not let unsafe metadata paths drive LI skip decisions', () => {
      const chunk = {
        file: 'safe/x.js',
        text: 'export const x = 1;',
        metadata: { path: '../src/generated/x.js' },
      };

      expect(indexingPolicyInternals.chunkPath(chunk)).toBe('safe/x.js');
    });
  });
});
