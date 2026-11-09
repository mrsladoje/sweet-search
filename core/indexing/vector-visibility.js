/**
 * SQL for the vectors a reader sees: rows not retired by a later epoch. The text must stay
 * identical across callers so prepared statements keyed on it are shared.
 * @param {string} [alias] table alias of `vectors`
 */
export function liveVectorSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}epoch_retired IS NULL`;
}
