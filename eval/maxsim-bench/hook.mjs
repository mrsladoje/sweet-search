// Preload (--import): dumps every native MaxSim kernel call to $SS_MAXSIM_DUMP.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.SS_MAXSIM_DUMP;
if (dir) {
  const { loadNativeAddon } = await import(new URL('../../core/infrastructure/native-resolver.js', import.meta.url));
  const res = loadNativeAddon();
  if (res) {
    const mod = res.mod;
    fs.mkdirSync(dir, { recursive: true });
    const tag = `${process.argv.includes('--serve') ? 'd' : 'c'}${process.pid}`;
    const index = fs.openSync(path.join(dir, `index-${tag}.jsonl`), 'a');
    let n = 0;
    const wrap = (name, kind) => {
      const orig = mod[name]?.bind(mod);
      if (!orig) return;
      mod[name] = (q, numQ, dim, cands) => {
        const scores = orig(q, numQ, dim, cands);
        const file = `${tag}-${String(n++).padStart(6, '0')}.bin`;
        const parts = [Buffer.from(q.buffer, q.byteOffset, numQ * dim * 4)];
        const meta = [];
        for (const c of cands) {
          const tok = Buffer.from(c.tokens.buffer, c.tokens.byteOffset, c.tokens.byteLength);
          parts.push(tok);
          const m = { nt: c.numTokens, dim: c.dim, tb: tok.length };
          if (c.minArray) for (const a of [c.minArray, c.scaleArray, c.tokenNorms]) parts.push(Buffer.from(a.buffer, a.byteOffset, c.numTokens * 4));
          else { m.min = c.min; m.scale = c.scale; }
          meta.push(m);
        }
        fs.writeFileSync(path.join(dir, file), Buffer.concat(parts));
        fs.writeSync(index, JSON.stringify({ file, kind, numQ, dim, cands: meta, scores: Array.from(scores) }) + '\n');
        return scores;
      };
    };
    wrap('maxsimScoreBatchPertoken', 'pertoken');
    wrap('maxsimScoreBatch4Bit', 'int4');
    wrap('maxsimScoreBatch', 'perdoc');
  }
}
