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
import { detectProjectBoundary } from '../infrastructure/project-detector.js';
import { UNRESOLVED_IMPORT_PREFIX } from './import-resolver.js';

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

/**
 * Resolve relationship target_ids from target_names
 * This runs AFTER all entities are extracted and inserted
 */
export function resolveRelationshipTargets(db) {
  console.log('  Resolving relationship targets...');

  // Build entity lookup maps
  const entities = db.prepare(`
    SELECT id, name, type, file_path, parent_class, signature, start_line, end_line
    FROM entities
  `).all();

  console.log(`  Loaded ${entities.length} entities`);

  // Lookup maps
  const byId = new Map(); // id -> entity (for O(1) lookup)
  const byExactName = new Map(); // "AuthService" -> [entities...]
  const byMethodName = new Map(); // "authenticate" -> [entities...]
  const byFileAndName = new Map(); // "path/to/file.java:AuthService" -> entity
  const byFile = new Map(); // "path/to/file.java" -> [entities...]

  for (const entity of entities) {
    // ID lookup
    byId.set(entity.id, entity);

    // Exact name (may have duplicates across files)
    if (!byExactName.has(entity.name)) {
      byExactName.set(entity.name, []);
    }
    byExactName.get(entity.name).push(entity);

    // File + name (unique within file)
    const fileKey = `${entity.file_path}:${entity.name}`;
    byFileAndName.set(fileKey, entity);
    let fileEntities = byFile.get(entity.file_path);
    if (!fileEntities) { fileEntities = []; byFile.set(entity.file_path, fileEntities); }
    fileEntities.push(entity);

    // Method name (just the method part)
    if (entity.type === 'method' || entity.type === 'function' || entity.type === 'rpc') {
      const methodName = entity.name.split('.').pop();
      if (!byMethodName.has(methodName)) {
        byMethodName.set(methodName, []);
      }
      byMethodName.get(methodName).push(entity);
    }
  }

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
  const warnings = [];

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
        byFile
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

  if (resolved > 0) {
    console.log(`  ✓ Linked ${resolved}/${unresolved.length} references to local definitions`);
  } else {
    console.log(`  ${unresolved.length} references resolve to external/library symbols (no local definition to link)`);
  }
  if (ambiguous > 0) {
    console.log(`  ⚠ ${ambiguous} ambiguous targets (multiple matches)`);
  }

  // Show sample warnings (max 5)
  if (warnings.length > 0) {
    console.log('  Sample resolution warnings:');
    for (const warning of warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
    if (warnings.length > 5) {
      console.log(`    ... and ${warnings.length - 5} more`);
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
  byFile = new Map()
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

      const candidates = byMethodName.get(methodName) || [];

      if (candidates.length === 0) {
        // No match found
        return null;
      } else if (candidates.length === 1) {
        // Single match - use it
        return candidates[0].id;
      } else {
        // Multiple matches - prefer same file, then same package
        if (sourceEntity) {
          // Same file
          const sameFile = candidates.find(c => c.file_path === sourceEntity.file_path);
          if (sameFile) return sameFile.id;

          // Same project (prefer matches within the same project component)
          const sameProjectMatch = candidates.find(c => isSameProject(c.file_path, sourceEntity.file_path));
          if (sameProjectMatch) return sameProjectMatch.id;
        }

        // Use first match (arbitrary but deterministic)
        if (warnings) {
          warnings.push(`Ambiguous call to ${targetName}: ${candidates.length} matches, using first`);
        }
        return candidates[0].id;
      }
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
      let candidates = typeCandidates(byExactName.get(targetName), sourceId);

      // Qualified base (`Sequel::Model`, `\RuntimeException`, `models.Model`,
      // `drogon::HttpController`, `Call.Base`): entities are stored by their
      // short name, so fall back to the last path segment. A qualified name
      // must also match its qualifier on disk (src/flask/views.py for
      // `flask.views.View`) — `nn.Module` must not link to an unrelated
      // local `Module`.
      const qualifier = qualifierPath(targetName);
      if (candidates.length === 0) {
        const shortName = lastPathSegment(targetName);
        if (shortName && shortName !== targetName) {
          candidates = typeCandidates(byExactName.get(shortName), sourceId);
          if (qualifier) candidates = candidates.filter(c => matchesQualifier(c.file_path || '', qualifier));
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
      let candidates = (byExactName.get(targetName) || []).filter(c => c.id !== sourceId);
      const types = candidates.filter(c => CLASS_LIKE_TYPES.has(c.type));
      if (types.length > 0) candidates = types;
      const picked = pickClosestCandidate(candidates, sourceEntity);
      return picked ? picked.id : null;
    }

    default: {
      // Unknown relationship type - try exact name match
      const candidates = (byExactName.get(targetName) || []).filter(c => c.id !== sourceId);
      const picked = pickClosestCandidate(candidates, sourceEntity);
      return picked ? picked.id : null;
    }
  }
}

const TYPE_REFERENCE_RELATIONSHIPS = new Set(['extends', 'implements', 'overrides', 'uses', 'throws']);

// Entity types that can be the target of an inheritance edge.
const CLASS_LIKE_TYPES = new Set([
  'class', 'interface', 'struct', 'trait', 'enum', 'type', 'typeAlias', 'typealias',
  'typedef', 'protocol', 'record', 'object', 'module', 'mixin', 'component', 'message', 'union',
]);

function typeCandidates(candidates, sourceId) {
  if (!candidates) return [];
  return candidates.filter(c => c.id !== sourceId && CLASS_LIKE_TYPES.has(c.type));
}

/** `Sequel::Model` → `Model`, `\Foo\Bar` → `Bar`, `models.Model` → `Model`. */
function lastPathSegment(name) {
  const parts = name.split(/::|\\|\./).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function isTestPath(filePath) {
  return /(?:^|\/)(?:tests?|spec|specs|__tests__|testing|mocks?|fixtures?)\/|(?:_test|_spec|\.test|\.spec|Tests?)\.[^/.]+$/i.test(filePath || '');
}

function sharedDirDepth(a, b) {
  const pa = a.split('/');
  const pb = b.split('/');
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

/** `flask.views.View` → `flask/views`, `Sequel::Dataset` → `sequel`; null if unqualified. */
function qualifierPath(name) {
  const parts = name.split(/::|\\|\./).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).map(nameKey).join('/');
}

/** True when the file or its directory sits at the qualifier path (`src/flask/views.py`). */
function matchesQualifier(filePath, qualifier) {
  const lower = filePath.toLowerCase().replace(/[_-]/g, '');
  const dot = lower.lastIndexOf('.');
  const sansExt = dot > lower.lastIndexOf('/') ? lower.slice(0, dot) : lower;
  const dir = lower.slice(0, Math.max(0, lower.lastIndexOf('/')));
  const at = (s) => s === qualifier || s.endsWith('/' + qualifier);
  return at(sansExt) || at(dir);
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

  let top = [];
  let bestScore = -1;
  for (const c of candidates) {
    const p = c.file_path || '';
    let score;
    if (p === srcPath) {
      score = 1e6;
    } else {
      score = sharedDirDepth(p, srcPath);
      if (c.end_line > c.start_line) score += 100;
      if (nameKey(fileStem(p)) === nameKey(c.name)) score += 1000;
      if (qualifier && matchesQualifier(p, qualifier)) score += 5000;
      if (!isTestPath(p)) score += 10000;
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
