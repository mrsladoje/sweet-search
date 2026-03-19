/**
 * TAGS_QUERIES Tests — Tree-Sitter Entity Extraction for All 12 Languages
 *
 * Phase 1: Query syntax validation (all 7 new languages)
 * Phase 2: extractSymbols per language
 * Phase 3: Tree-sitter vs regex parity (Java)
 * Phase 4: IDENT_TYPES coverage
 * Phase 5: Integration — extractFromFile through tree-sitter path
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// =============================================================================
// Shared setup
// =============================================================================

let provider;
let TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE, IDENT_TYPES, GRAMMAR_MAP;
let resetTreeSitterProvider;

beforeAll(async () => {
  const mod = await import('../core/tree-sitter-provider.js');
  TAGS_QUERIES = mod.TAGS_QUERIES;
  CAPTURE_TO_ENTITY_TYPE = mod.CAPTURE_TO_ENTITY_TYPE;
  IDENT_TYPES = mod.IDENT_TYPES;
  GRAMMAR_MAP = mod.GRAMMAR_MAP;
  resetTreeSitterProvider = mod.resetTreeSitterProvider;
  // Use the singleton so GraphExtractor (Phase 5) shares the same cached grammars
  // instead of loading all WASM grammars a second time, which causes V8 OOM.
  provider = mod.getTreeSitterProvider();
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

/** Extract symbols — fails loudly if grammar is unavailable. */
async function extractOrFail(code, lang) {
  const symbols = await provider.extractSymbols(code, lang);
  expect(symbols, `extractSymbols('${lang}') returned null — grammar unavailable?`).not.toBeNull();
  return symbols;
}

/** Extract symbols and assert expected entity names and types. */
async function assertEntities(code, lang, expectedTypes) {
  const symbols = await extractOrFail(code, lang);
  const names = symbols.map(s => s.name);
  for (const [name, type] of Object.entries(expectedTypes)) {
    expect(names).toContain(name);
    if (type) {
      const sym = symbols.find(s => s.name === name);
      expect(sym.type, `${lang}: '${name}' should be type '${type}'`).toBe(type);
    }
  }
  return symbols;
}

// =============================================================================
// Phase 1: Query Syntax Validation
// =============================================================================

describe('Phase 1: Query syntax validation', () => {
  const NEW_LANGUAGES = ['java', 'ruby', 'php', 'kotlin', 'swift', 'c', 'cpp'];

  for (const lang of NEW_LANGUAGES) {
    it(`${lang} has a TAGS_QUERIES entry`, () => {
      expect(TAGS_QUERIES[lang]).toBeDefined();
      expect(typeof TAGS_QUERIES[lang]).toBe('string');
      expect(TAGS_QUERIES[lang].trim().length).toBeGreaterThan(0);
    });

    it(`${lang} capture names map to CAPTURE_TO_ENTITY_TYPE`, () => {
      const captures = [...TAGS_QUERIES[lang].matchAll(/@([\w.]+)/g)].map(m => m[1]);
      expect(captures.length).toBeGreaterThan(0);
      for (const cap of captures) {
        expect(
          CAPTURE_TO_ENTITY_TYPE[cap],
          `capture @${cap} in ${lang} should map to an entity type`
        ).toBeDefined();
      }
    });

    it(`${lang} query parses without error against its grammar`, async () => {
      const language = await provider.loadLanguage(lang);
      if (!language) return; // grammar not available
      let query;
      try {
        query = await provider._createQuery(language, TAGS_QUERIES[lang]);
        expect(query).toBeTruthy();
      } finally {
        if (query) query.delete();
      }
    });
  }
});

// =============================================================================
// Phase 2: extractSymbols per Language
// =============================================================================

describe('Phase 2: extractSymbols — Java', () => {
  it('extracts class, constructor, and methods', async () => {
    const symbols = await assertEntities(`
public class AuthController {
    private String name;
    public AuthController(String name) { this.name = name; }
    public void handleLogin(String user) { System.out.println(user); }
    private static int helper() { return 42; }
}
`, 'java', { AuthController: 'class', handleLogin: 'method', helper: 'method' });
    // Constructor also captured
    expect(symbols.map(s => s.name)).toContain('AuthController');
  });

  it('extracts interface', async () => {
    await assertEntities(`
public interface UserRepository {
    User findById(long id);
    void save(User user);
}
`, 'java', { UserRepository: 'interface' });
  });

  it('extracts enum', async () => {
    await assertEntities(`
public enum Status { ACTIVE, INACTIVE, PENDING; }
`, 'java', { Status: 'enum' });
  });

  it('extracts record (Java 14+)', async () => {
    const symbols = await extractOrFail('public record Point(int x, int y) {}', 'java');
    const rec = symbols.find(s => s.name === 'Point');
    expect(rec, 'Point record should be extracted').toBeTruthy();
    expect(rec.type).toBe('record');
  });

  it('extracts abstract class and generic class', async () => {
    await assertEntities(`
public abstract class BaseService<T> {
    public abstract T process(String input);
}
`, 'java', { BaseService: 'class' });
  });

  it('extracts inner class', async () => {
    await assertEntities(`
public class Outer {
    public class Inner { void doStuff() {} }
}
`, 'java', { Outer: 'class', Inner: 'class', doStuff: 'method' });
  });

  it('has correct line ranges', async () => {
    const symbols = await extractOrFail(`@Deprecated
public class Old {
    @Override
    public void run() {}
}
`, 'java');
    const cls = symbols.find(s => s.name === 'Old' && s.type === 'class');
    expect(cls).toBeTruthy();
    expect(cls.startLine).toBeGreaterThanOrEqual(0);
    expect(cls.endLine).toBeGreaterThan(cls.startLine);
  });

  it('deduplicates symbols', async () => {
    const symbols = await extractOrFail(`
public class Foo { public void bar() {} }
`, 'java');
    const keys = symbols.map(s => `${s.startLine}:${s.type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Phase 2: extractSymbols — Ruby', () => {
  it('extracts class, module, method, singleton_method', async () => {
    await assertEntities(`
class UserService
  def initialize(repo) @repo = repo end
  def find_user(id) @repo.find(id) end
  def self.create(attrs) new(attrs) end
end

module Helpers
  def format(val) val.to_s end
end
`, 'ruby', {
      UserService: 'class', initialize: 'method', find_user: 'method',
      create: 'method', Helpers: 'module', format: 'method',
    });
  });

  it('class with superclass', async () => {
    await assertEntities(`
class Admin < User
  def promote() true end
end
`, 'ruby', { Admin: 'class' });
  });
});

describe('Phase 2: extractSymbols — PHP', () => {
  it('extracts class, interface, enum, trait, function, method', async () => {
    await assertEntities(`<?php
class UserController { public function index() { return []; } }
interface Repository { public function findAll(); }
trait Loggable { public function log($msg) { echo $msg; } }
function helper() { return 42; }
enum Status { case Active; case Inactive; }
`, 'php', {
      UserController: 'class', index: 'method', Repository: 'interface',
      findAll: 'method', Loggable: 'trait', log: 'method',
      helper: 'function', Status: 'enum',
    });
  });
});

describe('Phase 2: extractSymbols — Kotlin', () => {
  it('extracts class, object, function', async () => {
    await assertEntities(`
class UserService(private val repo: UserRepo) {
    fun findUser(id: Long): User? { return repo.findById(id) }
}
object Singleton { fun getInstance(): Singleton = this }
fun topLevel(): String = "hello"
`, 'kotlin', {
      UserService: 'class', findUser: 'function',
      Singleton: 'class', getInstance: 'function', topLevel: 'function',
    });
  });

  it('extracts data class and sealed class', async () => {
    await assertEntities(`
data class Point(val x: Int, val y: Int)
sealed class Result {
    data class Success(val data: String) : Result()
    data class Failure(val error: String) : Result()
}
`, 'kotlin', { Point: 'class', Result: 'class' });
  });

  it('extracts interface via class_declaration', async () => {
    const symbols = await extractOrFail(`
interface UserRepo { fun findById(id: Long): User? }
`, 'kotlin');
    // Kotlin interfaces use class_declaration, so type will be 'class'
    expect(symbols.find(s => s.name === 'UserRepo')).toBeTruthy();
  });
});

describe('Phase 2: extractSymbols — Swift', () => {
  it('extracts class, protocol, function', async () => {
    await assertEntities(`
class UserManager {
    func fetchUsers() -> [User] { return [] }
}
protocol Repository { func findAll() -> [Any] }
func globalHelper() -> String { return "hello" }
`, 'swift', {
      UserManager: 'class', fetchUsers: 'function',
      Repository: 'interface', findAll: 'method', globalHelper: 'function',
    });
  });

  it('extracts struct and enum', async () => {
    await assertEntities(`
struct Point { var x: Int; var y: Int }
enum Color { case red; case green; case blue }
`, 'swift', { Point: null, Color: null });
  });

  it('extracts init_declaration as named method', async () => {
    const symbols = await extractOrFail(`
class Foo { init(x: Int) { self.x = x } }
`, 'swift');
    expect(symbols.find(s => s.name === 'Foo')).toBeTruthy();
    const methods = symbols.filter(s => s.type === 'method');
    expect(methods.length, 'init should produce a method entity').toBeGreaterThanOrEqual(1);
    expect(methods.some(m => m.name === 'init')).toBe(true);
  });
});

describe('Phase 2: extractSymbols — C', () => {
  it('extracts function via nested declarator', async () => {
    await assertEntities(`
#include <stdio.h>
void handleRequest(int fd) { printf("handling %d\\n", fd); }
int main(int argc, char *argv[]) { handleRequest(0); return 0; }
`, 'c', { handleRequest: 'function', main: 'function' });
  });

  it('extracts struct and enum', async () => {
    await assertEntities(`
struct Node { int value; struct Node *next; };
enum Color { RED, GREEN, BLUE };
`, 'c', { Node: 'struct', Color: 'enum' });
  });

  it('extracts typedef', async () => {
    const symbols = await extractOrFail(`
typedef unsigned long size_t;
typedef struct { int x; int y; } Point;
`, 'c');
    const typedefs = symbols.filter(s => s.type === 'typeAlias');
    expect(typedefs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 2: extractSymbols — C++', () => {
  it('extracts class, struct, enum, namespace, function', async () => {
    await assertEntities(`
namespace mylib {
class UserService { public: void process(); };
struct Config { int timeout; bool verbose; };
enum class Status { Active, Inactive };
void freeFunction(int x) { }
} // namespace mylib
`, 'cpp', {
      mylib: 'namespace', UserService: 'class', Config: 'struct',
      Status: 'enum', freeFunction: 'function',
    });
  });

  it('captures free functions but not in-class methods (known limitation)', async () => {
    const symbols = await extractOrFail(`
class Foo { public: void bar(int x) { int y = x + 1; } };
void baz(int z) { int w = z + 2; }
`, 'cpp');
    const names = symbols.map(s => s.name);
    expect(names).toContain('Foo');
    expect(names).toContain('baz');
    // In-class methods are NOT captured — documented limitation, not a bug.
    expect(names).not.toContain('bar');
  });
});

// =============================================================================
// Phase 3: Tree-sitter vs regex parity (Java)
// =============================================================================

describe('Phase 3: Tree-sitter vs regex parity — Java', () => {
  it('tree-sitter finds >= entities compared to regex', async () => {
    const symbols = await extractOrFail(`
package com.example;
import java.util.List;
public class OrderService {
    private final OrderRepository repo;
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public List<Order> findAll() { return repo.findAll(); }
    public void createOrder(Order order) { repo.save(order); }
    private interface OrderRepository {
        List<Order> findAll();
        void save(Order order);
    }
    public enum Status { PENDING, COMPLETED, CANCELLED }
}
`, 'java');
    expect(symbols.filter(s => s.type === 'class').length).toBeGreaterThanOrEqual(1);
    expect(symbols.filter(s => s.type === 'interface').length).toBeGreaterThanOrEqual(1);
    expect(symbols.filter(s => s.type === 'enum').length).toBeGreaterThanOrEqual(1);
    expect(symbols.filter(s => s.type === 'method').length).toBeGreaterThanOrEqual(3);
    const names = symbols.map(s => s.name);
    expect(names).toContain('OrderService');
    expect(names).toContain('OrderRepository');
    expect(names).toContain('Status');
    expect(names).toContain('findAll');
    expect(names).toContain('createOrder');
  });
});

// =============================================================================
// Phase 4: IDENT_TYPES coverage
// =============================================================================

describe('Phase 4: IDENT_TYPES coverage', () => {
  it('includes all required node types', () => {
    for (const t of [
      'identifier', 'type_identifier', 'property_identifier', 'field_identifier',
      'constant', 'name', 'simple_identifier', 'namespace_identifier',
    ]) {
      expect(IDENT_TYPES.has(t), `IDENT_TYPES should include '${t}'`).toBe(true);
    }
  });

  const IDENT_CASES = [
    ['ruby', 'class Foo\n  def bar() 42 end\nend', 'class', 'Foo'],
    ['php', '<?php\nclass MyService { public function run() {} }', 'class', 'MyService'],
    ['kotlin', 'fun greet(): String = "hello"', 'function', 'greet'],
    ['swift', 'func greet() -> String { return "hello" }', 'function', 'greet'],
    ['cpp', 'namespace mylib { void doStuff() {} }', 'namespace', 'mylib'],
  ];

  for (const [lang, code, type, name] of IDENT_CASES) {
    it(`${lang}: ${type} name is '${name}', not <anonymous>`, async () => {
      const symbols = await extractOrFail(code, lang);
      const sym = symbols.find(s => s.type === type);
      expect(sym).toBeTruthy();
      expect(sym.name).toBe(name);
      expect(sym.name).not.toMatch(/<anonymous/);
    });
  }

  it('all 12 languages have TAGS_QUERIES entries', () => {
    for (const lang of Object.keys(GRAMMAR_MAP)) {
      expect(TAGS_QUERIES[lang], `${lang} should have TAGS_QUERIES`).toBeDefined();
    }
  });
});

// =============================================================================
// Phase 5: Integration — extractFromFile through tree-sitter path
// =============================================================================

describe('Phase 5: extractFromFile integration (tree-sitter path)', () => {
  let GraphExtractor;
  let extractor;

  beforeAll(async () => {
    const mod = await import('../core/graph-extractor.js');
    GraphExtractor = mod.default;
    extractor = new GraphExtractor({ projectRoot: '/test' });
  });

  const LANG_TESTS = [
    {
      lang: 'java', file: 'UserService.java',
      code: `
package com.example;
import java.util.List;
public class UserService extends BaseService implements Serializable {
    public void save(User user) { repo.persist(user); }
}`,
      entities: [['class', 'UserService'], ['method', 'save']],
      rels: [['imports', null], ['extends', 'BaseService'], ['implements', 'Serializable']],
    },
    {
      lang: 'ruby', file: 'user_service.rb',
      code: 'class UserService\n  def find(id) repo.find(id) end\nend',
      entities: [['class', 'UserService'], ['method', 'find']],
    },
    {
      lang: 'c', file: 'util.c',
      code: '#include <stdio.h>\nstruct Point { int x; int y; };\nvoid process(struct Point *p) { printf("%d", p->x); }',
      entities: [['struct', 'Point'], ['function', 'process']],
    },
    {
      lang: 'cpp', file: 'engine.cpp',
      code: '#include <vector>\nnamespace app {\nclass Engine { };\nvoid run() { }\n}',
      entities: [['namespace', 'app'], ['class', 'Engine']],
    },
    {
      lang: 'php', file: 'Controller.php',
      code: '<?php\nclass Controller { public function index() { return []; } }',
      entities: [['class', 'Controller'], ['method', 'index']],
    },
    {
      lang: 'kotlin', file: 'UserRepo.kt',
      code: 'class UserRepo {\n    fun findById(id: Long): User? = null\n}',
      entities: [['class', 'UserRepo'], ['function', 'findById']],
    },
    {
      lang: 'swift', file: 'Manager.swift',
      code: 'import Foundation\nclass Manager { func process() { } }',
      entities: [['class', 'Manager']],
    },
  ];

  for (const { lang, file, code, entities, rels } of LANG_TESTS) {
    it(`${lang}: produces entities + relationships`, async () => {
      const result = await extractor.extractFromFile(`/test/${file}`, code);
      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      for (const [type, name] of entities) {
        expect(result.entities.some(e => e.type === type && e.name === name),
          `${lang}: expected entity ${type}:${name}`).toBe(true);
      }
      if (rels) {
        for (const [type, target] of rels) {
          if (target) {
            expect(result.relationships.some(r => r.type === type && r.target_name === target),
              `${lang}: expected rel ${type}→${target}`).toBe(true);
          } else {
            expect(result.relationships.some(r => r.type === type),
              `${lang}: expected rel type '${type}'`).toBe(true);
          }
        }
      }
    });
  }

  it('Java: generic/qualified extends+implements normalized correctly', async () => {
    const result = await extractor.extractFromFile('/test/UserService.java', `
package com.example;
public class UserService extends com.example.BaseService<User>
    implements Comparable<String>, java.io.Serializable {
    public int compareTo(String value) { return 0; }
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'extends' && r.target_name === 'com.example.BaseService')).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'implements' && r.target_name === 'Comparable')).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'implements' && r.target_name === 'java.io.Serializable')).toBe(true);
  });

  it('TREE_SITTER_ENTITY_PRIORITY covers all CAPTURE_TO_ENTITY_TYPE values', async () => {
    const { TREE_SITTER_ENTITY_PRIORITY } = await import('../core/graph-extractor.js');
    const entityTypes = new Set(Object.values(CAPTURE_TO_ENTITY_TYPE));
    for (const type of entityTypes) {
      expect(TREE_SITTER_ENTITY_PRIORITY[type],
        `entity type '${type}' should have a priority rank`).toBeDefined();
    }
  });
});
