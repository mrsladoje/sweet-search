/**
 * Tests for the shared file-admission policy (core/indexing/admission-policy.js)
 * and its use by full indexing (discoverFiles). This is the single policy both
 * full and incremental indexing consume, so these lock the include allowlist,
 * exclude denylist, `.sweet-search-ignore`, `.gitignore`, and max file size.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createAdmissionPolicy } from '../../core/indexing/admission-policy.js';
import { discoverFiles } from '../../core/indexing/indexer-utils.js';

function mkproj() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-admit-'));
}
function gitInit(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
}
function write(root, rel, content = 'x') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

let root;
beforeEach(() => { root = mkproj(); });
afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('admission-policy / include allowlist', () => {
  it('admits supported source / text / config / build file types', () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    for (const f of [
      'src/a.js', 'src/a.jsx', 'lib/b.ts', 'lib/b.tsx', 'x.py', 'm.go', 'r.rs',
      'c.cpp', 'h.hpp', 'app.rb', 'svc.java', 'k.kt', 'main.swift', 'q.sql',
      'README.md', 'notes.txt', 'doc.rst', 'config.yaml', 'data.toml', 'api.proto',
      'schema.graphql', 'Dockerfile', 'service.dockerfile', 'Makefile', 'page.vue',
    ]) {
      expect(p.admitsShape(f), f).toBe(true);
    }
  });

  it('rejects unsupported binary / data / archive / media types (not in include allowlist)', () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    for (const f of [
      'img/logo.png', 'photo.jpg', 'doc.pdf', 'data.parquet', 'sheet.csv',
      'a.zip', 'arch.tar', 'v.mp4', 'a.mp3', 'x.bin', 'lib.so', 'app.exe', 'f.dat',
    ]) {
      expect(p.admitsShape(f), f).toBe(false);
    }
  });
});

describe('admission-policy / exclude denylist', () => {
  it('rejects default-excluded dependency / build / lock paths', () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.admitsShape('node_modules/dep/index.js')).toBe(false);
    expect(p.admitsShape('dist/bundle.js')).toBe(false);
    expect(p.admitsShape('target/main.rs')).toBe(false);
    expect(p.admitsShape('package-lock.json')).toBe(false);
    expect(p.admitsShape('.sweet-search/state.json')).toBe(false);
    expect(p.admitsShape('src/app.min.js')).toBe(false);
  });

  it('applies project-config exclude globs on top of defaults', () => {
    write(root, '.sweet-search.config.json', JSON.stringify({ exclude: ['**/fixtures/**'] }));
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.admitsShape('src/index.js')).toBe(true);
    expect(p.admitsShape('fixtures/gen.js')).toBe(false);
    expect(p.admitsShape('pkg/fixtures/gen.js')).toBe(false);
    expect(p.admitsShape('package-lock.json')).toBe(false); // defaults still apply
  });
});

describe('admission-policy / .sweet-search-ignore', () => {
  it('rejects paths matched by .sweet-search-ignore (shared with full indexing)', () => {
    write(root, '.sweet-search-ignore', 'generated/\n**/*.snap.js\nreports/*.html\n');
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.admitsShape('src/a.js')).toBe(true);
    expect(p.admitsShape('generated/a.js')).toBe(false);
    expect(p.admitsShape('src/x.snap.js')).toBe(false);
    expect(p.admitsShape('reports/index.html')).toBe(false);
  });
});

describe('admission-policy / max file size', () => {
  it('flags files over maxFileSize and treats unstatable files as inadmissible', () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    const small = write(root, 'small.js', 'x');
    const big = write(root, 'big.js', Buffer.alloc(p.maxFileSize + 10));
    expect(p.isOversizedAbs(small)).toBe(false);
    expect(p.isOversizedAbs(big)).toBe(true);
    expect(p.isOversizedAbs(path.join(root, 'missing.js'))).toBe(true);
  });

  it('honors a custom maxFileSize from project config', () => {
    write(root, '.sweet-search.config.json', JSON.stringify({ maxFileSize: 16 }));
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.maxFileSize).toBe(16);
    const f = write(root, 'a.js', 'this string is definitely more than sixteen bytes');
    expect(p.isOversizedAbs(f)).toBe(true);
  });
});

describe('admission-policy / gitignore alignment', () => {
  it('reports gitignored paths via git check-ignore, exempting agentic paths', async () => {
    gitInit(root);
    write(root, '.gitignore', 'ignored/\nsecret.js\n.cursor/\n');
    write(root, 'ignored/a.js');
    write(root, 'secret.js');
    write(root, 'keep.js');
    write(root, '.cursor/rules.md');
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.hasGit).toBe(true);
    const ignored = await p.gitignoredSet(['ignored/a.js', 'secret.js', 'keep.js', '.cursor/rules.md']);
    expect(ignored.has('ignored/a.js')).toBe(true);
    expect(ignored.has('secret.js')).toBe(true);
    expect(ignored.has('keep.js')).toBe(false);
    expect(ignored.has('.cursor/rules.md')).toBe(false); // agentic allowlist exempt
  });

  it('treats a non-git directory as "no gitignore" (admit all)', async () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.hasGit).toBe(false);
    const ignored = await p.gitignoredSet(['anything.js', 'whatever/x.ts']);
    expect(ignored.size).toBe(0);
  });
});

describe('discoverFiles (full indexing) uses the shared policy', () => {
  it('includes source/text types, excludes binary/data/media, respects size; works without git', async () => {
    write(root, 'src/a.js', 'export const a = 1;');
    write(root, 'src/b.py', 'x = 1');
    write(root, 'README.md', '# hi');
    write(root, 'logo.png', 'PNG');
    write(root, 'data.parquet', 'PARQ');
    write(root, 'nb.ipynb', '{}');
    write(root, 'big.js', Buffer.alloc(2 * 1024 * 1024)); // > 1 MB default
    const files = new Set(await discoverFiles({ projectRoot: root, silent: true }));
    expect(files.has('src/a.js')).toBe(true);
    expect(files.has('src/b.py')).toBe(true);
    expect(files.has('README.md')).toBe(true);
    expect(files.has('logo.png')).toBe(false);
    expect(files.has('data.parquet')).toBe(false);
    expect(files.has('nb.ipynb')).toBe(true); // Jupyter notebooks now indexed (generic chunking)
    expect(files.has('big.js')).toBe(false);
  });

  it('handles an empty repo cleanly', async () => {
    expect(await discoverFiles({ projectRoot: root, silent: true })).toEqual([]);
  });

  it('respects .gitignore and .sweet-search-ignore', async () => {
    gitInit(root);
    write(root, '.gitignore', 'ignored.js\n');
    write(root, '.sweet-search-ignore', 'skipme.js\n');
    write(root, 'keep.js');
    write(root, 'ignored.js');
    write(root, 'skipme.js');
    const files = new Set(await discoverFiles({ projectRoot: root, silent: true }));
    expect(files.has('keep.js')).toBe(true);
    expect(files.has('ignored.js')).toBe(false);   // .gitignore
    expect(files.has('skipme.js')).toBe(false);    // .sweet-search-ignore (now honored by full indexing too)
  });

  it('cross-check: every discovered file passes the per-path admission policy', async () => {
    for (const f of ['src/a.js', 'src/b.ts', 'c.go', 'd.rs', 'e.md', 'f.png', 'g.parquet']) write(root, f);
    const policy = createAdmissionPolicy({ projectRoot: root });
    const files = await discoverFiles({ projectRoot: root, silent: true });
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(policy.admitsShape(f), `discovered but not admitsShape: ${f}`).toBe(true);
      expect(policy.isOversizedAbs(path.join(root, f)), f).toBe(false);
    }
  });
});

// ── Jam support + git-tracked source under build-output dirs ────────────────
// Regression for the Boost.Build blind spot (b2-113 / b2-259): `.jam` was in no
// include glob or extension map, and `src/build/*.jam` was doubly excluded by
// the `**/build/**` glob and the `build` deny-dir. Real source kept under a
// build-output dir must index; real (gitignored) build output must not.
function gitCommitAll(root) {
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: root, stdio: 'ignore' });
}

describe('admission-policy / Jam files', () => {
  it('admits .jam and extensionless Jamfile/Jamroot', () => {
    const p = createAdmissionPolicy({ projectRoot: root });
    for (const f of ['src/tools/stage.jam', 'Jamroot.jam', 'boost-build.jam', 'Jamfile', 'Jamroot', 'Jamrules']) {
      expect(p.admitsShape(f), f).toBe(true);
    }
  });
});

describe('admission-policy / git-tracked source under build-output dirs', () => {
  it('re-admits tracked src/build/*.jam but still excludes real gitignored build output', () => {
    write(root, 'src/build/property.jam', 'rule feature { }');   // tracked source
    write(root, 'src/app.py', 'x');
    write(root, 'build/out.py', 'GENERATED');                    // real build output
    write(root, 'dist/bundle.js', 'x');
    write(root, '.gitignore', '/build/\n/dist/\n');              // root-anchored: keeps src/build tracked
    gitInit(root);
    gitCommitAll(root);
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.admitsShape('src/build/property.jam')).toBe(true);  // tracked ⇒ re-admitted
    expect(p.isBuildOutputOnly('src/build/property.jam')).toBe(true);
    expect(p.admitsShape('build/out.py')).toBe(false);           // untracked build output stays out
    expect(p.admitsShape('dist/bundle.js')).toBe(false);
  });

  it('does NOT re-admit build-output source in a non-git directory (no tracking signal)', () => {
    write(root, 'src/build/property.jam', 'x');
    const p = createAdmissionPolicy({ projectRoot: root });   // no gitInit
    expect(p.hasGit).toBe(false);
    expect(p.admitsShape('src/build/property.jam')).toBe(false);
  });

  it('full discovery includes tracked src/build/*.jam via the re-admission union', async () => {
    write(root, 'src/build/property.jam', 'rule feature { }');
    write(root, 'src/tools/stage.jam', 'rule stage { }');
    write(root, 'src/app.py', 'x');
    write(root, 'build/generated.js', 'x');
    write(root, '.gitignore', '/build/\n');
    gitInit(root);
    gitCommitAll(root);
    const files = new Set(await discoverFiles({ projectRoot: root, silent: true }));
    expect(files.has('src/build/property.jam')).toBe(true);
    expect(files.has('src/tools/stage.jam')).toBe(true);
    expect(files.has('build/generated.js')).toBe(false);   // gitignored real output
  });
});

// ── .gitattributes linguist overrides (authoritative, via git check-attr) ────
describe('admission-policy / .gitattributes linguist overrides', () => {
  it('linguist-generated=false force-admits a file the deny-list would reject', () => {
    write(root, 'dist/hand-written.js', 'export const x = 1');
    write(root, '.gitattributes', 'dist/hand-written.js linguist-generated=false\n');
    gitInit(root);
    gitCommitAll(root);
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.forceAdmit('dist/hand-written.js')).toBe(true);
    expect(p.admitsShape('dist/hand-written.js')).toBe(true);   // past the dist/ deny
  });

  it('linguist-vendored skips a file that would otherwise be admitted', () => {
    write(root, 'src/thirdparty.js', 'x');
    write(root, 'src/mine.js', 'x');
    write(root, '.gitattributes', 'src/thirdparty.js linguist-vendored\n');
    gitInit(root);
    gitCommitAll(root);
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.admitsShape('src/thirdparty.js')).toBe(false);
    expect(p.admitsShape('src/mine.js')).toBe(true);
  });

  it('linguist-generated (set) still admits for grep (Tier-2, demoted downstream)', () => {
    write(root, 'api/types.gen.ts', 'export type X = 1');
    write(root, '.gitattributes', 'api/types.gen.ts linguist-generated\n');
    gitInit(root);
    gitCommitAll(root);
    const p = createAdmissionPolicy({ projectRoot: root });
    // not force-skipped at admission — the chunk policy demotes it from vectors
    expect(p.admitsShape('api/types.gen.ts')).toBe(true);
    expect(p.linguistAttr('api/types.gen.ts')).toBe('generated');
  });

  it('no .gitattributes ⇒ every path is unspecified, behaviour unchanged', () => {
    write(root, 'src/a.js', 'x');
    gitInit(root);
    gitCommitAll(root);
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.linguistAttr('src/a.js')).toBe(null);
    expect(p.forceAdmit('src/a.js')).toBe(false);
  });
});
