import { describe, it, expect } from 'vitest';
import { isTestPath } from '../../core/graph/relationship-resolver.js';

describe('isTestPath (call-target tie ranking)', () => {
  it('treats words that only end in "test(s)" as production code', () => {
    for (const p of ['contests.go', 'pkg/contests/contests.go', 'latest.ts', 'src/greatest.py', 'attest.rs', 'Manifest.swift', 'protest.rb']) {
      expect(isTestPath(p), p).toBe(false);
    }
  });

  it('recognises test directories in any case', () => {
    for (const p of ['tests/a.py', 'Tests/GRDBTests/FooTests.swift', 'src/__tests__/x.ts', 'spec/models/user_spec.rb', 'internal/testing/fake.go', 'mocks/client.go', 'fixtures/a.json']) {
      expect(isTestPath(p), p).toBe(true);
    }
  });

  it('recognises test file suffixes and prefixes', () => {
    for (const p of [
      'context_test.go', 'a/b.test.ts', 'a/b.spec.js', 'lib/foo-test.js', 'foo_tests.py',
      'src/test_models.py', 'conftest.py',
      'src/main/java/FooTest.java', 'Sources/BarTests.swift', 'core/BazSpec.scala', 'FooSpecs.cs',
    ]) {
      expect(isTestPath(p), p).toBe(true);
    }
  });

  it('a capitalised Test(s)/Spec(s) file name is test code; a lowercase word ending in it is not', () => {
    expect(isTestPath('Test.java')).toBe(true);
    expect(isTestPath('src/Tests.kt')).toBe(true);
    expect(isTestPath('src/LatestSpec.swift')).toBe(true);
    expect(isTestPath('src/latest.swift')).toBe(false);
  });
});
