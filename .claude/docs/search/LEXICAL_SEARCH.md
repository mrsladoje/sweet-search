# Lexical Search

Lexical search provides fast text-based search using FTS5/BM25 with optional code graph expansion.

## Source Files

- **Primary**: `core/graph-search.js`
- **Configuration**: `core/config.js` (GRAPH_CONFIG section)
- **Database**: `.sweet-search/code-graph.db` (SQLite with FTS5)

## Performance

| Metric | Target | Typical | Source |
|--------|--------|---------|--------|
| BM25 search p50 | <10ms | 3-8ms | `graph-search.js` header: "Target: <10ms p50" |
| With graph expansion | <15ms | 5-15ms | Depends on graph traversal depth |
| Exact match (adaptive skip) | <10ms | 3-5ms | Skips expansion for high-confidence matches |

## GraphSearch Class

**Source**: `graph-search.js`, lines 23-29

```javascript
export class GraphSearch {
  constructor(dbPath = DB_PATHS.codeGraph) {
    this.dbPath = dbPath;
    this.db = null;
    this.hasFts5 = false;
    this.hasTrigram = false;
  }
}
```

## Search Methods

### BM25 Search

**Source**: `graph-search.js`, lines 71-232

The `bm25Search(query, limit)` method performs full-text search using FTS5:

1. **FTS5 Search**: Uses BM25 ranking with prefix matching
2. **Trigram Fallback**: If FTS5 returns <3 results and query is >=3 chars, tries trigram fuzzy search
3. **LIKE Fallback**: If no FTS5 tables exist, falls back to LIKE-based search

#### FTS5 Query Sanitization

**Source**: `graph-search.js`, lines 562-581

```javascript
sanitizeFtsQuery(query) {
  // Remove FTS5 special characters
  let sanitized = query.replace(/[":*^~()]/g, ' ');
  const words = sanitized.trim().split(/\s+/).filter(w => w.length > 0);

  if (words.length === 1) {
    // Single word: use prefix matching
    return `"${words[0]}"*`;
  }

  // Multiple words: use AND logic with prefix on last word
  return words.map((w, i) => {
    if (i === words.length - 1) {
      return `"${w}"*`;
    }
    return `"${w}"`;
  }).join(' ');
}
```

### Graph-Expanded Search

**Source**: `graph-search.js`, lines 417-541

The `graphExpandedSearch(query, options)` method:

1. **BM25 Search**: Initial text match
2. **Adaptive Expansion**: Skips graph traversal for exact matches
3. **Graph Expansion**: Finds related entities via code relationships

#### Adaptive Expansion

**Source**: `graph-search.js`, lines 377-405

The `isExactMatchResult()` method determines when to skip expensive graph traversal:

| Criterion | Condition |
|-----------|-----------|
| Name match | Entity name exactly matches query (case-insensitive) |
| High score | BM25 score > 30.0 indicates strong match |
| Score gap | Top result score >= 2x second result |
| Identifier match | CamelCase query matches name (partial) |

When skipped, the search returns `mode: 'bm25_exact_match'` and `skipped_expansion: true`.

### Structural Queries

**Source**: `graph-search.js`, lines 586-749

#### findCallers(entityName, options)

**Source**: lines 586-629

Finds all entities that call the target entity:

```javascript
async findCallers(entityName, options = {}) {
  // Find target entity
  const target = this.db.prepare(`
    SELECT id, name, type, file_path FROM entities
    WHERE name = ? OR name LIKE ?
    LIMIT 1
  `).get(entityName, `%${entityName}%`);

  // Create lowercase camelCase pattern for target_name matching
  const lowerCamelCase = target.name.charAt(0).toLowerCase() + target.name.slice(1);
  const targetNamePattern = `${lowerCamelCase}.%`;

  // Find callers (reverse 'calls' relationship)
  const callers = this.db.prepare(`
    SELECT DISTINCT e.id, e.name, e.type, e.file_path, ...
    FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE r.type = 'calls' AND (
      r.target_id = ?
      OR r.target_name LIKE ?
      OR r.target_name LIKE ?
    )
    ...
  `).all(target.id, targetNamePattern, `${target.name}.%`, limit);
}
```

#### findCallees(entityName, options)

**Source**: lines 634-668

Finds all entities that the source entity calls.

#### findImplementations(interfaceName, options)

**Source**: lines 673-693

Finds all classes that implement or extend the interface:

```javascript
const implementations = this.db.prepare(`
  SELECT DISTINCT e.id, e.name, e.type, e.file_path, ...
  FROM relationships r
  JOIN entities e ON e.id = r.source_id
  WHERE (r.target_name = ? OR r.target_name LIKE ?)
    AND r.type IN ('implements', 'extends')
  ...
`).all(interfaceName, `%${interfaceName}%`, limit);
```

#### findImpact(entityName, options)

**Source**: lines 698-749

Performs multi-hop traversal to find all dependents with risk scoring:

```javascript
for (let depth = 1; depth <= maxDepth && impacted.size < limit; depth++) {
  const dependents = this.db.prepare(`
    SELECT DISTINCT e.id, e.name, e.type, ...
    FROM relationships r
    JOIN entities e ON e.id = r.source_id
    WHERE r.target_id IN (${placeholders})
    ...
  `).all(...frontier);

  for (const dep of dependents) {
    impacted.set(dep.id, {
      ...dep,
      depth,
      riskScore: (4 - depth) / 3, // Higher for closer dependencies
    });
  }
}
```

## Graph Configuration

**Source**: `config.js`, lines 446-460

```javascript
export const GRAPH_CONFIG = {
  relationshipWeights: {
    extends: 2.0,
    implements: 1.8,
    overrides: 1.5,
    calls: 1.0,
    uses: 0.5,
    throws: 0.6,
    imports: 0.3,
  },
  expansion: {
    maxHops: 2,
    maxExpanded: 30,
  },
};
```

### Relationship Type Multipliers

**Source**: `graph-search.js`, lines 546-557

```javascript
getRelTypeMultiplier(relType) {
  const multipliers = {
    implements: 0.9,
    extends: 0.85,
    overrides: 0.8,
    calls: 0.7,
    throws: 0.6,
    uses: 0.5,
    imports: 0.3,
  };
  return multipliers[relType] || 0.5;
}
```

## Database Schema

The code graph database (`code-graph.db`) contains:

### entities table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Unique identifier |
| file_path | TEXT | Source file path |
| type | TEXT | Entity type (class, method, field, etc.) |
| name | TEXT | Entity name |
| signature | TEXT | Full signature |
| doc_comment | TEXT | Documentation comment |
| start_line | INTEGER | Start line in file |
| end_line | INTEGER | End line in file |
| package | TEXT | Package name |
| parent_class | TEXT | Parent class name |
| search_text | TEXT | Concatenated searchable text |
| summary | TEXT | HCGS-generated summary |

### relationships table

| Column | Type | Description |
|--------|------|-------------|
| source_id | TEXT | Source entity ID |
| target_id | TEXT | Target entity ID (if resolved) |
| target_name | TEXT | Target entity name (if unresolved) |
| type | TEXT | Relationship type |
| weight | REAL | Relationship weight |
| context_line | INTEGER | Line where relationship occurs |

### FTS5 Tables

- `entities_fts`: Standard FTS5 index on search_text
- `entities_trigram`: Trigram tokenizer FTS5 for fuzzy matching

## Usage

### Basic Search

```javascript
import { GraphSearch } from './graph-search.js';

const searcher = new GraphSearch();
const { results, stats } = await searcher.graphExpandedSearch("AuthService", {
  k: 10,
  expand: true,
});
```

### Structural Queries

```javascript
// Find all callers
const callers = await searcher.findCallers("EmployeeService");

// Find implementations
const impls = await searcher.findImplementations("DetectionHeuristic");

// Impact analysis
const impact = await searcher.findImpact("AuthService", { maxDepth: 3 });
```

## CLI

```bash
# Search with graph expansion
node graph-search.js "AuthService"

# BM25 only (no graph expansion)
node graph-search.js "authentication" --no-expand

# Force graph expansion (disable adaptive skip)
node graph-search.js "AuthService" --force-expand

# Show database statistics
node graph-search.js --stats

# JSON output
node graph-search.js "query" --json --top 20
```
