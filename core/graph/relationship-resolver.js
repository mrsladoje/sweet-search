#!/usr/bin/env node

/**
 * Relationship Target Resolution
 *
 * Post-processing step to resolve relationship target_ids from target_names.
 * This runs AFTER all entities are extracted and inserted into the database.
 *
 * Resolution strategies by relationship type:
 * - calls: Match method name, prefer same file/package
 * - overrides: Match method in parent class
 * - implements/extends: Match class/interface, prefer same project
 * - imports: Match by name, allow external (no match)
 * - uses/throws: General reference, prefer same project
 */

import path from 'path';
import { createHash } from 'crypto';
import { detectProjectBoundary } from '../infrastructure/project-detector.js';
import { UNRESOLVED_IMPORT_PREFIX, buildFileImportMap } from './import-resolver.js';
import { deriveOverrideEdges } from './override-edges.js';

// Entities from config/data/markup files (YAML keys, pom.xml tags, Makefile
// targets, TOML tables) are never the target of a code import. Name-based
// import resolution used to bind `import os` to a `.github/*.yml` key and
// `org.junit.Test` to the `org` tag in pom.xml.
const NON_CODE_IMPORT_TARGET_EXTS = new Set([
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.xml', '.md', '.mdx', '.markdown',
  '.ini', '.cfg', '.conf', '.properties', '.lock', '.txt', '.csv', '.html', '.htm', '.css',
  '.scss', '.sass', '.less', '.sql', '.graphql', '.gql', '.mk', '.cmake', '.dockerfile', '.env',
]);
const NON_CODE_IMPORT_TARGET_BASENAMES = new Set(['makefile', 'gnumakefile', 'dockerfile', 'cmakelists.txt']);

function isCodeImportTarget(entity) {
  const filePath = entity?.file_path;
  if (!filePath) return false;
  const base = path.posix.basename(String(filePath).replace(/\\/g, '/')).toLowerCase();
  if (NON_CODE_IMPORT_TARGET_BASENAMES.has(base)) return false;
  return !NON_CODE_IMPORT_TARGET_EXTS.has(path.posix.extname(base));
}

// =============================================================================
// PROJECT DETECTION
// =============================================================================

/**
 * Detect which project a file belongs to based on its path.
 * Uses marker-file detection to find nearest project boundary.
 *
 * @param {string} filePath - File path to analyze
 * @returns {string} Project identifier (kebab-cased directory name) or 'unknown'
 */
function detectProject(filePath) {
  if (!filePath) return 'unknown';
  const { name } = detectProjectBoundary(filePath, process.cwd());
  return name;
}

/**
 * Check if two files belong to the same project.
 *
 * @param {string} path1 - First file path
 * @param {string} path2 - Second file path
 * @returns {boolean} True if both files are in the same project
 */
function isSameProject(path1, path2) {
  const project1 = detectProject(path1);
  const project2 = detectProject(path2);

  // 'unknown' never matches (external imports, etc.)
  if (project1 === 'unknown' || project2 === 'unknown') return false;

  return project1 === project2;
}

// =============================================================================
// CALL-TARGET HELPERS
// =============================================================================

// Entity types that own methods. Extractors rarely fill `parent_class`
// (tree-sitter entities never do), so the owner is derived from spans.
const CONTAINER_TYPES = new Set([
  'class', 'struct', 'interface', 'trait', 'impl', 'enum', 'extension',
  'protocol', 'object', 'namespace', 'module', 'record', 'actor', 'union',
]);
// Go method receiver: `func (c *Context) Next()` → Context.
const GO_RECEIVER = /^func\s*\(\s*(?:\w+\s+)?\*?\s*(\w+)/;
// Receivers that mean "the enclosing object/type".
const SELF_RECEIVERS = new Set(['this', 'self', 'cls', 'me', 'static']);

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function receiverMatches(receiver, name) {
  if (!receiver || !name) return false;
  if (receiver === name) return true;
  // `observationBroker` ↔ DatabaseObservationBroker, `mainRepository` ↔ Repository.
  if (receiver.length >= 4 && name.endsWith(receiver)) return true;
  if (name.length >= 4 && receiver.endsWith(name)) return true;
  return false;
}

function parentDir(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// A PascalCase receiver names a type (`Foo.bar()`, `Foo::new()`) in these
// languages. Not in Go (exported variables), C# (properties) or C/C++/Ruby.
const PASCAL_CASE = /^[A-Z][a-z0-9]\w*$/;
const TYPE_RECEIVER_FILE = /\.(?:java|kt|kts|swift|py|pyi|js|jsx|mjs|cjs|ts|tsx|mts|cts|php|rs|scala|dart)$/i;
// Languages where a `.`-qualified call can reach a top-level function only
// through its module/package (`utils.helper()`, `pkg.Func()`): the receiver
// must name that module, so `json.loads` / `filepath.Join` never bind to a
// first-party `loads` / `Join` (code-graph-rag #2636). Not JS/TS: objects
// that hold functions (`context.commentSummary()` in typedoc) are idiomatic
// there; not Rust: its `.` calls are always methods.
const MODULE_FUNCTION_FILE = /\.(?:py|pyi|go)$/i;

/**
 * Lookups for call-target resolution, built once per resolution pass.
 *
 * ownerOf(entity): the owning class/struct/impl/… name — `parent_class`,
 *   else the Go receiver in the signature, else the innermost container entity
 *   whose span holds it (extractors rarely fill `parent_class`; tree-sitter
 *   entities never do). Memoised per entity id.
 * containerFiles(name): files that define a container type with exactly this
 *   name, or null when the repo defines no such type.
 */
export function createCallResolutionIndex(entities, { fileImports = null } = {}) {
  const containersByFile = new Map();
  const filesByContainerName = new Map();
  for (const e of entities) {
    if (!CONTAINER_TYPES.has(e.type)) continue;
    let files = filesByContainerName.get(e.name);
    if (!files) { files = new Set(); filesByContainerName.set(e.name, files); }
    files.add(e.file_path);
    if (e.start_line == null || e.end_line == null) continue;
    let list = containersByFile.get(e.file_path);
    if (!list) { list = []; containersByFile.set(e.file_path, list); }
    list.push(e);
  }
  for (const list of containersByFile.values()) list.sort((a, b) => a.start_line - b.start_line);

  const memo = new Map();
  function ownerOf(entity) {
    if (!entity) return null;
    const hit = memo.get(entity.id);
    if (hit !== undefined) return hit;
    let owner = entity.parent_class || null;
    if (!owner && entity.signature) {
      const g = GO_RECEIVER.exec(entity.signature);
      if (g) owner = g[1];
    }
    if (!owner && entity.start_line != null) {
      const list = containersByFile.get(entity.file_path);
      if (list) {
        const end = entity.end_line ?? entity.start_line;
        let best = null;
        for (const c of list) {
          if (c.start_line > entity.start_line) break;
          if (c.id !== entity.id && c.end_line >= end) best = c;
        }
        owner = best ? best.name : null;
      }
    }
    memo.set(entity.id, owner);
    return owner;
  }

  // Receiver-matching keys per candidate, computed once per entity instead of
  // once per (call, candidate): common method names (`new`, `get`, `to_string`)
  // have thousands of candidates, and every call re-normalised all of them.
  const factsMemo = new Map();
  function factsOf(entity) {
    let f = factsMemo.get(entity.id);
    if (f === undefined) {
      const owner = ownerOf(entity);
      const filePath = entity.file_path || '';
      f = {
        owner,
        ownerKey: normalizeName(owner),
        stemKey: normalizeName(fileStem(filePath)),
        dirKey: normalizeName(parentDir(filePath)),
        moduleFunction: entity.type === 'function' && !owner && MODULE_FUNCTION_FILE.test(filePath),
      };
      factsMemo.set(entity.id, f);
    }
    return f;
  }

  return {
    ownerOf,
    factsOf,
    containerFiles: (name) => filesByContainerName.get(name) || null,
    importsOf: (filePath) => (fileImports && fileImports.get(filePath)) || null,
  };
}

function defaultFactsOf(entity) {
  const filePath = entity.file_path || '';
  return {
    owner: null,
    ownerKey: '',
    stemKey: normalizeName(fileStem(filePath)),
    dirKey: normalizeName(parentDir(filePath)),
    moduleFunction: entity.type === 'function' && MODULE_FUNCTION_FILE.test(filePath),
  };
}

const NO_INDEX = { ownerOf: () => null, factsOf: defaultFactsOf, containerFiles: () => null, importsOf: () => null };

/**
 * Graph id of a file node, as GraphExtractor.makeId(path, 'file', basename)
 * computes it for the repo-relative paths the indexer passes.
 */
function fileNodeId(filePath) {
  return createHash('sha256').update(`${filePath}:file:${path.basename(filePath)}`).digest('hex').slice(0, 16);
}

/**
 * Prefer candidates defined in a file the caller's file imports
 * (`importsFile` edges) — unless one sits in the caller's own file, which
 * pickClosestCandidate ranks first anyway.
 */
function preferImported(pool, sourceEntity, importsOf) {
  if (pool.length <= 1 || !sourceEntity?.file_path) return pool;
  const imported = importsOf(sourceEntity.file_path);
  if (!imported || pool.some(c => c.file_path === sourceEntity.file_path)) return pool;
  const viaImport = pool.filter(c => isImported(imported, c.file_path));
  return viaImport.length > 0 ? viaImport : pool;
}

/** Imported file, or (Go) its package directory `dir/`. */
function isImported(imported, filePath) {
  if (!imported || !filePath) return false;
  if (imported.has(filePath)) return true;
  const slash = filePath.lastIndexOf('/');
  return slash > 0 && imported.has(filePath.slice(0, slash + 1));
}

/**
 * Narrow same-named call candidates using the call's receiver. An empty
 * result means "leave unresolved" — a missing edge is better than a wrong one
 * (graphify's exactly-one guard; code-graph-rag #2636).
 *
 * - `other.foo()` inside `foo` is delegation, not recursion: the calling
 *   entity is never its own target unless the receiver is self-like.
 * - Type-qualified `Foo.bar()` where the repo defines a type `Foo`: only
 *   methods owned by `Foo` (or ownerless ones in Foo's file) qualify.
 * - `.`-qualified call to a top-level function in a module language: the
 *   receiver must name the function's module (file stem or directory).
 * - A receiver that names a candidate's owner (`broker.notify` →
 *   DatabaseObservationBroker.notify) or file wins over the rest.
 * - `self.foo()` / bare `foo()` prefer the caller's own owner.
 * - Otherwise a definition in a file the caller's file imports wins.
 * The caller ranks what is left with pickClosestCandidate (same file, then
 * non-test code, then nearest directory).
 */
export function narrowCallCandidates(candidates, receiverRaw, sourceEntity, index = NO_INDEX) {
  if (candidates.length === 0) return candidates;
  const idx = index || NO_INDEX;
  const ownerOf = idx.ownerOf || NO_INDEX.ownerOf;
  const containerFiles = idx.containerFiles || NO_INDEX.containerFiles;
  const importsOf = idx.importsOf || NO_INDEX.importsOf;
  const factsOf = idx.factsOf || ((c) => ({ ...defaultFactsOf(c), owner: ownerOf(c), ownerKey: normalizeName(ownerOf(c)) }));
  const chained = receiverRaw.endsWith('()');
  const receiver = chained ? '' : receiverRaw;
  const selfLike = (!receiverRaw) || SELF_RECEIVERS.has(receiver.toLowerCase());

  let pool = candidates;
  if (sourceEntity && !selfLike && pool.length > 1) {
    // Recursion through another instance (`child.visit()` inside `visit`)
    // stays possible when the caller is the only definition.
    const srcId = sourceEntity.id;
    if (pool.some(c => c.id === srcId)) {
      const others = pool.filter(c => c.id !== srcId);
      if (others.length > 0) pool = others;
    }
  }

  if (selfLike) {
    if (pool.length > 1 && sourceEntity) {
      const srcOwner = ownerOf(sourceEntity);
      if (srcOwner) {
        const sameOwner = pool.filter(c => ownerOf(c) === srcOwner);
        if (sameOwner.length > 0) pool = sameOwner;
      }
    }
    return pool;
  }
  if (!receiver) return preferImported(pool, sourceEntity, importsOf);

  if (PASCAL_CASE.test(receiver)) {
    const typeFiles = containerFiles(receiver);
    if (typeFiles) {
      return pool.filter((c) => {
        const owner = ownerOf(c);
        return owner ? owner === receiver : typeFiles.has(c.file_path);
      });
    }
    // `HashMap::new`, `Collections.emptyList()`, `React.useState()`: a type
    // the repo does not define is external — never a same-named local method.
    if (sourceEntity && TYPE_RECEIVER_FILE.test(sourceEntity.file_path || '')) return [];
  }

  const r = normalizeName(receiver);
  const callerImports = sourceEntity?.file_path ? importsOf(sourceEntity.file_path) : null;
  let kept = null; // copy-on-first-drop keeps the common "nothing filtered" case allocation-free
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    const f = factsOf(c);
    // `import * as h from './helpers'` → `h.foo()`: the import names the module.
    const keep = !f.moduleFunction
      || isImported(callerImports, c.file_path)
      || receiverMatches(r, f.stemKey)
      || receiverMatches(r, f.dirKey);
    if (keep) {
      if (kept) kept.push(c);
    } else if (!kept) {
      kept = pool.slice(0, i);
    }
  }
  if (kept) pool = kept;
  if (pool.length > 1) {
    const byOwner = pool.filter(c => receiverMatches(r, factsOf(c).ownerKey));
    if (byOwner.length > 0) {
      pool = byOwner;
    } else {
      const byFile = pool.filter(c => receiverMatches(r, factsOf(c).stemKey));
      if (byFile.length > 0) pool = byFile;
    }
  }
  return preferImported(pool, sourceEntity, importsOf);
}

/**
 * Name/file lookups for resolveTarget. Insertion order is the entity order
 * given (ties in candidate ranking keep the first candidate), so callers must
 * pass entities in table (rowid) order.
 */
function buildEntityLookups(entities) {
  const byId = new Map(); // id -> entity (for O(1) lookup)
  const byExactName = new Map(); // "AuthService" -> [entities...]
  const byMethodName = new Map(); // "authenticate" -> [entities...]
  const byFileAndName = new Map(); // "path/to/file.java:AuthService" -> entity
  const byFile = new Map(); // "path/to/file.java" -> [entities...]

  for (const entity of entities) {
    byId.set(entity.id, entity);

    // Exact name (may have duplicates across files)
    let named = byExactName.get(entity.name);
    if (!named) { named = []; byExactName.set(entity.name, named); }
    named.push(entity);

    // File + name (the last same-named entity in a file wins)
    byFileAndName.set(`${entity.file_path}:${entity.name}`, entity);
    let fileEntities = byFile.get(entity.file_path);
    if (!fileEntities) { fileEntities = []; byFile.set(entity.file_path, fileEntities); }
    fileEntities.push(entity);

    // Method name (just the method part)
    if (CALLABLE_TYPES.has(entity.type)) {
      const methodName = entity.name.split('.').pop();
      let methods = byMethodName.get(methodName);
      if (!methods) { methods = []; byMethodName.set(methodName, methods); }
      methods.push(entity);
    }
  }
  return { byId, byExactName, byMethodName, byFileAndName, byFile };
}

const CALLABLE_TYPES = new Set(['method', 'function', 'rpc']);
const ENTITY_COLUMNS = 'rowid AS _rowid, id, name, type, file_path, parent_class, signature, start_line, end_line';
const SQL_CHUNK = 500;

function queryChunked(db, sqlFor, values, extraParams = []) {
  const out = [];
  const list = [...values];
  for (let i = 0; i < list.length; i += SQL_CHUNK) {
    const part = list.slice(i, i + SQL_CHUNK);
    out.push(...db.prepare(sqlFor(part.map(() => '?').join(','))).all(...part, ...extraParams));
  }
  return out;
}

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  } catch {
    return false;
  }
}

/** Every name a target name can be looked up by: itself and its path segments. */
function targetNameKeys(targetName) {
  const keys = new Set();
  const name = String(targetName || '');
  if (!name) return keys;
  keys.add(name);
  for (const seg of name.replace(/\(\)/g, '').split(/::|\\|\.|\//)) if (seg) keys.add(seg);
  return keys;
}

/**
 * Resolve a subset of relationship rows with exactly the rules of the full
 * pass (resolveTarget), loading only the entities those rows can reach:
 * the source entities, every entity named by a target-name segment, all
 * entities of the source and resolved-import files, container types in the
 * candidates' files (owner lookup) and dotted callables. With the maps
 * complete for every key a row looks up, the result equals what
 * resolveRelationshipTargets would pick for that row.
 *
 * The incremental reconciler uses it so an edited file's edges — and edges
 * into its entities — resolve as a full build would, without reloading the
 * whole entity table each tick.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<{source_id, target_name, type, context_line?, full_import_path?}>} rows
 * @param {{ liveOnly?: boolean }} [opts] - skip retired entities/edges (epoch columns)
 * @returns {Array<string|null>} target id per row (aligned with `rows`)
 */
export function resolveRowsScoped(db, rows, { liveOnly = true } = {}) {
  if (!rows || rows.length === 0) return [];
  // Per-run caches; a long-lived maintainer must not grow them without bound.
  if (pathFactsCache.size > 50_000) pathFactsCache.clear();
  if (nameKeyCache.size > 50_000) nameKeyCache.clear();
  const entityLive = liveOnly && hasColumn(db, 'entities', 'epoch_retired') ? ' AND epoch_retired IS NULL' : '';
  const relLive = liveOnly && hasColumn(db, 'relationships', 'epoch_retired') ? ' AND r.epoch_retired IS NULL' : '';

  const keys = new Set();
  const sourceIds = new Set();
  const importFiles = new Set();
  for (const r of rows) {
    for (const k of targetNameKeys(r.target_name)) keys.add(k);
    if (r.source_id) sourceIds.add(r.source_id);
    if (r.full_import_path && !String(r.full_import_path).startsWith(UNRESOLVED_IMPORT_PREFIX)) importFiles.add(r.full_import_path);
  }

  const byRowid = new Map();
  const add = (list) => { for (const e of list) if (!byRowid.has(e._rowid)) byRowid.set(e._rowid, e); };
  const sources = queryChunked(db, ph => `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id IN (${ph})${entityLive}`, sourceIds);
  add(sources);
  const named = queryChunked(db, ph => `SELECT ${ENTITY_COLUMNS} FROM entities WHERE name IN (${ph})${entityLive}`, keys);
  add(named);
  // Callables stored under a dotted name (`Foo.bar`) answer to their last part.
  const dotted = db.prepare(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE name LIKE '%.%' AND type IN ('method','function','rpc')${entityLive}`).all()
    .filter(e => keys.has(e.name.split('.').pop()));
  add(dotted);

  const fullFiles = new Set(importFiles);
  for (const s of sources) if (s.file_path) fullFiles.add(s.file_path);
  add(queryChunked(db, ph => `SELECT ${ENTITY_COLUMNS} FROM entities WHERE file_path IN (${ph})${entityLive}`, fullFiles));
  const candidateFiles = new Set();
  for (const e of [...named, ...dotted]) if (e.file_path && !fullFiles.has(e.file_path)) candidateFiles.add(e.file_path);
  const containerTypes = [...CONTAINER_TYPES];
  add(queryChunked(
    db,
    ph => `SELECT ${ENTITY_COLUMNS} FROM entities WHERE file_path IN (${ph}) AND type IN (${containerTypes.map(() => '?').join(',')})${entityLive}`,
    candidateFiles,
    containerTypes,
  ));

  const entities = [...byRowid.values()].sort((a, b) => a._rowid - b._rowid);
  const { byId, byExactName, byMethodName, byFileAndName, byFile } = buildEntityLookups(entities);

  // Imports of the source files: file-node ids are the logical
  // `path:file:basename` hash in a full build and a physical id in an
  // incrementally maintained graph — map both back to the path.
  const fileIdToPath = new Map();
  for (const s of sources) if (s.file_path) fileIdToPath.set(fileNodeId(s.file_path), s.file_path);
  for (const e of entities) if (e.type === 'file' && fullFiles.has(e.file_path)) fileIdToPath.set(e.id, e.file_path);
  const fileImports = new Map();
  if (fileIdToPath.size > 0) {
    const importRows = queryChunked(db, ph => `SELECT r.source_id, r.target_name FROM relationships r WHERE r.type = 'importsFile' AND r.source_id IN (${ph})${relLive}`, fileIdToPath.keys());
    for (const r of importRows) {
      const from = fileIdToPath.get(r.source_id);
      if (!from) continue;
      let set = fileImports.get(from);
      if (!set) { set = new Set(); fileImports.set(from, set); }
      set.add(r.target_name);
    }
  }
  const callIndex = createCallResolutionIndex(entities, { fileImports });

  return rows.map(r => resolveTarget(
    r.source_id, r.target_name, r.type, r.context_line, r.full_import_path,
    byExactName, byMethodName, byFileAndName, byId, null, byFile, callIndex,
  ) || null);
}

/** Collects the first `limit` warning messages and counts the rest. */
function createWarningSampler(limit) {
  return {
    samples: [],
    count: 0,
    push(message) {
      this.count++;
      if (this.samples.length < limit) this.samples.push(message);
    },
  };
}

/**
 * Resolve relationship target_ids from target_names
 * This runs AFTER all entities are extracted and inserted
 */
export function resolveRelationshipTargets(db) {
  console.log('  Resolving relationship targets...');
  pathFactsCache.clear();
  nameKeyCache.clear();

  // Build entity lookup maps
  const entities = db.prepare(`
    SELECT id, name, type, file_path, parent_class, signature, start_line, end_line
    FROM entities
  `).all();

  console.log(`  Loaded ${entities.length} entities`);

  const { byId, byExactName, byMethodName, byFileAndName, byFile } = buildEntityLookups(entities);

  // File → imported repo files (`importsFile` edges) for call disambiguation.
  let fileImports = null;
  try {
    fileImports = buildFileImportMap(db, fileNodeId);
  } catch {
    fileImports = null; // older graph without importsFile edges
  }
  const callIndex = createCallResolutionIndex(entities, { fileImports });

  // Get all unresolved relationships (include full_import_path for package-aware matching)
  const unresolved = db.prepare(`
    SELECT rowid, source_id, target_name, type, context_line, full_import_path
    FROM relationships
    WHERE target_id IS NULL AND target_name IS NOT NULL
  `).all();

  const updateStmt = db.prepare(`
    UPDATE relationships SET target_id = ? WHERE rowid = ?
  `);

  // Delete duplicate unresolved rows when resolution would create a constraint violation
  const deleteStmt = db.prepare(`
    DELETE FROM relationships WHERE rowid = ?
  `);

  let resolved = 0;
  let ambiguous = 0;
  let deduped = 0;
  // Only 5 samples are printed: keep those and a count, not one string per
  // ambiguous row (tens of thousands of template strings on a large repo).
  const warnings = createWarningSampler(5);

  console.log(`  Found ${unresolved.length} unresolved relationships`);

  // Wrap all updates in a single transaction for performance and to avoid
  // WSL/drvfs issues with many individual transactions (readonly database error)
  const resolveAll = db.transaction(() => {
    for (const rel of unresolved) {
      const targetId = resolveTarget(
        rel.source_id,
        rel.target_name,
        rel.type,
        rel.context_line,
        rel.full_import_path,
        byExactName,
        byMethodName,
        byFileAndName,
        byId,
        warnings,
        byFile,
        callIndex
      );

      if (targetId) {
        try {
          updateStmt.run(targetId, rel.rowid);
          resolved++;
        } catch (err) {
          if (err.message.includes('UNIQUE constraint')) {
            // A resolved relationship already exists - delete this duplicate unresolved one
            deleteStmt.run(rel.rowid);
            deduped++;
          } else {
            throw err;
          }
        }
      } else {
        // Check if it's ambiguous (multiple matches)
        const exactMatches = byExactName.get(rel.target_name) || [];
        if (exactMatches.length > 1) {
          ambiguous++;
        }
      }
    }
  });

  resolveAll();

  // Trace-only `overrides` edges need the resolved inheritance above.
  const overrideStats = deriveOverrideEdges(db, entities);
  if (overrideStats.edges > 0) {
    console.log(`  ✓ Derived ${overrideStats.edges} override edges (${overrideStats.ms}ms)`);
  }

  if (resolved > 0) {
    console.log(`  ✓ Linked ${resolved}/${unresolved.length} references to local definitions`);
  } else {
    console.log(`  ${unresolved.length} references resolve to external/library symbols (no local definition to link)`);
  }
  if (ambiguous > 0) {
    console.log(`  ⚠ ${ambiguous} ambiguous targets (multiple matches)`);
  }

  // Show sample warnings (max 5)
  if (warnings.count > 0) {
    console.log('  Sample resolution warnings:');
    for (const warning of warnings.samples) {
      console.log(`    - ${warning}`);
    }
    if (warnings.count > warnings.samples.length) {
      console.log(`    ... and ${warnings.count - warnings.samples.length} more`);
    }
  }

  return { resolved, total: unresolved.length, ambiguous, deduped };
}

/**
 * Resolve a single relationship target
 */
function resolveTarget(
  sourceId,
  targetName,
  relType,
  contextLine,
  fullImportPath,
  byExactName,
  byMethodName,
  byFileAndName,
  byId,
  warnings,
  byFile = new Map(),
  callIndex = null
) {
  // File-level import edges point at a repo path, not an entity; imports of
  // non-repo modules have no local target (not even a same-file namesake).
  if (relType === 'importsFile') return null;
  if (relType === 'imports' && fullImportPath && fullImportPath.startsWith(UNRESOLVED_IMPORT_PREFIX)) return null;

  // Get source entity for context (O(1) lookup instead of database query)
  const sourceEntity = sourceId ? byId.get(sourceId) : null;

  // Strategy 1: Exact name match in same file (highest priority). Not for
  // type references: the per-file map keeps only the last same-named entity,
  // which is often the class's own constructor (`Field` in Field.java) or the
  // source itself. Those types rank same-file candidates in the switch below.
  if (sourceEntity && !TYPE_REFERENCE_RELATIONSHIPS.has(relType)) {
    const sameFileKey = `${sourceEntity.file_path}:${targetName}`;
    const sameFileMatch = byFileAndName.get(sameFileKey);
    if (sameFileMatch) {
      return sameFileMatch.id;
    }
  }

  // Strategy 2: Relationship-specific resolution
  switch (relType) {
    case 'calls': {
      // Method calls: "object.method" or just "method"
      const parts = targetName.split('.');
      const methodName = parts.pop(); // Last part is the method name
      const receiver = parts.length > 0 ? parts[parts.length - 1] : '';

      const allCandidates = byMethodName.get(methodName) || [];
      const candidates = narrowCallCandidates(allCandidates, receiver, sourceEntity, callIndex || undefined);

      // Several left: same file, then non-test code, then nearest directory.
      const picked = pickClosestCandidate(candidates, sourceEntity);
      if (picked && candidates.length > 1 && warnings) {
        warnings.push(`Ambiguous call to ${targetName}: ${candidates.length} matches`);
      }
      return picked ? picked.id : null;
    }

    case 'overrides': {
      // Method overrides: find method in parent class
      const candidates = (byMethodName.get(targetName) || []).filter(c => c.id !== sourceId);
      const picked = pickClosestCandidate(candidates, sourceEntity);
      if (picked && candidates.length > 1 && warnings) {
        warnings.push(`Ambiguous override of ${targetName}: ${candidates.length} matches`);
      }
      return picked ? picked.id : null;
    }

    case 'implements':
    case 'extends': {
      // A base type is always a type. A same-named constructor, property or
      // function is never the target, and neither is the source itself
      // (Python `class Config(Config)` extends the imported Config).
      let candidates = typeCandidates(byExactName.get(targetName), sourceId, sourceEntity);

      // Qualified base (`Sequel::Model`, `\RuntimeException`, `models.Model`,
      // `drogon::HttpController`, `Call.Base`): entities are stored by their
      // short name, so fall back to the last path segment. A qualified name
      // must also match its qualifier on disk (src/flask/views.py for
      // `flask.views.View`) — `nn.Module` must not link to an unrelated
      // local `Module`.
      // A nested type also matches through its owner (`Call.Base` → the
      // `Base` whose parent_class is `Call`).
      const qualifier = qualifierOf(targetName);
      if (candidates.length === 0) {
        const shortName = lastPathSegment(targetName);
        if (shortName && shortName !== targetName) {
          candidates = typeCandidates(byExactName.get(shortName), sourceId, sourceEntity);
          if (qualifier) candidates = bestQualifierTier(candidates, qualifier);
        }
      }

      const picked = pickClosestCandidate(candidates, sourceEntity, qualifier);
      if (picked && candidates.length > 1 && warnings) {
        warnings.push(`Ambiguous ${relType} ${targetName}: ${candidates.length} matches`);
      }
      return picked ? picked.id : null;
    }

    case 'imports': {
      // Annotated by GraphExtractor's import resolver: the module is not a
      // repo file (package, stdlib) — a same-named local entity is a guess.
      if (fullImportPath && fullImportPath.startsWith(UNRESOLVED_IMPORT_PREFIX)) return null;

      // Annotated with the resolved repo file: bind to the named entity in
      // that file (`import { Foo } from './x'`, `com.x.Foo`, `use a::B`).
      // A module-level import (no such entity) stays file-level only; its
      // `importsFile` edge carries the target.
      const resolvedFileEntities = fullImportPath ? byFile.get(fullImportPath) : null;
      if (resolvedFileEntities) {
        // Item paths (`a::b::Item`, `com.x.Class`, `App\\Models\\User`) end in
        // the imported item; JS/Python module paths end in a module name,
        // which is not an entity (`import flask.json.tag` ≠ function `tag`).
        const str = String(targetName);
        const parts = str.split(/::|[.\\/]/).filter(Boolean);
        const last = parts.length > 1 && (str.includes('::') || str.includes('\\') || /^[A-Z]/.test(parts[parts.length - 1]))
          ? parts[parts.length - 1]
          : null;
        const named = resolvedFileEntities.filter((e) => e.name === str || (last !== null && e.name === last));
        const pick = named.find((e) => CLASS_LIKE_TYPES.has(e.type)) || named[0];
        return pick ? pick.id : null;
      }

      // Import statements: use full_import_path for package-aware matching
      let candidates = (byExactName.get(targetName) || []).filter(isCodeImportTarget);

      // Handle inner class imports: "Employee.Builder" → try "Employee" as fallback
      // Java inner classes are imported as OuterClass.InnerClass but the entity
      // is typically stored as just "OuterClass" (the file is OuterClass.java).
      // Only a Capitalised segment names a class: `org.junit.Test` must not
      // fall back to an entity called `org`.
      if (candidates.length === 0 && targetName.includes('.')) {
        const outerClassName = targetName.split('.').find((seg) => /^[A-Z]/.test(seg));
        if (outerClassName && outerClassName !== targetName) {
          candidates = (byExactName.get(outerClassName) || []).filter(isCodeImportTarget);
        }
      }

      if (candidates.length === 0) {
        return null; // External import (not in codebase)
      } else if (candidates.length === 1) {
        return candidates[0].id;
      } else if (fullImportPath) {
        // Multiple matches - use full_import_path for disambiguation
        // fullImportPath: "com.example.app.services.AuthService"
        // We need to match entity by file_path that corresponds to this package

        // Convert Java package path to file path pattern
        // "com.example.app.services.AuthService" -> "com/example/app/services/AuthService.java"
        const expectedPathSuffix = fullImportPath.replace(/\.\*$/, '').replace(/\./g, '/') + '.java';

        // Find candidate whose file_path ends with this pattern
        const packageMatch = candidates.find(c =>
          c.file_path && c.file_path.replace(/\\/g, '/').endsWith(expectedPathSuffix)
        );
        if (packageMatch) {
          return packageMatch.id;
        }

        // Fallback: prefer same project as source
        if (sourceEntity) {
          const sameProjectMatch = candidates.find(c => isSameProject(c.file_path, sourceEntity.file_path));
          if (sameProjectMatch) return sameProjectMatch.id;
        }

        if (warnings) {
          warnings.push(`Ambiguous import ${targetName}: ${candidates.length} matches, using first`);
        }
        return candidates[0].id;
      } else {
        // No full_import_path, use first match
        return candidates[0].id;
      }
    }

    case 'uses':
    case 'throws': {
      // General references (decorators, embedded types, `Class::member`,
      // thrown exceptions). A type wins over a same-named constructor or
      // method (`Tag::setName` uses class Tag, not the Tag() constructor);
      // decorators still resolve to the function when no type has the name.
      const all = byExactName.get(targetName);
      if (!all) return null;
      if (all.length === 1) return all[0].id !== sourceId ? all[0].id : null;
      const others = [];
      const types = [];
      for (const c of all) {
        if (c.id === sourceId) continue;
        others.push(c);
        if (CLASS_LIKE_TYPES.has(c.type)) types.push(c);
      }
      const picked = pickClosestCandidate(types.length > 0 ? types : others, sourceEntity);
      return picked ? picked.id : null;
    }

    case 'instantiates':
    case 'typeRef':
    case 'extensionOf':
      return resolveTypeUsage(targetName, sourceEntity, sourceId, byExactName, callIndex);

    default: {
      // Unknown relationship type - try exact name match
      const candidates = (byExactName.get(targetName) || []).filter(c => c.id !== sourceId);
      const picked = pickClosestCandidate(candidates, sourceEntity);
      return picked ? picked.id : null;
    }
  }
}

const TYPE_REFERENCE_RELATIONSHIPS = new Set([
  'extends', 'implements', 'overrides', 'uses', 'throws', 'instantiates', 'typeRef', 'extensionOf',
]);

/**
 * Trace-only type usages (`instantiates`, `typeRef`, `extensionOf`): a type
 * entity only, and only when exactly one survives — the same file, else a
 * file the source file imports, else the one non-test definition. A missing
 * edge beats a wrong one (graphify's exactly-one guard).
 */
function resolveTypeUsage(targetName, sourceEntity, sourceId, byExactName, callIndex) {
  let candidates = typeCandidates(byExactName.get(targetName), sourceId, sourceEntity);
  const srcPath = sourceEntity?.file_path;
  const imported = srcPath ? callIndex?.importsOf?.(srcPath) : null;
  if (srcPath) {
    // Test helper types are local. Library code never uses a test-file type
    // (a lone test `Key` class is not the `Key` a library signature names);
    // test code uses one only from its own file, a file it imports, or its
    // own top-level directory (jj lib/tests/test_fix.rs names
    // lib/src/fix.rs's `LineRange` alias, not cli/testing's struct).
    const srcIsTest = pathFacts(srcPath).isTest;
    const srcTop = srcPath.split('/')[0];
    candidates = candidates.filter((c) => {
      const p = c.file_path || '';
      if (!pathFacts(p).isTest) return true;
      if (!srcIsTest) return false;
      return p === srcPath || isImported(imported, p) || p.split('/')[0] === srcTop;
    });
  }
  if (candidates.length <= 1) return candidates[0]?.id || null;
  if (srcPath) {
    const sameFile = candidates.filter(c => c.file_path === srcPath);
    if (sameFile.length === 1) return sameFile[0].id;
    if (sameFile.length > 1) return null;
    if (imported) {
      const viaImport = candidates.filter(c => isImported(imported, c.file_path));
      if (viaImport.length === 1) return viaImport[0].id;
      if (viaImport.length > 1) return null;
    }
  }
  const nonTest = candidates.filter(c => !pathFacts(c.file_path || '').isTest);
  return nonTest.length === 1 ? nonTest[0].id : null;
}

// Entity types that can be the target of an inheritance edge.
const CLASS_LIKE_TYPES = new Set([
  'class', 'interface', 'struct', 'trait', 'enum', 'type', 'typeAlias', 'typealias',
  'typedef', 'protocol', 'record', 'object', 'module', 'mixin', 'component', 'message', 'union',
]);

function typeCandidates(candidates, sourceId, sourceEntity = null) {
  if (!candidates) return [];
  const srcFamilies = sourceEntity?.file_path ? pathFacts(sourceEntity.file_path).families : null;
  return candidates.filter(c => c.id !== sourceId && CLASS_LIKE_TYPES.has(c.type)
    && sharesLanguageFamily(srcFamilies, c.file_path));
}

// A type reference names a type of the same language family: Java `List<Span>`
// is java.util.List, not zipkin-lens's React `List` component. Interop
// families overlap (Kotlin↔Java, Swift↔Objective-C headers, C↔C++). An
// unknown extension has no family and is never filtered.
const LANGUAGE_FAMILY_BY_EXTENSION = new Map(Object.entries({
  java: ['jvm'], kt: ['jvm'], kts: ['jvm'], scala: ['jvm'], groovy: ['jvm'],
  js: ['js'], jsx: ['js'], mjs: ['js'], cjs: ['js'], ts: ['js'], tsx: ['js'], mts: ['js'], cts: ['js'],
  vue: ['js'], svelte: ['js'], astro: ['js'],
  c: ['c'], cc: ['c'], cpp: ['c'], cxx: ['c'], hpp: ['c'], hh: ['c'], hxx: ['c'], ipp: ['c'], inl: ['c'],
  h: ['c', 'objc'], m: ['objc', 'c'], mm: ['objc', 'c'],
  swift: ['swift', 'objc'],
  go: ['go'], rs: ['rust'], py: ['python'], pyi: ['python'], rb: ['ruby'], php: ['php'],
  cs: ['dotnet'], fs: ['dotnet'], fsi: ['dotnet'], vb: ['dotnet'], dart: ['dart'],
  ex: ['elixir'], exs: ['elixir'], erl: ['erlang'], hrl: ['erlang'], jl: ['julia'],
  lua: ['lua'], zig: ['zig'], sol: ['solidity'], hs: ['haskell'], ml: ['ocaml'], mli: ['ocaml'],
  graphql: ['graphql'], gql: ['graphql'], proto: ['proto'],
}));

function languageFamilies(filePath) {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  return LANGUAGE_FAMILY_BY_EXTENSION.get(base.slice(dot + 1).toLowerCase()) || null;
}

function sharesLanguageFamily(srcFamilies, candidatePath) {
  if (!srcFamilies || !candidatePath) return true;
  const candidate = pathFacts(candidatePath).families;
  return !candidate || candidate.some(f => srcFamilies.includes(f));
}

/** `Sequel::Model` → `Model`, `\Foo\Bar` → `Bar`, `models.Model` → `Model`. */
function lastPathSegment(name) {
  const parts = name.split(/::|\\|\./).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

// Test code by path shape. Directory segments and `_test`/`.spec`-style
// suffixes match in any case; the `FooTest.java` / `FooTests.swift` /
// `FooSpec.scala` suffix only as a capitalised word after a lowercase or digit,
// so `contests.go`, `latest.ts` and `greatest.py` stay production code.
const TEST_DIR_RE = /(?:^|\/)(?:tests?|spec|specs|__tests__|testing|mocks?|fixtures?)\//i;
const TEST_FILE_ANY_CASE_RE = /(?:[_.-](?:test|tests|spec))\.[^/.]+$|(?:^|\/)(?:test_[^/]*\.py|conftest\.py)$/i;
const TEST_FILE_CAMEL_RE = /(?:^|\/|[a-z0-9])(?:Tests?|Specs?)\.[^/.]+$/;

export function isTestPath(filePath) {
  const p = filePath || '';
  return TEST_DIR_RE.test(p) || TEST_FILE_ANY_CASE_RE.test(p) || TEST_FILE_CAMEL_RE.test(p);
}

// Per-path facts used to rank candidates, computed once per file per run
// (ranking runs for every ambiguous call/type edge; re-splitting the same
// paths per candidate was the cost). Cleared by resolveRelationshipTargets.
const pathFactsCache = new Map();
const nameKeyCache = new Map();

function pathFacts(filePath) {
  let facts = pathFactsCache.get(filePath);
  if (!facts) {
    facts = {
      parts: filePath.split('/'),
      isTest: isTestPath(filePath),
      stemKey: nameKey(fileStem(filePath)),
      families: languageFamilies(filePath),
    };
    pathFactsCache.set(filePath, facts);
  }
  return facts;
}

function cachedNameKey(name) {
  let key = nameKeyCache.get(name);
  if (key === undefined) {
    key = nameKey(name);
    nameKeyCache.set(name, key);
  }
  return key;
}

function sharedDirDepth(pa, pb) {
  const n = Math.min(pa.length, pb.length) - 1; // directories only
  let depth = 0;
  while (depth < n && pa[depth] === pb[depth]) depth++;
  return depth;
}

/** Lowercase, separator-free key: `generic_expression` ≡ `GenericExpression`. */
function nameKey(s) {
  return s.toLowerCase().replace(/[_-]/g, '');
}

function fileStem(filePath) {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * `flask.views.View` → { path: 'flask/views', owner: 'views' },
 * `Sequel::Dataset` → { path: 'sequel', owner: 'Sequel' }; null if unqualified.
 */
function qualifierOf(name) {
  const parts = name.split(/::|\\|\./).filter(Boolean);
  if (parts.length < 2) return null;
  return { path: parts.slice(0, -1).map(nameKey).join('/'), owner: parts[parts.length - 2] };
}

/**
 * How well a candidate matches a reference's qualifier: 3 = its owning type
 * is the qualifier (`Call.Base`, Ruby `JDBC::Dataset` declared in module
 * JDBC); 2 = its file sits at the qualifier path (`src/flask/views.py`);
 * 1 = its directory does; 0 = no match.
 */
function qualifierMatchLevel(candidate, qualifier) {
  if (candidate.parent_class && candidate.parent_class === qualifier.owner) return 3;
  const lower = (candidate.file_path || '').toLowerCase().replace(/[_-]/g, '');
  const dot = lower.lastIndexOf('.');
  const sansExt = dot > lower.lastIndexOf('/') ? lower.slice(0, dot) : lower;
  const at = (s) => s === qualifier.path || s.endsWith('/' + qualifier.path);
  if (at(sansExt)) return 2;
  const dir = lower.slice(0, Math.max(0, lower.lastIndexOf('/')));
  return at(dir) ? 1 : 0;
}

/**
 * Candidates at the strongest qualifier match only. The owner (`JDBC::Dataset`
 * → the Dataset whose parent_class is JDBC, in jdbc.rb) beats a file at the
 * qualifier path (jdbc.rb), which beats a file in the qualifier's directory
 * (jdbc/derby.rb defines its OWN Dataset inside JDBC::Derby — a sibling, not
 * the base). Empty when nothing matches the qualifier.
 */
function bestQualifierTier(candidates, qualifier) {
  let best = 0;
  let tier = [];
  for (const c of candidates) {
    const level = qualifierMatchLevel(c, qualifier);
    if (level === 0 || level < best) continue;
    if (level > best) { best = level; tier = []; }
    tier.push(c);
  }
  return tier;
}

/**
 * Pick the most plausible candidate for an ambiguous name. Order: same file;
 * then non-test code (a test file's private `Record` helper is not the
 * library's `Record`); then a file or directory at the reference's qualifier
 * (`flask.views.View` → src/flask/views.py); then a definition in a file
 * named after it (`Tag.h` defines `Tag`, `impl_forwards.h` only
 * forward-declares it); then a multi-line definition over a one-line
 * declaration; then the deepest shared directory; then the same project.
 * Ties keep the first candidate.
 */
function pickClosestCandidate(candidates, sourceEntity, qualifier = null) {
  if (candidates.length <= 1) return candidates[0] || null;
  const srcPath = sourceEntity?.file_path;
  if (!srcPath) return candidates[0];

  const srcParts = pathFacts(srcPath).parts;
  let top = [];
  let bestScore = -1;
  for (const c of candidates) {
    const p = c.file_path || '';
    let score;
    if (p === srcPath) {
      score = 1e6;
    } else {
      const facts = pathFacts(p);
      score = sharedDirDepth(facts.parts, srcParts);
      if (c.end_line > c.start_line) score += 100;
      if (facts.stemKey === cachedNameKey(c.name)) score += 1000;
      if (qualifier) score += 2000 * qualifierMatchLevel(c, qualifier);
      if (!facts.isTest) score += 10000;
    }
    if (score > bestScore) {
      top = [c];
      bestScore = score;
    } else if (score === bestScore) {
      top.push(c);
    }
  }
  if (top.length > 1 && bestScore % 100 === 0) {
    // No shared directory: fall back to the project boundary.
    const sameProject = top.find(c => isSameProject(c.file_path, srcPath));
    if (sameProject) return sameProject;
  }
  return top[0];
}

export { detectProject, isSameProject };
export default { resolveRelationshipTargets, detectProject, isSameProject };
