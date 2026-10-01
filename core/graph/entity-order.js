/**
 * The one entity order every graph-resolution input uses: file path, then
 * position, then kind, name and id (code-unit string order, no locale).
 *
 * Candidate lists keep this order and ties in candidate ranking keep the
 * first candidate, so a resolved graph never depends on file discovery order
 * or on rowids: a full build inserts entities in discovery order, and a
 * maintained graph appends a re-inserted entity after older rows.
 */

const cmpText = (a, b) => (a === b ? 0 : (a < b ? -1 : 1));

export function compareEntitiesForResolution(a, b) {
  return cmpText(String(a.file_path ?? ''), String(b.file_path ?? ''))
    || ((a.start_line ?? 0) - (b.start_line ?? 0))
    || ((a.end_line ?? 0) - (b.end_line ?? 0))
    || cmpText(String(a.type ?? ''), String(b.type ?? ''))
    || cmpText(String(a.name ?? ''), String(b.name ?? ''))
    || cmpText(String(a.id ?? ''), String(b.id ?? ''));
}

/** Relationship rows (source, target, line) in a fixed order. */
export function compareEdgeRows(a, b) {
  return cmpText(String(a.source_id ?? ''), String(b.source_id ?? ''))
    || cmpText(String(a.target_id ?? ''), String(b.target_id ?? ''))
    || ((a.context_line ?? 0) - (b.context_line ?? 0));
}
