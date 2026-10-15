// node --expose-gc mem-li.mjs <path to codebase-late-interaction.db> [calls=200]
//
// W11, product path (PAPER_PLAN.md W11): the resident memory of a real LateInteractionIndex
// in a fresh process. Loads the index as the daemon does, compares resident memory with
// the bytes its documents hold (int4 tokens, min, scale, norms, preNorms), then runs
// rerank-shaped native calls (25 random docs, 14 query tokens, seed 42) through
// nativeMaxSimPacked and reports the growth. Dev data only (a local index); light.
// macOS: also prints the footprint and the vmmap MALLOC summary (freed large blocks).
import { execFileSync } from 'node:child_process';

const SRC = new URL('../..', import.meta.url).pathname;
const [indexPath, nCalls = '200'] = process.argv.slice(2);
if (!indexPath || !global.gc) throw new Error('usage: node --expose-gc mem-li.mjs <index .db path> [calls]');
const { LateInteractionIndex } = await import(`${SRC}core/ranking/late-interaction-index.js`);
const sd = await import(`${SRC}core/infrastructure/simd-distance.js`);
const mb = x => (x / 1048576).toFixed(1);
const fp = () => { if (process.platform !== 'darwin') return ''; try { return execFileSync('footprint', ['-p', String(process.pid)], { encoding: 'utf8' }).split('\n').find(l => /Footprint/.test(l))?.trim().replace(/^.*Footprint:\s*/, 'footprint '); } catch { return ''; } };
const snap = (t) => { global.gc(); global.gc(); const m = process.memoryUsage(); console.log(`${t}: rss ${mb(m.rss)} MB, heap ${mb(m.heapUsed)}, arrayBuffers ${mb(m.arrayBuffers)} ${fp()}`); return m; };
await sd.initWasm?.();
const m0 = snap('base');
const li = new LateInteractionIndex({ indexPath });
await li.init();
const m1 = snap('loaded');
let tok = 0, bytes = 0, pre = 0, preB = 0, q4 = 0;
for (const d of li.documents.values()) {
  tok += d.numTokens; if (d.quantBits === 4) q4++;
  for (const f of ['tokens', 'minArray', 'scaleArray', 'tokenNorms', 'preNorms']) { const a = d[f]; if (!a) continue; bytes += a.byteLength; if (f === 'preNorms') { pre++; preB += a.byteLength; } }
}
console.log(`docs ${li.documents.size} (int4 ${q4}), tokens ${tok}, dim ${li.tokenDim}: held ${(bytes / tok).toFixed(2)} B/token (preNorms on ${pre} docs, ${(preB / tok).toFixed(2)} B/token); `
  + `resident growth ${((m1.rss - m0.rss) / tok).toFixed(2)} B/token, ArrayBuffer growth ${((m1.arrayBuffers - m0.arrayBuffers) / tok).toFixed(2)} B/token`);
const docs = [...li.documents.values()].filter(d => d.quantBits === 4);
let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const q = new Float32Array(14 * li.tokenDim).map(() => rnd() - 0.5);
for (let i = 0; i < Number(nCalls); i++) sd.nativeMaxSimPacked(q, 14, li.tokenDim, 4, Array.from({ length: 25 }, () => docs[Math.floor(rnd() * docs.length)]));
const m2 = snap(`after ${nCalls} calls`);
console.log(`per-call growth: ${mb(m2.rss - m1.rss)} MB resident over ${nCalls} calls`);
if (process.platform === 'darwin') {
  console.log(execFileSync('vmmap', ['-summary', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(l => /^MALLOC_LARGE|Physical footprint:/.test(l)).join('\n'));
}
