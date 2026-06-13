#!/usr/bin/env node
/**
 * bake-banner — dev-only asset baker for the animated terminal banner.
 *
 * The pixel banner SVG (assets/sweet-search-banner-pixelated.svg) is SMIL-animated.
 * librsvg/sharp cannot execute SMIL (animated elements that start at opacity:0 vanish),
 * so we drive a real SMIL engine — headless Chrome — to freeze the animation at N
 * timesteps, screenshot each faithful frame, and pack them into one lossless WebP
 * sprite-sheet that ships in the package. The runtime renderer (core/banner) decodes
 * this once with sharp and animates it across terminals (no Chrome needed at runtime).
 *
 *   node scripts/bake-banner.mjs                 # bake with defaults
 *   LOOP=8 FPS=12 WIDTH=1200 node scripts/bake-banner.mjs
 *
 * Requires (dev only): puppeteer-core + a local Chrome/Chromium.
 *   - auto-detects common Chrome paths, or set PUPPETEER_EXECUTABLE_PATH.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(join(ROOT, 'package.json'));
const sharp = require('sharp');
const puppeteer = require('puppeteer-core');

const SVG_PATH = join(ROOT, 'assets', 'sweet-search-banner-pixelated.svg');
const OUT_DIR = join(ROOT, 'assets', 'banner');
const OUT_WEBP = join(OUT_DIR, 'banner-frames.webp');
const OUT_MANIFEST = join(OUT_DIR, 'banner-manifest.json');

const LOOP = Number(process.env.LOOP || 8);      // seconds sampled (Clawd eat cycle)
const FPS = Number(process.env.FPS || 12);       // samples per second
const WIDTH = Number(process.env.WIDTH || 1200); // native SVG width
const HEIGHT = Math.round(WIDTH / 3);            // banner is 3:1
const GRID_COLS = 8;                             // sprite-sheet columns (keeps dims < WebP 16383 limit)

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find(p => existsSync(p)) || null;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome binary.');
    process.exit(1);
  }
  const svg = readFileSync(SVG_PATH, 'utf8');
  mkdirSync(OUT_DIR, { recursive: true });

  console.error(`[bake] chrome=${chrome}`);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'shell', args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset=utf8><style>*{margin:0;padding:0}html,body{background:transparent}svg{display:block}</style>${svg}`,
    { waitUntil: 'load' }
  );
  await page.evaluate(() => document.querySelector('svg').pauseAnimations());

  const samples = Math.round(LOOP * FPS);
  const frames = [];
  for (let i = 0; i < samples; i++) {
    await page.evaluate((t) => document.querySelector('svg').setCurrentTime(t), i / FPS);
    const el = await page.$('svg');
    frames.push(await el.screenshot({ type: 'png', omitBackground: true }));
  }
  await browser.close();
  console.error(`[bake] captured ${frames.length} frames @ ${WIDTH}x${HEIGHT}`);

  // Composite into an 8-column grid sprite sheet (each cell WIDTH x HEIGHT), lossless WebP.
  const N = frames.length;
  const rows = Math.ceil(N / GRID_COLS);
  const tiles = [];
  for (let i = 0; i < N; i++) {
    tiles.push({ input: frames[i], left: (i % GRID_COLS) * WIDTH, top: Math.floor(i / GRID_COLS) * HEIGHT });
  }
  const info = await sharp({ create: { width: GRID_COLS * WIDTH, height: rows * HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles)
    .webp({ lossless: true, effort: 6 })
    .toFile(OUT_WEBP);

  const manifest = { format: 'grid-webp', file: 'banner-frames.webp', gridCols: GRID_COLS, cellW: WIDTH, cellH: HEIGHT, count: N, fps: FPS, frameMs: Math.round(1000 / FPS) };
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.error(`[bake] wrote ${OUT_WEBP} (${(info.size / 1024).toFixed(0)}KB) + manifest (${N} frames)`);
}

main().catch(e => { console.error('[bake] failed:', e.message); process.exit(1); });
