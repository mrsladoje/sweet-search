import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CHAIN_LATER_ENV,
  CHAIN_PID_ENV,
  chainBoundary,
  chainBoundaryLine,
  chainKey,
  isShellName,
  readProcInfo,
  registerChainCall,
  resolveChainPosition,
} from '../../core/agent-tools/chain.js';

const dirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chain-'));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fake(rows) {
  return (pid) => {
    const r = rows.find(x => x[0] === pid);
    return r ? { ppid: r[1], comm: r[2], start: r[3] } : null;
  };
}

describe('chained-call boundary line', () => {
  it('names the tool and the first ten characters of the first argument (ss-read: the file name)', () => {
    expect(chainBoundaryLine('agent-search', ['Elasticsearch daily index', '-k', '5'])).toBe('# ss-search Elasticsea…');
    expect(chainBoundaryLine('read', ['worker/import.go', '10', '40'])).toBe('# ss-read import.go');
    expect(chainBoundaryLine('read', ['--in', 'a/b/OpensearchSpecificTemplates.java', '1', '9'])).toBe('# ss-read OpensearchSpecificTemplates.java');
    expect(chainBoundaryLine('read', ['x/' + 'a'.repeat(45) + '.rs'])).toBe('# ss-read ' + 'a'.repeat(40) + '…');
    expect(chainBoundaryLine('agent-search', ['disconnect'])).toBe('# ss-search disconnect');
    expect(chainBoundaryLine('find', ['a  b\nc'])).toBe('# ss-find a b c');
  });

  it('ss-trace names the whole symbol and the mode word, never a flag value', () => {
    expect(chainBoundaryLine('trace', ['_fetch_db_defaults_after_insert', 'callees', '--in', 'tortoise/x.py'])).toBe('# ss-trace _fetch_db_defaults_after_insert callees');
    expect(chainBoundaryLine('trace', ['--in', 'a/RealInterceptorChain.kt', 'proceed', 'callers'])).toBe('# ss-trace proceed callers');
    expect(chainBoundaryLine('trace', ['addMutationHelper', '--depth', '2'])).toBe('# ss-trace addMutationHelper');
    expect(chainBoundaryLine('trace', ['x'.repeat(45)])).toBe('# ss-trace ' + 'x'.repeat(40) + '…');
    expect(chainBoundaryLine('trace', [])).toBe('# ss-trace');
  });

  it('ss-semantic names its file, positional or --in, not the question', () => {
    expect(chainBoundaryLine('semantic', ['lib/sequel/connection_pool/timed_queue.rb', 'what happens on timeout?'])).toBe('# ss-semantic timed_queue.rb');
    expect(chainBoundaryLine('semantic', ['what happens on a/b timeout?', '--in', 'lib/x/pool.rb'])).toBe('# ss-semantic pool.rb');
    expect(chainBoundaryLine('semantic', ['how does it wait', '--in=lib/x/pool.rb', '-k', '3'])).toBe('# ss-semantic pool.rb');
  });

  it('skips flags and a flag\'s number before the first argument', () => {
    expect(chainBoundaryLine('agent-search', ['-k', '2', 'pool timeout'])).toBe('# ss-search pool timeo…');
    expect(chainBoundaryLine('grep', ['-i', 'addMutation'])).toBe('# ss-grep addMutatio…');
    expect(chainBoundaryLine('trace', [])).toBe('# ss-trace');
  });

  it('prints only for a later call of a chain', () => {
    expect(chainBoundary('find', ['x'], { [CHAIN_LATER_ENV]: '1' })).toBe('# ss-find x\n');
    expect(chainBoundary('find', ['x'], { [CHAIN_LATER_ENV]: '0' })).toBe('');
    expect(chainBoundary('find', ['x'], {})).toBe('');
  });
});

describe('chain key: the shell that ran the command', () => {
  it('recognises shells by name, path or login dash', () => {
    for (const c of ['zsh', '/bin/zsh', '-bash', 'sh', '/usr/bin/dash']) expect(isShellName(c)).toBe(true);
    for (const c of ['node', 'claude', 'codex', 'opencode', '', 'bashful']) expect(isShellName(c)).toBe(false);
  });

  it('uses the shell parent, or this process when the shell exec\'d it', () => {
    const info = fake([[7, 1, 'claude', '50'], [100, 7, '/bin/zsh', '60'], [101, 100, 'node', '61']]);
    expect(chainKey(101, info)).toBe('100-60');
    // zsh execs the last command of `-c`: that tool IS the shell; its parent is the harness.
    const execd = fake([[7, 1, 'claude', '50'], [100, 7, 'node', '60']]);
    expect(chainKey(100, execd)).toBe('100-60');
    // Two single-command tool calls of one harness never share a key.
    const other = fake([[7, 1, 'claude', '50'], [200, 7, 'node', '90']]);
    expect(chainKey(200, other)).toBe('200-90');
    expect(chainKey(999, info)).toBe(null);
  });

  it('reads this process and its parent from the OS', () => {
    const me = readProcInfo(process.pid);
    expect(me).not.toBe(null);
    expect(me.ppid).toBe(process.ppid);
    expect(String(me.start)).toMatch(/^\d+$/);
  });
});

describe('chain registry', () => {
  it('marks every call after the first of one shell, and nothing else', () => {
    const dir = tmpDir();
    expect(registerChainCall('100-60', { dir })).toBe(false);
    expect(registerChainCall('100-60', { dir })).toBe(true);
    expect(registerChainCall('100-60', { dir })).toBe(true);
    expect(registerChainCall('100-61', { dir })).toBe(false); // a reused pid
    expect(registerChainCall(null, { dir })).toBe(false);
  });

  it('treats a stale entry as a new shell and sweeps old entries', () => {
    const dir = tmpDir();
    const now = Date.now();
    expect(registerChainCall('1-1', { dir, now })).toBe(false);
    const hourLater = now + 60 * 60 * 1000;
    expect(registerChainCall('1-1', { dir, now: hourLater })).toBe(false);
    fs.writeFileSync(path.join(dir, 'old-1'), '');
    const old = new Date(now - 2 * 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, 'old-1'), old, old);
    registerChainCall('2-2', { dir });
    expect(fs.existsSync(path.join(dir, 'old-1'))).toBe(false);
  });

  it('decides once: an answer in the environment stands, else it is recorded there', () => {
    const dir = tmpDir();
    const procInfo = fake([[7, 1, 'claude', '50'], [100, 7, 'zsh', '60'], [101, 100, 'node', '61'], [102, 100, 'node', '62']]);
    const e1 = {};
    expect(resolveChainPosition(e1, { selfPid: 101, dir, procInfo })).toBe(false);
    expect(e1[CHAIN_LATER_ENV]).toBe('0');
    const e2 = {};
    expect(resolveChainPosition(e2, { selfPid: 102, dir, procInfo })).toBe(true);
    expect(e2[CHAIN_LATER_ENV]).toBe('1');
    expect(resolveChainPosition({ [CHAIN_LATER_ENV]: '0' }, { selfPid: 102, dir, procInfo })).toBe(false);
    // A launcher between the shell and the binary stands for the call.
    const e3 = { [CHAIN_PID_ENV]: '101' };
    expect(resolveChainPosition(e3, { selfPid: 555, dir, procInfo })).toBe(true);
  });
});

describe('real shells (this OS)', () => {
  // Each child prints its chain key; the shell decides how the commands are spawned.
  const probe = `node -e "import('${path.resolve('core/agent-tools/chain.js')}').then(m=>console.log(m.chainKey(process.pid)))"`;
  for (const sh of ['/bin/zsh', '/bin/bash', '/bin/sh'].filter(s => fs.existsSync(s))) {
    it(`${sh}: every command of one -c string shares a key, separate shells do not`, () => {
      const one = spawnSync(sh, ['-c', `${probe}; ${probe}; ${probe}`], { encoding: 'utf8' }).stdout.trim().split('\n');
      expect(one).toHaveLength(3);
      expect(new Set(one).size).toBe(1);
      const two = spawnSync(sh, ['-c', probe], { encoding: 'utf8' }).stdout.trim();
      expect(two).not.toBe(one[0]);
    });
  }
});
