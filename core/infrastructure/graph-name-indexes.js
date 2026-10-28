/**
 * Expression indexes for the name lookups of ss-trace on code-graph.db.
 *
 * The caller queries match `relationships.target_name` with `name`, `name.%`, `%.name`
 * and `%::name` (case-insensitive LIKE). A LIKE with a leading wildcard reads every row:
 * 2-7 s per trace on a graph of 300k-500k entities. The two expressions below are the
 * head (before the first `.`) and the tail (after the last `.` or `:`) of a target name,
 * lowercased. Every row the LIKE clauses match has head or tail equal to the lowercased
 * name (for a name without `.` or `:`), so the indexes find a superset and the LIKE
 * clauses still decide. One exception: `_` and `%` in a name are LIKE wildcards, so the
 * scan also matched `syncXpod` for `sync_pod`; the indexes do not find such a row. The
 * spelling filter after the query dropped those rows anyway (except in PHP files).
 * Built-in functions only: any SQLite connection can write the table.
 *
 * Added with CREATE INDEX IF NOT EXISTS by createGraphSchema (full build and maintainer):
 * no schema version change. A reader checks that the indexes exist and keeps the
 * scanning query when they do not.
 */

const SEP = `replace(target_name, ':', '.')`;

export const TARGET_HEAD_SQL = `lower(substr(target_name, 1, instr(target_name, '.') - 1))`;
export const TARGET_TAIL_SQL = `lower(substr(${SEP}, length(rtrim(${SEP}, replace(${SEP}, '.', ''))) + 1))`;

export const GRAPH_NAME_INDEXES = {
  idx_entities_name_lower: 'ON entities(lower(name))',
  idx_rel_target_head: `ON relationships(${TARGET_HEAD_SQL})`,
  idx_rel_target_tail: `ON relationships(${TARGET_TAIL_SQL})`,
};

export function ensureGraphNameIndexes(db) {
  for (const [name, on] of Object.entries(GRAPH_NAME_INDEXES)) {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ${on}`);
  }
}

export function hasGraphNameIndexes(db) {
  const names = Object.keys(GRAPH_NAME_INDEXES);
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${names.map(() => '?').join(', ')})`,
  ).all(...names);
  return rows.length === names.length;
}

/**
 * Rowids of the relationships whose target_name a caller pattern of `name` can match,
 * from the indexes: a superset of the LIKE matches. Null when `name` holds a character
 * the head/tail split does not cover; the caller then keeps the scanning query.
 */
export function targetNameCandidateSql(name) {
  if (!name || /[.:]/.test(name)) return null;
  return {
    sql: `SELECT rowid FROM relationships WHERE target_name = ?
      UNION SELECT rowid FROM relationships WHERE ${TARGET_HEAD_SQL} = ?
      UNION SELECT rowid FROM relationships WHERE ${TARGET_TAIL_SQL} = ?`,
    params: [name, name.toLowerCase(), name.toLowerCase()],
  };
}
