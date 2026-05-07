function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function definitionPattern(name) {
  const n = escapeRegExp(name);
  return new RegExp([
    `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`,
    `^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(`,
    `^\\s*(?:export\\s+)?(?:class|interface|enum|type)\\s+${n}\\b`,
    `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:const|static|fn|struct|enum|trait|type)\\s+${n}\\b`,
    `^\\s*(?:const|var|type)\\s+${n}\\b`,
    `^\\s*func\\s+(?:\\([^)]*\\)\\s+)?${n}\\s*\\(`,
    `^\\s*(?:def|class)\\s+${n}\\s*[(:]`,
  ].join('|'));
}

function definitionType(line) {
  if (/\b(const|static)\b/.test(line)) return 'const';
  if (/\b(var|let)\b/.test(line)) return 'variable';
  if (/\b(class|struct)\b/.test(line)) return 'class';
  if (/\b(interface|trait)\b/.test(line)) return 'interface';
  if (/\benum\b/.test(line)) return 'enum';
  if (/\b(type)\b/.test(line)) return 'type';
  return 'function';
}

function memberAssignmentPattern(name) {
  const n = escapeRegExp(name);
  return new RegExp([
    `^\\s*(?:exports|module\\.exports|[A-Za-z_$][\\w$]*)(?:\\.prototype)?(?:\\.${n}|\\[['"]${n}['"]\\])\\s*=\\s*(?:async\\s+)?function(?:\\s+${n})?\\s*\\(`,
    `^\\s*defineGetter\\([^,]+,\\s*['"]${n}['"]\\s*,\\s*function(?:\\s+${n})?\\s*\\(`,
  ].join('|'));
}

function findBlockEnd(lines, start) {
  let depth = 0, seenBrace = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seenBrace = true; }
      else if (ch === '}') depth--;
    }
    if (seenBrace && depth <= 0) return i + 1;
  }
  return start + 1;
}

function compactSnippet(lines, start, end) {
  return lines.slice(start, Math.min(end, start + 4)).map(line => line.trim()).filter(Boolean).join(' ');
}

export function findSameFileDefinition({ name, filePath, readFileRange }) {
  if (!name || !filePath || !readFileRange) return null;
  const text = readFileRange(filePath, 1, 20000);
  if (!text) return null;
  const re = definitionPattern(name);
  const lines = text.split('\n');
  const idx = lines.findIndex(line => re.test(line));
  if (idx < 0) return null;
  const end = findBlockEnd(lines, idx);
  return {
    id: `synthetic:def:${filePath}:${idx + 1}:${name}`,
    name,
    type: definitionType(lines[idx]),
    filePath,
    startLine: idx + 1,
    endLine: end,
    signature: lines[idx].trim(),
    summary: compactSnippet(lines, idx, end),
  };
}

export function findAssignedMemberDefinitions({ name, files, readFileRange, limit = 12 }) {
  if (!name || !files?.length || !readFileRange) return [];
  const re = memberAssignmentPattern(name);
  const out = [];
  for (const filePath of files) {
    const text = readFileRange(filePath, 1, 20000);
    if (!text) continue;
    const lines = text.split('\n');
    const idx = lines.findIndex(line => re.test(line));
    if (idx < 0) continue;
    out.push({
      id: `synthetic:member:${filePath}:${idx + 1}:${name}`,
      name,
      type: 'method',
      filePath,
      startLine: idx + 1,
      endLine: findBlockEnd(lines, idx),
      signature: lines[idx].trim(),
      summary: 'Member assignment definition found from source text',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function findAssignedMemberDefinition(opts) {
  return findAssignedMemberDefinitions(opts)[0] || null;
}
