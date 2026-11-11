/**
 * core/infrastructure/process-identity.js: a pid read from a file names a process only with
 * the start token stored beside it (docs/STATE_MACHINES.md, rule 7).
 *
 * The children are real processes. No sweet-search daemon is started.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';

import {
  processStartToken, ownStartToken, processIs, sweetSearchProcessIs, holderLives,
} from '../../core/infrastructure/process-identity.js';

const children = [];
afterEach(() => {
  for (const c of children.splice(0)) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
});

/** A live process that is no sweet-search process. */
function innocent() {
  const c = spawn('sleep', ['60'], { stdio: 'ignore' });
  children.push(c);
  return c;
}

/** A live process that titles itself as the daemons do; resolves once the title is set. */
function titled(title) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['-e', `process.title = ${JSON.stringify(title)}; console.log('ready'); setInterval(() => {}, 1000);`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    children.push(c);
    c.stdout.once('data', () => resolve(c));
    c.once('error', reject);
    c.once('exit', () => reject(new Error('the titled child exited early')));
  });
}

/** A pid that is certainly dead: a child that already exited. */
function deadPid() {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

const ANOTHER_TOKEN = process.platform === 'linux' ? 'no-such-boot:1' : 'Mon Jan 1 00:00:00 2001';

describe('start token', () => {
  it('is readable for this process and for a child, and does not change', () => {
    const own = ownStartToken();
    expect(typeof own).toBe('string');
    expect(own.length).toBeGreaterThan(0);
    expect(processStartToken(process.pid)).toBe(own);

    const child = innocent();
    const first = processStartToken(child.pid);
    expect(typeof first).toBe('string');
    expect(processStartToken(child.pid)).toBe(first);
  });

  it('is null for a dead pid and for a value that is no pid', () => {
    expect(processStartToken(deadPid())).toBeNull();
    expect(processStartToken(0)).toBeNull();
    expect(processStartToken(NaN)).toBeNull();
  });

  it.skipIf(process.platform === 'linux')('does not depend on the time zone of the reader', () => {
    const child = innocent();
    const here = processStartToken(child.pid);
    const before = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(processStartToken(child.pid)).toBe(here);
    } finally {
      if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
    }
  });
});

describe('processIs', () => {
  it("is 'same' for the process that has the stored token", () => {
    const child = innocent();
    expect(processIs(child.pid, processStartToken(child.pid))).toBe('same');
    expect(processIs(process.pid, ownStartToken())).toBe('same');
  });

  it("is 'other' when a live process has the pid and another token is stored", () => {
    const child = innocent();
    expect(processIs(child.pid, ANOTHER_TOKEN)).toBe('other');
    // This very process got the pid of a dead holder.
    expect(processIs(process.pid, ANOTHER_TOKEN)).toBe('other');
  });

  it("is 'gone' for a dead pid, with or without a token", () => {
    const pid = deadPid();
    expect(processIs(pid, ANOTHER_TOKEN)).toBe('gone');
    expect(processIs(pid, null)).toBe('gone');
  });

  it("is 'unknown' for a live pid with no stored token", () => {
    const child = innocent();
    expect(processIs(child.pid, null)).toBe('unknown');
    expect(processIs(child.pid, undefined)).toBe('unknown');
    expect(processIs(process.pid, null)).toBe('unknown');
  });

  it('holderLives is false only for a dead holder and for a pid that another process got', () => {
    const child = innocent();
    expect(holderLives(child.pid, processStartToken(child.pid))).toBe(true);
    expect(holderLives(child.pid, null)).toBe(true); // cannot be told: lives
    expect(holderLives(child.pid, ANOTHER_TOKEN)).toBe(false);
    expect(holderLives(deadPid(), null)).toBe(false);
  });
});

describe('sweetSearchProcessIs (the check before a signal)', () => {
  it("with no token, a process that is not titled sweet-search-… is 'other'", () => {
    const child = innocent();
    expect(sweetSearchProcessIs(child.pid, null)).toBe('other');
  });

  it("with no token, a process titled as a daemon is 'same'", async () => {
    const child = await titled('sweet-search-daemon');
    expect(sweetSearchProcessIs(child.pid, null)).toBe('same');
  });

  it('with both tokens, the tokens decide and the title does not', async () => {
    const daemon = await titled('sweet-search-maintainer');
    expect(sweetSearchProcessIs(daemon.pid, ANOTHER_TOKEN)).toBe('other');
    const child = innocent();
    expect(sweetSearchProcessIs(child.pid, processStartToken(child.pid))).toBe('same');
  });

  it("does not judge this process by its title: no token is 'unknown'", () => {
    expect(sweetSearchProcessIs(process.pid, null)).toBe('unknown');
  });
});
