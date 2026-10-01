import path from 'path';
import { asTopLevelCaller, fileNodeId, fileNodeSourceSql, hasFilesTable } from '../graph/file-nodes.js';

const ACTIVE = 'stale_since IS NULL';

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rowToEntity(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature || '',
    summary: row.summary || '',
    parentClass: row.parent_class || null,
    package: row.package || null,
  };
}

function moduleStem(filePath) {
  return path.basename(String(filePath || ''), path.extname(String(filePath || '')));
}

function moduleLooksRelated(moduleName, stem) {
  const normalized = String(moduleName || '').replace(/\\/g, '/').replace(/\.[cm]?[jt]sx?$/, '');
  return normalized === stem || normalized.endsWith(`/${stem}`);
}

function parseSpecifiers(specs, targetName, aliases) {
  for (const rawPart of specs.split(',')) {
    const part = rawPart.trim();
    const colon = part.match(new RegExp(`^${escapeRegExp(targetName)}\\s*:\\s*([A-Za-z_$][\\w$]*)$`));
    const asAlias = part.match(new RegExp(`^${escapeRegExp(targetName)}\\s+as\\s+([A-Za-z_$][\\w$]*)$`));
    if (colon) aliases.add(colon[1]);
    else if (asAlias) aliases.add(asAlias[1]);
    else if (part === targetName) aliases.add(targetName);
  }
}

function extractAliases(text, target) {
  const aliases = new Set();
  const stem = moduleStem(target.filePath);
  for (const line of String(text || '').split('\n')) {
    if (!line.includes(target.name) || !line.includes(stem)) continue;
    const cjs = line.match(/\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/);
    if (cjs && moduleLooksRelated(cjs[2], stem)) parseSpecifiers(cjs[1], target.name, aliases);
    const esm = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (esm && moduleLooksRelated(esm[2], stem)) parseSpecifiers(esm[1], target.name, aliases);
    const prop = line.match(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(['"]([^'"]+)['"]\\)\\.${escapeRegExp(target.name)}\\b`));
    if (prop && moduleLooksRelated(prop[2], stem)) aliases.add(prop[1]);
  }
  return [...aliases];
}

function lineOfIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const ALIAS_TARGET_FILE = /\.(?:[cm]?[jt]sx?|rs)$/i;

const fileIdCache = new WeakMap();

/**
 * Files that import `targetFile` (`importsFile` edges), as [{ file_path }],
 * or null when the graph has no importsFile edges (built before them) —
 * then the caller falls back to scanning every file. An alias
 * (`import { foo as bar }`, `const bar = require('./x').foo`) needs an import
 * of the target's file, so importers are the only files that can hold one.
 */
function importingFiles(db, targetFile, entitySql, entityParams) {
  let hasEdges;
  try {
    hasEdges = !!db.prepare("SELECT 1 FROM relationships WHERE type = 'importsFile' LIMIT 1").get();
  } catch {
    return null;
  }
  if (!hasEdges) return null;
  const live = db.prepare('PRAGMA table_info(relationships)').all().some(c => c.name === 'epoch_retired') ? ' AND epoch_retired IS NULL' : '';
  const sources = db.prepare(`SELECT DISTINCT source_id FROM relationships WHERE type = 'importsFile' AND target_name = ?${live}`).all(targetFile)
    .map(r => r.source_id);
  if (sources.length === 0) return [];
  let byId = fileIdCache.get(db);
  if (!byId) {
    byId = new Map();
    // The file-node table lists every indexed file, including importers that
    // define no symbol (a barrel `index.ts`, a script); older graphs only
    // have the entity table's files.
    const fileSql = hasFilesTable(db)
      ? `SELECT DISTINCT file_path FROM ${fileNodeSourceSql()} e WHERE ${entitySql} UNION SELECT DISTINCT file_path FROM entities WHERE ${entitySql} AND file_path IS NOT NULL`
      : `SELECT DISTINCT file_path FROM entities WHERE ${entitySql} AND file_path IS NOT NULL`;
    const fileParams = hasFilesTable(db) ? [...entityParams, ...entityParams] : entityParams;
    for (const { file_path: f } of db.prepare(fileSql).all(...fileParams)) {
      byId.set(fileNodeId(f), f);
    }
    fileIdCache.set(db, byId);
  }
  const out = new Set();
  const physical = db.prepare('SELECT file_path FROM entities WHERE id = ?');
  // The per-connection cache predates files indexed later by the maintainer
  // (a long-lived reader stays connected); their node is still in `files`.
  const node = hasFilesTable(db) ? db.prepare('SELECT file_path FROM files WHERE id = ? LIMIT 1') : null;
  for (const id of sources) {
    const f = byId.get(id) || physical.get(id)?.file_path || node?.get(id)?.file_path;
    if (f) out.add(f);
  }
  return [...out].sort().map(file_path => ({ file_path }));
}

export function findAliasCallers({
  db,
  target,
  readFileRange,
  limit = 40,
  entityVisibilitySql: entitySql = ACTIVE,
  entityVisibilityParams: entityParams = [],
  mapEntity = rowToEntity,
}) {
  if (!db || !target?.filePath || !target?.name) return [];
  // Alias forms exist only for JS/TS imports and Rust paths; any other target
  // can never match, and scanning cost one read of up to 1,000 files.
  if (!ALIAS_TARGET_FILE.test(target.filePath)) return [];
  const files = importingFiles(db, target.filePath, entitySql, entityParams) || db.prepare(`
    SELECT DISTINCT file_path
    FROM entities
    WHERE ${entitySql} AND file_path IS NOT NULL
    ORDER BY CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END, file_path
    LIMIT 1000
  `).all(...entityParams);
  const entityAtLine = db.prepare(`
    SELECT id, name, type, file_path, start_line, end_line, signature, summary, parent_class, package
    FROM entities
    WHERE ${entitySql} AND file_path = ? AND start_line <= ? AND end_line >= ?
    ORDER BY (end_line - start_line) ASC
    LIMIT 1
  `);
  // An alias call in top-level code (a script body) is attributed to the
  // file's node (graph/file-nodes.js) when the graph has one.
  const fileNodeAt = hasFilesTable(db)
    ? db.prepare(`SELECT e.id, e.name, e.type, e.file_path, e.start_line, e.end_line, e.signature, e.summary, e.parent_class, e.package
        FROM ${fileNodeSourceSql()} e WHERE ${entitySql} AND e.file_path = ? LIMIT 1`)
    : null;
  const out = [];
  const seen = new Set();
  for (const { file_path: filePath } of files) {
    if (filePath === target.filePath) continue;
    const text = readFileRange(filePath, 1, 20000);
    const aliases = extractAliases(text, target);
    const patterns = aliases.map(alias => ({
      targetName: alias,
      re: new RegExp(`(?<![\\w$])${escapeRegExp(alias)}\\s*\\(`, 'g'),
    }));
    if (/\.rs$/.test(target.filePath)) {
      patterns.push({
        targetName: `::${target.name}`,
        re: new RegExp(`\\b[A-Za-z_][\\w]*::${escapeRegExp(target.name)}\\s*\\(`, 'g'),
      });
    }
    if (!patterns.length) continue;
    for (const pattern of patterns) {
      const re = pattern.re;
      for (const match of text.matchAll(re)) {
        const line = lineOfIndex(text, match.index || 0);
        let entity = entityAtLine.get(...entityParams, filePath, line, line);
        if (!entity && fileNodeAt) {
          const node = fileNodeAt.get(...entityParams, filePath);
          if (node) entity = asTopLevelCaller(node, line);
        }
        if (!entity || entity.id === target.id) continue;
        const targetName = match[0].replace(/\s*\($/, '') || pattern.targetName;
        const key = `${entity.id}:${line}:${targetName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...mapEntity(entity), relationship: 'calls', contextLine: line, targetName, weight: 0.82 });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
