// node check_quantizer.mjs <in.bin> <out.bin> <dim> <n>
// Runs the REAL production code on float32 tokens [n, dim] two ways and writes both results:
//  A) quantizeToInt4PerToken, not exported: its exact source text is cut out of
//     core/ranking/late-interaction-index.js and evaluated unchanged.
//  B) LateInteractionIndex.add() (quantBits 4, no rotation, no pooling), which also stores the norms.
// Output: for each of A, B: raw | mn | sc | nr (A's nr slot is zero-filled).
import fs from 'node:fs';
const [inp, outp, dimS, nS] = process.argv.slice(2);
const dim = Number(dimS), n = Number(nS);
const SRC = new URL('../../', import.meta.url).pathname;
const file = SRC + 'core/ranking/late-interaction-index.js';
const text = fs.readFileSync(file, 'utf8');
const start = text.indexOf('function quantizeToInt4PerToken(');
if (start < 0) throw new Error('function not found');
let depth = 0, end = -1, seen = false;
for (let i = text.indexOf('{', start); i < text.length; i++) {
  if (text[i] === '{') { depth++; seen = true; }
  else if (text[i] === '}') { depth--; if (seen && depth === 0) { end = i + 1; break; } }
}
const fn = new Function(`${text.slice(start, end)}; return quantizeToInt4PerToken;`)();

const b = fs.readFileSync(inp);
const flat = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
const A = fn(flat, n, dim);

const { LateInteractionIndex } = await import(file);
const idx = new LateInteractionIndex({ indexPath: '/nonexistent/li.db', loadExisting: false, quantBits: 4, tokenDim: dim, maxTokens: 100000 });
const toks = Array.from({ length: n }, (_, t) => flat.slice(t * dim, (t + 1) * dim));
await idx.add('x', toks, { _pooledUpstream: true });
const D = idx.documents.get('x');
if (!D || D.numTokens !== n || D.dim !== dim || D.quantBits !== 4) throw new Error('add() entry unexpected');

const u8 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
fs.writeFileSync(outp, Buffer.concat([
  u8(A.data), u8(A.minArray), u8(A.scaleArray), Buffer.alloc(n * 4),
  u8(D.tokens), u8(D.minArray), u8(D.scaleArray), u8(D.tokenNorms),
]));
