import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateWatermarks, DEFAULT_WATERMARKS } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import { readVocabState, VOCAB_STATE, VOCAB_RUNNING } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { vocabRefreshHandler, vocabRefreshInFlight } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import { detectCommunities, computeGraphHash } from '../../core/graph/community-detector.js';
import { createGraphSchema } from '../../core/graph/graph-extractor.js';

// communities.json and the vocabulary embedding artifacts were built only by the full index
// run: the maintainer never refreshed them, so a maintained index kept the communities and
// hub vocabulary of its first build however much the code changed.
describe('vocab_refresh watermark', () => {
  const vocab = (v) => ({ vocab: { graphEpoch: 9, vocabEpoch: 0, liveRelationships: 1000, msSinceRun: Infinity, ...v } });

  it('fires once enough of the graph changed and the interval passed', () => {
    expect(evaluateWatermarks(vocab({ changedRows: 50 }))).toEqual([
      { tier: 'vocab_refresh', reason: 'graph_changed', payload: { graphEpoch: 9, vocabEpoch: 0, changedRows: 50 } },
    ]);
    expect(evaluateWatermarks(vocab({ changedRows: DEFAULT_WATERMARKS.vocabChangeRows, liveRelationships: 10 ** 9 }))).toHaveLength(1);
  });

  it('waits for enough change, for the interval, and for a graph change', () => {
    expect(evaluateWatermarks(vocab({ changedRows: 49 }))).toEqual([]);
    expect(evaluateWatermarks(vocab({ changedRows: 500, msSinceRun: DEFAULT_WATERMARKS.vocabIntervalMs - 1 }))).toEqual([]);
    expect(evaluateWatermarks(vocab({ changedRows: 500, vocabEpoch: 9 }))).toEqual([]);
    expect(evaluateWatermarks(vocab({ changedRows: 500, running: true }))).toEqual([]);
  });
});

function graphDb(path, { entities, edges }) {
  const db = new Database(path);
  createGraphSchema(db);
  const e = db.prepare('INSERT INTO entities (id, name, type, file_path, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?, ?)');
  for (const x of entities) e.run(x.id, x.name ?? x.id, x.type ?? 'function', x.file ?? `src/${x.id}.js`, x.written ?? 0, x.retired ?? null);
  const r = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, epoch_written, epoch_retired) VALUES (?, ?, ?, ?, ?, ?)');
  for (const x of edges) r.run(x.s, x.t, x.t, x.type ?? 'calls', x.written ?? 0, x.retired ?? null);
  db.close();
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('communities of a maintained graph', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-vocab-comm-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('equal the full build of the same live graph: retired rows and row order do not count', () => {
    const r = rng(7);
    const entities = Array.from({ length: 60 }, (_, i) => ({ id: `e${String(i).padStart(2, '0')}`, file: `src/m${i % 6}/f${i % 12}.js` }));
    const edges = [];
    for (let i = 0; i < 160; i++) {
      const s = entities[Math.floor(r() * 60)].id;
      const t = entities[Math.floor(r() * 60)].id;
      if (s !== t && !edges.some((x) => x.s === s && x.t === t)) edges.push({ s, t, type: r() < 0.2 ? 'imports' : 'calls' });
    }
    graphDb(join(dir, 'full.db'), { entities, edges });
    // The maintained graph: the same live rows written in another order at later epochs,
    // next to retired versions of entities and edges that the code no longer has.
    const retiredEntities = Array.from({ length: 20 }, (_, i) => ({ id: `gone${i}`, file: 'src/old.js', written: 1, retired: 3 }));
    const retiredEdges = Array.from({ length: 40 }, (_, i) => ({ s: entities[i].id, t: i % 2 ? `gone${i % 20}` : entities[59 - i].id, written: 1, retired: 2 + (i % 3) }));
    graphDb(join(dir, 'maintained.db'), {
      entities: [...retiredEntities, ...entities.map((x, i) => ({ ...x, written: 1 + (i % 4) }))].reverse(),
      edges: [...edges.map((x, i) => ({ ...x, written: 2 + (i % 5) })).reverse(), ...retiredEdges],
    });

    const full = detectCommunities(join(dir, 'full.db'), { timeoutMs: 10_000 });
    const maintained = detectCommunities(join(dir, 'maintained.db'), { timeoutMs: 10_000 });
    expect(full.communities.length).toBeGreaterThan(1);
    expect(maintained.communities).toEqual(full.communities);
    expect(maintained.graphHash).toBe(full.graphHash);
    expect(maintained.relationshipCount).toBe(edges.length);
    expect(computeGraphHash(join(dir, 'maintained.db'))).toBe(computeGraphHash(join(dir, 'full.db')));
  });
});

describe('vocab_refresh job', () => {
  let root;
  let stateDir;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ss-vocab-refresh-'));
    stateDir = join(root, '.sweet-search');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const names = ['PaymentGateway', 'InvoiceRenderer', 'LedgerStore', 'TaxCalculator', 'RefundPolicy', 'CurrencyFormatter'];
  function project() {
    const entities = [];
    const edges = [];
    names.forEach((name, i) => {
      const file = `src/${name}.js`;
      writeFileSync(join(root, file), [
        `/** ${name} settles customer payments, renders invoice totals and records ledger entries. */`,
        `export class ${name} {`,
        `  /** Computes the settlement amount for a customer invoice. */`,
        `  settle${name}(invoice) { return invoice.total; }`,
        '}',
      ].join('\n'));
      entities.push({ id: name, name, type: 'class', file });
      entities.push({ id: `${name}.settle`, name: `settle${name}`, type: 'method', file });
      edges.push({ s: `${name}.settle`, t: name, type: 'memberOf' });
      for (let k = 1; k <= 3; k++) edges.push({ s: `${names[(i + k) % names.length]}.settle`, t: name });
    });
    return { entities, edges };
  }

  it('rebuilds the artifacts from the live graph, records the epoch, and re-encodes only new texts', async () => {
    const { entities, edges } = project();
    graphDb(join(stateDir, 'code-graph.db'), { entities, edges: edges.map((x) => ({ ...x, written: 4 })) });
    const encoded = [];
    const embed = async (texts) => { encoded.push(texts.length); return texts.map((t) => Float32Array.from({ length: 8 }, (_, k) => (t.length + k) / 100)); };

    const first = await vocabRefreshHandler({}, { stateDir, projectRoot: root, embed, wait: true });
    expect(first.graphEpoch).toBe(4);
    const communities = JSON.parse(readFileSync(join(stateDir, 'communities.json'), 'utf8'));
    expect(communities.communities.length).toBeGreaterThan(0);
    expect(communities.graphHash).toBe(computeGraphHash(join(stateDir, 'code-graph.db')));
    expect(JSON.parse(readFileSync(join(stateDir, VOCAB_STATE), 'utf8'))).toMatchObject({ graphEpoch: 4, liveRelationships: edges.length });
    expect(encoded.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const artifacts = readdirSync(stateDir);
    expect(artifacts.some((f) => f.startsWith('vocab-'))).toBe(true);
    expect(artifacts.filter((f) => f.endsWith('.tmp'))).toEqual([]);

    // A graph change: the state reader sees it against the recorded run.
    const db = new Database(join(stateDir, 'code-graph.db'));
    db.prepare("UPDATE relationships SET epoch_retired = 6 WHERE source_id = 'PaymentGateway.settle' AND type = 'calls'").run();
    db.close();
    const state = readVocabState(stateDir);
    expect(state).toMatchObject({ graphEpoch: 6, vocabEpoch: 4, liveRelationships: edges.length });
    expect(state.changedRows).toBe(3);
    // Each count stops at the cap, and nothing is counted inside the interval.
    expect(readVocabState(stateDir, Date.now(), { countCap: 2 }).changedRows).toBe(2);
    expect(readVocabState(stateDir, Date.now(), { intervalMs: 3_600_000 }).changedRows).toBe(0);

    // The second run encodes only what the stored artifacts do not hold.
    encoded.length = 0;
    const second = await vocabRefreshHandler({}, { stateDir, projectRoot: root, embed, wait: true });
    expect(second.graphEpoch).toBe(6);
    const total = first.terms + first.phrases;
    expect(total).toBeGreaterThan(0);
    expect(encoded.reduce((a, b) => a + b, 0)).toBeLessThan(total);
    expect(second.encoded).toBe(encoded.reduce((a, b) => a + b, 0));
    expect(readVocabState(stateDir)).toMatchObject({ graphEpoch: 6, vocabEpoch: 6, changedRows: 0, liveRelationships: edges.length - 3 });
  });

  it('without an encoder rebuilds communities.json only', async () => {
    graphDb(join(stateDir, 'code-graph.db'), project());
    await vocabRefreshHandler({}, { stateDir, projectRoot: root, wait: true });
    expect(existsSync(join(stateDir, 'communities.json'))).toBe(true);
    expect(existsSync(join(stateDir, 'vocab-identifiers.bin'))).toBe(false);
    expect(existsSync(join(stateDir, 'vocab-semantic-seeds.bin'))).toBe(false);
  });

  it('returns at once and runs in the background; a second job while it runs is skipped', async () => {
    graphDb(join(stateDir, 'code-graph.db'), project());
    const started = await vocabRefreshHandler({}, { stateDir, projectRoot: root });
    expect(started).toMatchObject({ tier: 'vocab_refresh', started: true });
    expect(existsSync(join(stateDir, VOCAB_RUNNING))).toBe(true);
    expect(readVocabState(stateDir).running).toBe(true);
    expect(await vocabRefreshHandler({}, { stateDir, projectRoot: root })).toEqual({ skipped: 'running' });
    const done = await vocabRefreshInFlight();
    expect(done.error).toBeUndefined();
    expect(existsSync(join(stateDir, VOCAB_RUNNING))).toBe(false);
    expect(existsSync(join(stateDir, 'communities.json'))).toBe(true);
    expect(readVocabState(stateDir).running).toBe(false);
  });

  it('a marker left by a dead process does not hold the job back', () => {
    graphDb(join(stateDir, 'code-graph.db'), project());
    writeFileSync(join(stateDir, 'communities.json'), '{}');
    writeFileSync(join(stateDir, VOCAB_RUNNING), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 0 }));
    expect(readVocabState(stateDir).running).toBe(false);
  });
});
