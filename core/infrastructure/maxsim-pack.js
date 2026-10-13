// Packs per-token MaxSim docs for the native `maxsimScorePacked` entry point.
// No imports: the MaxSim benchmark (eval/maxsim-bench) loads it standalone.

/**
 * Pack per-token docs for `maxsimScorePacked`: the distinct ArrayBuffers behind
 * their typed arrays (one per index segment when the docs come from a segment
 * slab) and 10 u32 per doc: numTokens, dim, then buffer index + byte offset of
 * tokens, minArray, scaleArray and tokenNorms.
 * @param {Array<{tokens: Uint8Array|Int8Array, numTokens: number, dim: number, minArray: Float32Array, scaleArray: Float32Array, tokenNorms: Float32Array}>} docs
 * @returns {{ buffers: Uint8Array[], desc: Uint32Array }}
 */
export function packMaxSimDocs(docs) {
  const buffers = [];
  const index = new Map();
  const desc = new Uint32Array(docs.length * 10);
  let lastBuf = null, lastIdx = -1;
  const put = (at, arr) => {
    const buf = arr.buffer;
    let idx;
    if (buf === lastBuf) idx = lastIdx;
    else {
      idx = index.get(buf);
      if (idx === undefined) { idx = buffers.length; buffers.push(new Uint8Array(buf)); index.set(buf, idx); }
      lastBuf = buf; lastIdx = idx;
    }
    desc[at] = idx;
    desc[at + 1] = arr.byteOffset;
  };
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], at = i * 10;
    desc[at] = d.numTokens;
    desc[at + 1] = d.dim;
    put(at + 2, d.tokens);
    put(at + 4, d.minArray);
    put(at + 6, d.scaleArray);
    put(at + 8, d.tokenNorms);
  }
  return { buffers, desc };
}
