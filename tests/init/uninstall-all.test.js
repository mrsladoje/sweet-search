/**
 * `sweet-search uninstall` scope:
 *   - default: this repo only; the shared model cache is kept for other repos
 *   - --all (alias --purge): every repo init recorded, the shared cache, and
 *     the npm package
 *
 * Every CLI run here sets HOME to a temp dir, so `--all` can only ever delete
 * a fake ~/.cache/sweet-search. Running from the source checkout means
 * detectPackageInstall() reports 'none', so no npm uninstall is attempted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRepoRegistry, registerRepo, unregisterRepos } from '../../scripts/repo-registry.js';
import { detectPackageInstall } from '../../scripts/uninstall.js';
import { installUserShims } from '../../scripts/user-shims.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'core', 'cli.js');

let home;
let registry;
let env;

beforeEach(() => {
  // realpath: on macOS tmpdir() is /var/..., but the CLI sees /private/var/... .
  home = realpathSync(mkdtempSync(join(tmpdir(), 'sweet-search-home-')));
  registry = join(home, '.cache', 'sweet-search', 'repos.json');
  env = { ...process.env, HOME: home, SWEET_SEARCH_REPO_REGISTRY: registry };
  delete env.SWEET_SEARCH_MODEL_CACHE;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function makeRepo(name) {
  const root = join(home, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  return root;
}

function runCli(cwd, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function initRepo(root) {
  const r = runCli(root, ['init', '--profile=core', '--skip-prewarm-hook', '--skip-cuda']);
  expect(r.code, r.out).toBe(0);
}

function fakeModelCache() {
  const models = join(home, '.cache', 'sweet-search', 'models', 'some-model');
  mkdirSync(models, { recursive: true });
  writeFileSync(join(models, 'model.onnx'), 'x'.repeat(2048));
  return models;
}

describe('repo registry', () => {
  it('records each repo once and forgets it on unregister', () => {
    const e = { SWEET_SEARCH_REPO_REGISTRY: registry };
    const a = makeRepo('a');
    const b = makeRepo('b');
    registerRepo(a, e);
    registerRepo(b, e);
    registerRepo(a, e);
    expect(readRepoRegistry(e)).toEqual([a, b]);
    unregisterRepos([a], e);
    expect(readRepoRegistry(e)).toEqual([b]);
  });

  it('drops repos that no longer exist when it records a new one', () => {
    const e = { SWEET_SEARCH_REPO_REGISTRY: registry };
    const live = makeRepo('live');
    registerRepo('/definitely/gone/repo', e);
    registerRepo(live, e);
    expect(readRepoRegistry(e)).toEqual([live]);
  });

  it('reads a missing or corrupt record as empty', () => {
    const e = { SWEET_SEARCH_REPO_REGISTRY: registry };
    expect(readRepoRegistry(e)).toEqual([]);
    mkdirSync(dirname(registry), { recursive: true });
    writeFileSync(registry, 'not json');
    expect(readRepoRegistry(e)).toEqual([]);
  });
});

describe('detectPackageInstall', () => {
  it('recognises global and source-checkout installs', () => {
    expect(detectPackageInstall('/g/lib/node_modules/sweet-search', '/g/lib/node_modules')).toEqual({ kind: 'global' });
    expect(detectPackageInstall('/src/sweet-search', '/g/lib/node_modules')).toEqual({ kind: 'none' });
    expect(detectPackageInstall('/u/.npm/_npx/ab12/node_modules/sweet-search', '/g/lib/node_modules'))
      .toEqual({ kind: 'none' });
  });

  it('calls it local only when the project declares sweet-search', () => {
    const app = join(home, 'app');
    mkdirSync(join(app, 'node_modules', 'sweet-search'), { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ devDependencies: { 'sweet-search': '^2.9.0' } }));
    expect(detectPackageInstall(join(app, 'node_modules', 'sweet-search'), '/g/lib/node_modules'))
      .toEqual({ kind: 'local', cwd: app });
  });

  it('calls a store layout it cannot verify "other" instead of guessing an npm command', () => {
    const store = join(home, '.pnpm', 'sweet-search@2.9.0', 'node_modules', 'sweet-search');
    mkdirSync(store, { recursive: true });
    expect(detectPackageInstall(store, '/g/lib/node_modules')).toEqual({ kind: 'other', path: store });
  });
});

describe('uninstall scope', () => {
  it('init records the repo', () => {
    const repo = makeRepo('repo-a');
    initRepo(repo);
    expect(JSON.parse(readFileSync(registry, 'utf8')).repos).toContain(repo);
  });

  it('default uninstall cleans this repo only and keeps the shared models', () => {
    const a = makeRepo('repo-a');
    const b = makeRepo('repo-b');
    initRepo(a);
    initRepo(b);
    const models = fakeModelCache();

    const r = runCli(a, ['uninstall', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(a, '.sweet-search'))).toBe(false);
    expect(existsSync(join(b, '.sweet-search'))).toBe(true);
    expect(existsSync(models)).toBe(true);
    expect(r.out).toContain('kept for your other repos');
    expect(r.out).toContain('sweet-search uninstall --all');
    expect(JSON.parse(readFileSync(registry, 'utf8')).repos).toEqual([b]);
  });

  it('--keep-models is still accepted and behaves like the default', () => {
    const a = makeRepo('repo-a');
    initRepo(a);
    const models = fakeModelCache();
    const r = runCli(a, ['uninstall', '--force', '--keep-models']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(models)).toBe(true);
  });

  it('--all --dry-run lists every recorded repo and the shared cache, removes nothing', () => {
    const a = makeRepo('repo-a');
    const b = makeRepo('repo-b');
    initRepo(a);
    initRepo(b);
    const models = fakeModelCache();

    const r = runCli(a, ['uninstall', '--all', '--dry-run']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`Repo: ${a}`);
    expect(r.out).toContain(`Repo: ${b}`);
    expect(r.out).toContain('shared model cache');
    expect(existsSync(join(b, '.sweet-search'))).toBe(true);
    expect(existsSync(models)).toBe(true);
  });

  it('--all removes every recorded repo and the shared cache, even from another directory', () => {
    const a = makeRepo('repo-a');
    const b = makeRepo('repo-b');
    initRepo(a);
    initRepo(b);
    fakeModelCache();
    const elsewhere = makeRepo('not-initialized');

    const r = runCli(elsewhere, ['uninstall', '--all', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(a, '.sweet-search'))).toBe(false);
    expect(existsSync(join(b, '.sweet-search'))).toBe(false);
    expect(existsSync(join(home, '.cache', 'sweet-search'))).toBe(false);
    expect(r.out).not.toContain('npm uninstall');
  });

  it('--all removes the ss-* commands init put on PATH, and never a user\'s own', () => {
    const userBin = join(home, '.local', 'bin');
    mkdirSync(userBin, { recursive: true });
    writeFileSync(join(userBin, 'ss-grep'), '#!/bin/sh\necho mine\n', { mode: 0o755 });
    const binary = join(home, 'native-bin');
    writeFileSync(binary, 'native', { mode: 0o755 });
    const shims = installUserShims({ binary, packageRoot: join(home, 'p', 'node_modules', 'sweet-search'), env: { PATH: userBin }, home });
    expect(shims.status).toBe('installed');
    expect(existsSync(join(userBin, 'ss-read'))).toBe(true);
    const elsewhere = makeRepo('not-initialized');

    const dry = runCli(elsewhere, ['uninstall', '--all', '--dry-run']);
    expect(dry.out).toContain(join(userBin, 'ss-read'));
    expect(existsSync(join(userBin, 'ss-read'))).toBe(true);

    const r = runCli(elsewhere, ['uninstall', '--all', '--force']);
    expect(r.code, r.out).toBe(0);
    for (const n of ['ss-search', 'ss-find', 'ss-read', 'ss-semantic', 'ss-trace']) {
      expect(existsSync(join(userBin, n)), n).toBe(false);
    }
    expect(readFileSync(join(userBin, 'ss-grep'), 'utf8')).toContain('mine');
    expect(existsSync(join(home, '.cache', 'sweet-search'))).toBe(false);
  });

  it('a repo-scoped uninstall leaves the ss-* commands on PATH for the other repos', () => {
    const repo = makeRepo('repo');
    initRepo(repo);
    const userBin = join(home, '.local', 'bin');
    mkdirSync(userBin, { recursive: true });
    const binary = join(home, 'native-bin');
    writeFileSync(binary, 'native', { mode: 0o755 });
    installUserShims({ binary, packageRoot: join(home, 'p', 'node_modules', 'sweet-search'), env: { PATH: userBin }, home });
    const r = runCli(repo, ['uninstall', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(userBin, 'ss-read'))).toBe(true);
  });

  it('--all refuses to run without a terminal unless --force is given', () => {
    const a = makeRepo('repo-a');
    initRepo(a);
    const models = fakeModelCache();
    const r = runCli(a, ['uninstall', '--all']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('--force');
    expect(existsSync(join(a, '.sweet-search'))).toBe(true);
    expect(existsSync(models)).toBe(true);
  });

  it('--all with a custom SWEET_SEARCH_MODEL_CACHE removes only the recorded model dirs', () => {
    const custom = join(home, 'my-models');
    const theirs = join(custom, 'someone-elses-file.bin');
    mkdirSync(custom, { recursive: true });
    writeFileSync(theirs, 'keep me');
    env.SWEET_SEARCH_MODEL_CACHE = custom;
    const a = makeRepo('repo-a');
    initRepo(a);
    // Simulate a model init recorded under the custom root.
    const modelDir = join(custom, 'recorded-model');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'model.onnx'), 'x');
    const cfgPath = join(a, '.sweet-search', 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.models = { 'recorded-model': { cacheDir: modelDir } };
    writeFileSync(cfgPath, JSON.stringify(cfg));

    const r = runCli(a, ['uninstall', '--all', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(modelDir)).toBe(false);
    expect(existsSync(theirs)).toBe(true);
    expect(existsSync(custom)).toBe(true);
  });

  it('--purge is an alias for --all', () => {
    const a = makeRepo('repo-a');
    initRepo(a);
    fakeModelCache();
    const r = runCli(a, ['uninstall', '--purge', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(home, '.cache', 'sweet-search'))).toBe(false);
  });
});
