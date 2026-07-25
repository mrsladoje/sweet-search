#!/usr/bin/env node
/**
 * Download tree-sitter WASM grammar files.
 *
 * For most languages the wasm bundled in tree-sitter-wasms@0.1.13 works
 * fine — the runtime provider (core/infrastructure/tree-sitter-provider.js)
 * resolves it via the package's `out/` directory by default.
 *
 * KNOWN OVERRIDES:
 *   - swift: the 0.4.0 wasm shipped in tree-sitter-wasms@0.1.13 reliably
 *     crashes V8 Wasm tier-up compilation ("Fatal process out of memory:
 *     Zone") on linux-x64 under Node 24.x (verified 24.4 + 24.18) and on
 *     Node 25.x; macOS arm64 and Node 20 are unaffected. The 0.7.2 wasm
 *     from alex-pinkus/tree-sitter-swift release `0.7.2-pypi` does not
 *     trigger the bug. The override is COMMITTED at
 *     core/infrastructure/grammars/ (tree-sitter-provider.js Strategy 2c)
 *     and ships in the npm package — this script only regenerates it.
 *
 * Usage:
 *   node scripts/download-tree-sitter-grammars.js
 *   node scripts/download-tree-sitter-grammars.js --dir ./my-grammars
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, '..', 'core', 'infrastructure', 'grammars');

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust',
  'java', 'c', 'cpp', 'ruby', 'php', 'kotlin', 'swift',
];

// Grammars that need an override because the bundled version crashes V8.
// Pinned to a specific release tag for reproducibility.
const GRAMMAR_OVERRIDES = {
  swift: {
    url: 'https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.2-pypi/tree-sitter-swift.wasm',
    sizeBytes: 3455394,
    reason: 'tree-sitter-wasms@0.1.13 ships v0.4.0 which crashes Node 25.x V8 turboshaft Wasm tier-up (Zone OOM in WasmLoweringPhase). v0.7.2 builds clean.',
  },
};

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const get = (currentUrl) => {
      https.get(currentUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(destPath);
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    };
    get(url);
  });
}

async function ensureOverride(lang, dir) {
  const override = GRAMMAR_OVERRIDES[lang];
  if (!override) return { lang, status: 'no-override' };

  const filename = `tree-sitter-${lang}.wasm`;
  const filepath = path.join(dir, filename);

  if (fs.existsSync(filepath)) {
    const stat = fs.statSync(filepath);
    if (stat.size === override.sizeBytes) {
      return { lang, status: 'present', size: stat.size };
    }
    console.log(`  ⚠ ${filename} size mismatch (${stat.size} vs expected ${override.sizeBytes}) — re-downloading`);
    fs.unlinkSync(filepath);
  }

  console.log(`  ↓ downloading ${filename} from ${override.url}`);
  await downloadFile(override.url, filepath);
  const stat = fs.statSync(filepath);
  if (stat.size !== override.sizeBytes) {
    throw new Error(`${filename}: downloaded size ${stat.size} != expected ${override.sizeBytes}`);
  }
  return { lang, status: 'downloaded', size: stat.size };
}

async function main() {
  const dirIdx = process.argv.indexOf('--dir');
  const grammarsDir = dirIdx !== -1 ? process.argv[dirIdx + 1] : DEFAULT_DIR;

  fs.mkdirSync(grammarsDir, { recursive: true });

  console.log('Tree-sitter grammar download helper');
  console.log('====================================');
  console.log(`Target directory: ${grammarsDir}\n`);

  // Step 1: fetch any required overrides (Swift today).
  console.log(`Fetching ${Object.keys(GRAMMAR_OVERRIDES).length} override grammar(s)…`);
  for (const lang of Object.keys(GRAMMAR_OVERRIDES)) {
    try {
      const res = await ensureOverride(lang, grammarsDir);
      if (res.status === 'present') {
        console.log(`  ✓ ${lang}: already present (${res.size} bytes)`);
      } else if (res.status === 'downloaded') {
        console.log(`  ✓ ${lang}: downloaded (${res.size} bytes)`);
      }
    } catch (err) {
      console.error(`  ✗ ${lang}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log();

  // Step 2: report all languages. Non-overridden ones are served from
  // tree-sitter-wasms in node_modules by default — only flag if both the
  // override path AND the bundle path are missing.
  const missing = [];
  const present = [];
  const bundleDir = path.join(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out');

  for (const lang of LANGUAGES) {
    const filename = `tree-sitter-${lang}.wasm`;
    const overridePath = path.join(grammarsDir, filename);
    const bundlePath = path.join(bundleDir, filename);
    if (fs.existsSync(overridePath) || fs.existsSync(bundlePath)) {
      present.push(filename);
    } else {
      missing.push(filename);
    }
  }

  if (present.length > 0) {
    console.log(`Resolvable (${present.length}/${LANGUAGES.length}):`);
    for (const f of present) console.log(`  ✓ ${f}`);
    console.log();
  }

  if (missing.length > 0) {
    console.log(`Missing grammars (${missing.length}):`);
    for (const f of missing) console.log(`  ✗ ${f}`);
    console.log();
    console.log('To obtain pre-built WASM grammar files:');
    console.log('  1. Run `npm install` to restore the tree-sitter-wasms bundle');
    console.log('  2. https://github.com/Gregoor/tree-sitter-wasms');
    console.log(`Or place .wasm files in: ${grammarsDir}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
