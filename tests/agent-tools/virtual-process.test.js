/**
 * One ss-* call = one virtual process (core/agent-tools/virtual-process.js). The daemon
 * runs many calls at once for many callers; each must see only its own environment and
 * working directory, and hand back only its own output and exit code.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { runInVirtualProcess, currentCall } from '../../core/agent-tools/virtual-process.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe('virtual process', () => {
  it('keeps env, cwd and output apart between interleaved calls', async () => {
    const [a, b] = await Promise.all([
      runInVirtualProcess({ env: { WHO: 'a' }, cwd: '/tmp' }, async () => {
        await tick(15);
        process.stdout.write(`${process.env.WHO} ${process.cwd()} ${process.env.ONLY_B}\n`);
        process.env.SET_BY_A = '1';
      }),
      runInVirtualProcess({ env: { WHO: 'b', ONLY_B: 'yes' }, cwd: '/usr' }, async () => {
        process.stdout.write(`${process.env.WHO} ${process.cwd()}\n`);
        await tick(25);
        process.stdout.write(`after: ${process.env.SET_BY_A}\n`);
      }),
    ]);
    expect(a.stdout.toString()).toBe('a /tmp undefined\n');
    expect(b.stdout.toString()).toBe('b /usr\nafter: undefined\n');
    expect(process.env.SET_BY_A).toBeUndefined();
    expect(process.env.WHO).toBeUndefined();
    expect(currentCall()).toBeNull();
  });

  it('turns process.exit into the call exit code, from any depth', async () => {
    const deep = async () => { await tick(1); process.exit(3); };
    const r = await runInVirtualProcess({ env: {}, cwd: '/' }, async () => {
      process.stdout.write('before\n');
      await deep();
      process.stdout.write('never\n');
    });
    expect(r.code).toBe(3);
    expect(r.stdout.toString()).toBe('before\n');
  });

  it('a normal return is exit 0; a throw is exit 1 with a crash line on stderr', async () => {
    expect((await runInVirtualProcess({ env: {}, cwd: '/' }, async () => {})).code).toBe(0);
    const r = await runInVirtualProcess({ env: {}, cwd: '/' }, async () => { throw new Error('boom'); });
    expect(r.code).toBe(1);
    expect(r.stderr.toString()).toMatch(/^\[ss-\*\] crash: Error: boom/);
  });

  it('sends console.log to stderr (engine load banners never reach the agent)', async () => {
    const r = await runInVirtualProcess({ env: {}, cwd: '/' }, async () => {
      console.log('BinaryHNSW: Loaded', 42);
      process.stderr.write(Buffer.from('raw\n'));
      process.stdout.write('result\n', 'utf8', () => {});
    });
    expect(r.stdout.toString()).toBe('result\n');
    expect(r.stderr.toString()).toBe('BinaryHNSW: Loaded 42\nraw\n');
  });

  it("children inherit the call's environment, not the host's", async () => {
    const r = await runInVirtualProcess({ env: { PATH: process.env.PATH, MARK: 'call' }, cwd: '/' }, async () => {
      process.stdout.write(execFileSync('sh', ['-c', 'printf "%s" "$MARK"'], { encoding: 'utf8' }));
    });
    expect(r.stdout.toString()).toBe('call');
  });

  it('enumerates only the call environment', async () => {
    const r = await runInVirtualProcess({ env: { ONE: '1', TWO: '2' }, cwd: '/' }, async () => {
      process.stdout.write(JSON.stringify({ keys: Object.keys(process.env).sort(), has: 'ONE' in process.env, spread: { ...process.env } }));
    });
    expect(JSON.parse(r.stdout.toString())).toEqual({ keys: ['ONE', 'TWO'], has: true, spread: { ONE: '1', TWO: '2' } });
  });
});
