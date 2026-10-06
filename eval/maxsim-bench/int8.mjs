// int4 → f32 → per-token int8 requantization, so the int8 kernel runs on the
// same replayed docs as the captured int4 production path.
function dequantInt4(c) {
  const { numTokens: nt, dim } = c; const pd = (dim + 1) >> 1; const out = new Float32Array(nt * dim);
  for (let t = 0; t < nt; t++) for (let d = 0; d < dim; d++) {
    const byte = c.tokens[t * pd + (d >> 1)]; const nib = (d & 1) ? (byte >> 4) & 15 : byte & 15;
    out[t * dim + d] = nib * c.scaleArray[t] + c.minArray[t];
  }
  return out;
}
export function toInt8(c) {
  const f = dequantInt4(c); const { numTokens: nt, dim } = c;
  const tokens = Buffer.alloc(nt * dim); const minArray = new Float32Array(nt); const scaleArray = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    let lo = Infinity, hi = -Infinity;
    for (let d = 0; d < dim; d++) { const v = f[t * dim + d]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const s = (hi - lo) / 255 || 1; minArray[t] = lo; scaleArray[t] = s;
    for (let d = 0; d < dim; d++) tokens[t * dim + d] = (Math.max(0, Math.min(255, Math.round((f[t * dim + d] - lo) / s))) - 128) & 255;
  }
  return { tokens, numTokens: nt, dim, minArray, scaleArray, tokenNorms: c.tokenNorms };
}

