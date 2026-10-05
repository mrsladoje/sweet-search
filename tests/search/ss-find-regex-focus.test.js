/**
 * ss-find: an entry whose chunk holds several top-level definitions narrows to the one that
 * holds the chunk's first regex hit (focusResultsOnRegexHits, search-pattern-chunks.js).
 */
import { describe, expect, it } from 'vitest';
import { focusResultsOnRegexHits } from '../../core/search/search-pattern-chunks.js';

// jj lib/src/bisect.rs 1-60: license + imports, enum BisectionError (39-46), enum Evaluation (51-60).
const repo = {
  findEntitiesInRange: (file, start, end) => [
    { name: 'BisectionError', type: 'enum', startLine: 39, endLine: 46 },
    { name: 'BackendError', type: 'variant', startLine: 41, endLine: 41 },
    { name: 'Evaluation', type: 'enum', startLine: 51, endLine: 60 },
  ].filter((e) => e.startLine >= start && e.startLine <= end),
};
const chunk = { file: 'lib/src/bisect.rs', startLine: 1, endLine: 60, name: null, type: 'code', metadata: { startLine: 1, endLine: 60 } };

describe('ss-find regex-hit focus', () => {
  it('a hit in the second definition narrows the entry to it', () => {
    const [r] = focusResultsOnRegexHits([chunk], [{ file: 'lib/src/bisect.rs', line: 51 }], repo);
    expect([r.startLine, r.endLine, r.name, r.type]).toEqual([51, 60, 'Evaluation', 'enum']);
    expect(r.metadata).toMatchObject({ startLine: 51, endLine: 60, name: 'Evaluation' });
    expect(r.focusedFrom).toEqual({ startLine: 1, endLine: 60 });
  });

  it('a hit in the first definition, a single definition, no hit or no graph: unchanged', () => {
    expect(focusResultsOnRegexHits([chunk], [{ file: 'lib/src/bisect.rs', line: 40 }], repo)[0]).toBe(chunk);
    const one = { ...chunk, startLine: 48, endLine: 60 };
    expect(focusResultsOnRegexHits([one], [{ file: 'lib/src/bisect.rs', line: 51 }], repo)[0]).toBe(one);
    expect(focusResultsOnRegexHits([chunk], [{ file: 'other.rs', line: 51 }], repo)[0]).toBe(chunk);
    expect(focusResultsOnRegexHits([chunk], [{ file: 'lib/src/bisect.rs', line: 51 }], null)[0]).toBe(chunk);
  });

  it('the first hit inside the chunk decides; nested definitions are not targets', () => {
    const [r] = focusResultsOnRegexHits([chunk], [
      { file: 'lib/src/bisect.rs', line: 70 }, { file: 'lib/src/bisect.rs', line: 55 }, { file: 'lib/src/bisect.rs', line: 41 },
    ], repo);
    expect(r).toBe(chunk); // line 41 (inside BisectionError, the first definition) is the first hit
  });
});
