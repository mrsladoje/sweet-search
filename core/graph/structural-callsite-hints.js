const SKIP = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'func', 'return', 'defer', 'go', 'select',
  'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'panic', 'recover',
  'setTimeout', 'clearTimeout', 'require', 'import', 'new', 'await', 'async',
]);

const MEMBER_SKIP = new Set([
  'bind', 'call', 'apply', 'map', 'filter', 'reduce', 'forEach', 'then', 'catch',
  'toString', 'String', 'Error', 'Println', 'Printf', 'Errorf', 'Fatalf',
]);

// Receivers that mean "the enclosing type or file": a call through one of
// these can only reach a definition in the target's own file.
const SELF_RECEIVERS = new Set(['self', 'this', 'Self', 'cls']);

export function isSelfReceiver(receiver) {
  return SELF_RECEIVERS.has(String(receiver || '').replace(/^[$@]/, ''));
}

// The receiver written right before an identifier: `a.b(`, `a::b(`, `a->b(`,
// `a?.b(`. Returns null for an unqualified call, the receiver identifier for
// a plain `recv.name(`, and '?' when a call result or an index is the receiver.
function receiverBefore(text, index) {
  const before = text.slice(Math.max(0, index - 96), index);
  const m = before.match(/([A-Za-z_$][\w$]*|[)\]>])\s*(?:\?\.|\.|::|->)\s*$/);
  if (!m) return null;
  return /^[A-Za-z_$]/.test(m[1]) ? m[1] : '?';
}

export function stripNonCode(text) {
  return String(text || '')
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(#|\/\/).*$/gm, '');
}

/**
 * Names called in a body, with how each call was written. A name is
 * `qualified` only when EVERY call site wrote a receiver (`x.Parse(`); one
 * bare call (`Parse(`) makes it unqualified. `qualifiers` lists the receivers
 * written. Names come in the order callsiteHints has always returned them.
 */
export function callsiteHintSites(code, known = new Set()) {
  const order = [];
  const info = new Map();
  const note = (name, receiver, member) => {
    if (!name || known.has(name)) return;
    if (SKIP.has(name) || (member && MEMBER_SKIP.has(name))) return;
    let entry = info.get(name);
    if (!entry) {
      if (order.length >= 12) return;
      entry = { name, qualified: true, qualifiers: [] };
      info.set(name, entry);
      order.push(name);
    }
    if (receiver == null) entry.qualified = false;
    else if (!entry.qualifiers.includes(receiver)) entry.qualifiers.push(receiver);
  };
  const text = stripNonCode(code);
  const free = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?:\.(?:bind|call|apply))?\s*\(/g;
  for (const m of text.matchAll(free)) note(m[1], receiverBefore(text, m.index), false);
  const member = /(?:\.|::)\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of text.matchAll(member)) {
    note(m[1], receiverBefore(text, m.index + m[0].lastIndexOf(m[1])), true);
  }
  return order.map(name => info.get(name));
}

export function callsiteHints(code, known = new Set()) {
  return callsiteHintSites(code, known).map(h => h.name);
}
