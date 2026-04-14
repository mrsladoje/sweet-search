/**
 * End-to-end smoke test: route nativeEmbed() through the CoreML bridge and
 * compare cosine similarity against the candle BF16 baseline on the same texts.
 *
 * Tests the FULL pipeline that production uses: tokenizer → bridge → output,
 * not just the model in isolation. If this passes, the full-index bench is
 * safe to run.
 */
import { spawn } from 'child_process';

const TEXTS = [
  'function add(a, b) { return a + b; }',
  'export class AuthService { constructor(private jwtProvider) {} async login(credentials) { const user = await this.userRepo.findByEmail(credentials.email); return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
  'import numpy as np\ndef cosine_similarity(a, b):\n    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))',
  'SELECT u.name, COUNT(o.id) AS order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING order_count > 5',
  'Represent this query for searching relevant code: binary search implementation',
  '// Short snippet\nconst x = 42;',
  'fn main() { let v: Vec<i32> = (0..100).filter(|x| x % 2 == 0).collect(); println!("{:?}", v); }',
  '#[derive(Debug, Clone)]\npub struct Config { pub hidden_size: usize, pub num_layers: usize, pub num_heads: usize }',
  'async function fetchData(url) { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }',
  'def quicksort(arr):\n    if len(arr) <= 1: return arr\n    pivot = arr[len(arr) // 2]\n    return quicksort([x for x in arr if x < pivot]) + [x for x in arr if x == pivot] + quicksort([x for x in arr if x > pivot])',
];

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function runBackend(backend) {
  // Use a child process so SWEET_SEARCH_INFERENCE_BACKEND can differ between runs
  // and the embedding model is fresh each time.
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--input-type=module', '-e', `
      import { nativeEmbed } from './core/infrastructure/native-inference.js';
      const TEXTS = ${JSON.stringify(TEXTS)};
      const t0 = performance.now();
      const out = await nativeEmbed(TEXTS);
      const ms = performance.now() - t0;
      const arrays = out.map(v => Array.from(v));
      const payload = '__JSON__' + JSON.stringify({ ms, arrays }) + '__END__';
      // Flush before exit — process.exit can interrupt pending writes on pipes.
      await new Promise((resolve) => process.stdout.write(payload, () => resolve()));
      process.exit(0);
    `], {
      cwd: '/Users/admin/Projects/sweet-search-private',
      env: { ...process.env, SWEET_SEARCH_INFERENCE_BACKEND: backend },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    child.stdout.on('data', (c) => { buf += c.toString(); });
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`${backend} exited ${code}`));
      const m = buf.match(/__JSON__([\s\S]*)__END__/);
      if (!m) return reject(new Error(`${backend}: no JSON marker in output`));
      resolve(JSON.parse(m[1]));
    });
  });
}

console.log('Running candle baseline …');
const candle = await runBackend('candle');
console.log(`  candle: ${candle.ms.toFixed(1)}ms for ${candle.arrays.length} texts`);

console.log('\nRunning CoreML bridge …');
const coreml = await runBackend('coreml');
console.log(`  coreml: ${coreml.ms.toFixed(1)}ms for ${coreml.arrays.length} texts`);

console.log('\n─── Per-input cosine (CoreML vs candle) ───');
let minCos = 1, maxCos = 0, sum = 0;
for (let i = 0; i < TEXTS.length; i++) {
  const c = cosine(candle.arrays[i], coreml.arrays[i]);
  minCos = Math.min(minCos, c); maxCos = Math.max(maxCos, c); sum += c;
  const flag = c >= 0.999 ? 'PASS' : c >= 0.99 ? 'WARN' : 'FAIL';
  const preview = TEXTS[i].slice(0, 60).replace(/\n/g, '\\n');
  console.log(`  ${String(i).padStart(2)}  ${c.toFixed(6)}  [${flag}]  ${preview}`);
}
console.log(`\nmin=${minCos.toFixed(6)}  max=${maxCos.toFixed(6)}  mean=${(sum/TEXTS.length).toFixed(6)}`);

if (minCos >= 0.999) {
  console.log('\nPASS — bridge output matches candle within 0.999 cosine. Safe to run full-index bench.');
  process.exit(0);
} else {
  console.error(`\nFAIL — minimum cosine ${minCos.toFixed(6)} below 0.999 gate. Do NOT run full bench.`);
  process.exit(1);
}
