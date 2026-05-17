import { readFileSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';

export function readAdjacentManifest(dbPath) {
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(dbPath), 'reconcile-manifest.json'), 'utf8'));
    return Number.isInteger(manifest?.epoch) ? manifest : null;
  } catch {
    return null;
  }
}

export function readAdjacentManifestEpoch(dbPath) {
  return readAdjacentManifest(dbPath)?.epoch ?? null;
}

export function resolveManifestCodeGraphPath(dbPath, manifest = readAdjacentManifest(dbPath)) {
  const descriptor = manifest?.codeGraph?.path || manifest?.codeGraph?.dbPath;
  if (!descriptor || typeof descriptor !== 'string') return dbPath;
  return isAbsolute(descriptor) ? descriptor : join(dirname(dbPath), descriptor);
}

function hasColumns(db, table, columns) {
  const names = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  return columns.every((column) => names.has(column));
}

export function sqlAliasPrefix(alias = '') {
  if (!alias) return '';
  const normalized = String(alias).endsWith('.') ? String(alias).slice(0, -1) : String(alias);
  return normalized ? `${normalized}.` : '';
}

export function createCodeGraphVisibility(db, manifestEpoch) {
  return {
    manifestEpoch: Number.isInteger(manifestEpoch) ? manifestEpoch : null,
    entities: hasColumns(db, 'entities', ['epoch_written', 'epoch_retired']),
    relationships: hasColumns(db, 'relationships', ['epoch_written', 'epoch_retired']),
  };
}

export function entityVisibilitySql(visibility, alias = '') {
  const prefix = sqlAliasPrefix(alias);
  if (!visibility?.entities) return `${prefix}stale_since IS NULL`;
  if (Number.isInteger(visibility.manifestEpoch)) {
    return `(${prefix}epoch_written IS NULL OR ${prefix}epoch_written <= ?)
      AND (${prefix}epoch_retired IS NULL OR ${prefix}epoch_retired > ?)
      AND (${prefix}stale_since IS NULL OR (${prefix}epoch_retired IS NOT NULL AND ${prefix}epoch_retired > ?))`;
  }
  return `${prefix}stale_since IS NULL AND ${prefix}epoch_retired IS NULL`;
}

export function entityVisibilityParams(visibility) {
  if (!visibility?.entities || !Number.isInteger(visibility.manifestEpoch)) return [];
  return [visibility.manifestEpoch, visibility.manifestEpoch, visibility.manifestEpoch];
}

export function relationshipVisibilitySql(visibility, alias = 'r') {
  if (!visibility?.relationships) return '1=1';
  const prefix = sqlAliasPrefix(alias);
  if (Number.isInteger(visibility.manifestEpoch)) {
    return `(${prefix}epoch_written IS NULL OR ${prefix}epoch_written <= ?)
      AND (${prefix}epoch_retired IS NULL OR ${prefix}epoch_retired > ?)`;
  }
  return `${prefix}epoch_retired IS NULL`;
}

export function relationshipVisibilityParams(visibility) {
  if (!visibility?.relationships || !Number.isInteger(visibility.manifestEpoch)) return [];
  return [visibility.manifestEpoch, visibility.manifestEpoch];
}

export class CodeGraphReaderVisibility {
  constructor(baseDbPath, opts = {}) {
    this.baseDbPath = baseDbPath;
    this.explicitManifestEpoch = Number.isInteger(opts.manifestEpoch);
    this.manifestEpoch = this.explicitManifestEpoch ? opts.manifestEpoch : null;
    const manifest = this.explicitManifestEpoch ? readAdjacentManifest(this.baseDbPath) : null;
    this.dbPath = this.explicitManifestEpoch
      ? resolveManifestCodeGraphPath(this.baseDbPath, manifest)
      : baseDbPath;
    this._visibility = null;
    this._hasHcgsSummaryMetadata = null;
    this._summaryVisibilityCache = new Map();
    if (!this.explicitManifestEpoch) this.sync();
  }

  sync(onChange) {
    if (this.explicitManifestEpoch) return false;
    const manifest = readAdjacentManifest(this.baseDbPath);
    const nextEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : null;
    const nextDbPath = resolveManifestCodeGraphPath(this.baseDbPath, manifest);
    const changed = nextEpoch !== this.manifestEpoch || nextDbPath !== this.dbPath;
    this.manifestEpoch = nextEpoch;
    this.dbPath = nextDbPath;
    if (changed) {
      this.reset();
      if (typeof onChange === 'function') onChange();
    }
    return changed;
  }

  reset() {
    this._visibility = null;
    this._hasHcgsSummaryMetadata = null;
    this._summaryVisibilityCache = new Map();
  }

  state(db) {
    if (!this._visibility) this._visibility = createCodeGraphVisibility(db, this.manifestEpoch);
    return this._visibility;
  }

  entitySql(db, alias = '') { return entityVisibilitySql(this.state(db), alias); }
  entityParams(db) { return entityVisibilityParams(this.state(db)); }
  relationshipSql(db, alias = 'r') { return relationshipVisibilitySql(this.state(db), alias); }
  relationshipParams(db) { return relationshipVisibilityParams(this.state(db)); }

  hasSummarySidecar(db) {
    if (
      this._hasHcgsSummaryMetadata === null
      || (this._hasHcgsSummaryMetadata === false && this.manifestEpoch === null)
    ) {
      this._hasHcgsSummaryMetadata = !!db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='hcgs_summary_metadata'",
      ).get();
    }
    return this._hasHcgsSummaryMetadata;
  }

  summaryVisible(db, entityId) {
    if (!entityId || !this.hasSummarySidecar(db)) return true;
    if (this.manifestEpoch === null) {
      const row = db.prepare(`
        SELECT epoch_retired
        FROM hcgs_summary_metadata
        WHERE entity_id = ?
      `).get(String(entityId));
      return row ? row.epoch_retired == null : false;
    }
    const key = `${entityId}:${this.manifestEpoch ?? 'live'}`;
    if (this._summaryVisibilityCache.has(key)) return this._summaryVisibilityCache.get(key);
    const row = db.prepare(`
      SELECT epoch_written, epoch_retired
      FROM hcgs_summary_metadata
      WHERE entity_id = ?
    `).get(String(entityId));
    const visible = row
      ? (Number.isInteger(this.manifestEpoch)
        ? (row.epoch_written == null || row.epoch_written <= this.manifestEpoch)
          && (row.epoch_retired == null || row.epoch_retired > this.manifestEpoch)
        : row.epoch_retired == null)
      : false;
    this._summaryVisibilityCache.set(key, visible);
    return visible;
  }
}
