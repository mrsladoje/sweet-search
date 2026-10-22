import { describe, it, expect } from 'vitest';
import { maxProcessTitleLength } from '../../core/infrastructure/process-title.js';

describe('maxProcessTitleLength', () => {
  it('leaves one NUL per remaining argument in the original argv block', () => {
    // `node t.mjs`: 5 + 6 bytes; the title and its NUL plus one NUL for argv[1].
    expect(maxProcessTitleLength({ argv0: 'node', execArgv: [], argv: ['/n', '/w/t.mjs'], cwd: '/w' })).toBe(9);
  });

  it('counts the script by its base name, not the resolved path', () => {
    const short = maxProcessTitleLength({ argv0: 'node', execArgv: [], argv: ['/n', '/a/very/long/dir/t.mjs'], cwd: '/w' });
    expect(short).toBe(9);
  });

  it('counts `node .` as one byte', () => {
    // process.argv[1] is then the cwd (or a parent), whose base name was never in argv.
    expect(maxProcessTitleLength({ argv0: 'node', execArgv: [], argv: ['/n', '/work/project'], cwd: '/work/project' })).toBe(5);
    expect(maxProcessTitleLength({ argv0: 'node', execArgv: [], argv: ['/n', '/work'], cwd: '/work/project' })).toBe(5);
  });

  it('includes exec args and script args', () => {
    // node --x s.js ab: 5 + 4 + 5 + 3 = 17 bytes, 4 args.
    expect(maxProcessTitleLength({ argv0: 'node', execArgv: ['--x'], argv: ['/n', '/w/s.js', 'ab'], cwd: '/w' })).toBe(13);
  });
});
