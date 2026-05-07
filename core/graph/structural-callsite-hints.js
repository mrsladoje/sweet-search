const SKIP = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'func', 'return', 'defer', 'go', 'select',
  'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'panic', 'recover',
  'setTimeout', 'clearTimeout', 'require', 'import', 'new', 'await', 'async',
]);

const MEMBER_SKIP = new Set([
  'bind', 'call', 'apply', 'map', 'filter', 'reduce', 'forEach', 'then', 'catch',
  'toString', 'String', 'Error', 'Println', 'Printf', 'Errorf', 'Fatalf',
]);

function addHint(out, known, name, member = false) {
  if (!name || known.has(name) || out.includes(name)) return;
  if (SKIP.has(name) || (member && MEMBER_SKIP.has(name))) return;
  out.push(name);
}

export function stripNonCode(text) {
  return String(text || '')
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(#|\/\/).*$/gm, '');
}

export function callsiteHints(code, known = new Set()) {
  const out = [];
  const text = stripNonCode(code);
  const free = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?:\.(?:bind|call|apply))?\s*\(/g;
  for (const m of text.matchAll(free)) {
    addHint(out, known, m[1], false);
    if (out.length >= 12) return out;
  }
  const member = /(?:\.|::)\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of text.matchAll(member)) {
    addHint(out, known, m[1], true);
    if (out.length >= 12) return out;
  }
  return out;
}
