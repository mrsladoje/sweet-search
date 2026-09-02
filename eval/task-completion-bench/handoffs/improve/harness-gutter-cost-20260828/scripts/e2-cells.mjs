// e2-cells.mjs — shared cell assembly for the E2 analysis. Import from /tmp/fp-inv/e2/.
import fs from 'node:fs';
export const REPAIR = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean));
export const POOL = fs.readFileSync('/root/fresh-run/pool.txt', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean);

export function load(file = '/tmp/fp-inv/e2/rollout-costs.json') {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Epoch C opencode sweet: the rp-* repair pass REPLACES the fp-* rows for the 11 repair tasks.
export function cellRows(rollouts, { epoch, harness, form }) {
  return rollouts.filter(r => {
    if (!r.ok) return false;
    if (r.epoch !== epoch || r.harness !== harness) return false;
    if (r.form !== form) return false;
    if (epoch === 'C' && harness === 'opencode' && form !== 'native') {
      if (r.repair) return REPAIR.has(r.taskId);
      return !REPAIR.has(r.taskId);
    }
    return true;
  });
}
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const sum = a => a.reduce((x, y) => x + y, 0);
export function bootCI(deltas, iters = 20000, seed = 20260828) {
  // paired bootstrap over tasks
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const n = deltas.length; if (!n) return [null, null];
  const ms = [];
  for (let i = 0; i < iters; i++) {
    let t = 0; for (let j = 0; j < n; j++) t += deltas[(rnd() * n) | 0];
    ms.push(t / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * iters)], ms[Math.floor(0.975 * iters)]];
}
