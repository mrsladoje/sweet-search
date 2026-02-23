import { describe, it, expect, beforeEach } from 'vitest';
import { GraphExtractor, splitTopLevelCommas } from '../core/graph-extractor.js';

// =============================================================================
// splitTopLevelCommas
// =============================================================================
describe('splitTopLevelCommas', () => {
  it('splits simple comma-separated values', () => {
    expect(splitTopLevelCommas('Foo, Bar, Baz')).toEqual(['Foo', ' Bar', ' Baz']);
  });

  it('preserves commas inside angle brackets (generics)', () => {
    expect(splitTopLevelCommas('Base<Foo, Bar>, IFace')).toEqual(['Base<Foo, Bar>', ' IFace']);
  });

  it('preserves commas inside parentheses', () => {
    expect(splitTopLevelCommas('Base(x, y), Other')).toEqual(['Base(x, y)', ' Other']);
  });

  it('handles nested brackets', () => {
    expect(splitTopLevelCommas('Map<String, List<Int>>, Set<T>')).toEqual([
      'Map<String, List<Int>>', ' Set<T>',
    ]);
  });

  it('returns single element for no commas', () => {
    expect(splitTopLevelCommas('OnlyOne')).toEqual(['OnlyOne']);
  });

  it('handles empty string', () => {
    expect(splitTopLevelCommas('')).toEqual(['']);
  });
});

// =============================================================================
// expandRelationshipTargets
// =============================================================================
describe('expandRelationshipTargets', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('splits implements targets', () => {
    expect(extractor.expandRelationshipTargets('implements', 'Foo, Bar, Baz'))
      .toEqual(['Foo', 'Bar', 'Baz']);
  });

  it('splits inherit targets with C++ access specifiers', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'public Bar, protected Baz'))
      .toEqual(['Bar', 'Baz']);
  });

  it('strips generics from inherit targets', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'Comparable<Int>, Serializable'))
      .toEqual(['Comparable', 'Serializable']);
  });

  it('strips nested generics cleanly', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'Map<String, List<Int>>'))
      .toEqual(['Map']);
  });

  it('splits protocol targets', () => {
    expect(extractor.expandRelationshipTargets('protocol', 'Proto1, Proto2'))
      .toEqual(['Proto1', 'Proto2']);
  });

  it('does not split non-multi-target types', () => {
    expect(extractor.expandRelationshipTargets('import', 'some.package'))
      .toEqual(['some.package']);
  });

  it('preserves namespaced targets', () => {
    expect(extractor.expandRelationshipTargets('with', 'App\\Models\\User'))
      .toEqual(['App\\Models\\User']);
  });

  it('splits plainImport with aliases', () => {
    expect(extractor.expandRelationshipTargets('plainImport', 'os, sys as system'))
      .toEqual(['os', 'sys']);
  });

  it('strips constructor args from inherit targets', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'Base(x), Other'))
      .toEqual(['Base', 'Other']);
  });

  it('handles generics inside comma list without breaking', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'public Base<Foo, Bar>, public IFace'))
      .toEqual(['Base', 'IFace']);
  });

  it('returns non-string target as-is', () => {
    expect(extractor.expandRelationshipTargets('inherit', 42)).toEqual([42]);
  });

  it('strips virtual keyword from C++ inherit', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'virtual Base, public Derived'))
      .toEqual(['Base', 'Derived']);
  });

  it('strips trailing semicolons from C++ forward declarations', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'public Base;'))
      .toEqual(['Base']);
  });

  it('strips trailing braces', () => {
    expect(extractor.expandRelationshipTargets('inherit', 'public Base {'))
      .toEqual(['Base']);
  });
});

// =============================================================================
// PHP extraction: extends + implements
// =============================================================================
describe('PHP relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('extracts extends and implements from PHP class', async () => {
    const code = `<?php
class Foo extends Bar implements Baz, Qux {
  public function test() {}
}`;
    const result = await extractor.extractFromFile('/test/file.php', code);

    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    const implementsRels = result.relationships.filter(r => r.type === 'implements');

    expect(extendsRels.length).toBe(1);
    expect(extendsRels[0].target_name).toBe('Bar');
    expect(implementsRels.length).toBe(2);
    expect(implementsRels.map(r => r.target_name).sort()).toEqual(['Baz', 'Qux']);
  });

  it('extracts extends from abstract class', async () => {
    const code = `<?php
abstract class AbstractRepo extends BaseRepo {
}`;
    const result = await extractor.extractFromFile('/test/abstract.php', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(1);
    expect(extendsRels[0].target_name).toBe('BaseRepo');
  });

  it('extracts implements from final class with extends', async () => {
    const code = `<?php
final class Service extends BaseService implements Loggable, Cacheable {
}`;
    const result = await extractor.extractFromFile('/test/final.php', code);
    const implementsRels = result.relationships.filter(r => r.type === 'implements');
    expect(implementsRels.length).toBe(2);
    expect(implementsRels.map(r => r.target_name).sort()).toEqual(['Cacheable', 'Loggable']);
  });
});

// =============================================================================
// Ruby extraction: methodCall
// =============================================================================
describe('Ruby relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('extracts method calls from Ruby code', async () => {
    const code = `class Foo < Bar
  def run
    obj.method(arg)
    service.call(x)
  end
end`;
    const result = await extractor.extractFromFile('/test/file.rb', code);
    const calls = result.relationships.filter(r => r.type === 'calls');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.map(r => r.target_name)).toContain('obj.method');
    expect(calls.map(r => r.target_name)).toContain('service.call');
  });

  it('skips Ruby built-in call objects', async () => {
    const code = `class Foo
  def run
    puts.something(x)
    print.other(y)
  end
end`;
    const result = await extractor.extractFromFile('/test/skip.rb', code);
    const calls = result.relationships.filter(r => r.type === 'calls');
    expect(calls.length).toBe(0);
  });
});

// =============================================================================
// C++ extraction: multiple inheritance
// =============================================================================
describe('C++ relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('extracts multiple C++ parents', async () => {
    const code = `#include <iostream>
class Foo : public Bar, private Baz {
  void test() {}
};`;
    const result = await extractor.extractFromFile('/test/file.cpp', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['Bar', 'Baz']);
  });

  it('handles C++ inheritance with templates', async () => {
    const code = `class Widget : public Base<T>, public IFace {
};`;
    const result = await extractor.extractFromFile('/test/template.cpp', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['Base', 'IFace']);
  });

  it('handles virtual inheritance', async () => {
    const code = `class Diamond : virtual public Base, public Other {
};`;
    const result = await extractor.extractFromFile('/test/virtual.cpp', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['Base', 'Other']);
  });
});

// =============================================================================
// Swift extraction: extension conformance
// =============================================================================
describe('Swift relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('extracts extension protocol conformance', async () => {
    const code = `import Foundation
extension Foo: Equatable, Hashable {
}`;
    const result = await extractor.extractFromFile('/test/ext.swift', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['Equatable', 'Hashable']);
  });
});

// =============================================================================
// Kotlin: inherit comma splitting (no pattern change, just expandRelationshipTargets)
// =============================================================================
describe('Kotlin relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('splits multiple Kotlin parents', async () => {
    const code = `import kotlin.io
class Foo(val x: Int) : Bar, Baz {
}`;
    const result = await extractor.extractFromFile('/test/file.kt', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['Bar', 'Baz']);
  });
});

// =============================================================================
// C#: inherit comma splitting (no pattern change, just expandRelationshipTargets)
// =============================================================================
describe('C# relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('splits multiple C# parents', async () => {
    const code = `using System;
public class Foo : IBar, IBaz {
}`;
    const result = await extractor.extractFromFile('/test/file.cs', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    expect(extendsRels.length).toBe(2);
    expect(extendsRels.map(r => r.target_name).sort()).toEqual(['IBar', 'IBaz']);
  });
});

// =============================================================================
// Objective-C: protocol comma splitting
// =============================================================================
describe('Objective-C relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('splits multiple ObjC protocols', async () => {
    const code = `#import <Foundation/Foundation.h>
@interface Foo : NSObject <Proto1, Proto2>
@end`;
    const result = await extractor.extractFromFile('/test/file.m', code);
    const implementsRels = result.relationships.filter(r => r.type === 'implements');
    expect(implementsRels.length).toBe(2);
    expect(implementsRels.map(r => r.target_name).sort()).toEqual(['Proto1', 'Proto2']);
  });
});

// =============================================================================
// Dart: with stops before implements (regression for greedy capture bug)
// =============================================================================
describe('Dart relationship extraction', () => {
  let extractor;
  beforeEach(() => {
    extractor = new GraphExtractor({ useTreeSitter: false });
  });

  it('with pattern does not capture through implements keyword', async () => {
    const code = `class Foo extends Bar with Equatable, Serializable implements Baz {
}`;
    const result = await extractor.extractFromFile('/test/file.dart', code);
    const extendsRels = result.relationships.filter(r => r.type === 'extends');
    const implementsRels = result.relationships.filter(r => r.type === 'implements');

    // with maps to extends — should get Bar (extends) + Equatable + Serializable (with)
    const extNames = extendsRels.map(r => r.target_name).sort();
    expect(extNames).toEqual(['Bar', 'Equatable', 'Serializable']);

    // implements should get only Baz, not be swallowed by with
    expect(implementsRels.length).toBe(1);
    expect(implementsRels[0].target_name).toBe('Baz');
  });
});
