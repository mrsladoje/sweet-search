import { describe, it, expect } from 'vitest';
import { fileInScopes, renderOutsideScopeLine, renderOutsideScopeProbeLine } from '../../core/search/grep-output-shaping.js';

describe('fileInScopes', () => {
  it('matches a file scope exactly and a directory scope by prefix', () => {
    expect(fileInScopes('lib/a/base.rb', ['lib/a/base.rb'])).toBe(true);
    expect(fileInScopes('lib/a/base.rb', ['lib/a'])).toBe(true);
    expect(fileInScopes('lib/a/base.rb', ['lib/a/'])).toBe(true);
    expect(fileInScopes('lib/ab/base.rb', ['lib/a'])).toBe(false);
    expect(fileInScopes('lib/a/base.rb', ['lib/b', 'lib/a/base.rb'])).toBe(true);
  });
});

describe('renderOutsideScopeLine', () => {
  const scopes = ['lib/sequel/model/base.rb'];
  const files = [
    { file: 'lib/sequel/model/base.rb', total: 9, prior: 1 },
    { file: 'spec/model_spec.rb', total: 5, prior: 0.5 },
    { file: 'lib/sequel/plugins/sql_comments.rb', total: 3, prior: 1 },
  ];

  it('names source files outside the scope, source first', () => {
    expect(renderOutsideScopeLine({ files, outsideTotal: 8, scopedTotal: 9, scopes }))
      .toBe('# also 8 hits outside --in: lib/sequel/plugins/sql_comments.rb, spec/model_spec.rb');
  });

  it('stays silent when only tests or docs match outside a scope that answered', () => {
    const quiet = [files[0], files[1], { file: 'doc/release_notes/3.34.0.txt', total: 2, prior: 1 },
      { file: 'examples/fastapi/models.py', total: 1, prior: 1 }];
    expect(renderOutsideScopeLine({ files: quiet, outsideTotal: 7, scopedTotal: 9, scopes })).toBeNull();
  });

  it('names test hits when the scope itself had none', () => {
    expect(renderOutsideScopeLine({ files: [files[1]], outsideTotal: 5, scopedTotal: 0, scopes }))
      .toBe('# also 5 hits outside --in: spec/model_spec.rb');
  });

  it('caps the list and counts the rest, hidden files included', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ file: `lib/p${i}.rb`, total: 1, prior: 1 }));
    expect(renderOutsideScopeLine({ files: many, hiddenFiles: 4, outsideTotal: 9, scopedTotal: 1, scopes }))
      .toBe('# also 9 hits outside --in: lib/p0.rb, lib/p1.rb, lib/p2.rb (+6 more files)');
  });

  it('prints nothing when nothing matches outside', () => {
    expect(renderOutsideScopeLine({ files: [files[0]], outsideTotal: 0, scopedTotal: 9, scopes })).toBeNull();
  });
});

describe('renderOutsideScopeProbeLine', () => {
  const scopes = ['pkg/config/types.go'];
  const many = Array.from({ length: 20 }, (_, i) => `pkg/f${i}.go`);

  it('says limit+ files and names the first source files', () => {
    expect(renderOutsideScopeProbeLine({ files: many, limit: 20, scopedTotal: 1, scopes }))
      .toBe('# also 20+ files outside --in: pkg/f0.go, pkg/f1.go, pkg/f2.go');
  });

  it('says N+ files when the read budget ran out first', () => {
    expect(renderOutsideScopeProbeLine({ files: ['cmd/a.go', 'pkg/b.go'], limit: 20, scopedTotal: 1, scopes }))
      .toBe('# also 2+ files outside --in: cmd/a.go, pkg/b.go');
  });

  it('gives an exact file count when every candidate was read', () => {
    expect(renderOutsideScopeProbeLine({ files: ['cmd/a.go'], limit: 20, complete: true, scopedTotal: 1, scopes }))
      .toBe('# also 1 file outside --in: cmd/a.go');
    expect(renderOutsideScopeProbeLine({ files: ['cmd/a.go', 'pkg/b.go'], limit: 20, complete: true, scopedTotal: 1, scopes }))
      .toBe('# also 2 files outside --in: cmd/a.go, pkg/b.go');
  });

  it('stays silent when no source file matched outside a scope that answered', () => {
    const files = ['test/a_test.go', 'docs/b.md'];
    expect(renderOutsideScopeProbeLine({ files, limit: 20, scopedTotal: 1, scopes })).toBeNull();
    expect(renderOutsideScopeProbeLine({ files: [], limit: 20, scopedTotal: 0, scopes })).toBeNull();
  });

  it('names test hits when the scope itself had none', () => {
    expect(renderOutsideScopeProbeLine({ files: ['test/a_test.go'], limit: 20, scopedTotal: 0, scopes }))
      .toBe('# also 1+ files outside --in: test/a_test.go');
  });

  it('never names a file inside the scope', () => {
    expect(renderOutsideScopeProbeLine({ files: ['pkg/config/types.go', 'pkg/b.go'], limit: 20, scopedTotal: 1, scopes }))
      .toBe('# also 1+ files outside --in: pkg/b.go');
  });
});
