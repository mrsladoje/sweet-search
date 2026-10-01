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
 * give nothing); the nearest base level that defines the name wins; among
 * same-named overloads the matching parameter count wins; private members
 * never take part (except C/C++); at most MAX_TARGETS_PER_METHOD targets;
 * constructors never override.
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
// A private member neither overrides nor is overridden (Swift, Java,
// Kotlin, C#, Scala, TS, PHP). C/C++ private virtuals do override (NVI).
const PRIVATE_MEMBER = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:[\w]+\s+)*?(?:private|fileprivate)\b/;
const PRIVATE_CAN_OVERRIDE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;

function isPrivateMember(m) {
  return !!m.signature && PRIVATE_MEMBER.test(m.signature) && !PRIVATE_CAN_OVERRIDE.test(m.file_path || '');
}

/** Parameter count of a one-line signature: `f()` → 0, `f(a, b: [X, Y])` → 2; null if unknown. */
function arity(signature) {
  if (!signature) return null;
  const open = signature.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  let count = 0;
  let sawToken = false;
  for (let i = open + 1; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      if (depth === 0) return sawToken ? count + 1 : 0;
      depth--;
    } else if (ch === ',' && depth === 0) count++;
    else if (!/\s/.test(ch)) sawToken = true;
  }
  return null; // parameter list continues on the next line
}

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
 *   parent_class, signature, start_line, end_line (the resolver passes its
 *   own list)
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
    SELECT id, name, type, file_path, parent_class, signature, start_line, end_line FROM entities
  `).all();

  // Per-file facts, computed once per path.
  const fileFacts = new Map();
  const factsOf = (filePath) => {
    let f = fileFacts.get(filePath);
    if (!f) {
      const open = OPEN_TYPE_FILE.test(filePath || '');
      f = { open, family: open ? langFamily(filePath) : '' };
      fileFacts.set(filePath, f);
    }
    return f;
  };

  const byId = new Map();
  const containersByFile = new Map();
  const primaryCount = new Map(); // family\0name → count of primary declarations
  for (const e of rows) {
    byId.set(e.id, e);
    if (!CONTAINER_TYPES.has(e.type) || e.start_line == null || e.end_line == null) continue;
    let list = containersByFile.get(e.file_path);
    if (!list) { list = []; containersByFile.set(e.file_path, list); }
    list.push(e);
    const f = factsOf(e.file_path);
    if (f.open && !BLOCK_TYPES.has(e.type)) {
      const k = `${f.family}\u0000${e.name}`;
      primaryCount.set(k, (primaryCount.get(k) || 0) + 1);
    }
  }
  for (const list of containersByFile.values()) list.sort((a, b) => a.start_line - b.start_line);

  // Group key of a type: an extension / impl block joins the ONE primary
  // declaration of that name in its language family. Several primaries with
  // one name (GRDB tests declare many `class Observer`) stay separate, so
  // their bases never mix.
  const nameKey = (filePath, name) => {
    const f = factsOf(filePath);
    if (!f.open) return null;
    const k = `${f.family}\u0000${name}`;
    return primaryCount.get(k) === 1 ? k : null;
  };
  const groupKeyCache = new Map();
  const groupKey = (c) => {
    let gk = groupKeyCache.get(c.id);
    if (gk === undefined) {
      const f = factsOf(c.file_path);
      const k = `${f.family}\u0000${c.name}`;
      gk = nameKey(c.file_path, c.name)
        || (f.open && BLOCK_TYPES.has(c.type) && !primaryCount.has(k) ? k : `id\u0000${c.id}`);
      groupKeyCache.set(c.id, gk);
    }
    return gk;
  };

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
  if (basesOfGroup.size === 0) {
    clear.run();
    return { edges: 0, ms: Math.round(performance.now() - started) };
  }

  // Only types in the inheritance graph need their methods: files holding a
  // container of such a type, or methods whose parent_class names one.
  const relevant = new Set();
  for (const [k, bases] of basesOfGroup) {
    relevant.add(k);
    for (const b of bases) relevant.add(b);
  }
  const relevantFiles = new Set();
  for (const [filePath, list] of containersByFile) {
    if (list.some(c => relevant.has(groupKey(c)))) relevantFiles.add(filePath);
  }

  // Methods by owning group.
  const methodsByGroup = new Map(); // groupKey → Map(name → [method])
  for (const m of rows) {
    if (!METHOD_TYPES.has(m.type) || m.start_line == null) continue;
    if (CONSTRUCTOR_NAMES.has(m.name) || m.name.startsWith('~')) continue;
    let gk = null;
    let ownerName = null;
    if (relevantFiles.has(m.file_path)) {
      const end = m.end_line ?? m.start_line;
      let owner = null;
      for (const c of containersByFile.get(m.file_path)) {
        if (c.start_line > m.start_line) break; // sorted by start
        if (c.id === m.id || c.end_line < end) continue;
        if (m.parent_class && c.name !== m.parent_class) continue;
        if (!owner || (c.end_line - c.start_line) < (owner.end_line - owner.start_line)) owner = c;
      }
      if (owner) { gk = groupKey(owner); ownerName = owner.name; }
    }
    if (!gk && m.parent_class) {
      gk = nameKey(m.file_path, m.parent_class);
      ownerName = m.parent_class;
    }
    if (!gk || !relevant.has(gk) || m.name === ownerName) continue; // Java/C++ constructors share the type's name
    let byName = methodsByGroup.get(gk);
    if (!byName) { byName = new Map(); methodsByGroup.set(gk, byName); }
    let same = byName.get(m.name);
    if (!same) { same = []; byName.set(m.name, same); }
    same.push(m);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO relationships (source_id, target_id, target_name, type, weight, context_line)
    VALUES (?, ?, ?, 'overrides', 1.0, ?)
  `);
  // Ancestor levels per type, breadth-first once (depth <= MAX_DEPTH); only
  // ancestors that own methods matter.
  const ancestorLevels = (childKey) => {
    const levels = [];
    const seen = new Set([childKey]);
    let frontier = [...basesOfGroup.get(childKey)];
    for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
      const level = [];
      const next = [];
      for (const bk of frontier) {
        if (seen.has(bk)) continue;
        seen.add(bk);
        const owned = methodsByGroup.get(bk);
        if (owned) level.push(owned);
        const up = basesOfGroup.get(bk);
        if (up) for (const u of up) next.push(u);
      }
      if (level.length > 0) levels.push(level);
      frontier = next;
    }
    return levels;
  };

  let edges = 0;
  db.transaction(() => {
    clear.run();
    for (const childKey of basesOfGroup.keys()) {
      const own = methodsByGroup.get(childKey);
      if (!own) continue;
      const levels = ancestorLevels(childKey);
      if (levels.length === 0) continue;
      for (const [name, methods] of own) {
        // The nearest level that defines `name` (non-private) wins.
        let targets = null;
        for (const level of levels) {
          for (const owned of level) {
            const baseMethods = owned.get(name);
            if (!baseMethods) continue;
            for (const bm of baseMethods) if (!isPrivateMember(bm)) (targets ||= []).push(bm);
          }
          if (targets) break;
        }
        if (!targets) continue;
        for (const m of methods) {
          if (isPrivateMember(m)) continue;
          // Overloads share a name (Swift `databaseDidChange()` vs
          // `databaseDidChange(with:)`): with several candidates, keep the
          // ones whose parameter count matches when any does.
          let picked = targets;
          if (targets.length > 1) {
            const n = arity(m.signature);
            if (n !== null) {
              const same = targets.filter(bm => arity(bm.signature) === n);
              if (same.length > 0) picked = same;
            }
          }
          if (picked.length > MAX_TARGETS_PER_METHOD) continue;
          for (const bm of picked) {
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
