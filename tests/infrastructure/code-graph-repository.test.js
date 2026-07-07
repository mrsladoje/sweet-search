import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import {
  createCodeGraphVisibility,
  entityVisibilityParams,
  entityVisibilitySql,
  relationshipVisibilityParams,
  relationshipVisibilitySql,
} from '../../core/infrastructure/code-graph-visibility.js';
import { writeManifest, zeroManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';

let tmpDirs = [];
let repos = [];

function writeGraphManifest(stateDir, epoch) {
  const manifest = {
    ...zeroManifest({ codeGraph: 'code-graph.db' }),
    epoch,
    codeGraph: { path: 'code-graph.db', epoch },
  };
  writeManifest(stateDir, manifest);
}

function createGraphDb(options = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'code-graph-repo-'));
  tmpDirs.push(tmpDir);
  const dbPath = join(tmpDir, 'code-graph.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      parent_class TEXT,
      stale_since INTEGER,
      epoch_written INTEGER,
      epoch_retired INTEGER
    );

    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT,
      type TEXT,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      epoch_written INTEGER,
      epoch_retired INTEGER
    );
  `);

  const insertEntity = db.prepare(`
    INSERT INTO entities (
      id, name, type, file_path, start_line, end_line, parent_class,
      stale_since, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEntity.run('caller', 'Caller', 'function', 'src/caller.js', 1, 80, null, null, 1, null);
  insertEntity.run('widget-old', 'Widget', 'class', 'src/old-widget.js', 10, 30, null, 1111, 1, 3);
  insertEntity.run('widget-new', 'Widget', 'class', 'src/new-widget.js', 10, 30, null, null, 3, null);
  insertEntity.run('widget-future', 'FutureWidget', 'class', 'src/future-widget.js', 10, 30, null, null, 7, null);
  insertEntity.run('old-only', 'OldOnly', 'function', 'src/old-only.js', 1, 12, null, 2222, 1, 3);
  insertEntity.run('new-only', 'NewOnly', 'function', 'src/new-only.js', 1, 12, null, null, 3, null);

  const insertRelationship = db.prepare(`
    INSERT INTO relationships (
      source_id, target_id, target_name, type, weight, context_line,
      full_import_path, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRelationship.run('caller', 'widget-old', 'Widget', 'calls', 2.0, 12, null, 1, 3);
  insertRelationship.run('caller', 'widget-new', 'Widget', 'calls', 3.0, 13, null, 3, null);
  insertRelationship.run('caller', 'widget-future', 'FutureWidget', 'calls', 4.0, 14, null, 7, null);
  insertRelationship.run('caller', 'old-only', 'OldOnly', 'calls', 1.0, 15, null, 1, 3);
  insertRelationship.run('caller', 'new-only', 'NewOnly', 'calls', 1.0, 16, null, 3, null);
  db.close();

  if (Number.isInteger(options.manifestEpoch)) {
    writeGraphManifest(tmpDir, options.manifestEpoch);
  }
  return { dbPath, tmpDir };
}

function writeSingleEntityGraphDb(dbPath, entity) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      parent_class TEXT,
      stale_since INTEGER,
      epoch_written INTEGER,
      epoch_retired INTEGER
    );

    CREATE TABLE relationships (
      source_id TEXT,
      target_id TEXT,
      target_name TEXT,
      type TEXT,
      weight REAL DEFAULT 1.0,
      context_line INTEGER,
      full_import_path TEXT,
      epoch_written INTEGER,
      epoch_retired INTEGER
    );
  `);
  db.prepare(`
    INSERT INTO entities (
      id, name, type, file_path, start_line, end_line, parent_class,
      stale_since, epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entity.id,
    entity.name,
    entity.type || 'function',
    entity.filePath,
    entity.startLine || 1,
    entity.endLine || 10,
    null,
    null,
    entity.epochWritten ?? 0,
    entity.epochRetired ?? null,
  );
  db.close();
}

function openRepo(dbPath, options = {}) {
  const repo = new CodeGraphRepository(dbPath, options);
  repos.push(repo);
  return repo;
}

function resultIds(rows) {
  return rows.map((row) => row.id).sort();
}

afterEach(() => {
  for (const repo of repos) repo.close();
  repos = [];
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('CodeGraphRepository epoch visibility', () => {
  it('treats undefined manifest epoch as an unpinned live read', () => {
    const { dbPath } = createGraphDb();
    const db = new Database(dbPath, { readonly: true });
    try {
      const visibility = createCodeGraphVisibility(db, undefined);

      expect(visibility.manifestEpoch).toBeNull();
      expect(entityVisibilitySql(visibility)).toBe('stale_since IS NULL AND epoch_retired IS NULL');
      expect(entityVisibilityParams(visibility)).toEqual([]);
      expect(relationshipVisibilitySql(visibility, '')).toBe('epoch_retired IS NULL');
      expect(relationshipVisibilityParams(visibility)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('accepts bare or dotted SQL aliases for visibility predicates', () => {
    const { dbPath } = createGraphDb();
    const db = new Database(dbPath, { readonly: true });
    try {
      const visibility = createCodeGraphVisibility(db, 4);

      expect(entityVisibilitySql(visibility, 'e.')).toContain('e.epoch_written');
      expect(entityVisibilitySql(visibility, 'e.')).not.toContain('e..');
      expect(entityVisibilitySql(visibility, 'e')).toBe(entityVisibilitySql(visibility, 'e.'));
      expect(relationshipVisibilitySql(visibility, 'r.')).toContain('r.epoch_written');
      expect(relationshipVisibilitySql(visibility, 'r.')).not.toContain('r..');
      expect(relationshipVisibilitySql(visibility, 'r')).toBe(relationshipVisibilitySql(visibility, 'r.'));
    } finally {
      db.close();
    }
  });

  it('pins entity, range, and name lookups to the requested epoch', () => {
    const { dbPath } = createGraphDb();
    const epoch2 = openRepo(dbPath, { manifestEpoch: 2 });
    const epoch4 = openRepo(dbPath, { manifestEpoch: 4 });

    expect(epoch2.findEnclosingEntity('src/old-widget.js', 12, 18)?.id).toBe('widget-old');
    expect(epoch2.findEnclosingEntity('src/new-widget.js', 12, 18)).toBeNull();
    expect(epoch2.findFirstEntityInRange('src/old-widget.js', 1, 20)?.id).toBe('widget-old');
    expect(resultIds(epoch2.findEntitiesInRange('src/old-widget.js', 1, 40))).toEqual(['widget-old']);
    expect(epoch2.findEntityWithNameInRange('src/old-widget.js', 1, 40, 'widget')?.name).toBe('Widget');
    expect(epoch2.getEntityById('widget-old')?.filePath).toBe('src/old-widget.js');
    expect(epoch2.getEntityById('widget-new')).toBeNull();
    expect(resultIds(epoch2.findEntitiesByNames(['Widget'], { types: ['class'], limit: 10 }))).toEqual(['widget-old']);
    expect(resultIds(epoch2.findEntitiesByNamesCaseInsensitive(['widget'], { types: ['class'], limit: 10 }))).toEqual(['widget-old']);
    expect(resultIds(epoch2.findEntitiesByAnyName(['widget'], { limit: 10 }))).toEqual(['widget-old']);
    expect(epoch2.countEntitiesByAnyName(['widget']).get('widget')).toBe(1);

    expect(epoch4.findEnclosingEntity('src/old-widget.js', 12, 18)).toBeNull();
    expect(epoch4.findEnclosingEntity('src/new-widget.js', 12, 18)?.id).toBe('widget-new');
    expect(epoch4.getEntityById('widget-old')).toBeNull();
    expect(epoch4.getEntityById('widget-new')?.filePath).toBe('src/new-widget.js');
    expect(resultIds(epoch4.findEntitiesByNames(['Widget'], { types: ['class'], limit: 10 }))).toEqual(['widget-new']);
    expect(resultIds(epoch4.findEntitiesByAnyName(['FutureWidget'], { limit: 10 }))).toEqual([]);
  });

  it('pins outgoing, incoming, and call-count relationship lookups to the requested epoch', () => {
    const { dbPath } = createGraphDb();
    const epoch2 = openRepo(dbPath, { manifestEpoch: 2 });
    const epoch4 = openRepo(dbPath, { manifestEpoch: 4 });

    expect(epoch2.getOutgoingRelationships('caller', { types: ['calls'], limit: 10 }).map((row) => row.targetId).sort())
      .toEqual(['old-only', 'widget-old']);
    expect(epoch2.getIncomingRelationships('widget-old', { types: ['calls'], limit: 10 }).map((row) => row.source.id))
      .toEqual(['caller']);
    expect(epoch2.getIncomingRelationships('widget-new', { types: ['calls'], limit: 10 })).toEqual([]);
    expect(epoch2.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('OldOnly')).toBe(1);
    expect(epoch2.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('NewOnly')).toBe(0);

    expect(epoch4.getOutgoingRelationships('caller', { types: ['calls'], limit: 10 }).map((row) => row.targetId).sort())
      .toEqual(['new-only', 'widget-new']);
    expect(epoch4.getIncomingRelationships('widget-new', { types: ['calls'], limit: 10 }).map((row) => row.source.id))
      .toEqual(['caller']);
    expect(epoch4.getIncomingRelationships('widget-old', { types: ['calls'], limit: 10 })).toEqual([]);
    expect(epoch4.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('OldOnly')).toBe(0);
    expect(epoch4.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('NewOnly')).toBe(1);
  });

  it('does not return resolved outgoing relationships whose target entity is hidden', () => {
    const { dbPath } = createGraphDb();
    const db = new Database(dbPath);
    try {
      db.prepare(`
        INSERT INTO relationships (
          source_id, target_id, target_name, type, weight, context_line,
          full_import_path, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('caller', 'widget-future', 'FutureWidget', 'calls', 99, 99, null, 3, null);
      db.prepare(`
        INSERT INTO relationships (
          source_id, target_id, target_name, type, weight, context_line,
          full_import_path, epoch_written, epoch_retired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('caller', null, 'UnresolvedThing', 'calls', 98, 98, null, 3, null);
    } finally {
      db.close();
    }

    const epoch4 = openRepo(dbPath, { manifestEpoch: 4 });
    const rows = epoch4.getOutgoingRelationships('caller', { types: ['calls'], limit: 10 });

    expect(rows.map((row) => row.targetName)).toContain('UnresolvedThing');
    expect(rows.map((row) => row.targetId)).not.toContain('widget-future');
    const counts = epoch4.countIncomingCallsByNames(['FutureWidget', 'UnresolvedThing']);
    expect(counts.get('FutureWidget')).toBe(0);
    expect(counts.get('UnresolvedThing')).toBe(1);
  });

  it('reports file staleness at the pinned epoch without treating future rows as indexed', () => {
    const { dbPath } = createGraphDb();
    const epoch2 = openRepo(dbPath, { manifestEpoch: 2 });
    const epoch4 = openRepo(dbPath, { manifestEpoch: 4 });

    expect(epoch2.getFileIndexInfo('src/old-widget.js')).toEqual({ staleSince: null });
    expect(epoch2.getFileIndexInfo('src/future-widget.js')).toBeNull();
    expect(epoch2.getFileIndexInfo('src/missing.js')).toBeNull();

    expect(epoch4.getFileIndexInfo('src/old-widget.js')).toEqual({ staleSince: 1111 });
    expect(epoch4.getFileIndexInfo('src/new-widget.js')).toEqual({ staleSince: null });
  });

  it('refreshes adjacent manifest pins and rebuilds derived relationship-count caches', () => {
    const { dbPath, tmpDir } = createGraphDb({ manifestEpoch: 2 });
    const repo = openRepo(dbPath);

    expect(repo.getManifestEpoch()).toBe(2);
    expect(repo.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('OldOnly')).toBe(1);
    expect(repo.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('NewOnly')).toBe(0);

    writeGraphManifest(tmpDir, 4);
    expect(repo.refreshManifestEpoch()).toBe(4);
    expect(repo.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('OldOnly')).toBe(0);
    expect(repo.countIncomingCallsByNames(['OldOnly', 'NewOnly']).get('NewOnly')).toBe(1);
  });

  it('opens the code graph database named by the adjacent reconcile manifest', () => {
    const { dbPath, tmpDir } = createGraphDb();
    writeSingleEntityGraphDb(join(tmpDir, 'code-graph-epoch-5.db'), {
      id: 'manifest-only',
      name: 'ManifestOnly',
      filePath: 'src/manifest-only.js',
      epochWritten: 5,
    });
    const manifest = {
      ...zeroManifest({ codeGraph: 'code-graph-epoch-5.db' }),
      epoch: 5,
      codeGraph: { path: 'code-graph-epoch-5.db', epoch: 5 },
    };
    writeManifest(tmpDir, manifest);

    const repo = openRepo(dbPath);
    expect(repo.getEntityById('manifest-only')?.filePath).toBe('src/manifest-only.js');
    expect(repo.getEntityById('caller')).toBeNull();
  });

  it('uses the manifest code graph path when an explicit epoch is supplied', () => {
    const { dbPath, tmpDir } = createGraphDb();
    writeSingleEntityGraphDb(join(tmpDir, 'code-graph-epoch-5.db'), {
      id: 'manifest-pinned',
      name: 'ManifestPinned',
      filePath: 'src/manifest-pinned.js',
      epochWritten: 5,
    });
    writeManifest(tmpDir, {
      ...zeroManifest({ codeGraph: 'code-graph-epoch-5.db' }),
      epoch: 7,
      codeGraph: { path: 'code-graph-epoch-5.db', epoch: 7 },
    });

    const repo = openRepo(dbPath, { manifestEpoch: 5 });
    expect(repo.getEntityById('manifest-pinned')?.filePath).toBe('src/manifest-pinned.js');
    expect(repo.getEntityById('caller')).toBeNull();
  });
});

describe('findAdjacentEntities (same-file span map)', () => {
  function createAdjacencyDb() {
    const tmpDir = mkdtempSync(join(tmpdir(), 'code-graph-adj-'));
    tmpDirs.push(tmpDir);
    const dbPath = join(tmpDir, 'code-graph.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        file_path TEXT NOT NULL, start_line INTEGER, end_line INTEGER,
        parent_class TEXT, stale_since INTEGER,
        epoch_written INTEGER, epoch_retired INTEGER
      );
      CREATE TABLE relationships (
        source_id TEXT, target_id TEXT, target_name TEXT, type TEXT,
        weight REAL DEFAULT 1.0, context_line INTEGER, full_import_path TEXT,
        epoch_written INTEGER, epoch_retired INTEGER
      );
    `);
    const insert = db.prepare(`
      INSERT INTO entities (id, name, type, file_path, start_line, end_line,
        parent_class, stale_since, epoch_written, epoch_retired)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL)
    `);
    // sushi-shaped file: siblings around the 475-543 window, plus traps.
    insert.run('e-far', 'assignFshCode', 'function', 'src/common.ts', 100, 200, null);
    insert.run('e-above', 'replaceReferences', 'function', 'src/common.ts', 441, 474, null);
    insert.run('e-above-inner', 'innerClosure', 'function', 'src/common.ts', 450, 460, null);
    insert.run('e-window', 'listUndefinedLocalCodes', 'function', 'src/common.ts', 475, 543, null);
    insert.run('e-below', 'applyInsertRules', 'function', 'src/common.ts', 544, 580, null);
    insert.run('e-below-inner', 'insertHelper', 'function', 'src/common.ts', 550, 560, null);
    insert.run('e-other-file', 'unrelated', 'function', 'src/other.ts', 400, 600, null);
    db.close();
    return dbPath;
  }

  it('returns outermost nearest siblings above and below, same file only', () => {
    const repo = openRepo(createAdjacencyDb());
    const adj = repo.findAdjacentEntities('src/common.ts', 475, 543, { perSide: 2 });
    expect(adj.above.map(e => e.name)).toEqual(['replaceReferences', 'assignFshCode']);
    expect(adj.below.map(e => e.name)).toEqual(['applyInsertRules']);
    expect(adj.above[0]).toMatchObject({ startLine: 441, endLine: 474, type: 'function' });
  });

  it('never returns the enclosing entity or the window itself', () => {
    const repo = openRepo(createAdjacencyDb());
    // Window strictly inside listUndefinedLocalCodes: the enclosing entity
    // matches neither "fully above" nor "starts below".
    const adj = repo.findAdjacentEntities('src/common.ts', 480, 500, { perSide: 2 });
    expect(adj.above.map(e => e.name)).not.toContain('listUndefinedLocalCodes');
    expect(adj.below.map(e => e.name)).not.toContain('listUndefinedLocalCodes');
    expect(adj.above[0].name).toBe('replaceReferences');
    expect(adj.below[0].name).toBe('applyInsertRules');
  });

  it('perSide=1 trims each side and invalid input returns empty', () => {
    const repo = openRepo(createAdjacencyDb());
    const adj = repo.findAdjacentEntities('src/common.ts', 475, 543, { perSide: 1 });
    expect(adj.above).toHaveLength(1);
    expect(adj.below).toHaveLength(1);
    expect(repo.findAdjacentEntities(null, 1, 2)).toEqual({ above: [], below: [] });
    expect(repo.findAdjacentEntities('src/common.ts', NaN, 2)).toEqual({ above: [], below: [] });
  });
});
