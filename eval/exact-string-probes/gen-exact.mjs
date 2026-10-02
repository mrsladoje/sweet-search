// Build the exact-string probe set from DEV repos (SEED env, default 42;
// dev-seed42.json and dev-seed7.json were made with seeds 42 and 7).
// Each query quotes an error message, log line, string constant or config key
// that sits inside a function body (indented line) of an implementation file.
// Gold = file + line(s) of that literal; the literal must occur in exactly one
// indexed file. Usage: node gen-exact.mjs <reposDir> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const [reposDir, outPath] = process.argv.slice(2);
const REPOS = ['fastify', 'flask', 'gin', 'ripgrep', 'r3-dgraph'];
const PER_REPO = { error: 4, log: 3, const: 1, config: 2 };
const SEED = Number(process.env.SEED || 42);
// EXCLUDE=<set.json>: skip literals already used by another set (fresh validation set).
const EXCLUDED = new Set(process.env.EXCLUDE
  ? JSON.parse(fs.readFileSync(process.env.EXCLUDE, 'utf8')).items.map((it) => it.query.toLowerCase())
  : []);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const EXT = new Set(['.go', '.js', '.mjs', '.cjs', '.ts', '.py', '.rs']);
const SKIP_PATH = /(^|\/)(test|tests|testing|__tests__|spec|specs|example|examples|docs?|vendor|bench|benches|benchmark|benchmarks|fixtures?|testdata|third_party|node_modules|dist|build)(\/|$)|(_test\.go|\.test\.[jt]s|\.spec\.[jt]s|_test\.py|test_[^/]*\.py|\.d\.ts)$/i;
const ERROR_CTX = /errors\.New|fmt\.Errorf|Errorf\(|errors\.Wrap|errors\.Errorf|\braise\b|\bthrow\b|panic\(|bail!|anyhow!|format_err!|Err\(|new Error|Error\(|ValueError|TypeError|RuntimeError|KeyError|abort\(|x\.Errorf|status\.Errorf|createError|FST_ERR/;
const LOG_CTX = /\blog\.|logger\.|glog\.|klog\.|console\.|warn!|debug!|info!|error!|trace!|eprintln!|println!|\bprint\(|logging\.|\.log\(|\.warn\(|\.info\(|\.debug\(|Infof|Warningf|Debugf|Printf|Println|message!/;

const STRING_RE = /"((?:[^"\\\n]|\\.){6,200})"|'((?:[^'\\\n]|\\.){6,200})'|`([^`\n]{6,200})`/g;

function cleanLiteral(s) {
  return s
    .replace(/\\[ntr"'\\]/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/%[-+# 0-9.*]*[a-zA-Z%]/g, ' ')
    .replace(/\{[^{}]{0,30}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s) => (s.match(/[A-Za-z]{2,}/g) || []);

const out = [];
for (const repo of REPOS) {
  const root = path.join(reposDir, repo);
  const db = new Database(path.join(root, '.sweet-search', 'codebase.db'), { readonly: true });
  const files = db.prepare('SELECT DISTINCT file_path FROM vectors').all().map(r => r.file_path)
    .filter(f => EXT.has(path.extname(f)) && !SKIP_PATH.test(f)).sort();
  db.close();
  const contents = new Map();
  for (const f of files) {
    try { contents.set(f, fs.readFileSync(path.join(root, f), 'utf8')); } catch { /* skip */ }
  }
  const pools = { error: [], log: [], const: [], config: [] };
  const seenText = new Set();
  for (const [f, text] of contents) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s+\S/.test(line)) continue; // inside a body (indented)
      const trimmed = line.trim();
      if (/^(\/\/|#|\*|\/\*|--)/.test(trimmed)) continue; // comment line
      if (/^(import|from|use|require)\b/.test(trimmed)) continue;
      STRING_RE.lastIndex = 0;
      let m;
      while ((m = STRING_RE.exec(line))) {
        const raw = m[1] ?? m[2] ?? m[3];
        if (!raw || /^[\w./-]+\.(js|go|py|rs|ts|json|md|html|css|txt)$/i.test(raw)) continue;
        if (/^https?:|^\/|[<>]|\\x|\\u/.test(raw)) continue;
        const isKey = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,4}$/.test(raw) && raw.length >= 8 && raw.length <= 40;
        const q = cleanLiteral(raw);
        let type;
        if (isKey) type = 'config';
        else {
          const w = words(q);
          if (w.length < 4 || q.length < 20 || q.length > 120) continue;
          if (w.filter(x => /^[a-z]+$/.test(x)).length < 3) continue; // prose-like
          type = ERROR_CTX.test(line) ? 'error' : (LOG_CTX.test(line) ? 'log' : 'const');
        }
        const key = q.toLowerCase();
        if (seenText.has(key) || EXCLUDED.has(key)) continue;
        seenText.add(key);
        pools[type].push({ file: f, line: i + 1, raw, query: isKey ? raw : q, type });
      }
    }
  }
  // Uniqueness: the literal must occur in exactly one indexed file.
  const unique = (c) => {
    let filesHit = 0;
    const goldLines = [];
    for (const [f, text] of contents) {
      if (!text.includes(c.raw)) continue;
      filesHit++;
      if (f === c.file) text.split('\n').forEach((l, idx) => { if (l.includes(c.raw)) goldLines.push(idx + 1); });
    }
    return filesHit === 1 ? goldLines : null;
  };
  const rnd = mulberry32(SEED + REPOS.indexOf(repo));
  const picked = [];
  let deficit = 0;
  for (const type of ['error', 'log', 'const', 'config']) {
    let want = PER_REPO[type];
    for (const c of shuffle(pools[type], rnd)) {
      if (want <= 0) break;
      const goldLines = unique(c);
      if (!goldLines || goldLines.length > 3) continue;
      picked.push({ ...c, goldLines });
      want--;
    }
    deficit += want;
  }
  // Fill any shortfall from the error/log pools (seeded order).
  for (const type of ['error', 'log', 'const']) {
    for (const c of shuffle(pools[type], rnd)) {
      if (deficit <= 0) break;
      if (picked.some(p => p.raw === c.raw)) continue;
      const goldLines = unique(c);
      if (!goldLines || goldLines.length > 3) continue;
      picked.push({ ...c, goldLines });
      deficit--;
    }
  }
  console.error(`${repo}: files=${contents.size} pools=${Object.entries(pools).map(([k, v]) => `${k}:${v.length}`).join(',')} picked=${picked.length}`);
  picked.forEach((p, i) => out.push({ id: `exact-${repo}-${i + 1}`, repo, type: p.type, query: p.query, goldFile: p.file, goldLines: p.goldLines }));
}
fs.writeFileSync(outPath, JSON.stringify({ seed: SEED, generatedBy: 'gen-exact.mjs', repos: REPOS, items: out }, null, 2));
console.error(`total=${out.length}`);
