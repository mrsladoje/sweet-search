import path from 'path';

const ACTIVE = 'stale_since IS NULL';

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rowToEntity(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature || '',
    summary: row.summary || '',
    parentClass: row.parent_class || null,
    package: row.package || null,
  };
}

function moduleStem(filePath) {
  return path.basename(String(filePath || ''), path.extname(String(filePath || '')));
}

function moduleLooksRelated(moduleName, stem) {
  const normalized = String(moduleName || '').replace(/\\/g, '/').replace(/\.[cm]?[jt]sx?$/, '');
  return normalized === stem || normalized.endsWith(`/${stem}`);
}

function parseSpecifiers(specs, targetName, aliases) {
  for (const rawPart of specs.split(',')) {
    const part = rawPart.trim();
    const colon = part.match(new RegExp(`^${escapeRegExp(targetName)}\\s*:\\s*([A-Za-z_$][\\w$]*)$`));
    const asAlias = part.match(new RegExp(`^${escapeRegExp(targetName)}\\s+as\\s+([A-Za-z_$][\\w$]*)$`));
    if (colon) aliases.add(colon[1]);
    else if (asAlias) aliases.add(asAlias[1]);
    else if (part === targetName) aliases.add(targetName);
  }
}

function extractAliases(text, target) {
  const aliases = new Set();
  const stem = moduleStem(target.filePath);
  for (const line of String(text || '').split('\n')) {
    if (!line.includes(target.name) || !line.includes(stem)) continue;
    const cjs = line.match(/\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/);
    if (cjs && moduleLooksRelated(cjs[2], stem)) parseSpecifiers(cjs[1], target.name, aliases);
    const esm = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (esm && moduleLooksRelated(esm[2], stem)) parseSpecifiers(esm[1], target.name, aliases);
    const prop = line.match(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(['"]([^'"]+)['"]\\)\\.${escapeRegExp(target.name)}\\b`));
    if (prop && moduleLooksRelated(prop[2], stem)) aliases.add(prop[1]);
  }
  return [...aliases];
}

function lineOfIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function findAliasCallers({ db, target, readFileRange, limit = 40 }) {
  if (!db || !target?.filePath || !target?.name) return [];
  const files = db.prepare(`
    SELECT DISTINCT file_path
    FROM entities
    WHERE ${ACTIVE} AND file_path IS NOT NULL
    ORDER BY CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END, file_path
    LIMIT 1000
  `).all();
  const entityAtLine = db.prepare(`
    SELECT id, name, type, file_path, start_line, end_line, signature, summary, parent_class, package
    FROM entities
    WHERE ${ACTIVE} AND file_path = ? AND start_line <= ? AND end_line >= ?
    ORDER BY (end_line - start_line) ASC
    LIMIT 1
  `);
  const out = [];
  const seen = new Set();
  for (const { file_path: filePath } of files) {
    if (filePath === target.filePath) continue;
    const text = readFileRange(filePath, 1, 20000);
    const aliases = extractAliases(text, target);
    const patterns = aliases.map(alias => ({
      targetName: alias,
      re: new RegExp(`(?<![\\w$])${escapeRegExp(alias)}\\s*\\(`, 'g'),
    }));
    if (/\.rs$/.test(target.filePath)) {
      patterns.push({
        targetName: `::${target.name}`,
        re: new RegExp(`\\b[A-Za-z_][\\w]*::${escapeRegExp(target.name)}\\s*\\(`, 'g'),
      });
    }
    if (!patterns.length) continue;
    for (const pattern of patterns) {
      const re = pattern.re;
      for (const match of text.matchAll(re)) {
        const line = lineOfIndex(text, match.index || 0);
        const entity = entityAtLine.get(filePath, line, line);
        if (!entity || entity.id === target.id) continue;
        const targetName = match[0].replace(/\s*\($/, '') || pattern.targetName;
        const key = `${entity.id}:${line}:${targetName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...rowToEntity(entity), relationship: 'calls', contextLine: line, targetName, weight: 0.82 });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
