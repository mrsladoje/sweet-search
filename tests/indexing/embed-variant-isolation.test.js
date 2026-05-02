/**
 * Locks invariants for the embedding-text variant switch
 * (SWEET_SEARCH_EMBED_TEXT_VARIANT) — research-only infrastructure.
 *
 * Production guarantees these tests enforce:
 *   1. With env unset (or set to 'current'), embedding_text and
 *      li_greedy_text are byte-identical to shipped v6.2.
 *   2. With ANY variant active, the LI input for non-Python/Java
 *      languages remains byte-identical to what shipped v6.2 would
 *      have used. (LI input cannot drift from shipped under research
 *      ablations.)
 *   3. embedding_text DOES change under non-current variants
 *      (otherwise the experiment switch is broken).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import { pickLiInput } from '../../core/indexing/indexer-ann.js';

const ROOT = '/Users/admin/Projects/sweet-search-private';
const ENV_KEY = 'SWEET_SEARCH_EMBED_TEXT_VARIANT';

const NON_PYJVA_LANGS = ['javascript', 'typescript', 'jsx', 'tsx', 'ruby', 'go', 'c', 'cpp', 'rust'];
const ALL_VARIANTS = [
  'current', 'no_path', 'normalized_path', 'no_language',
  'parent_only', 'enriched', 'code_breadcrumb',
];

function buildChunk({ language, sym = 'doStuff', file = 'src/x_abcdef12.ext', parent = null, content = 'function doStuff() { return 1; }' }) {
  const c = new ASTChunker({ projectRoot: ROOT });
  return c.buildChunk(content, `${ROOT}/${file}`, language, 'function', sym, 0, 5, parent);
}

describe('embedding-text variant — isolation invariants', () => {
  let savedEnv;
  beforeEach(() => { savedEnv = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedEnv;
  });

  describe('default (env unset) === shipped v6.2 behavior', () => {
    it('embedding_text is identical with env unset vs explicit current', () => {
      delete process.env[ENV_KEY];
      const a = buildChunk({ language: 'javascript', file: 'src/repo/Foo_abcdef12.js', sym: 'foo' });
      process.env[ENV_KEY] = 'current';
      const b = buildChunk({ language: 'javascript', file: 'src/repo/Foo_abcdef12.js', sym: 'foo' });
      expect(a.embedding_text).toBe(b.embedding_text);
    });

    it('embedding_text === li_greedy_text under variant=current', () => {
      process.env[ENV_KEY] = 'current';
      for (const lang of ['python', ...NON_PYJVA_LANGS, 'java', 'php']) {
        const ch = buildChunk({ language: lang, file: `src/repo/Foo_abcdef12.${lang.slice(0,2)}`, sym: 'foo' });
        expect(ch.embedding_text).toBe(ch.li_greedy_text);
      }
    });

    it('explicit variant=current produces shipped-format text (path + Parent + symbol + Language)', () => {
      process.env[ENV_KEY] = 'current';
      const ch = buildChunk({
        language: 'javascript',
        file: 'src/repo/Foo_abcdef12.js',
        sym: 'handleClick',
        parent: { parentSymbol: 'Foo', parentType: 'class' },
      });
      // Order is path → Parent → function → Language → body
      expect(ch.embedding_text).toMatch(/^# src\/repo\/Foo_abcdef12\.js\n# Parent: class Foo\n# function: handleClick\n# Language: javascript\n/);
    });
  });

  describe('LI input byte-stable across variants for non-Python/Java langs', () => {
    it.each(NON_PYJVA_LANGS)('LI(%s) is identical for all 7 variants', (lang) => {
      const file = `src/Repo/Foo_abcdef12.${lang === 'go' ? 'go' : 'js'}`;
      const inputs = ALL_VARIANTS.map(v => {
        process.env[ENV_KEY] = v;
        const ch = buildChunk({ language: lang, file, sym: 'fn', parent: { parentSymbol: 'Klass', parentType: 'class' } });
        return pickLiInput(ch);
      });
      for (let i = 1; i < inputs.length; i++) {
        expect(inputs[i]).toBe(inputs[0]);
      }
    });

    it('LI input under any variant equals LI input under variant=current', () => {
      process.env[ENV_KEY] = 'current';
      const baseline = buildChunk({ language: 'javascript', file: 'src/repo/X_abcdef12.js', sym: 'fn', parent: { parentSymbol: 'K', parentType: 'class' } });
      const baselineLi = pickLiInput(baseline);

      for (const v of ALL_VARIANTS.filter(x => x !== 'current')) {
        process.env[ENV_KEY] = v;
        const ch = buildChunk({ language: 'javascript', file: 'src/repo/X_abcdef12.js', sym: 'fn', parent: { parentSymbol: 'K', parentType: 'class' } });
        expect(pickLiInput(ch)).toBe(baselineLi);
      }
    });
  });

  describe('embedding_text DOES change under non-current variants', () => {
    it('normalized_path strips the slug from the path line', () => {
      process.env[ENV_KEY] = 'current';
      const a = buildChunk({ language: 'javascript', file: 'src/Repo/Foo_abcdef12.js', sym: 'fn' });
      process.env[ENV_KEY] = 'normalized_path';
      const b = buildChunk({ language: 'javascript', file: 'src/Repo/Foo_abcdef12.js', sym: 'fn' });
      expect(a.embedding_text).not.toBe(b.embedding_text);
      expect(b.embedding_text).toMatch(/# src\/Repo\/Foo\.js\n/);
      expect(b.embedding_text).not.toMatch(/_abcdef12/);
    });

    it('no_path drops the path line', () => {
      process.env[ENV_KEY] = 'no_path';
      const ch = buildChunk({ language: 'javascript', file: 'src/Repo/Foo_abcdef12.js', sym: 'fn' });
      expect(ch.embedding_text.startsWith('# function:')).toBe(true);
    });

    it('parent_only keeps only path + parent', () => {
      process.env[ENV_KEY] = 'parent_only';
      const ch = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'fn', parent: { parentSymbol: 'Klass', parentType: 'class' } });
      expect(ch.embedding_text).toMatch(/^# src\/Foo\.js\n# Parent: class Klass\nfunction doStuff/);
      expect(ch.embedding_text).not.toMatch(/# Language:/);
      expect(ch.embedding_text).not.toMatch(/# function:/);
    });

    it('code_breadcrumb uses Parent.symbol for JS and Parent::symbol for Ruby', () => {
      process.env[ENV_KEY] = 'code_breadcrumb';
      const js = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'click', parent: { parentSymbol: 'Foo', parentType: 'class' } });
      expect(js.embedding_text).toMatch(/# Foo\.click\n/);
      const rb = buildChunk({ language: 'ruby', file: 'src/Foo.rb', sym: 'click', parent: { parentSymbol: 'Foo', parentType: 'class' } });
      expect(rb.embedding_text).toMatch(/# Foo::click\n/);
    });

    it('enriched at buildChunk-time matches current; differs only after enrichEmbeddingText runs with scope/imports', () => {
      process.env[ENV_KEY] = 'enriched';
      const a = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'fn' });
      process.env[ENV_KEY] = 'current';
      const b = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'fn' });
      expect(a.embedding_text).toBe(b.embedding_text);
    });
  });

  describe('unknown variant falls back to current', () => {
    it('a junk env value behaves identically to current', () => {
      process.env[ENV_KEY] = 'this-variant-does-not-exist';
      const a = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'fn' });
      process.env[ENV_KEY] = 'current';
      const b = buildChunk({ language: 'javascript', file: 'src/Foo.js', sym: 'fn' });
      expect(a.embedding_text).toBe(b.embedding_text);
    });
  });
});
