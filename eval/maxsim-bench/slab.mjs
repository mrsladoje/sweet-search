// Copies candidates into one ArrayBuffer (4-byte aligned fields), the layout the
// LI segment loader gives docs of one segment, and returns views into it.
export function toSlab(cands) {
  const al = n => (n + 3) & ~3;
  let total = 0;
  for (const c of cands) total += al(c.tokens.byteLength) + 3 * al(c.numTokens * 4);
  const slab = new ArrayBuffer(total);
  const u8 = new Uint8Array(slab);
  let off = 0;
  const copy = (arr, Ctor) => {
    const len = arr.byteLength;
    u8.set(new Uint8Array(arr.buffer, arr.byteOffset, len), off);
    const view = new Ctor(slab, off, Ctor === Float32Array ? len / 4 : len);
    off += al(len);
    return view;
  };
  return cands.map(c => ({ ...c, tokens: copy(c.tokens, Uint8Array), minArray: copy(c.minArray, Float32Array), scaleArray: copy(c.scaleArray, Float32Array), tokenNorms: copy(c.tokenNorms, Float32Array) }));
}
