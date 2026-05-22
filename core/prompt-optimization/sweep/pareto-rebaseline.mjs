/**
 * Pareto-front re-baselining after probe rotation (Phase 7).
 *
 * Plan reference: docs/PHASE7.md §3.1, §3.7.1 step 11.
 *
 * WHY THIS IS NON-NEGOTIABLE
 * ──────────────────────────
 * At round 11 the probe set rotates (5 new probes replace 5 old ones). After
 * rotation, existing Pareto-front incumbents have scores from the OLD probe set,
 * while new mutations will be evaluated on the NEW probe set. Comparing
 * old-probe incumbents against new-probe challengers is apples-to-oranges:
 *
 *   - A new mutation that would barely survive the old hard probes could appear
 *     to Pareto-dominate an incumbent that was excellent on those hard probes —
 *     simply because it has never been tested on them.
 *   - This could permanently lock the best incumbents out of the front.
 *
 * Solution: before resuming the loop, evaluate every incumbent on every new
 * probe so that all front members cover the SAME probe set. Cost:
 * |front| × |newProbes| agent runs (e.g. 6 × 5 = 30 evaluate() calls), which
 * is cheap relative to a full round (~32 mutation+screen calls).
 *
 * All evaluation is delegated to the injectable `evaluate` callback so this
 * module contains zero I/O and remains fully unit-testable.
 */

/**
 * Re-evaluate every Pareto-front incumbent on each new probe.
 *
 * The `evaluate` callback is called once per (incumbent, probe) pair and
 * should return the Maximin score (min across targets) for that pair. The
 * callback owns target aggregation; `runCount` tracks call count.
 *
 * @param {object} args
 * @param {object[]} args.front      — current Pareto-front incumbents;
 *                                    each must have at minimum a unique id
 *                                    and may carry an existing `scores` map
 * @param {object[]} args.newProbes  — probe records being added after rotation;
 *                                    each must have a string `id`
 * @param {(variant: object, probe: object) => Promise<number>} args.evaluate
 * @returns {Promise<{ updatedFront: object[], scoresAdded: number, runCount: number }>}
 */
export async function rebaselineFront({ front, newProbes, evaluate }) {
  if (!Array.isArray(front)) {
    throw new TypeError('rebaselineFront: front must be an array');
  }
  if (!Array.isArray(newProbes)) {
    throw new TypeError('rebaselineFront: newProbes must be an array');
  }
  if (typeof evaluate !== 'function') {
    throw new TypeError('rebaselineFront: evaluate must be a function');
  }

  if (front.length === 0 || newProbes.length === 0) {
    return { updatedFront: [...front], scoresAdded: 0, runCount: 0 };
  }

  // Fail-fast at the boundary: validate EVERY probe id before invoking the
  // (expensive, side-effecting) evaluate callback. A lazy per-incumbent check
  // would otherwise fire evaluate() for earlier probes — and throw redundantly
  // across the parallel incumbent map — before surfacing a malformed probe.
  newProbes.forEach((probe, i) => {
    if (probe == null || typeof probe.id !== 'string') {
      throw new TypeError(`rebaselineFront: newProbes[${i}] must have a string id`);
    }
  });

  let scoresAdded = 0;
  let runCount = 0;

  // Evaluate all incumbents × all new probes in parallel per incumbent.
  // After this step every incumbent carries scores for the SAME new probe set,
  // so the post-rotation Pareto front compares apples-to-apples (§3.1 re-baseline).
  const updatedFront = await Promise.all(
    front.map(async (incumbent) => {
      const scores = { ...(incumbent.scores ?? {}) };

      for (const probe of newProbes) {
        const maximin = await evaluate(incumbent, probe);
        scores[probe.id] = maximin;
        scoresAdded++;
        runCount++;
      }

      return { ...incumbent, scores };
    }),
  );

  return { updatedFront, scoresAdded, runCount };
}
