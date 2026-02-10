# Structural Search (GraphRAG)

Documentation of structural query patterns and graph-based code search.

> **Full query routing documentation:** [QUERY-ROUTING.md](../../QUERY-ROUTING.md)

## Source Files

- **Query Router**: `core/query-router.js` (WASM CatBoost + regex pre-checks)
- **WASM Router**: `core/wasm-router/` (499 trees, depth 4, ~10μs)
- **Graph Search**: `core/graph-search.js`
- **Smart Search Integration**: `core/sweet-search.js`

## Overview

Structural search provides dependency analysis through code graph queries. Structural patterns are detected via regex (~1μs) BEFORE the WASM CatBoost ML router (~10μs), ensuring 100% accuracy for graph queries.

## Structural Pattern Detection

**Source**: `query-router.js` lines 57-66

8 structural pattern types are detected via regex BEFORE the WASM CatBoost ML model:

```javascript
const STRUCTURAL_PATTERNS = {
  callers: /\b(?:(?:what|who|show|find|list)\s+(?:calls?|callers?|calling|invokes?|references?|uses)\s+(?:of\s+|to\s+)?|callers?\s+of\s+|what\s+uses\s+|usages?\s+of\s+|references?\s+to\s+)(\w+)/i,
  whereIsCalled: /\bwhere\s+is\s+(\w+)\s+called\b/i,
  calleesWhatDoes: /\bwhat\s+does\s+(\w+)\s+(?:call|invoke|use|depend\s+on|import)\b/i,
  calleesOf: /\b(?:callees?\s+of|dependencies\s+of|(?:methods?|functions?)\s+called\s+by)\s+(\w+)/i,
  implementations: /\b(?:(?:implementations?|implementers?|implementors?|subclasses?|subtypes?)\s+of|(?:classes?|types?)\s+(?:that\s+)?(?:implementing?|extending?)|(?:who|what)\s+(?:extends?|implements?))\s+(\w+)/i,
  impact: /\b(?:impact\s+of\s+(?:changing|modifying|refactoring|updating|deleting|removing|renaming|moving)|(?:what\s+)?depends?\s+on|(?:will|what)\s+breaks?\s+if\s+(?:I|we)\s+(?:change|modify|update|delete|remove)|affected\s+by\s+(?:changes?\s+to|modifying)?|(?:downstream|ripple)\s+effects?\s+of|what\s+needs?\s+to\s+change\s+if\s+(?:I|we)\s+(?:refactor|modify))\s+(\w+)/i,
  definition: /\b(?:definition|declaration)\s+of\s+(\w+)/i,
  hierarchy: /\b(?:call\s+)?hierarchy\s+(?:of|for)\s+(\w+)/i,
};
```

All patterns capture the target entity in the last capture group.

## Query Routing Pipeline

**3-Stage Pipeline** (see [QUERY-ROUTING.md](../../QUERY-ROUTING.md) for details):

```
Query Input
    │
    ▼
┌─────────────────────────────────────────────┐
│  Stage 1: Structural Patterns (~1μs)        │
│  - 8 regex patterns checked first           │
│  - 100% accuracy for graph queries          │
│  - Returns mode='structural' with 0.95 conf │
└─────────────────────────────────────────────┘
    │ not matched
    ▼
┌─────────────────────────────────────────────┐
│  Stage 2: File Extension Check (~0.1μs)     │
│  - .java, .ts, .py, etc. → LEXICAL          │
│  - Path separators → LEXICAL                │
└─────────────────────────────────────────────┘
    │ not matched
    ▼
┌─────────────────────────────────────────────┐
│  Stage 3: WASM CatBoost ML (~10μs)          │
│  - 499 trees, depth 4                       │
│  - 50 features extracted in Rust            │
│  - Softmax confidence + reject option       │
└─────────────────────────────────────────────┘
```

**Structural route result:**
```javascript
{
  mode: 'structural',
  confidence: 0.95,
  structuralType: 'callers',  // or 'callees', 'implementations', 'impact', etc.
  targetEntity: 'AuthService',
  method: 'pattern',
  routingLatency_us: 2
}
```

## Graph Search Functions

### findCallers()

**Source**: `grep -n "async findCallers" graph-search.js`

Finds all entities that call the target.

```javascript
async findCallers(entityName, options = {}) {
  const { maxDepth = 2, limit = 50 } = options;

  // Find target entity
  const target = this.db.prepare(`
    SELECT id, name, type, file_path FROM entities
    WHERE name = ? OR name LIKE ?
  `).get(entityName, `%${entityName}%`);

  // Create lowercase camelCase pattern for target_name matching
  const lowerCamelCase = target.name.charAt(0).toLowerCase() + target.name.slice(1);
  const targetNamePattern = `${lowerCamelCase}.%`;

  // Find callers via 'calls' relationship
  const callers = this.db.prepare(`
    SELECT DISTINCT e.id, e.name, e.type, e.file_path, e.start_line, ...
    FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE r.type = 'calls' AND (
      r.target_id = ?
      OR r.target_name LIKE ?
      OR r.target_name LIKE ?
    )
  `).all(target.id, targetNamePattern, `${target.name}.%`, limit);

  return { results: callers.map(...), stats: {...} };
}
```

### findCallees()

**Source**: `grep -n "async findCallees" graph-search.js`

Finds all entities that the source calls.

```javascript
async findCallees(entityName, options = {}) {
  const { limit = 50 } = options;

  const source = this.db.prepare(`
    SELECT id, name, type FROM entities WHERE name = ? OR name LIKE ?
  `).get(entityName, `%${entityName}%`);

  const callees = this.db.prepare(`
    SELECT DISTINCT e.id, e.name, e.type, e.file_path, ...
    FROM relationships r
    LEFT JOIN entities e ON e.id = r.target_id OR e.name = r.target_name
    WHERE r.source_id = ? AND r.type = 'calls'
  `).all(source.id, limit);

  return { results: callees.map(...), stats: {...} };
}
```

### findImplementations()

**Source**: `grep -n "async findImplementations" graph-search.js`

Finds classes that implement an interface or extend a class.

```javascript
async findImplementations(interfaceName, options = {}) {
  const { limit = 50 } = options;

  const implementations = this.db.prepare(`
    SELECT DISTINCT e.id, e.name, e.type, e.file_path, ...
    FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE (r.target_name = ? OR r.target_name LIKE ?)
      AND r.type IN ('implements', 'extends')
  `).all(interfaceName, `%${interfaceName}%`, limit);

  return { results: implementations.map(...), stats: {...} };
}
```

### findImpact()

**Source**: `grep -n "async findImpact" graph-search.js`

Multi-hop dependency analysis for change impact assessment.

```javascript
async findImpact(entityName, options = {}) {
  const { maxDepth = 3, limit = 100 } = options;

  const target = this.db.prepare(`
    SELECT id, name, type FROM entities WHERE name = ?
  `).get(entityName);

  const impacted = new Map();
  let frontier = [target.id];

  // BFS traversal up to maxDepth
  for (let depth = 1; depth <= maxDepth && impacted.size < limit; depth++) {
    const dependents = this.db.prepare(`
      SELECT DISTINCT e.id, e.name, e.type, ...
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.target_id IN (${placeholders})
    `).all(...frontier);

    for (const dep of dependents) {
      if (!impacted.has(dep.id)) {
        impacted.set(dep.id, {
          ...dep,
          depth,
          riskScore: (4 - depth) / 3,  // Higher for closer dependencies
        });
      }
    }
    frontier = nextFrontier.slice(0, 20);  // Limit branching
  }

  return { results: sorted_by_riskScore, stats: {...} };
}
```

## Integration in SweetSearch

**Source**: `grep -n "structuralSearch" sweet-search.js`

```javascript
async structuralSearch(query, routing, options = {}) {
  const { structuralType, targetEntity } = routing;

  let result;
  switch (structuralType) {
    case 'callers':
      result = await this.graphSearch.findCallers(targetEntity);
      break;
    case 'callees':
      result = await this.graphSearch.findCallees(targetEntity);
      break;
    case 'implementations':
      result = await this.graphSearch.findImplementations(targetEntity);
      break;
    case 'impact':
      result = await this.graphSearch.findImpact(targetEntity);
      break;
  }

  return result.results.map(r => ({ ...r, searchPath: 'structural', structuralType }));
}
```

## Performance Numbers

| Query Type | Target Latency | Notes |
|------------|----------------|-------|
| findCallers | <10ms | Single SQL query |
| findCallees | <10ms | Single SQL query |
| findImplementations | <10ms | Single SQL query |
| findImpact | <50ms | Multi-hop BFS, depends on graph density |

**Note**: All latency numbers are **targets**. Actual performance depends on code-graph.db size and SQLite performance.

## Example Queries

| Query | Type | Target |
|-------|------|--------|
| "what calls AuthService" | callers | AuthService |
| "who invokes LoginController" | callers | LoginController |
| "what does EmployeeService call" | callees | EmployeeService |
| "implementations of UserRepository" | implementations | UserRepository |
| "impact of changing SessionManager" | impact | SessionManager |
| "what depends on EventService" | impact | EventService |

## Database Schema

**Source**: Graph database `code-graph.db`

```sql
-- Entities table (classes, methods, functions, etc.)
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,           -- 'class', 'method', 'interface', etc.
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,
  summary TEXT,
  package TEXT,
  parent_class TEXT
);

-- Relationships table
CREATE TABLE relationships (
  source_id TEXT,           -- Entity doing the calling
  target_id TEXT,           -- Entity being called (may be NULL)
  target_name TEXT,         -- Unresolved name (e.g., "authService.login")
  type TEXT,                -- 'calls', 'implements', 'extends', 'uses', 'throws', 'imports'
  weight REAL,
  context_line INTEGER,
  full_import_path TEXT,    -- Full Java import path (e.g., "com.example.AuthService")
  is_static INTEGER,        -- 1 if static import
  is_wildcard INTEGER       -- 1 if wildcard import (e.g., "com.foo.*")
);

-- Supported Languages: Java, JavaScript/TypeScript, Proto

-- FTS5 for BM25 search
CREATE VIRTUAL TABLE entities_fts USING fts5(...);

-- Trigram index for fuzzy matching
CREATE VIRTUAL TABLE entities_trigram USING fts5(..., tokenize='trigram');
```

## Relationship Weights

**Source**: `grep -n "relationshipWeights" config.js`

```javascript
relationshipWeights: {
  extends: 2.0,
  implements: 1.8,
  overrides: 1.5,
  calls: 1.0,
  uses: 0.5,
  throws: 0.6,
  imports: 0.3,
}
```

These weights are used in `getRelTypeMultiplier()` (`grep -n "getRelTypeMultiplier" graph-search.js`) for graph expansion scoring.
