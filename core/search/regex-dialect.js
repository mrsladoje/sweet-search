/**
 * Detect grep patterns that may have been written with GNU BRE muscle memory.
 *
 * Sweet Search deliberately keeps Rust-regex semantics for the first search.
 * Agent-format callers may use the translation below for one retry after that
 * exact pattern returns zero matches. Normal users and non-zero searches remain
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

const BRE_RETRY_TRIGGERS = new Set(['|', '(', '+', '{']);
const BARE_BRE_DIVERGENT_METACHARS = new Set(['(', ')', '+', '?', '{', '|']);
const ZERO_WIDTH_ESCAPES = new Set(['A', 'b', 'B', 'z']);
const ADDITIVE_RETRY_STATS = [
  'candidateGenTime_ms',
  'grepTime_ms',
  'literalFilterTime_ms',
  'gramLookupTime_ms',
];

function isEscapedDoublePipe(pattern, slashStart, escapedIndex) {
  const previous = pattern.slice(Math.max(0, slashStart - 2), slashStart) === '\\|';
  const next = pattern.slice(escapedIndex + 1, escapedIndex + 3) === '\\|';
  return previous || next;
}

function inspectBreDialect(pattern, { fixedString = false } = {}) {
  if (fixedString || typeof pattern !== 'string' || pattern.length < 2) return null;

  const operators = new Set();
  let retryable = false;
  let translated = '';
  let inClass = false;
  let hasBareDivergentMetachar = false;
  let hasEscapedQuestion = false;
  let hasAmbiguousEscapeRun = false;
  let hasEmptyAlternationArm = false;
  const armStack = [{ hasContent: false, sawAlternation: false }];

  const currentArm = () => armStack[armStack.length - 1];
  const markContent = () => { currentArm().hasContent = true; };
  const closeAlternationContext = () => {
    const arm = currentArm();
    if (arm.sawAlternation && !arm.hasContent) hasEmptyAlternationArm = true;
    return arm;
  };

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inClass) {
      translated += ch;
      if (ch === '\\') {
        let slashCount = 1;
        while (pattern[i + slashCount] === '\\') slashCount++;
        translated += '\\'.repeat(slashCount - 1);
        i += slashCount - 1;
        if (slashCount % 2 === 1 && i + 1 < pattern.length) {
          translated += pattern[++i];
        }
      } else if (ch === ']') {
        inClass = false;
      }
      continue;
    }
    if (ch === '[') {
      inClass = true;
      translated += ch;
      markContent();
      continue;
    }
    if (ch !== '\\') {
      translated += ch;
      if (BARE_BRE_DIVERGENT_METACHARS.has(ch)) {
        hasBareDivergentMetachar = true;
        markContent();
      } else if (ch !== '^' && ch !== '$' && ch !== '*') {
        markContent();
      }
      continue;
    }

    const slashStart = i;
    let slashCount = 1;
    while (pattern[i + slashCount] === '\\') slashCount++;
    const escapedIndex = slashStart + slashCount;
    const escaped = pattern[escapedIndex];
    // Multiple backslashes are ambiguous (for example a literal backslash
    // followed by an escaped operator). Preserve the run, then re-scan the
    // following character so `\\[...\|...]` still enters the character class.
    if (slashCount !== 1 || !escaped) {
      translated += '\\'.repeat(slashCount);
      if (slashCount !== 1) {
        hasAmbiguousEscapeRun = true;
        markContent();
      }
      i = slashStart + slashCount - 1;
      continue;
    }

    const rawEscape = pattern.slice(slashStart, escapedIndex + 1);
    if (escaped === '{') {
      const interval = pattern.slice(slashStart).match(/^\\\{(\d+(?:,\d*)?)\\\}/);
      if (interval) {
        operators.add('{');
        retryable = true;
        translated += `{${interval[1]}}`;
        i = slashStart + interval[0].length - 1;
        continue;
      }
    }

    let operator = null;
    if (escaped === '|' && !isEscapedDoublePipe(pattern, slashStart, escapedIndex)) operator = '|';
    else if (escaped === '(' || escaped === ')' || escaped === '+' || escaped === '?') operator = escaped;

    if (operator) {
      operators.add(operator);
      if (BRE_RETRY_TRIGGERS.has(operator)) retryable = true;
      if (operator === '?') hasEscapedQuestion = true;

      if (operator === '|') {
        const arm = currentArm();
        if (!arm.hasContent) hasEmptyAlternationArm = true;
        arm.sawAlternation = true;
        arm.hasContent = false;
      } else if (operator === '(') {
        armStack.push({ hasContent: false, sawAlternation: false });
      } else if (operator === ')') {
        const closed = closeAlternationContext();
        if (armStack.length > 1) {
          armStack.pop();
          if (closed.hasContent) markContent();
        }
      }

      translated += operator === '?' ? rawEscape : operator;
    } else {
      translated += rawEscape;
      if (!ZERO_WIDTH_ESCAPES.has(escaped)) markContent();
    }
    i = escapedIndex;
  }

  for (const arm of armStack) {
    if (arm.sawAlternation && !arm.hasContent) hasEmptyAlternationArm = true;
  }
  if (operators.size === 0) return null;
  return {
    operators: [...operators].map(op => BRE_OPERATOR_LABELS[op]),
    retryable,
    translated,
    translationAmbiguous: hasBareDivergentMetachar
      || hasAmbiguousEscapeRun
      || hasEmptyAlternationArm
      || (hasEscapedQuestion && retryable),
  };
}

/**
 * @param {string} pattern
 * @param {{ fixedString?: boolean }} [options]
 * @returns {{ operators: string[] } | null}
 */
export function detectBreDialectHint(pattern, { fixedString = false } = {}) {
  const inspection = inspectBreDialect(pattern, { fixedString });
  return inspection ? { operators: inspection.operators } : null;
}

/**
 * Translate only unambiguous GNU BRE operator spellings used by agents.
 * Closing group/interval escapes are translated with their opening operator.
 * `\?` remains diagnostic-only because it is too commonly used literally.
 *
 * @param {string} pattern
 * @param {{ fixedString?: boolean }} [options]
 * @returns {{ pattern: string, operators: string[] } | null}
 */
export function translateBreToRustRegex(pattern, { fixedString = false } = {}) {
  const inspection = inspectBreDialect(pattern, { fixedString });
  if (!inspection?.retryable || inspection.translationAmbiguous || inspection.translated === pattern) {
    return null;
  }
  try {
    if (new RegExp(inspection.translated).test('')) return null;
  } catch { /* JavaScript cannot parse every Rust-valid regex; structural guards still apply. */ }
  return { pattern: inspection.translated, operators: inspection.operators };
}

function collectCandidateMatches(candidateResult) {
  return [
    ...(candidateResult?.indexedMatches || []),
    ...(candidateResult?.overlayMatches || []),
  ];
}

function sumNumericFields(original = {}, retried = {}, selected = {}) {
  const merged = { ...selected };
  for (const key of ADDITIVE_RETRY_STATS) {
    const left = Number.isFinite(original[key]) ? original[key] : 0;
    const right = Number.isFinite(retried[key]) ? retried[key] : 0;
    if (Number.isFinite(original[key]) || Number.isFinite(retried[key])) merged[key] = left + right;
  }

  const stageKeys = new Set([
    ...Object.keys(original.stageTiming || {}),
    ...Object.keys(retried.stageTiming || {}),
  ]);
  if (stageKeys.size > 0) {
    merged.stageTiming = { ...(selected.stageTiming || {}) };
    for (const key of stageKeys) {
      const left = Number.isFinite(original.stageTiming?.[key]) ? original.stageTiming[key] : 0;
      const right = Number.isFinite(retried.stageTiming?.[key]) ? retried.stageTiming[key] : 0;
      merged.stageTiming[key] = left + right;
    }
  }
  return merged;
}

function withMergedRetryStats(selected, original, retried) {
  if (!selected?.stats && !original?.stats && !retried?.stats) return selected;
  return {
    ...selected,
    stats: sumNumericFields(original?.stats, retried?.stats, selected?.stats),
  };
}

function isRegexSyntaxError(error) {
  const messages = [];
  for (let current = error; current && messages.length < 3; current = current.cause) {
    messages.push(current instanceof Error ? current.message : String(current));
  }
  return /invalid regex|regex parse error|error parsing regex|regex syntax|repetition operator|unclosed (?:group|character class)|unmatched (?:closing|parenthesis)/i
    .test(messages.join('\n'));
}

/**
 * Run one agent-only BRE respelling retry after the caller's final result
 * shaping reports zero matches. The supplied shaper is reused for the retry so
 * hint counts and adoption always describe the matches the caller can return.
 *
 * @param {{
 *   pattern: string,
 *   fixedString?: boolean,
 *   agentFormat?: boolean,
 *   originalResult: object,
 *   shapeResult?: (candidateResult: object) => Array,
 *   retry: (translatedPattern: string) => Promise<object>,
 * }} options
 * @returns {Promise<{
 *   candidateResult: object,
 *   matches: Array,
 *   regexDialectHint: object|null,
 * }>}
 */
export async function retryBreDialectAfterZero({
  pattern,
  fixedString = false,
  agentFormat = false,
  originalResult,
  shapeResult = collectCandidateMatches,
  retry,
}) {
  const originalMatches = shapeResult(originalResult);
  if (!agentFormat || originalMatches.length > 0) {
    return { candidateResult: originalResult, matches: originalMatches, regexDialectHint: null };
  }

  const fallbackHint = detectBreDialectHint(pattern, { fixedString });
  const translation = translateBreToRustRegex(pattern, { fixedString });
  if (!translation) {
    return { candidateResult: originalResult, matches: originalMatches, regexDialectHint: fallbackHint };
  }

  try {
    const retried = await retry(translation.pattern);
    const retriedMatches = shapeResult(retried);
    const retryMatched = retriedMatches.length > 0;
    const selected = retryMatched ? retried : originalResult;
    return {
      candidateResult: withMergedRetryStats(selected, originalResult, retried),
      matches: retryMatched ? retriedMatches : originalMatches,
      regexDialectHint: {
        operators: translation.operators,
        retryAttempted: true,
        retryMatched,
        retryMatches: retriedMatches.length,
        translatedPattern: translation.pattern,
      },
    };
  } catch (error) {
    if (!isRegexSyntaxError(error)) throw error;
    return { candidateResult: originalResult, matches: originalMatches, regexDialectHint: fallbackHint };
  }
}

/**
 * @param {{
 *   operators?: string[], retryAttempted?: boolean, retryMatched?: boolean,
 *   retryMatches?: number, translatedPattern?: string,
 * } | null | undefined} hint
 * @returns {string}
 */
export function renderRegexDialectHint(hint) {
  const operators = Array.isArray(hint?.operators) ? hint.operators : [];
  if (operators.length === 0) return '';
  if (hint.retryAttempted) {
    if (hint.retryMatched) {
      const count = Number.isInteger(hint.retryMatches) ? hint.retryMatches : 0;
      return `regex note: zero-hit GNU BRE operators were retried with unescaped Rust operators; ` +
        `showing ${count} retry match${count === 1 ? '' : 'es'}.`;
    }
    return 'regex note: GNU BRE operators were retried with unescaped Rust operators; both forms returned 0 matches.';
  }
  if (operators.includes('\\|')) {
    return 'regex note: Rust syntax treats \\| as a literal pipe; use | for alternation ' +
      '(or -F for a literal search). The original pattern was used unchanged.';
  }
  return `regex note: Rust syntax uses unescaped operators (${operators.join(', ')}); ` +
    'escaped forms match punctuation. The original pattern was used unchanged.';
}
