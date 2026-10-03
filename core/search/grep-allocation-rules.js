/**
 * ss-grep's file weight and line allocation (grep-output-shaping.js uses both).
 *
 *   weight = hits / (hits + 2) x prior (the constant is fixed at 2; it is not tuned on
 *            confirmation probes)
 *   lines  = every kept file gets one line, in weight order, before any file gets a second;
 *            then Sainte-Laguë
 *
 * Keys are 16 x weight^2, as in grep-output-shaping.js. A key is one correctly rounded division
 * of two exact integers, so equal weights give equal keys and file ORDER ties are real ties.
 * Allocation quotients multiply those doubles, so two equal quotients can differ by one
 * rounding step; the tie-break (more hits, then the earlier file) then does not apply to that
 * pair.
 */

/**
 * 16 x weight^2 of a file with `hits` matches and prior scale `scale` (16 x prior^2:
 * 16 source, 4 test, 1 generated).
 *
 * @param {number} hits
 * @param {number} scale
 */
export function grepWeightKey(hits, scale) {
  return (scale * hits * hits) / ((hits + 2) * (hits + 2));
}

/**
 * Line allocation with a first-line pass: each file with stored matches gets one line in
 * input order until the budget runs out, then the remaining lines go by Sainte-Laguë
 * (divisor 2a + 1).
 *
 * PRECONDITION: files in weight order (key desc, hits desc, path asc).
 *
 * @param {ArrayLike<number>} keys - 16 x weight^2
 * @param {ArrayLike<number>} totals - hits per file (tie-break)
 * @param {ArrayLike<number>} caps - stored matches per file
 * @param {number} budget - lines to give (k)
 * @returns {Int32Array} lines per file, same order as the input
 */
export function allocateGrepLinesWithFirstLine(keys, totals, caps, budget) {
  const n = keys.length;
  const alloc = new Int32Array(n);
  let remaining = Math.max(0, budget | 0);
  const heap = new Int32Array(Math.min(n, remaining));
  let size = 0;
  for (let f = 0; f < n && remaining > 0; f++) {
    if (!(caps[f] > 0)) continue;
    alloc[f] = 1;
    remaining--;
    if (caps[f] > 1) heap[size++] = f;
  }
  if (remaining === 0 || size === 0) return alloc;

  // Squared divisors (keys are squared weights):
  // q_a > q_b <=> keys[a] d2(alloc[b]) > keys[b] d2(alloc[a]).
  const d2 = (a) => (2 * a + 1) * (2 * a + 1);
  const better = (a, b) => {
    const lhs = keys[a] * d2(alloc[b]);
    const rhs = keys[b] * d2(alloc[a]);
    return lhs > rhs || (lhs === rhs && (totals[a] > totals[b] || (totals[a] === totals[b] && a < b)));
  };
  const siftDown = (pos) => {
    const f = heap[pos];
    for (;;) {
      let child = 2 * pos + 1;
      if (child >= size) break;
      if (child + 1 < size && better(heap[child + 1], heap[child])) child++;
      if (!better(heap[child], f)) break;
      heap[pos] = heap[child];
      pos = child;
    }
    heap[pos] = f;
  };
  for (let pos = (size >> 1) - 1; pos >= 0; pos--) siftDown(pos);
  while (remaining > 0 && size > 0) {
    const f = heap[0];
    alloc[f]++;
    remaining--;
    if (alloc[f] < caps[f]) siftDown(0);
    else { heap[0] = heap[--size]; if (size > 0) siftDown(0); }
  }
  return alloc;
}
