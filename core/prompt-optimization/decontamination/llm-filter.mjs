/**
 * LLM-as-decontaminator filter.
 *
 * Layer 3 of the three-layer protocol in §11.1: catches semantically-similar
 * contamination that survives both n-gram and embedding layers. Asks an LLM
 * judge whether the probe's gold answer overlaps with snippets the judge has
 * "obviously seen during pretraining" (LiveCodeBench / MBPP decontamination
 * convention).
 *
 * Judge is dependency-injected — typically DSv4-Flash via the OpenRouter
 * adapter, but the filter itself doesn't bind to any provider. The judge
 * callback returns a verdict object: `{ memorised: boolean, confidence?: number, rationale?: string }`.
 *
 * The filter applies a confidence floor (default 0.6) before flagging — a
 * cheap guardrail against single-judge hallucinations. Pre-registered judge
 * prompt path is a caller responsibility (committed under
 * `core/prompt-optimization/data/judge-prompts/`).
 *
 * @param {object} args
 * @param {Array<{ id: string, query: string, goldAnswer: string }>} args.probes
 * @param {(probe: { id: string, query: string, goldAnswer: string }) => Promise<{
 *   memorised: boolean,
 *   confidence?: number,
 *   rationale?: string,
 * }>} args.judge
 * @param {number}  [args.confidenceFloor=0.6]
 * @param {number}  [args.concurrency=4]
 * @returns {Promise<{
 *   flagged: Array<{ id: string, verdict: { memorised: boolean, confidence?: number, rationale?: string } }>,
 *   clean:   string[],
 *   stats: { probesChecked: number, probesFlagged: number, confidenceFloor: number },
 * }>}
 */
export async function llmDecontaminate({
  probes,
  judge,
  confidenceFloor = 0.6,
  concurrency = 4,
}) {
  if (!Array.isArray(probes)) throw new TypeError('llm-filter: probes must be an array');
  if (typeof judge !== 'function') throw new TypeError('llm-filter: judge must be a function');
  if (!(confidenceFloor >= 0 && confidenceFloor <= 1)) {
    throw new RangeError('llm-filter: confidenceFloor must be in [0, 1]');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('llm-filter: concurrency must be a positive integer');
  }

  const flagged = [];
  const clean = [];

  // Tiny pool — most LLM providers rate-limit at single-digit concurrency.
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= probes.length) return;
      const probe = probes[i];
      if (!probe || typeof probe.id !== 'string') {
        throw new TypeError('llm-filter: each probe needs a string id');
      }
      const verdict = await judge(probe);
      if (!verdict || typeof verdict.memorised !== 'boolean') {
        throw new TypeError(`llm-filter: judge for ${probe.id} returned malformed verdict`);
      }
      const conf = verdict.confidence ?? 1;
      const isFlagged = verdict.memorised && conf >= confidenceFloor;
      if (isFlagged) flagged.push({ id: probe.id, verdict });
      else clean.push(probe.id);
    }
  }

  const workers = [];
  const k = Math.min(concurrency, probes.length);
  for (let i = 0; i < k; i++) workers.push(worker());
  await Promise.all(workers);

  // Stable sort for deterministic output regardless of worker race.
  flagged.sort((a, b) => a.id.localeCompare(b.id));
  clean.sort();

  return {
    flagged,
    clean,
    stats: {
      probesChecked: probes.length,
      probesFlagged: flagged.length,
      confidenceFloor,
    },
  };
}
