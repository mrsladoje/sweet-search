function qualifierTerms(qualifier) {
  const raw = String(qualifier || '').toLowerCase();
  return [raw, ...raw.split(/[^a-z0-9]+/)].filter(t => t.length >= 3);
}

export function shouldTrustQualifiedResolution(targetName, entity) {
  const normalized = String(targetName || '').replace(/::/g, '.');
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 2 || !entity?.name) return true;
  const leaf = parts[parts.length - 1].toLowerCase();
  if (leaf !== String(entity.name).toLowerCase()) return true;
  const qualifier = parts[parts.length - 2];
  const hay = `${entity.filePath || ''} ${entity.parentClass || ''} ${entity.package || ''} ${entity.signature || ''} ${entity.summary || ''}`.toLowerCase();
  return qualifierTerms(qualifier).some(term => hay.includes(term));
}

// Receivers that mean "the enclosing object", so a qualified edge like
// `this.fetch` can only belong to a target in the SAME class or file as the
// calling entity — never to an unrelated plain function that shares the name.
const SELF_QUALIFIERS = new Set(['this', 'self', 'super', 'cls', 'me']);

/**
 * Caller-side twin of shouldTrustQualifiedResolution: decide whether a stored
 * call edge (matched to `target` by name pattern) plausibly refers to that
 * target. `edge` carries the CALLING entity's fields (filePath, parentClass)
 * plus targetId/targetName from the relationship row.
 */
export function trustedCallerEdge(edge, target) {
  const tn = String(edge?.targetName || '').trim();
  if (!tn || !target?.name) return true;
  if (edge.targetId && edge.targetId === target.id) return true;
  const parts = tn.replace(/::/g, '.').split('.').filter(Boolean);
  if (parts.length < 2) return true; // bare-name edge: exact match already
  const qualifier = parts[parts.length - 2].toLowerCase();
  if (SELF_QUALIFIERS.has(qualifier)) {
    if (edge.filePath && target.filePath && edge.filePath === target.filePath) return true;
    return !!(edge.parentClass && target.parentClass && edge.parentClass === target.parentClass);
  }
  const targetNames = [target.name, target.parentClass]
    .filter(Boolean)
    .map(s => String(s).toLowerCase());
  if (targetNames.includes(qualifier)) return true;
  return shouldTrustQualifiedResolution(tn, target);
}
