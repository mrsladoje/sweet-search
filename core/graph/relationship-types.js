/**
 * Relationship types that ss-trace reads but search ranking must not.
 *
 * - overrides:    method → the same-named method of a resolved base type /
 *                 protocol / interface / trait (derived after resolution,
 *                 SCIP-style: Dog#sound() is_implementation Animal#sound()).
 * - instantiates: code → the type it constructs (`new Foo(`, `Foo(` in
 *                 Swift/Kotlin/Python/Dart/Scala, Rust `Foo::new(` / `Foo {`).
 * - typeRef:      definition → a type named in its parameter / return types.
 * - extensionOf:  Swift `extension X: P` line → X. The conformance rows of
 *                 that line have no container entity as source; the override
 *                 pass joins them on (source, line) to learn that X adopts P.
 *
 * Search ranking (structural PageRank, graph expansion, community detection,
 * repo map, structural signals, context expansion) was tuned on graphs
 * without these edges. Every ranking consumer skips them, so adding them
 * changes no ranking; ss-trace asks for them by name. Widening any of them
 * into ranking needs held-out MRR evidence first (CLAUDE.md).
 */

export const TRACE_ONLY_RELATIONSHIP_TYPES = Object.freeze(['overrides', 'instantiates', 'typeRef', 'extensionOf']);

const TRACE_ONLY_SET = new Set(TRACE_ONLY_RELATIONSHIP_TYPES);

/** SQL list literal: `('overrides','instantiates','typeRef')`. */
export const TRACE_ONLY_TYPES_SQL = `(${TRACE_ONLY_RELATIONSHIP_TYPES.map(t => `'${t}'`).join(',')})`;

export function isTraceOnlyRelationship(type) {
  return TRACE_ONLY_SET.has(type);
}

/**
 * Relationship types whose every site line the extractor records in the
 * trace-only site-line table (graph-extractor insertCallSites), keyed by
 * `rel_type`. `relationships` keeps one row per (source, type, target).
 * `overrides` is derived per method pair, so it has one line by nature.
 */
export const SITE_LINE_RELATIONSHIP_TYPES = Object.freeze(new Set(['calls', 'instantiates', 'typeRef', 'extensionOf']));

/** Drop trace-only types from a ranking consumer's relationship-type list. */
export function rankingRelationshipTypes(types) {
  return types.filter(t => !TRACE_ONLY_SET.has(t));
}
