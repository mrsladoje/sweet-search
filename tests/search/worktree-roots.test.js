// A linked git worktree is a second checkout sharing the main repository's `.git`. It has
// no `.sweet-search/` of its own, so every ss-* call used to exit 2 -- on a surface Claude
// Code's desktop app, `claude --worktree` and worktree-isolated subagents all put agents on.
//
// Pointing both roots at the main checkout is what the bench pin did, and it was WORSE than
// failing: the tools read the parent's uncommitted tree while the harness's own `Read` saw
// the clean worktree. 45 worktree-scoped zeros across 5 of 66 sweet rollouts, and 6 of 22
// subagent ss-* results echoed the parent's own edit back as repository state.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRoots, describeWorktree, hasIndex } from '../../core/search/worktree-roots.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const fakeIndex = (dir) => {
  mkdirSync(path.join(dir, '.sweet-search'), { recursive: true });
  writeFileSync(path.join(dir, '.sweet-search', 'codebase.db'), '');
};

let root, main, linked, plain;

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wt-roots-')));
  main = path.join(root, 'main');
  linked = path.join(root, 'linked');
  plain = path.join(root, 'plain');
  mkdirSync(main); mkdirSync(plain);
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 'fixture@example.test');
  git(main, 'config', 'user.name', 'Fixture');
  mkdirSync(path.join(main, 'src'));
  writeFileSync(path.join(main, 'src/a.js'), 'export const a = 1;\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'base');
  git(main, 'worktree', 'add', '-q', linked, '-b', 'feat');
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('describeWorktree', () => {
  it('tells a linked worktree from the main checkout, and names the main checkout', () => {
    expect(describeWorktree(main).linked).toBe(false);
    const wt = describeWorktree(linked);
    expect(wt.linked).toBe(true);
    expect(realpathSync(wt.mainCheckout)).toBe(main);
    expect(realpathSync(wt.worktree)).toBe(linked);
  });

  it('returns null outside a git repository', () => {
    expect(describeWorktree(plain)).toBeNull();
  });
});

describe('resolveRoots', () => {
  it('an explicit SWEET_SEARCH_PROJECT_ROOT always wins', () => {
    // It is how the bench pins a root; second-guessing it would change measured behaviour.
    const r = resolveRoots({ cwd: linked, explicitRoot: '/pinned/elsewhere' });
    expect(r.indexRoot).toBe('/pinned/elsewhere');
    expect(r.fileRoot).toBe('/pinned/elsewhere');
    expect(r.split).toBe(false);
    expect(r.refusal).toBeNull();
  });

  it('REFUSES, with a hint, when no index exists anywhere', () => {
    // Never a silent redirect: that is exactly how the tools came to read the parent tree.
    const r = resolveRoots({ cwd: linked });
    expect(r.split).toBe(false);
    expect(r.refusal).toBeTruthy();
    expect(r.refusal).toContain(linked);
    expect(r.refusal).toContain(main);                      // names the main checkout
    expect(r.refusal).toContain('SWEET_SEARCH_PROJECT_ROOT'); // names the override
  });

  it('SPLITS the roots once the main checkout has an index, and says so', () => {
    fakeIndex(main);
    const r = resolveRoots({ cwd: linked });
    expect(r.refusal).toBeNull();
    expect(r.split).toBe(true);
    // Index lookups go to the checkout that owns the index...
    expect(realpathSync(r.indexRoot)).toBe(main);
    // ...and every byte the agent reads comes from its own worktree.
    expect(realpathSync(r.fileRoot)).toBe(linked);
    expect(r.notice).toBeTruthy();
    expect(r.notice).toContain(main);
  });

  it('does not split when the worktree has an index of its own', () => {
    fakeIndex(linked);
    const r = resolveRoots({ cwd: linked });
    expect(r.split).toBe(false);
    expect(realpathSync(r.indexRoot)).toBe(linked);
    expect(realpathSync(r.fileRoot)).toBe(linked);
    expect(r.notice).toBeUndefined();
    rmSync(path.join(linked, '.sweet-search'), { recursive: true, force: true });
  });

  it('leaves the main checkout and a non-repo directory exactly as before', () => {
    const inMain = resolveRoots({ cwd: main });
    expect(inMain.split).toBe(false);
    expect(inMain.refusal).toBeNull();
    expect(realpathSync(inMain.indexRoot)).toBe(main);

    // Not a repository and no index: the caller's own "no index here" message must still be
    // what the user sees, not a worktree hint about a repository they are not in.
    const outside = resolveRoots({ cwd: plain });
    expect(outside.refusal).toBeNull();
    expect(outside.split).toBe(false);
    expect(outside.indexRoot).toBe(plain);
  });

  it('hasIndex keys on the vector database, not on the directory', () => {
    expect(hasIndex(main)).toBe(true);
    expect(hasIndex(plain)).toBe(false);
    mkdirSync(path.join(plain, '.sweet-search'), { recursive: true });
    expect(hasIndex(plain), 'an empty .sweet-search dir is not an index').toBe(false);
    expect(hasIndex('')).toBe(false);
    expect(hasIndex(null)).toBe(false);
  });
});

describe('index admission denies worktree copies', () => {
  it('denies .claude/worktrees/** without denying the rest of .claude/', async () => {
    // `.claude/` is on the agentic gitignore allowlist, so without an explicit deny a
    // worktree copy is admitted and every file in the repository is indexed twice under a
    // path that is not where the agent edits. Copies have been seen inside a real index.
    const { createAdmissionPolicy } = await import('../../core/indexing/admission-policy.js');
    const policy = createAdmissionPolicy({ projectRoot: main });
    expect(policy.isExcluded('.claude/worktrees/feat/src/a.js')).toBe(true);
    expect(policy.admitsShape('.claude/worktrees/feat/src/a.js')).toBe(false);
    expect(policy.isExcluded('.git/worktrees/feat/HEAD')).toBe(true);
    // The rest of .claude/ stays admissible.
    expect(policy.isExcluded('.claude/settings.json')).toBe(false);
    expect(policy.isExcluded('.claude/agents/reviewer.md')).toBe(false);
    expect(policy.isExcluded('src/a.js')).toBe(false);
  });
});
