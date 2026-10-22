/**
 * deriveOverrideEdges on an epoch-versioned graph reads every container but only the
 * methods an inheritance group can own (it read every live entity on every maintainer
 * tick). The edges must equal computeOverrideEdges over all rows: random graphs with
 * open-type families (Swift/Kotlin extension blocks, members found by parent_class),
 * closed families, overloads, private members and unrelated noise methods.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

import { computeOverrideEdges, deriveOverrideEdges } from '../../core/graph/override-edges.js';
import { compareEdgeRows, compareEntitiesForResolution } from '../../core/graph/entity-order.js';
import { createGraphSchema } from '../../core/graph/graph-extractor.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomGraph(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const exts = ['swift', 'kt', 'java', 'ts'];
  const typeNames = ['Animal', 'Dog', 'Cat', 'Observer', 'Base', 'Node', 'Leaf', 'Proto'];
  const methodNames = ['sound', 'walk', 'run', 'didChange', 'setUp', 'init', 'render'];
  const entities = [];
  const rels = [];
  let n = 0;
  const containers = [];
  for (let f = 0; f < 10; f++) {
    const ext = pick(exts);
    const file = `src/f${f}.${ext}`;
    let line = 1;
    for (let c = 0; c < 1 + Math.floor(r() * 3); c++) {
      const block = (ext === 'swift' || ext === 'kt') && r() < 0.3;
      const name = pick(typeNames);
      const start = line;
      const methods = 1 + Math.floor(r() * 4);
      const end = start + methods * 2 + 1;
      const type = block ? 'extension' : pick(['class', 'interface', 'struct', 'protocol']);
      const cid = `${file}:${type}:${name}:${n++}`;
      entities.push({ id: cid, name, type, file_path: file, parent_class: null, signature: `${type} ${name}`, start_line: start, end_line: end, retired: r() < 0.05 });
      containers.push({ id: cid, line: start });
      for (let m = 0; m < methods; m++) {
        const mname = pick(methodNames);
        const args = Math.floor(r() * 3);
        const priv = r() < 0.15 ? 'private ' : '';
        entities.push({ id: `${file}:method:${mname}:${n++}`, name: mname, type: 'method', file_path: file, parent_class: r() < 0.7 ? name : null,
          signature: `${priv}func ${mname}(${Array.from({ length: args }, (_, i) => `a${i}`).join(', ')})`, start_line: start + 1 + m * 2, end_line: start + 2 + m * 2, retired: r() < 0.05 });
      }
      line = end + 2;
    }
    // Swift extension members with no container in their file.
    if (ext === 'swift' && r() < 0.5) {
      entities.push({ id: `${file}:method:orphan:${n++}`, name: pick(methodNames), type: 'method', file_path: file, parent_class: pick(typeNames),
        signature: 'func orphan()', start_line: line + 10, end_line: line + 11, retired: false });
    }
  }
  // Noise: many methods in files with no inheritance at all.
  for (let i = 0; i < 40; i++) {
    entities.push({ id: `noise/n${i}.go:function:fn${i}:${n++}`, name: pick(methodNames), type: 'function', file_path: `noise/n${i}.go`, parent_class: null,
      signature: 'func x()', start_line: 1, end_line: 3, retired: false });
  }
  for (let i = 0; i < 14; i++) {
    const s = pick(containers);
    const t = pick(containers);
    if (s.id === t.id) continue;
    rels.push({ source_id: s.id, target_id: t.id, type: pick(['extends', 'implements']), context_line: s.line, retired: r() < 0.1 });
  }
  for (const c of containers) {
    if (!c.id.includes(':extension:')) continue;
    const t = pick(containers);
    if (r() < 0.5) rels.push({ source_id: c.id, target_id: t.id, type: 'extensionOf', context_line: c.line, retired: false });
  }
  const seen = new Set();
  const unique = rels.filter((x) => {
    const key = `${x.source_id}|${x.target_id}|${x.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { entities, rels: unique };
}

describe('override edges from the scoped read', () => {
  it('equal the edges computed from every live row, on 40 random graphs', () => {
    let nonEmpty = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { entities, rels } = randomGraph(seed);
      const db = new Database(':memory:');
      createGraphSchema(db);
      const insE = db.prepare('INSERT INTO entities (id, name, type, file_path, parent_class, signature, start_line, end_line, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)');
      for (const e of entities) insE.run(e.id, e.name, e.type, e.file_path, e.parent_class, e.signature, e.start_line, e.end_line, e.retired ? 2 : null);
      const insR = db.prepare("INSERT INTO relationships (source_id, target_id, target_name, type, weight, context_line, epoch_written, epoch_retired) VALUES (?, ?, '', ?, 1, ?, 1, ?)");
      for (const x of rels) insR.run(x.source_id, x.target_id, x.type, x.context_line, x.retired ? 2 : null);

      const live = entities.filter((e) => !e.retired).map(({ retired, ...e }) => e).sort(compareEntitiesForResolution);
      const inh = rels.filter((x) => !x.retired && x.type !== 'extensionOf').map(({ source_id, target_id, context_line }) => ({ source_id, target_id, context_line })).sort(compareEdgeRows);
      const ext = rels.filter((x) => !x.retired && x.type === 'extensionOf').map(({ source_id, context_line, target_id }) => ({ source_id, context_line, target_id })).sort(compareEdgeRows);
      const want = computeOverrideEdges(live, inh, ext).map((e) => `${e.source}|${e.target}|${e.name}|${e.line}`).sort();

      deriveOverrideEdges(db, { epoch: 3 });
      const got = db.prepare("SELECT source_id, target_id, target_name, context_line FROM relationships WHERE type = 'overrides' AND epoch_retired IS NULL")
        .all().map((x) => `${x.source_id}|${x.target_id}|${x.target_name}|${x.context_line}`).sort();
      expect(got, `seed ${seed}`).toEqual(want);
      if (want.length > 0) nonEmpty += 1;
      db.close();
    }
    expect(nonEmpty).toBeGreaterThan(10);
  });
});
