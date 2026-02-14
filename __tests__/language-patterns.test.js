/**
 * Language Patterns Registry Tests
 *
 * Tests for core/language-patterns.js:
 * - Extension mapping (70+ extensions → 37 language IDs)
 * - Filename mapping (Dockerfile, Makefile)
 * - Chunker pattern matching per language
 * - Graph pattern entity/relationship extraction
 * - API functions (getLanguageByPath, getChunkerPatterns, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  EXTENSION_MAP,
  FILENAME_MAP,
  getLanguageByExtension,
  getLanguageByPath,
  getChunkerPatterns,
  getGraphPatterns,
  getLanguageMeta,
  getSupportedExtensions,
  isIndentBased,
  getRegisteredLanguages,
} from '../core/language-patterns.js';

// =============================================================================
// EXTENSION MAPPING
// =============================================================================

describe('EXTENSION_MAP', () => {
  it('maps common extensions', () => {
    expect(EXTENSION_MAP['.js']).toBe('javascript');
    expect(EXTENSION_MAP['.ts']).toBe('javascript');
    expect(EXTENSION_MAP['.java']).toBe('java');
    expect(EXTENSION_MAP['.py']).toBe('python');
    expect(EXTENSION_MAP['.go']).toBe('go');
    expect(EXTENSION_MAP['.rs']).toBe('rust');
    expect(EXTENSION_MAP['.proto']).toBe('proto');
  });

  it('maps C/C++ variants', () => {
    expect(EXTENSION_MAP['.c']).toBe('c');
    expect(EXTENSION_MAP['.h']).toBe('c');
    expect(EXTENSION_MAP['.cpp']).toBe('cpp');
    expect(EXTENSION_MAP['.cc']).toBe('cpp');
    expect(EXTENSION_MAP['.hpp']).toBe('cpp');
  });

  it('maps web/style languages', () => {
    expect(EXTENSION_MAP['.html']).toBe('html');
    expect(EXTENSION_MAP['.css']).toBe('css');
    expect(EXTENSION_MAP['.scss']).toBe('scss');
    expect(EXTENSION_MAP['.less']).toBe('less');
  });

  it('maps config/data formats', () => {
    expect(EXTENSION_MAP['.json']).toBe('json');
    expect(EXTENSION_MAP['.yaml']).toBe('yaml');
    expect(EXTENSION_MAP['.yml']).toBe('yaml');
    expect(EXTENSION_MAP['.toml']).toBe('toml');
    expect(EXTENSION_MAP['.xml']).toBe('xml');
  });

  it('maps JVM languages', () => {
    expect(EXTENSION_MAP['.kt']).toBe('kotlin');
    expect(EXTENSION_MAP['.scala']).toBe('scala');
    expect(EXTENSION_MAP['.groovy']).toBe('groovy');
  });

  it('has at least 60 extensions', () => {
    expect(Object.keys(EXTENSION_MAP).length).toBeGreaterThanOrEqual(60);
  });
});

describe('FILENAME_MAP', () => {
  it('maps Dockerfile', () => {
    expect(FILENAME_MAP['Dockerfile']).toBe('dockerfile');
  });

  it('maps Makefile variants', () => {
    expect(FILENAME_MAP['Makefile']).toBe('makefile');
    expect(FILENAME_MAP['GNUmakefile']).toBe('makefile');
  });
});

// =============================================================================
// API FUNCTIONS
// =============================================================================

describe('getLanguageByExtension', () => {
  it('resolves known extensions', () => {
    const result = getLanguageByExtension('.py');
    expect(result).not.toBeNull();
    expect(result.id).toBe('python');
    expect(result.indentBased).toBe(true);
  });

  it('returns null for unknown extensions', () => {
    expect(getLanguageByExtension('.xyz')).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = getLanguageByExtension('.PY');
    expect(result).not.toBeNull();
    expect(result.id).toBe('python');
  });
});

describe('getLanguageByPath', () => {
  it('resolves by extension', () => {
    const result = getLanguageByPath('/foo/bar.java');
    expect(result.id).toBe('java');
  });

  it('resolves Dockerfile by filename', () => {
    const result = getLanguageByPath('/app/Dockerfile');
    expect(result).not.toBeNull();
    expect(result.id).toBe('dockerfile');
  });

  it('resolves Dockerfile.prod by prefix match', () => {
    const result = getLanguageByPath('/app/Dockerfile.prod');
    expect(result).not.toBeNull();
    expect(result.id).toBe('dockerfile');
  });

  it('returns null for unknown files', () => {
    expect(getLanguageByPath('/foo/README')).toBeNull();
  });

  it('includes chunker patterns when available', () => {
    const result = getLanguageByPath('/foo/main.go');
    expect(result.chunker).not.toBeNull();
    expect(result.chunker.function).toBeInstanceOf(RegExp);
  });
});

describe('getChunkerPatterns', () => {
  it('returns patterns for registered languages', () => {
    const patterns = getChunkerPatterns('python');
    expect(patterns).not.toBeNull();
    expect(patterns.class).toBeInstanceOf(RegExp);
    expect(patterns.function).toBeInstanceOf(RegExp);
  });

  it('returns null for unknown languages', () => {
    expect(getChunkerPatterns('cobol')).toBeNull();
  });
});

describe('getGraphPatterns', () => {
  it('returns graph patterns for registered languages', () => {
    const patterns = getGraphPatterns('go');
    expect(patterns).not.toBeNull();
    expect(patterns.entities).toBeDefined();
    expect(patterns.relationships).toBeDefined();
    expect(patterns.entities.function).toBeInstanceOf(RegExp);
  });

  it('returns null for unknown languages', () => {
    expect(getGraphPatterns('cobol')).toBeNull();
  });
});

describe('getLanguageMeta', () => {
  it('returns metadata for registered languages', () => {
    const meta = getLanguageMeta('ruby');
    expect(meta).not.toBeNull();
    expect(meta.endKeyword).toBe('end');
    expect(meta.comment.line).toBe('#');
  });

  it('identifies indent-based languages', () => {
    const meta = getLanguageMeta('python');
    expect(meta.indentBased).toBe(true);
    expect(meta.endKeyword).toBeNull();
  });
});

describe('getSupportedExtensions', () => {
  it('returns array of extensions', () => {
    const exts = getSupportedExtensions();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThanOrEqual(60);
    expect(exts).toContain('.js');
    expect(exts).toContain('.py');
    expect(exts).toContain('.go');
  });
});

describe('isIndentBased', () => {
  it('returns true for Python', () => {
    expect(isIndentBased('python')).toBe(true);
  });

  it('returns true for YAML', () => {
    expect(isIndentBased('yaml')).toBe(true);
  });

  it('returns false for Java', () => {
    expect(isIndentBased('java')).toBe(false);
  });

  it('returns false for unknown', () => {
    expect(isIndentBased('cobol')).toBe(false);
  });
});

describe('getRegisteredLanguages', () => {
  it('returns at least 30 languages', () => {
    const langs = getRegisteredLanguages();
    expect(langs.length).toBeGreaterThanOrEqual(30);
  });

  it('includes core languages', () => {
    const langs = getRegisteredLanguages();
    expect(langs).toContain('javascript');
    expect(langs).toContain('java');
    expect(langs).toContain('python');
    expect(langs).toContain('go');
    expect(langs).toContain('rust');
  });
});

// =============================================================================
// PATTERN MATCHING VERIFICATION
// =============================================================================

describe('chunker pattern matching', () => {
  it('Python class pattern matches', () => {
    const p = getChunkerPatterns('python');
    expect('class MyApp(Base):'.match(p.class)?.[1]).toBe('MyApp');
  });

  it('Python function pattern matches indented def', () => {
    const p = getChunkerPatterns('python');
    expect('def run(self):'.match(p.function)?.[1]).toBe('run');
    expect('async def fetch(url):'.match(p.function)?.[1]).toBe('fetch');
  });

  it('Go struct pattern matches', () => {
    const p = getChunkerPatterns('go');
    expect('type Server struct {'.match(p.struct)?.[1]).toBe('Server');
  });

  it('Rust function pattern matches', () => {
    const p = getChunkerPatterns('rust');
    expect('pub fn new() -> Self {'.match(p.function)?.[1]).toBe('new');
    expect('fn helper(x: i32) {'.match(p.function)?.[1]).toBe('helper');
  });

  it('Rust impl chunker captures impl target type in group 1', () => {
    const p = getChunkerPatterns('rust');
    expect('impl User {'.match(p.impl)?.[1]).toBe('User');
    expect('impl Validator for User {'.match(p.impl)?.[1]).toBe('User');
  });
});

describe('graph entity pattern matching', () => {
  it('Go function captures name in group 1', () => {
    const p = getGraphPatterns('go');
    expect('func main() {'.match(p.entities.function)?.[1]).toBe('main');
  });

  it('Go method captures method name in group 1', () => {
    const p = getGraphPatterns('go');
    expect('func (s *Server) Start() {'.match(p.entities.method)?.[1]).toBe('Start');
  });

  it('Rust struct captures name', () => {
    const p = getGraphPatterns('rust');
    expect('pub struct Config {'.match(p.entities.struct)?.[1]).toBe('Config');
  });

  it('SQL table captures name', () => {
    const p = getGraphPatterns('sql');
    expect('CREATE TABLE users ('.match(p.entities.table)?.[1]).toBe('users');
  });
});
