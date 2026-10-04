/**
 * A daemon started by autoSpawnServer outlives the ss-* call that started it, so it must not
 * inherit that call's start stamp (SWEET_SEARCH_CALL_STARTED_MS): every later call it served
 * would begin with its 90 s loading budget already spent.
 */
import { describe, expect, it, vi } from 'vitest';

const spawns = vi.hoisted(() => []);
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: (cmd, args, opts) => { spawns.push({ cmd, args, opts }); return { pid: 1, unref() {} }; },
}));

const { autoSpawnServer } = await import('../../core/search/search-server.js');

describe('autoSpawnServer', () => {
  it('drops the call start stamp and sets the heap flag', async () => {
    process.env.SWEET_SEARCH_CALL_STARTED_MS = '12345';
    process.env.SWEET_SEARCH_SOCKET_PATH = '/nonexistent/ss-auto-spawn-env.sock';
    try {
      await autoSpawnServer({ quiet: true });
    } finally {
      delete process.env.SWEET_SEARCH_CALL_STARTED_MS;
      delete process.env.SWEET_SEARCH_SOCKET_PATH;
    }
    expect(spawns).toHaveLength(1);
    expect(spawns[0].opts.env.SWEET_SEARCH_CALL_STARTED_MS).toBeUndefined();
    expect(spawns[0].args[0]).toMatch(/^--max-old-space-size=\d+$/);
    expect(spawns[0].args.slice(-1)).toEqual(['--serve']);
  }, 15_000);
});
