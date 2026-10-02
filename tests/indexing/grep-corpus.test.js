import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GREP_MAX_FILE_SIZE,
  _resetChangedGrepFilesCache,
  discoverGrepCorpus,
  isGrepCorpusPath,
  listChangedGrepFiles,
} from '../../core/indexing/grep-corpus.js';

function write(root, rel, content = 'needle\n') {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function initRepo(root) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
}

describe('isGrepCorpusPath', () => {
  it('keeps dependency, doc and extensionless paths', () => {
    for (const rel of ['vendor/x509/cert.go', 'README.md', 'Makefile', 'third_party/a.c', 'build/x.jam']) {
      expect(isGrepCorpusPath(rel)).toBe(true);
    }
  });

  it('drops sweet-search state, git internals, worktrees and secrets', () => {
    for (const rel of ['.sweet-search/codebase.db', '.git/config', '.claude/worktrees/a/x.js', '.env', 'app/.env.local', 'config/secrets.json']) {
      expect(isGrepCorpusPath(rel)).toBe(false);
    }
  });

  it('drops paths outside the project', () => {
    expect(isGrepCorpusPath('../outside.js')).toBe(false);
    expect(isGrepCorpusPath('/etc/passwd')).toBe(false);
    expect(isGrepCorpusPath('')).toBe(false);
  });

  it('honours .sweet-search-ignore patterns', () => {
    expect(isGrepCorpusPath('fixtures/big.txt', [/^fixtures(?:\/.*)?$/])).toBe(false);
  });
});

describe('discoverGrepCorpus (git worktree)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ss-grep-corpus-'));
    initRepo(root);
    write(root, 'src/app.go', 'package main\n');
    write(root, 'vendor/github.com/zmap/zcrypto/x509/x509.go', 'func IsPrecert() bool\n');
    write(root, 'README.md', '# readme\n');
    write(root, 'Makefile', 'all:\n');
    write(root, '.gitignore', 'ignored.log\nbuild-out/\n');
    write(root, 'ignored.log', 'needle\n');
    write(root, 'build-out/gen.go', 'needle\n');
    write(root, '.env', 'SECRET=1\n');
    write(root, 'empty.txt', '');
    write(root, 'dist/app.min.js', `${'x'.repeat(5000)}\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    write(root, 'scripts/new-tool', '#!/bin/sh\necho needle\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('adds tracked and untracked-but-not-ignored files to the embedding files', async () => {
    const { files, added, truncated, source } = await discoverGrepCorpus(['src/app.go'], { projectRoot: root });
    expect(source).toBe('git');
    expect(files[0]).toBe('src/app.go');
    expect(files).toEqual(expect.arrayContaining([
      'vendor/github.com/zmap/zcrypto/x509/x509.go', 'README.md', 'Makefile', '.gitignore', 'scripts/new-tool',
    ]));
    expect(new Set(files).size).toBe(files.length);
    expect(added).toBe(files.length - 1);
    expect(truncated).toBe(0);
  });

  it('leaves out ignored, secret, empty and minified files', async () => {
    const { files } = await discoverGrepCorpus([], { projectRoot: root });
    for (const rel of ['ignored.log', 'build-out/gen.go', '.env', 'empty.txt', 'dist/app.min.js']) {
      expect(files).not.toContain(rel);
    }
  });

  it('leaves out symlinks and oversized files', async () => {
    symlinkSync(join(root, 'src/app.go'), join(root, 'link.go'));
    write(root, 'huge.txt', 'needle\n');
    truncateSync(join(root, 'huge.txt'), GREP_MAX_FILE_SIZE + 1);
    const { files } = await discoverGrepCorpus([], { projectRoot: root });
    expect(files).not.toContain('link.go');
    expect(files).not.toContain('huge.txt');
  });

  it('keeps the embedding files and drops extras at the cap', async () => {
    const { files, truncated } = await discoverGrepCorpus(['src/app.go'], { projectRoot: root, cap: 2 });
    expect(files).toHaveLength(2);
    expect(files[0]).toBe('src/app.go');
    expect(truncated).toBeGreaterThan(0);
  });
});

describe('discoverGrepCorpus (no git)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ss-grep-corpus-nogit-'));
    write(root, 'src/a.py', 'x = 1\n');
    write(root, 'vendor/lib.c', 'int f(void);\n');
    write(root, 'node_modules/pkg/index.js', 'module.exports = 1\n');
    write(root, '.venv/lib/site.py', 'x = 1\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('walks the root but skips dependency and cache directories', async () => {
    const { files, source } = await discoverGrepCorpus([], { projectRoot: root });
    expect(source).toBe('walk');
    expect(files.sort()).toEqual(['src/a.py', 'vendor/lib.c']);
  });
});

describe('listChangedGrepFiles', () => {
  let root;

  beforeEach(() => {
    _resetChangedGrepFilesCache();
    root = mkdtempSync(join(tmpdir(), 'ss-grep-changed-'));
    initRepo(root);
    write(root, 'a.go', 'package a\n');
    write(root, 'b.go', 'package b\n');
    write(root, '.gitignore', 'tmp.log\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('lists modified tracked and untracked files, not clean or ignored ones', () => {
    write(root, 'a.go', 'package a // edited\n');
    write(root, 'vendor/new.go', 'package v\n');
    write(root, 'tmp.log', 'x\n');
    write(root, '.env', 'SECRET=1\n');
    expect(listChangedGrepFiles(root).sort()).toEqual(['a.go', 'vendor/new.go']);
  });

  it('drops deleted files and respects the limit', () => {
    rmSync(join(root, 'b.go'));
    write(root, 'c.go', 'package c\n');
    write(root, 'd.go', 'package d\n');
    expect(listChangedGrepFiles(root)).toEqual(['c.go', 'd.go']);
    _resetChangedGrepFilesCache();
    expect(listChangedGrepFiles(root, { limit: 1 })).toEqual(['c.go']);
  });

  it('is empty outside git', () => {
    const plain = mkdtempSync(join(tmpdir(), 'ss-grep-changed-nogit-'));
    try {
      write(plain, 'a.go', 'package a\n');
      expect(listChangedGrepFiles(plain)).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
