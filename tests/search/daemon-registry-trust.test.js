/**
 * The daemon registries are instruction files, so their provenance matters.
 *
 * What is in these files is ACTED ON. The count cap sends `/stop` to every
 * socket path it reads; the RSS coordinator sends SIGTERM to every pid it
 * reads. Both used to default to a fixed path in a world-writable directory —
 * `/tmp/sweet-search-daemons.json`, and `os.tmpdir()` for the RSS one, which is
 * `/tmp` on Linux. Any other local user could create that file before we did
 * and then choose its contents, which turns our own daemon into the thing that
 * stops the user's processes. The RSS coordinator is default-ON at 24 GiB and
 * below, so this needed no opt-in to reach.
 *
 * The rule these tests pin is FAIL CLOSED: anything we cannot vouch for reads
 * as empty and is never written to. An unenforced cap is a footprint problem; a
 * trusted hostile registry is the user losing running processes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registryTrustworthy, readRegistry, upsertSelf } from '../../core/search/daemon-registry.js';

let root;

const REAL_LOOKING_ENTRY = {
  daemons: {
    999999: {
      pid: 999999,
      projectRoot: '/somewhere',
      socketPath: '/tmp/attacker-controlled.sock',
      pidFile: '/tmp/x.pid',
      startedAt: 1,
      lastActivityMs: 1,
    },
  },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-trust-'));
  chmodSync(root, 0o700);
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('registryTrustworthy', () => {
  it('trusts our own private file in our own private directory', () => {
    const f = join(root, 'daemons.json');
    writeFileSync(f, JSON.stringify(REAL_LOOKING_ENTRY), { mode: 0o600 });
    expect(registryTrustworthy(f)).toBe(true);
  });

  it('trusts a path that does not exist yet inside a private directory', () => {
    // We are about to create it ourselves; absence is not suspicious.
    expect(registryTrustworthy(join(root, 'not-created-yet.json'))).toBe(true);
  });

  it('rejects a symlink, however harmless its target looks', () => {
    const target = join(root, 'real.json');
    const link = join(root, 'daemons.json');
    writeFileSync(target, JSON.stringify(REAL_LOOKING_ENTRY), { mode: 0o600 });
    symlinkSync(target, link);
    expect(registryTrustworthy(link)).toBe(false);
  });

  it('rejects a file others can write', () => {
    const f = join(root, 'daemons.json');
    writeFileSync(f, JSON.stringify(REAL_LOOKING_ENTRY));
    chmodSync(f, 0o666);
    expect(registryTrustworthy(f)).toBe(false);
  });

  it('rejects any file inside a world-writable directory', () => {
    // This is the /tmp case exactly. The file itself can look perfect — mode
    // 0600 and ours — and still be replaceable by rename from outside.
    const openDir = join(root, 'open');
    mkdirSync(openDir);
    chmodSync(openDir, 0o777);
    const f = join(openDir, 'daemons.json');
    writeFileSync(f, JSON.stringify(REAL_LOOKING_ENTRY), { mode: 0o600 });
    expect(registryTrustworthy(f)).toBe(false);
  });

  it('rejects a directory standing where the file should be', () => {
    const f = join(root, 'daemons.json');
    mkdirSync(f);
    expect(registryTrustworthy(f)).toBe(false);
  });
});

describe('registry I/O refuses untrusted files', () => {
  it('reads an untrusted registry as EMPTY even though it parses', () => {
    const openDir = join(root, 'open');
    mkdirSync(openDir);
    chmodSync(openDir, 0o777);
    const f = join(openDir, 'daemons.json');
    writeFileSync(f, JSON.stringify(REAL_LOOKING_ENTRY), { mode: 0o600 });

    return readRegistry({ SWEET_SEARCH_DAEMON_REGISTRY: f }).then((daemons) => {
      // Not "we read it and ignored the entries" — we never took its word at all.
      expect(daemons).toEqual({});
    });
  });

  it('still reads a trusted registry normally, so the check is not vacuous', async () => {
    const f = join(root, 'daemons.json');
    writeFileSync(f, JSON.stringify(REAL_LOOKING_ENTRY), { mode: 0o600 });
    const daemons = await readRegistry({ SWEET_SEARCH_DAEMON_REGISTRY: f });
    expect(Object.keys(daemons)).toEqual(['999999']);
  });

  it('declines to publish our socket path into an untrusted location', async () => {
    const openDir = join(root, 'open');
    mkdirSync(openDir);
    chmodSync(openDir, 0o777);
    const f = join(openDir, 'daemons.json');

    const ok = await upsertSelf(
      { pid: process.pid, projectRoot: root, socketPath: join(root, 'd.sock'), pidFile: join(root, 'd.pid'), startedAt: Date.now(), lastActivityMs: Date.now() },
      { SWEET_SEARCH_DAEMON_REGISTRY: f },
    );
    expect(ok).toBe(false);
    expect(existsSync(f)).toBe(false);
  });

  it('writes normally into a trusted location', async () => {
    const f = join(root, 'daemons.json');
    const ok = await upsertSelf(
      { pid: process.pid, projectRoot: root, socketPath: join(root, 'd.sock'), pidFile: join(root, 'd.pid'), startedAt: Date.now(), lastActivityMs: Date.now() },
      { SWEET_SEARCH_DAEMON_REGISTRY: f },
    );
    expect(ok).toBe(true);
    expect(existsSync(f)).toBe(true);
  });
});
