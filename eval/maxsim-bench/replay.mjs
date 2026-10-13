// Loads a replay set written by hook.mjs: one entry per native MaxSim call
// (query, candidate pool, captured scores).
import fs from 'node:fs';
import path from 'node:path';

export function loadCalls(root) {
  const calls = [];
  for (const repo of fs.readdirSync(root).sort()) {
    const dir = path.join(root, repo);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith('index-')).sort()) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        const buf = fs.readFileSync(path.join(dir, m.file));
        let off = 0;
        const take = (n) => { const b = buf.subarray(off, off + n); off += n; return b; };
        const f32 = (n) => { const b = take(n * 4); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
        const query = f32(m.numQ * m.dim);
        const cands = m.cands.map(c => {
          const tokens = Buffer.from(take(c.tb));
          if (m.kind === 'perdoc') return { tokens, numTokens: c.nt, dim: c.dim, min: c.min, scale: c.scale };
          return { tokens, numTokens: c.nt, dim: c.dim, minArray: f32(c.nt), scaleArray: f32(c.nt), tokenNorms: f32(c.nt) };
        });
        calls.push({ repo, file: m.file, kind: m.kind, numQ: m.numQ, dim: m.dim, query, cands, ref: m.scores });
      }
    }
  }
  return calls;
}
