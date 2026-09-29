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
    registerRepo('/tmp/a', e);
    registerRepo('/tmp/b', e);
    registerRepo('/tmp/a', e);
    expect(readRepoRegistry(e)).toEqual(['/tmp/a', '/tmp/b']);
    unregisterRepos(['/tmp/a'], e);
    expect(readRepoRegistry(e)).toEqual(['/tmp/b']);
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
  it('recognises global, project-local and source-checkout installs', () => {
    expect(detectPackageInstall('/g/lib/node_modules/sweet-search', '/g/lib/node_modules')).toEqual({ kind: 'global' });
    expect(detectPackageInstall('/work/app/node_modules/sweet-search', '/g/lib/node_modules'))
      .toEqual({ kind: 'local', cwd: '/work/app' });
    expect(detectPackageInstall('/src/sweet-search', '/g/lib/node_modules')).toEqual({ kind: 'none' });
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

  it('--purge is an alias for --all', () => {
    const a = makeRepo('repo-a');
    initRepo(a);
    fakeModelCache();
    const r = runCli(a, ['uninstall', '--purge', '--force']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(home, '.cache', 'sweet-search'))).toBe(false);
  });
});
