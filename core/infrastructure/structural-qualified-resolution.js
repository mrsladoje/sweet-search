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
