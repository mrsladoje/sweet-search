import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createImportResolver } from '../../core/graph/import-resolver.js';

// The maintainer rebuilt the import resolver every tick (104 ms at 100k files). It now keeps
// one while isCurrent() holds: the same file set, and every file the resolver read (configs,
// listings, declaration sources) unchanged. Then a kept resolver answers like a fresh one.
describe('import resolver kept across ticks', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-resolver-resident-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const write = (rel, text) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const probes = (files) => {
    const out = [];
    for (const from of files.filter((f) => f.endsWith('.ts'))) {
      for (const spec of ['./a', './b', '../lib/c', '@app/a', '@app/b', 'pkg']) out.push([from, spec]);
    }
    return out;
  };
  const answers = (resolver, files) => probes(files).map(([from, spec]) => {
    try { return JSON.stringify(resolver.resolve(from, { spec, kind: 'import' }, 'typescript')); } catch { return 'throw'; }
  });

  it('reuses only when a fresh resolver gives the same answers (random add/delete/config edits)', () => {
    write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }));
    const pool = ['src/a.ts', 'src/b.ts', 'src/x/a.ts', 'src/x/b.ts', 'lib/c.ts', 'src/y.ts'];
    for (const f of pool) write(f, 'export const v = 1;\n');
    let files = ['src/a.ts', 'lib/c.ts', 'src/y.ts'];
    let kept = createImportResolver({ projectRoot: root, files, probeFs: false });
    answers(kept, files); // let it read its configs
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let reused = 0;
    for (let step = 0; step < 40; step += 1) {
      const r = rnd();
      if (r < 0.3) {
        const f = pool[Math.floor(rnd() * pool.length)];
        files = files.includes(f) ? files.filter((x) => x !== f) : [...files, f];
      } else if (r < 0.4) {
        write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': [rnd() < 0.5 ? 'src/*' : 'src/x/*'] } } }));
        const t = new Date(Date.now() + step * 1000);
        utimesSync(join(root, 'tsconfig.json'), t, t);
      }
      const fresh = createImportResolver({ projectRoot: root, files, probeFs: false });
      if (kept.isCurrent(files)) {
        reused += 1;
        expect(answers(kept, files)).toEqual(answers(fresh, files));
      } else {
        kept = fresh;
      }
      answers(kept, files);
    }
    expect(reused).toBeGreaterThan(5);
    expect(answers(kept, files).some((a) => a !== 'null')).toBe(true);
  });

  it('is not current after the file set or a config it read changes', () => {
    write('tsconfig.json', '{}');
    write('src/a.ts', 'export const a = 1;\n');
    const files = ['src/a.ts'];
    const resolver = createImportResolver({ projectRoot: root, files, probeFs: false });
    resolver.resolve('src/a.ts', { spec: '@app/b', kind: 'import' }, 'typescript'); // a path alias: reads tsconfig.json
    expect(resolver.isCurrent(files)).toBe(true);
    expect(resolver.isCurrent([...files, 'src/b.ts'])).toBe(false);
    write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.' } }));
    expect(resolver.isCurrent(files)).toBe(false);
  });
});
