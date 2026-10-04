function qualifierTerms(qualifier) {
  const raw = String(qualifier || '').toLowerCase();
  return [raw, ...raw.split(/[^a-z0-9]+/)].filter(t => t.length >= 3);
}

export function shouldTrustQualifiedResolution(targetName, entity) {
  // Rust `recv.name(` is method-call syntax: it reaches a method of an impl or trait, never a
  // free function (those are called by path, `a::f(`). jj `working_copy_path.clone()` was
  // bound to the free `fn clone` in lib/testutils/src/git.rs.
  if (rustMethodCallOnFreeFunction(targetName, entity)) return false;
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
const SELF_QUALIFIERS = new Set(['this', 'self', 'super', 'cls', 'me', 'static']);

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
  // Resolution already bound this call to ANOTHER definition (a different
  // file or owning type): `database.statementDidFail` → Database's method is
  // not a caller of DatabaseObservationBroker.statementDidFail. Same file and
  // owner (an overload, or the same definition re-indexed) stays trusted.
  if (edge.targetId && edge.resolvedFile
    && (edge.resolvedFile !== target.filePath || (edge.resolvedParent || null) !== (target.parentClass || null))) {
    return false;
  }
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

function rustMethodCallOnFreeFunction(targetName, entity) {
  const raw = String(targetName || '');
  if (!/\.rs$/.test(String(entity?.filePath || '')) || entity?.parentClass) return false;
  if (!/(?:^|[^:])\.[A-Za-z_]\w*$/.test(raw) || raw.includes('::')) return false;
  return entity.type === 'function';
}
