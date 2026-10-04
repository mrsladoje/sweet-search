/**
 * Kind words in front of symbol names in agent output (ss-search, ss-find, ss-read): the
 * agent reads `methods hold, size` or `class Pool, methods a, b`, never a bare name list.
 * Owner review 2026-10-04.
 */

// Index entity type → the word the agent reads in front of a name. A type with no entry here
// prints as stored when it is one plain word; anything else prints no kind.
const KIND_WORDS = {
  function: 'function', arrow: 'function', method: 'method', class: 'class', interface: 'interface',
  struct: 'struct', enum: 'enum', trait: 'trait', impl: 'impl', module: 'module', namespace: 'namespace',
  typealias: 'type', type: 'type', typedef: 'type', record: 'record', object: 'object', protocol: 'protocol',
  extension: 'extension', actor: 'actor', variable: 'variable', const: 'constant', constant: 'constant',
  field: 'field', property: 'property', macro: 'macro', topkey: 'key', keyval: 'key', section: 'section',
};

/** The kind word of an index entity type, or '' when there is none to print. */
export function kindWord(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return '';
  if (KIND_WORDS[t]) return KIND_WORDS[t];
  return /^[a-z]+$/.test(t) && t !== 'symbol' && t !== 'code' ? t : '';
}

function pluralKind(word) {
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** `kind name`, or the name alone when the kind is unknown. */
export function kindName(name, type) {
  const k = kindWord(type);
  return k ? `${k} ${name}` : String(name);
}

/**
 * A list of `{name, type}` with kind words, one word per run of the same kind in list order:
 * `methods a, b, c`, `class Pool, methods a, b, field c`. Names with no known kind print bare
 * (a run of their own: the word of a neighbour would claim a kind the index does not know). With `cap`, the names past it print as `+N more`.
 * `unknown` (the chunker's name for an unnamed chunk) and anonymous names print nothing.
 */
export function kindNameList(items, cap = Infinity) {
  const list = (items || []).filter((i) => i?.name && i.name !== 'unknown' && !String(i.name).startsWith('<anonymous'));
  if (list.length === 0) return '';
  const shown = list.slice(0, cap);
  const runs = [];
  for (const i of shown) {
    const w = kindWord(i.type);
    const last = runs[runs.length - 1];
    if (last && w === last.word) last.names.push(i.name);
    else runs.push({ word: w, names: [i.name] });
  }
  const text = runs.map((r) => {
    if (!r.word) return r.names.join(', ');
    return `${r.names.length > 1 ? pluralKind(r.word) : r.word} ${r.names.join(', ')}`;
  }).join(', ');
  const rest = list.length - shown.length;
  return rest > 0 ? `${text} +${rest} more` : text;
}
