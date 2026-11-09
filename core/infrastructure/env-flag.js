const OFF_WORDS = ['0', 'false', 'off', 'no'];
const ON_WORDS = ['1', 'true', 'on', 'yes'];

/**
 * True when `value` is one of 0, false, off, no (any case). An unset or empty
 * value is not off. Surrounding whitespace is ignored unless `trim` is false.
 */
export function isOffValue(value, { trim = true } = {}) {
  const text = String(value ?? '');
  return OFF_WORDS.includes((trim ? text.trim() : text).toLowerCase());
}

/** True when SWEET_SEARCH_EMBED_USE_CPU is exactly '1': dense embedding runs on the ORT CPU path even if a native accelerator exists. */
export function isEmbedForcedToCpu(env = process.env) {
  return env.SWEET_SEARCH_EMBED_USE_CPU === '1';
}

/** True when `value` is one of 1, true, on, yes (any case, whitespace ignored). An unset or empty value is not on. */
export function isOnValue(value) {
  return ON_WORDS.includes(String(value ?? '').trim().toLowerCase());
}
