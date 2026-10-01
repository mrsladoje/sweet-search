/**
 * Override edges, derived after relationship resolution.
 *
 * A method overrides (or implements) the same-named method of a resolved
 * base type: `class Dog : Animal { fun sound() }` → Dog.sound overrides
 * Animal.sound. This is SCIP's model (scip.proto `Relationship`: a type's
 * `is_implementation` relationship to its base carries over to same-named
 * members) and the tree-sitter tags convention (`@reference.implementation`
 * marks the adopting type; members follow by name). No regex sees an
 * override, so the edges are inferred from facts the graph already holds:
 *   1. resolved `extends` / `implements` rows between type entities, plus
 *      Swift `extension X: P` rows lifted to X through `extensionOf`;
 *   2. method ownership: the innermost container entity whose span holds the
 *      method in the same file, else the method's `parent_class` when that
 *      names exactly one primary type of the language family (members of a
 *      Swift extension block have no container entity in their file).
 *
 * Precision: no edge without a RESOLVED base (NSObject, Comparable, Sendable
 * give nothing); the nearest base level that defines the name wins; at most
 * MAX_TARGETS_PER_METHOD targets; constructors never override.
 *
 * Trace-only: `overrides` is in TRACE_ONLY_RELATIONSHIP_TYPES, so search
 * ranking never reads these edges (see relationship-types.js).
 */

const CONTAINER_TYPES = new Set([
  'class', 'struct', 'interface', 'trait', 'impl', 'enum', 'extension',
  'protocol', 'object', 'record', 'actor', 'mixin', 'module',
]);
// Secondary blocks of a type declared elsewhere.
const BLOCK_TYPES = new Set(['extension', 'impl']);
const METHOD_TYPES = new Set(['method', 'function']);
const CONSTRUCTOR_NAMES = new Set([
  'constructor', 'init', '__init__', '__new__', 'initialize', 'new', 'deinit', '__del__',
  'finalize', 'dealloc',
]);
// Languages where one type spans several blocks (Swift/Kotlin extensions,
// Rust impl blocks, C# partial classes, Ruby reopened classes, ObjC
// categories, Scala/Dart extensions).
const OPEN_TYPE_FILE = /\.(?:swift|kt|kts|rs|cs|rb|m|mm|h|scala|dart)$/i;
const MAX_DEPTH = 4;
const MAX_TARGETS_PER_METHOD = 4;

function langFamily(filePath) {
  const m = /\.([A-Za-z0-9]+)$/.exec(filePath || '');
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'kts') return 'kt';
  if (ext === 'mm' || ext === 'h') return 'm';
  return ext;
}

/**
 * Derive `overrides` edges. Replaces every existing `overrides` row (no
 * extractor emits them), so a re-run gives the same result.
 * SWEET_SEARCH_OVERRIDE_EDGES=0 disables (and leaves no rows).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array<object>} [entities] rows with id, name, type, file_path,
 *   parent_class, start_line, end_line (the resolver passes its own list)
 * @returns {{ edges: number, ms: number }}
 */
export function deriveOverrideEdges(db, entities = null) {
  const started = performance.now();
  const clear = db.prepare(`DELETE FROM relationships WHERE type = 'overrides'`);
  if (process.env.SWEET_SEARCH_OVERRIDE_EDGES === '0') {
    clear.run();
    return { edges: 0, ms: 0 };
  }
  const rows = entities || db.prepare(`
    SELECT id, name, type, file_path, parent_class, start_line, end_line FROM entities
  `).all();

  const byId = new Map();
  const containersByFile = new Map();
  const primaryCount = new Map(); // family\0name → count of primary declarations
  for (const e of rows) {
    byId.set(e.id, e);
    if (!CONTAINER_TYPES.has(e.type) || e.start_line == null || e.end_line == null) continue;
    let list = containersByFile.get(e.file_path);
    if (!list) { list = []; containersByFile.set(e.file_path, list); }
    list.push(e);
    if (OPEN_TYPE_FILE.test(e.file_path) && !BLOCK_TYPES.has(e.type)) {
      const k = `${langFamily(e.file_path)}\u0000${e.name}`;
      primaryCount.set(k, (primaryCount.get(k) || 0) + 1);
    }
  }

  // Group key of a type: an extension / impl block joins the ONE primary
  // declaration of that name in its language family. Several primaries with
  // one name (GRDB tests declare many `class Observer`) stay separate, so
  // their bases never mix.
  const nameKey = (filePath, name) => {
    if (!OPEN_TYPE_FILE.test(filePath)) return null;
    const k = `${langFamily(filePath)}\u0000${name}`;
    return primaryCount.get(k) === 1 ? k : null;
  };
  const groupKey = (c) => nameKey(c.file_path, c.name)
    || (BLOCK_TYPES.has(c.type) && OPEN_TYPE_FILE.test(c.file_path) && !primaryCount.has(`${langFamily(c.file_path)}\u0000${c.name}`)
      ? `${langFamily(c.file_path)}\u0000${c.name}`
      : `id\u0000${c.id}`);

  // Methods by owning group.
  const methodsByGroup = new Map(); // groupKey → Map(name → [method])
  for (const m of rows) {
    if (!METHOD_TYPES.has(m.type) || m.start_line == null) continue;
    if (CONSTRUCTOR_NAMES.has(m.name) || m.name.startsWith('~')) continue;
    let gk = null;
    let ownerName = null;
    const list = containersByFile.get(m.file_path);
    if (list) {
      let owner = null;
      const end = m.end_line ?? m.start_line;
      for (const c of list) {
        if (c.id === m.id || c.start_line > m.start_line || c.end_line < end) continue;
        if (m.parent_class && c.name !== m.parent_class) continue;
        if (!owner || (c.end_line - c.start_line) < (owner.end_line - owner.start_line)) owner = c;
      }
      if (owner) { gk = groupKey(owner); ownerName = owner.name; }
    }
    if (!gk && m.parent_class) {
      gk = nameKey(m.file_path, m.parent_class);
      ownerName = m.parent_class;
    }
    if (!gk || m.name === ownerName) continue; // Java/C++ constructors share the type's name
    let byName = methodsByGroup.get(gk);
    if (!byName) { byName = new Map(); methodsByGroup.set(gk, byName); }
    let same = byName.get(m.name);
    if (!same) { same = []; byName.set(m.name, same); }
    same.push(m);
  }

  // Swift `extension X: P` rows: (source, line) → X's entity.
  const extensionOf = new Map();
  for (const r of db.prepare(`
    SELECT source_id, context_line, target_id FROM relationships
    WHERE type = 'extensionOf' AND target_id IS NOT NULL
  `).iterate()) {
    extensionOf.set(`${r.source_id}\u0000${r.context_line}`, r.target_id);
  }

  // Resolved inheritance, lifted to groups.
  const basesOfGroup = new Map(); // groupKey → Set(groupKey)
  for (const r of db.prepare(`
    SELECT source_id, target_id, context_line FROM relationships
    WHERE type IN ('extends', 'implements') AND target_id IS NOT NULL AND source_id IS NOT NULL
  `).iterate()) {
    let s = byId.get(r.source_id);
    if (!s || !CONTAINER_TYPES.has(s.type)) {
      const extended = extensionOf.get(`${r.source_id}\u0000${r.context_line}`);
      s = extended ? byId.get(extended) : null;
    }
    const t = byId.get(r.target_id);
    if (!s || !t || !CONTAINER_TYPES.has(s.type) || !CONTAINER_TYPES.has(t.type)) continue;
    const sk = groupKey(s);
    const tk = groupKey(t);
    if (sk === tk) continue;
    let set = basesOfGroup.get(sk);
    if (!set) { set = new Set(); basesOfGroup.set(sk, set); }
    set.add(tk);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO relationships (source_id, target_id, target_name, type, weight, context_line)
    VALUES (?, ?, ?, 'overrides', 1.0, ?)
  `);
  let edges = 0;
  db.transaction(() => {
    clear.run();
    for (const [childKey, directBases] of basesOfGroup) {
      const own = methodsByGroup.get(childKey);
      if (!own) continue;
      for (const [name, methods] of own) {
        // Breadth-first over bases; the nearest level that defines `name` wins.
        const targets = [];
        let frontier = [...directBases];
        const seen = new Set([childKey]);
        for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0 && targets.length === 0; depth++) {
          const next = [];
          for (const bk of frontier) {
            if (seen.has(bk)) continue;
            seen.add(bk);
            const baseMethods = methodsByGroup.get(bk)?.get(name);
            if (baseMethods) for (const bm of baseMethods) targets.push(bm);
            const up = basesOfGroup.get(bk);
            if (up) for (const u of up) next.push(u);
          }
          frontier = next;
        }
        if (targets.length === 0 || targets.length > MAX_TARGETS_PER_METHOD) continue;
        for (const m of methods) {
          for (const bm of targets) {
            if (bm.id === m.id) continue;
            const qualified = bm.parent_class ? `${bm.parent_class}.${bm.name}` : bm.name;
            edges += insert.run(m.id, bm.id, qualified, m.start_line).changes;
          }
        }
      }
    }
  })();
  return { edges, ms: Math.round(performance.now() - started) };
}

export default deriveOverrideEdges;
