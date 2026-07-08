export function clampLimit(value, fallback, max) {
  const n = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, n));
}

export function lowerCamel(name) {
  if (!name) return '';
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function rowToEntity(row, prefix = '') {
  if (!row) return null;
  return {
    id: row[`${prefix}id`],
    name: row[`${prefix}name`],
    type: row[`${prefix}type`],
    filePath: row[`${prefix}file_path`],
    startLine: row[`${prefix}start_line`],
    endLine: row[`${prefix}end_line`],
    signature: row[`${prefix}signature`] || '',
    summary: row[`${prefix}summary`] || '',
    parentClass: row[`${prefix}parent_class`] || null,
    package: row[`${prefix}package`] || null,
  };
}

export function callTargetAliases(targetName) {
  const raw = String(targetName || '').trim();
  if (!raw) return [];
  const out = [raw];
  const bound = raw.match(/^(.+)\.(bind|call|apply)$/);
  if (bound) out.push(bound[1]);
  if (raw.includes('::')) out.push(raw.split('::').filter(Boolean).pop());
  return [...new Set(out)];
}

export function qualifiedTargetName(targetName) {
  const base = String(targetName || '').trim().replace(/\.(bind|call|apply)$/, '').replace(/::/g, '.');
  if (!base.includes('.')) return null;
  const parts = base.split('.').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

export function isTestPath(filePath = '') {
  return /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(filePath);
}

export function placeholders(values) {
  return values.map(() => '?').join(',');
}

// Entities extracted from config/doc files (TOML keys, YAML fields, …) are
// valid search hits but must never be presented as call-graph neighbours —
// a `calls` edge into stylua.toml is noise, not structure.
const NON_CODE_FILE_RE = /\.(toml|ya?ml|json|json5|ini|cfg|conf|properties|lock|md|markdown|rst|txt|xml|html?|css|scss|svg)$/i;

export function isLikelyCodeEntity(entity) {
  if (!entity) return false;
  if (entity.filePath && NON_CODE_FILE_RE.test(entity.filePath)) return false;
  return true;
}
