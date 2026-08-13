// Pull the "=== ISSUE ===" block for given tasks from any recorded rollout. BLINDED: no labels.
import fs from 'node:fs';
const RES = '/root/sweet-search-private/eval/task-completion-bench/results';
const WANT = new Set(process.env.WANT.split(','));
const found = {};

function scanFile(f, taskId) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
  for (const ln of txt.split('\n')) {
    if (!ln.includes('=== ISSUE ===')) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const acc = [];
    (function walk(v) {
      if (typeof v === 'string') { if (v.includes('=== ISSUE ===')) acc.push(v); return; }
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(o);
    if (acc.length) { found[taskId] = acc[0]; return; }
  }
}

outer:
for (const run of fs.readdirSync(RES)) {
  const as = `${RES}/${run}/agent-state`;
  if (!fs.existsSync(as)) continue;
  for (const d of fs.readdirSync(as)) {
    const taskId = d.replace(/-(native|sweet)$/, '');
    if (!WANT.has(taskId) || found[taskId]) continue;
    // walk down for jsonl rollouts
    const stack = [`${as}/${d}`];
    while (stack.length) {
      const cur = stack.pop();
      let ents; try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = `${cur}/${e.name}`;
        if (e.isDirectory()) stack.push(p);
        else if (/\.jsonl?$/.test(e.name)) { scanFile(p, taskId); if (found[taskId]) break; }
      }
      if (found[taskId]) break;
    }
    if ([...WANT].every(w => found[w])) break outer;
  }
}

for (const [k, v] of Object.entries(found)) {
  console.log('##### ISSUE ' + k);
  console.log(v.replace(/^=== ISSUE ===\n?/, '').slice(0, 12000));
  console.log('##### END ' + k);
}
console.log('MISSING: ' + [...WANT].filter(w => !found[w]).join(','));
