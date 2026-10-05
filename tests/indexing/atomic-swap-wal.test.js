/**
 * atomicSwapDatabase moved only the main database file. An old WAL-mode
 * database leaves `x.db-wal` / `x.db-shm` next to it; after the swap SQLite
 * replayed that old WAL into the new `x.db` on open and the file read as
 * "database disk image is malformed" (seen on `index --graph-only --full`
 * over an existing plug index). The sidecars now travel with their database.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fsp from 'fs/promises';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicSwapDatabase } from '../../core/indexing/indexer-utils.js';

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function walDb(file, rows) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE t (v TEXT)');
  const ins = db.prepare('INSERT INTO t VALUES (?)');
  for (const r of rows) ins.run(r);
  return db;
}

describe('atomicSwapDatabase with WAL sidecars', () => {
  it('an old database with an unflushed WAL does not leak into the new one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-wal-'));
    dirs.push(dir);
    const finalPath = path.join(dir, 'code-graph.db');
    // Old database: rows only in the WAL, handle still open (a running reader).
    const old = walDb(finalPath, Array.from({ length: 500 }, (_, i) => `old-${i}`.repeat(20)));
    expect(fs.existsSync(`${finalPath}-wal`)).toBe(true);

    const tmpPath = `${finalPath}.tmp`;
    const fresh = walDb(tmpPath, ['new']);
    fresh.close();

    await atomicSwapDatabase(tmpPath, finalPath);
    old.close();

    const db = new Database(finalPath);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.prepare('SELECT v FROM t').all()).toEqual([{ v: 'new' }]);
    db.close();
    expect(fs.existsSync(`${finalPath}.bak-wal`)).toBe(false);
  });
});

describe('atomicSwapDatabase failures leave the old database in place', () => {
  afterEach(() => vi.restoreAllMocks());
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-fail-'));
    dirs.push(dir);
    const finalPath = path.join(dir, 'code-graph.db');
    fs.writeFileSync(finalPath, 'old');
    fs.writeFileSync(`${finalPath}-wal`, 'old-wal');
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, 'new');
    return { finalPath, tmpPath };
  };
  const failOn = (pred, code, times = Infinity) => {
    const real = fsp.rename.bind(fsp);
    let left = times;
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (left > 0 && pred(String(from), String(to))) { left--; throw Object.assign(new Error(code), { code }); }
      return real(from, to);
    });
  };

  it('a busy rename in the middle is undone and retried', async () => {
    const { finalPath, tmpPath } = setup();
    failOn((from) => from === tmpPath, 'EBUSY', 1);
    await atomicSwapDatabase(tmpPath, finalPath);
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('new');
    expect(fs.existsSync(`${finalPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${finalPath}.bak`)).toBe(false);
  });

  it('a lasting failure after the old database moved puts it back with its WAL', async () => {
    const { finalPath, tmpPath } = setup();
    failOn((from) => from === tmpPath, 'EACCES');
    await expect(atomicSwapDatabase(tmpPath, finalPath)).rejects.toThrow('EACCES');
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('old');
    expect(fs.readFileSync(`${finalPath}-wal`, 'utf8')).toBe('old-wal');
    expect(fs.readFileSync(tmpPath, 'utf8')).toBe('new');
  });

  it('a busy sidecar on every attempt never loses the backup', async () => {
    const { finalPath, tmpPath } = setup();
    failOn((from) => from === `${finalPath}-wal`, 'EBUSY');
    await expect(atomicSwapDatabase(tmpPath, finalPath)).rejects.toThrow('EBUSY');
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('old');
    expect(fs.readFileSync(`${finalPath}-wal`, 'utf8')).toBe('old-wal');
  }, 10000);

  it('a backup left with no database beside it is restored, then replaced', async () => {
    const { finalPath, tmpPath } = setup();
    fs.renameSync(finalPath, `${finalPath}.bak`);
    await atomicSwapDatabase(tmpPath, finalPath);
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('new');
    expect(fs.existsSync(`${finalPath}.bak`)).toBe(false);
  });
});
