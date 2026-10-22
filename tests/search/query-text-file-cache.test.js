import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __TEST__ } from '../../core/search/search-postprocess.js';

// The daemon cached each file's text for query-text ranking forever: after an edit was
// indexed, ranking still used the old text (a removed word kept its exact-match bonus).
describe('query-text file cache', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-qtcache-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reads the file again after it changes', () => {
    const file = join(root, 'a.js');
    writeFileSync(file, 'const firstyak = 1;\n');
    const result = { file: 'a.js', startLine: 1, endLine: 1 };
    expect(__TEST__.readCandidateSpan(root, result)).toContain('firstyak');
    writeFileSync(file, 'const thirdkudu = 1;\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    expect(__TEST__.readCandidateSpan(root, result)).toContain('thirdkudu');
  });
});
