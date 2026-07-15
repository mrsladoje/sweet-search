/**
 * Detect grep patterns that may have been written with GNU BRE muscle memory.
 *
 * Sweet Search deliberately keeps Rust-regex semantics. This module never
 * rewrites a pattern: it only produces an agent-facing hint after the original
 * pattern returned zero matches. Normal users and non-zero searches remain
 * byte-identical.
 */

const BRE_OPERATOR_LABELS = Object.freeze({
  '|': '\\|',
  '(': '\\(',
  ')': '\\)',
  '+': '\\+',
  '?': '\\?',
  '{': '\\{m,n\\}',
});

/**
 * @param {string} pattern
 * @param {{ fixedString?: boolean }} [options]
 * @returns {{ operators: string[] } | null}
 */
export function detectBreDialectHint(pattern, { fixedString = false } = {}) {
  if (fixedString || typeof pattern !== 'string' || pattern.length < 2) return null;

  const operators = new Set();
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inClass) {
      // An escaped closing bracket remains part of the class.
      if (ch === '\\' && i + 1 < pattern.length) { i++; continue; }
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') { inClass = true; continue; }
    if (ch !== '\\') continue;

    const slashStart = i;
    let slashCount = 1;
    while (pattern[i + slashCount] === '\\') slashCount++;
    const escapedIndex = slashStart + slashCount;
    const escaped = pattern[escapedIndex];
    i = escapedIndex - 1;
    // Multiple backslashes are ambiguous (for example a literal backslash
    // followed by an escaped operator), so only diagnose the unambiguous form.
    if (slashCount !== 1 || !escaped) continue;

    if (escaped === '|') {
      // `\|\|` is a common, intentional Rust-regex spelling for the literal
      // code operator `||`. Calling it a BRE alternation mistake is harmful.
      const previousIsPipeEscape = pattern.slice(Math.max(0, slashStart - 2), slashStart) === '\\|';
      const nextIsPipeEscape = pattern.slice(escapedIndex + 1, escapedIndex + 3) === '\\|';
      if (!previousIsPipeEscape && !nextIsPipeEscape) operators.add('|');
    } else if (escaped === '(' || escaped === ')' || escaped === '+' || escaped === '?') {
      operators.add(escaped);
    } else if (escaped === '{' && /^\d+(?:,\d*)?\\\}/.test(pattern.slice(escapedIndex + 1))) {
      operators.add('{');
    }
    i = escapedIndex;
  }

  if (operators.size === 0) return null;
  return { operators: [...operators].map(op => BRE_OPERATOR_LABELS[op]) };
}

/**
 * @param {{ operators?: string[] } | null | undefined} hint
 * @returns {string}
 */
export function renderRegexDialectHint(hint) {
  const operators = Array.isArray(hint?.operators) ? hint.operators : [];
  if (operators.length === 0) return '';
  if (operators.includes('\\|')) {
    return 'regex note: Rust syntax treats \\| as a literal pipe; use | for alternation ' +
      '(or -F for a literal search). The original pattern was used unchanged.';
  }
  return `regex note: Rust syntax uses unescaped operators (${operators.join(', ')}); ` +
    'escaped forms match punctuation. The original pattern was used unchanged.';
}
