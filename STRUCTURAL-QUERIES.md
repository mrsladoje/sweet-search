# GraphRAG Structural Queries

## Overview

6 structural query types that leverage the code graph to enable queries like "what calls X" and "impact of changing Y".

> **Full routing documentation:** [QUERY-ROUTING.md](./QUERY-ROUTING.md)

## Implementation

### Phase 1: Query Router (query-router.js)

Structural query detection with 6 pattern types (checked BEFORE ML routing with 95% confidence):

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

Structural queries are detected BEFORE ML (WASM CatBoost) routing with 95% confidence.

### Phase 2: Graph Query Methods (graph-search.js)

Added 4 new methods to GraphSearch class:

1. **`findCallers(entityName, options)`** - Find all entities that call the target
2. **`findCallees(entityName, options)`** - Find all entities called by the target
3. **`findImplementations(interfaceName, options)`** - Find implementations/subclasses
4. **`findImpact(entityName, options)`** - Impact analysis with BFS traversal (up to 3 levels)

### Phase 3: SweetSearch Integration (sweet-search.js)

- Added `structuralSearch()` method to route to appropriate graph query
- Added `formatStructuralResults()` for specialized output formatting
- Integrated into search pipeline with `case 'structural':`

## Usage Examples

```bash
# Find callers
./ss "what calls authenticate"

# Find callees
./ss "what does LoginService call"

# Find implementations
./ss "implementations of UserRepository"

# Impact analysis
./ss "impact of changing AuthService"
```

## Query Patterns

### Callers
- "what calls X"
- "who calls X"
- "find callers of X"
- "show what invokes X"
- "list references to X"
- "callers of X"
- "what uses X"
- "usages of X"
- "references to X"
- "where is X called"

### Callees
- "what does X call"
- "what does X invoke"
- "what does X use"
- "what does X depend on"
- "what does X import"
- "callees of X"
- "dependencies of X"
- "methods called by X"
- "functions called by X"

### Implementations
- "implementations of X"
- "implementers of X"
- "subclasses of X"
- "subtypes of X"
- "classes implementing X"
- "types implementing X"
- "who implements X"
- "what extends X"

### Impact
- "impact of changing X"
- "impact of deleting X"
- "impact of refactoring X"
- "impact of renaming X"
- "impact of moving X"
- "what depends on X"
- "what will break if I modify X"
- "affected by changes to X"
- "downstream effects of X"
- "what needs to change if I refactor X"

### Definition (NEW)
- "definition of X"
- "declaration of X"

### Hierarchy (NEW)
- "call hierarchy of X"
- "hierarchy of X"
- "hierarchy for X"

## Output Format

Structural results use a specialized format:

```
======================================================================
CALLERS: authenticate (5 found)
======================================================================

• LoginController (method)
  src/main/java/com/example/LoginController.java:42 (call at :45)
  "Handles user login by calling authenticate"

• AuthFilter (method)
  src/main/java/com/example/AuthFilter.java:28 (call at :31)
  "Pre-request authentication filter"
```

For impact analysis, results include:
- **depth**: Distance from target entity (1-3)
- **riskScore**: Higher for closer dependencies (0.33-1.0)

## Performance

- **Query routing**: ~1μs (structural pattern regex detection, BEFORE WASM CatBoost)
- **Graph traversal**:
  - Callers/Callees: <10ms (single hop)
  - Implementations: <15ms (relationship filter)
  - Impact: <50ms (BFS up to 3 hops)
  - Definition/Hierarchy: <10ms (direct lookup)

## Database Schema

Queries use existing `entities` and `relationships` tables:

```sql
-- Relationships table (v2.9 - with import metadata)
CREATE TABLE relationships (
  source_id TEXT,
  target_id TEXT,
  target_name TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'calls', 'implements', 'extends', 'imports', etc.
  weight REAL DEFAULT 1.0,
  context_line INTEGER,
  full_import_path TEXT,        -- Full Java import path for disambiguation
  is_static INTEGER DEFAULT 0,  -- 1 if static import
  is_wildcard INTEGER DEFAULT 0 -- 1 if wildcard import
);

-- Callers: reverse lookup on 'calls' relationships
SELECT e.* FROM relationships r
JOIN entities e ON e.id = r.source_id
WHERE r.target_id = ? AND r.type = 'calls'

-- Impact: BFS traversal with depth tracking
-- Frontier-based expansion up to maxDepth (default: 3)
```

## Supported Languages

- **Java** - Full support (classes, methods, imports, inheritance)
- **JavaScript/TypeScript** - Full support (functions, classes, imports)
- **Proto** - Services, RPCs, messages

## Configuration

```javascript
// In graph query methods
const options = {
  maxDepth: 3,      // Impact analysis depth (callers/impact)
  limit: 50         // Max results per query
};
```

## Files Modified

1. **`core/query-router.js`**
   - `STRUCTURAL_PATTERNS` constant with 8 pattern types
   - Structural detection runs FIRST (before WASM CatBoost ML)
   - Returns `mode: 'structural'` with `confidence: 0.95` and `targetEntity`

2. **`core/graph-search.js`**
   - `findCallers()` - Find all entities that call the target
   - `findCallees()` - Find all entities called by the target
   - `findImplementations()` - Find implementations/subclasses
   - `findImpact()` - Impact analysis with BFS traversal (up to 3 levels)

3. **`core/sweet-search.js`**
   - `structuralSearch()` - Routes to appropriate graph query
   - `formatStructuralResults()` - Specialized output formatting
   - `search()` switch handles 'structural' mode

## Related Documentation

- **[QUERY-ROUTING.md](./QUERY-ROUTING.md)** - Full query router documentation (WASM CatBoost, 50 features, reject option)
- **[CODEBASE_INDEXING_AND_SEARCHING.md](../../CODEBASE_INDEXING_AND_SEARCHING.md)** - Complete search system architecture
