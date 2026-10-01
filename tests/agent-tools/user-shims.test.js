/**
 * ss-* on the agent's PATH for a project-local install (scripts/user-shims.js): init copies
 * the native binary into a user bin directory already on PATH, records each file it wrote,
 * and `uninstall --all` removes exactly those files — never a user's own ss-*.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentPathDirs, installUserShims, planUserShimRemovals, readShimManifest, removeUserShims, shimManifestPath,
} from '../../scripts/user-shims.js';
import { setUpAgentTools } from '../../scripts/init.js';
import { AGENT_TOOLS } from '../../core/agent-tools/tools.js';

const NAMES = Object.keys(AGENT_TOOLS);

function world() {
  const base = mkdtempSync(path.join(tmpdir(), 'ss-shims-'));
  const home = path.join(base, 'home');
  const userBin = path.join(home, '.local', 'bin');
  mkdirSync(userBin, { recursive: true });
  const pkg = path.join(base, 'proj', 'node_modules', 'sweet-search');
  mkdirSync(pkg, { recursive: true });
  const binary = path.join(base, 'native-bin');
  writeFileSync(binary, 'native v1');
  chmodSync(binary, 0o755);
  const sys = path.join(base, 'usr-bin');
  mkdirSync(sys);
  return { base, home, userBin, pkg, binary, sys, env: { PATH: `${userBin}:${sys}` } };
}

describe('installUserShims', () => {
  it('copies the binary under every ss-* name into ~/.local/bin and records each file', () => {
    const w = world();
    const r = installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home });
    expect(r.status).toBe('installed');
    expect(r.dir).toBe(w.userBin);
    const inodes = new Set();
    for (const n of NAMES) {
      const f = path.join(w.userBin, n);
      expect(readFileSync(f, 'utf8')).toBe('native v1');
      expect(statSync(f).mode & 0o111).toBeTruthy();
      inodes.add(statSync(f).ino);
    }
    expect(inodes.size, 'one file on disk, six names').toBe(1);
    expect(readShimManifest(w.home).shims.map((e) => e.path).sort()).toEqual(NAMES.map((n) => path.join(w.userBin, n)).sort());
    expect(readdirSync(w.userBin).sort(), 'no temporary files left').toEqual([...NAMES].sort());
  });

  it('a second run changes nothing; a newer binary refreshes the copies', () => {
    const w = world();
    installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home });
    expect(installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home }).status).toBe('current');
    writeFileSync(w.binary, 'native v2');
    expect(installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home }).status).toBe('installed');
    for (const n of NAMES) expect(readFileSync(path.join(w.userBin, n), 'utf8')).toBe('native v2');
    expect(planUserShimRemovals({ home: w.home })).toHaveLength(NAMES.length);
  });

  it('never overwrites a user\'s own ss-* command', () => {
    const w = world();
    writeFileSync(path.join(w.userBin, 'ss-grep'), '#!/bin/sh\necho mine\n', { mode: 0o755 });
    const r = installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home });
    expect(r.conflicts).toEqual([path.join(w.userBin, 'ss-grep')]);
    expect(readFileSync(path.join(w.userBin, 'ss-grep'), 'utf8')).toContain('mine');
    expect(readFileSync(path.join(w.userBin, 'ss-read'), 'utf8')).toBe('native v1');
    expect(readShimManifest(w.home).shims.map((e) => path.basename(e.path))).not.toContain('ss-grep');
  });

  it('does nothing when a global install already has every name on PATH', () => {
    const w = world();
    for (const n of NAMES) writeFileSync(path.join(w.sys, n), 'global', { mode: 0o755 });
    const r = installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home });
    expect(r.status).toBe('not-needed');
    expect(readdirSync(w.userBin)).toEqual([]);
    expect(existsSync(shimManifestPath(w.home))).toBe(false);
  });

  it('ignores the node_modules/.bin directories npx puts on its own PATH', () => {
    const w = world();
    const dotBin = path.join(w.base, 'proj', 'node_modules', '.bin');
    mkdirSync(dotBin, { recursive: true });
    for (const n of NAMES) writeFileSync(path.join(dotBin, n), 'local', { mode: 0o755 });
    expect(agentPathDirs({ PATH: `${dotBin}:${w.userBin}` })).toEqual([w.userBin]);
    const r = installUserShims({ binary: w.binary, packageRoot: w.pkg, env: { PATH: `${dotBin}:${w.env.PATH}` }, home: w.home });
    expect(r.status).toBe('installed');
  });

  it('writes nothing without a user bin directory on PATH, or for an npx cache copy', () => {
    const w = world();
    expect(installUserShims({ binary: w.binary, packageRoot: w.pkg, env: { PATH: w.sys }, home: w.home }).status).toBe('no-dir');
    const npx = path.join(w.base, '_npx', 'abc', 'node_modules', 'sweet-search');
    expect(installUserShims({ binary: w.binary, packageRoot: npx, env: w.env, home: w.home }).status).toBe('skipped');
    expect(readdirSync(w.userBin)).toEqual([]);
  });

  it('SWEET_SEARCH_BIN_DIR picks the directory', () => {
    const w = world();
    const own = path.join(w.base, 'mybin');
    const r = installUserShims({ binary: w.binary, packageRoot: w.pkg, env: { ...w.env, SWEET_SEARCH_BIN_DIR: own }, home: w.home });
    expect(r.dir).toBe(own);
    expect(readFileSync(path.join(own, 'ss-trace'), 'utf8')).toBe('native v1');
  });
});

describe('removeUserShims (uninstall --all)', () => {
  it('removes exactly the recorded files and keeps one the user changed', () => {
    const w = world();
    installUserShims({ binary: w.binary, packageRoot: w.pkg, env: w.env, home: w.home });
    // The user replaced one (new file, new inode): it is theirs now.
    const replaced = path.join(w.userBin, 'ss-find');
    writeFileSync(`${replaced}.new`, '#!/bin/sh\necho mine\n');
    renameSync(`${replaced}.new`, replaced);
    writeFileSync(path.join(w.userBin, 'other-tool'), 'x');

    const dry = removeUserShims({ home: w.home, dryRun: true });
    expect(dry.removed).toHaveLength(NAMES.length - 1);
    expect(existsSync(path.join(w.userBin, 'ss-grep')), 'a dry run removes nothing').toBe(true);

    const r = removeUserShims({ home: w.home });
    expect(r.removed.sort()).toEqual(NAMES.filter((n) => n !== 'ss-find').map((n) => path.join(w.userBin, n)).sort());
    expect(r.kept).toEqual([replaced]);
    expect(readdirSync(w.userBin).sort()).toEqual(['other-tool', 'ss-find']);
    expect(existsSync(shimManifestPath(w.home))).toBe(false);
  });
});

describe('setUpAgentTools with a local install', () => {
  it('puts ss-* on PATH through the user bin directory, and says where', () => {
    const w = world();
    const r = setUpAgentTools({
      env: w.env, home: w.home,
      link: () => ({ status: 'linked', detail: 'x', binary: w.binary, packageRoot: w.pkg }),
    });
    expect(r.onPath).toBe(true);
    expect(r.detail).toContain(w.userBin);
    expect(existsSync(path.join(w.userBin, 'ss-semantic'))).toBe(true);
  });

  it('names the fix when no user bin directory is on PATH', () => {
    const w = world();
    const r = setUpAgentTools({
      env: { PATH: w.sys }, home: w.home,
      link: () => ({ status: 'linked', detail: 'x', binary: w.binary, packageRoot: w.pkg }),
    });
    expect(r.onPath).toBe(false);
    expect(r.detail).toContain('npm install -g sweet-search');
    expect(r.detail).toContain(path.join(w.home, '.local', 'bin'));
  });
});
