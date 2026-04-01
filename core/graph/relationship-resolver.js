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

import { detectProjectBoundary } from '../infrastructure/project-detector.js';

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
    SELECT id, name, type, file_path, parent_class, signature
    FROM entities
  `).all();

  console.log(`  Loaded ${entities.length} entities`);

  // Lookup maps
  const byId = new Map(); // id -> entity (for O(1) lookup)
  const byExactName = new Map(); // "AuthService" -> [entities...]
  const byMethodName = new Map(); // "authenticate" -> [entities...]
  const byFileAndName = new Map(); // "path/to/file.java:AuthService" -> entity

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
        warnings
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

  console.log(`  ✓ Resolved ${resolved}/${unresolved.length} relationships`);
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
  warnings
) {
  // Get source entity for context (O(1) lookup instead of database query)
  const sourceEntity = sourceId ? byId.get(sourceId) : null;

  // Strategy 1: Exact name match in same file (highest priority)
  if (sourceEntity) {
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
      const candidates = byMethodName.get(targetName) || [];

      if (candidates.length === 0) {
        return null;
      } else if (candidates.length === 1) {
        return candidates[0].id;
      } else {
        // Multiple matches - prefer methods in interfaces or parent classes
        // This is complex, so just use first match for now
        if (warnings) {
          warnings.push(`Ambiguous override of ${targetName}: ${candidates.length} matches`);
        }
        return candidates[0].id;
      }
    }

    case 'implements':
    case 'extends': {
      // Interface/class references: exact name match
      const candidates = byExactName.get(targetName) || [];

      if (candidates.length === 0) {
        return null;
      } else if (candidates.length === 1) {
        return candidates[0].id;
      } else {
        // Multiple matches - prefer same project
        if (sourceEntity) {
          const sameProjectMatch = candidates.find(c => isSameProject(c.file_path, sourceEntity.file_path));
          if (sameProjectMatch) return sameProjectMatch.id;
        }

        if (warnings) {
          warnings.push(`Ambiguous ${relType} ${targetName}: ${candidates.length} matches`);
        }
        return candidates[0].id;
      }
    }

    case 'imports': {
      // Import statements: use full_import_path for package-aware matching
      let candidates = byExactName.get(targetName) || [];

      // Handle inner class imports: "Employee.Builder" → try "Employee" as fallback
      // Java inner classes are imported as OuterClass.InnerClass but the entity
      // is typically stored as just "OuterClass" (the file is OuterClass.java)
      if (candidates.length === 0 && targetName.includes('.')) {
        const outerClassName = targetName.split('.')[0];
        candidates = byExactName.get(outerClassName) || [];
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
      // General references: exact name match
      const candidates = byExactName.get(targetName) || [];

      if (candidates.length === 0) {
        return null;
      } else if (candidates.length === 1) {
        return candidates[0].id;
      } else {
        // Multiple matches - prefer same project
        if (sourceEntity) {
          const sameProjectMatch = candidates.find(c => isSameProject(c.file_path, sourceEntity.file_path));
          if (sameProjectMatch) return sameProjectMatch.id;
        }

        return candidates[0].id;
      }
    }

    default: {
      // Unknown relationship type - try exact name match
      const candidates = byExactName.get(targetName) || [];
      if (candidates.length > 0) {
        return candidates[0].id;
      }
      return null;
    }
  }
}

export { detectProject, isSameProject };
export default { resolveRelationshipTargets, detectProject, isSameProject };
