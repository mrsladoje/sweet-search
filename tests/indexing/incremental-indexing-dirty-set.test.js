/**
 * Tests for core/incremental-indexing/infrastructure/dirty-set.mjs
 *
 * Plan § 9.1-9.5: bounded dirty set with overflow handling, canonicalisation,
 * and round-trip drain.
 */

import { describe, it, expect } from 'vitest';
import {
  DirtySet,
  canonicaliseInsideRoot,
} from '../../core/incremental-indexing/infrastructure/dirty-set.mjs';

describe('DirtySet / basic semantics', () => {
  it('coalesces duplicate inserts', () => {
    const s = new DirtySet();
    s.add('a.js'); s.add('a.js'); s.add('a.js');
    expect(s.size).toBe(1);
    expect(s.stats().totalEnqueued).toBe(3);
  });

  it('normalises backslashes to forward slashes', () => {
    const s = new DirtySet();
    s.add('src\\foo\\bar.js');
    expect(s.has('src/foo/bar.js')).toBe(true);
    expect(s.peek()).toEqual(['src/foo/bar.js']);
  });

  it('drain returns insertion-order entries and empties the set', () => {
    const s = new DirtySet();
    s.add('a.js'); s.add('b.js'); s.add('c.js');
    const drained = s.drain();
    expect(drained.map((d) => d.path)).toEqual(['a.js', 'b.js', 'c.js']);
    expect(s.size).toBe(0);
  });

  it('add returns true on first insert and on refresh', () => {
    const s = new DirtySet();
    expect(s.add('a.js')).toBe(true);
    expect(s.add('a.js', 'cli')).toBe(true);
    const drained = s.drain();
    expect(drained[0].firstSource).toBe('watcher');
    expect(drained[0].lastSource).toBe('cli');
  });

  it('remove deletes a specific path without draining the rest', () => {
    const s = new DirtySet();
    s.add('a.js'); s.add('b.js');
    s.remove('a.js');
    expect(s.peek()).toEqual(['b.js']);
  });
});

describe('DirtySet / overflow policy', () => {
  it('respects maxSize by dropping the oldest entry', () => {
    const dropped = [];
    const s = new DirtySet({ maxSize: 3, onOverflow: (p) => dropped.push(p) });
    s.add('a'); s.add('b'); s.add('c');
    s.add('d'); // bumps `a`
    expect(s.size).toBe(3);
    expect(s.has('a')).toBe(false);
    expect(s.has('d')).toBe(true);
    expect(dropped.length).toBe(1);
    expect(dropped[0].dropped).toBe(1);
  });

  it('overflow counter survives across multiple events', () => {
    const s = new DirtySet({ maxSize: 2 });
    s.add('a'); s.add('b'); s.add('c'); s.add('d');
    expect(s.stats().totalDropped).toBe(2);
  });
});

describe('canonicaliseInsideRoot', () => {
  it('returns an absolute project-anchored path', () => {
    const out = canonicaliseInsideRoot('/projects/repo', 'src/a.js');
    expect(out).toBe('/projects/repo/src/a.js');
  });

  it('rejects paths that escape the root', () => {
    expect(canonicaliseInsideRoot('/projects/repo', '../etc/passwd')).toBeNull();
    expect(canonicaliseInsideRoot('/projects/repo', '/etc/passwd')).toBeNull();
  });

  it('returns the root itself when input is `.`', () => {
    expect(canonicaliseInsideRoot('/projects/repo', '.')).toBe('/projects/repo');
  });
});
