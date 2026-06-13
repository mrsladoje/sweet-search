/**
 * Animated terminal banner — universal renderer.
 *
 * Decodes the pre-baked lossless WebP sprite-sheet (assets/banner/) once with sharp,
 * then animates it via the best path the terminal supports:
 *
 *   Kitty graphics  (Ghostty, kitty, WezTerm, Konsole)        — pixel-perfect
 *   iTerm2 inline   (iTerm.app)                                — pixel-perfect
 *   Sixel           (Windows Terminal, Konsole, xterm, foot…) — crisp raster
 *   half-blocks     (everything else: Apple Terminal, VS Code, SSH, CI-tty) — truecolor ▀
 *
 * Zero prerequisites for users: the only dependency is sharp (already a package dep,
 * auto-installed per-platform by npm). Chrome is used ONLY at bake time (scripts/bake-banner.mjs).
 *
 * Safe by construction: renders only to an interactive TTY, never throws, honours
 * NO_BANNER / SWEET_SEARCH_NO_BANNER / CI, and leaves the final frame in place when done.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodeSixelFrame, buildPalette, makeMapper, sampleColors } from './sixel.js';

const require = createRequire(import.meta.url);

const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'banner');
const ESC = '\x1b', BEL = '\x07', ST = ESC + '\\';
const SYNC_ON = `${ESC}[?2026h`, SYNC_OFF = `${ESC}[?2026l`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- gating ----------------
function shouldRender(stream, env) {
  if (env.SWEET_SEARCH_NO_BANNER || env.NO_BANNER) return false;
  if (env.CI) return false;
  if (!stream || !stream.isTTY) return false;
  if ((env.TERM || '') === 'dumb') return false;
  return true;
}

// ---------------- terminal capability query (DA1 + text-area size) ----------------
function queryTerminal(stream, env, timeout = 140) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (env.SS_NO_QUERY || !stdin || !stdin.isTTY) { resolve({}); return; }
    let buf = '', done = false, t;
    const finish = () => {
      if (done) return; done = true;
      try { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); } catch { /* noop */ }
      clearTimeout(t);
      const da1 = (buf.match(/\x1b\[\?([0-9;]+)c/) || [])[1] || '';
      const size = buf.match(/\x1b\[4;(\d+);(\d+)t/);
      resolve({ sixel: da1.split(';').includes('4'), areaH: size ? +size[1] : 0, areaW: size ? +size[2] : 0 });
    };
    const onData = (d) => { buf += d.toString('latin1'); if (/\x1b\[\?[0-9;]+c/.test(buf) && (/\x1b\[4;\d+;\d+t/.test(buf) || buf.length > 64)) finish(); };
    try { stdin.setRawMode(true); stdin.resume(); stdin.on('data', onData); } catch { resolve({}); return; }
    stream.write(`${ESC}[14t${ESC}[c`);     // text-area pixel size, then primary device attributes
    t = setTimeout(finish, timeout);
  });
}

function detectProto(env, caps) {
  if (env.SS_PROTO) return env.SS_PROTO;
  const tp = env.TERM_PROGRAM || '';
  if (env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR || tp === 'ghostty' || tp === 'WezTerm' || /kitty/i.test(env.TERM || '')) return 'kitty';
  if (tp === 'iTerm.app') return 'iterm';
  if (caps.sixel || env.WT_SESSION || /foot|contour|mlterm/i.test(env.TERM || '')) return 'sixel';
  return 'blocks';
}

// ---------------- color (truecolor default; 256 fallback) ----------------
function rgb256(r, g, b) {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) { if (r < 8) return 16; if (r > 248) return 231; return 232 + Math.round(((r - 8) / 247) * 24); }
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}
const GHALF = [' ', '▀', '▄', '█'];
function sextantChar(v) {
  if (v === 0) return ' '; if (v === 63) return '█'; if (v === 21) return '▌'; if (v === 42) return '▐';
  return String.fromCodePoint(0x1FB00 + (v - 1 - (v > 21 ? 1 : 0) - (v > 42 ? 1 : 0)));
}

// ---------------- main ----------------
export async function showBanner(opts = {}) {
  const env = opts.env || process.env;
  const out = opts.stream || process.stdout;
  let onSig = null;
  try {
    if (!shouldRender(out, env)) return false;

    const sharp = require('sharp');
    const man = JSON.parse(readFileSync(join(ASSET_DIR, 'banner-manifest.json'), 'utf8'));
    const { gridCols: GC, cellW: CW, cellH: CH, count: N, frameMs } = man;
    const maxMs = opts.maxMs ?? Number(env.SS_BANNER_MS || 2600);
    const color = opts.color || env.SS_COLOR || 'truecolor';
    const cellMode = opts.cells || env.SS_CELLS || 'half';

    const caps = opts.query === false ? {} : await queryTerminal(out, env);
    const proto = opts.proto || detectProto(env, caps);
    const capCols = Number(opts.cols || env.SS_COLS || 120);
    const cols = Math.max(20, Math.min((out.columns || 80) - 2, capCols));

    // decode the sprite sheet once
    const { data: big, info } = await sharp(join(ASSET_DIR, man.file)).raw().toBuffer({ resolveWithObject: true });
    const BW = info.width, ch = info.channels;
    const frameRaw = (i) => {
      const gx = (i % GC) * CW, gy = Math.floor(i / GC) * CH, f = Buffer.allocUnsafe(CW * CH * 4);
      for (let y = 0; y < CH; y++) { const so = ((gy + y) * BW + gx) * ch; big.copy(f, y * CW * 4, so, so + CW * 4); }
      return f;
    };

    const fg = color === '256' ? (r, g, b) => `${ESC}[38;5;${rgb256(r, g, b)}m` : (r, g, b) => `${ESC}[38;2;${r};${g};${b}m`;
    const bg = color === '256' ? (r, g, b) => `${ESC}[48;5;${rgb256(r, g, b)}m` : (r, g, b) => `${ESC}[48;2;${r};${g};${b}m`;
    const RESET = `${ESC}[0m`;

    // ---------------- per-protocol lazy frame builder (build only frames we show) ----------------
    let renderRows = Math.max(4, Math.round(cols / 6));
    const cache = new Map();
    let buildOne;

    if (proto === 'kitty' || proto === 'iterm') {
      buildOne = async (i) => (await sharp(frameRaw(i), { raw: { width: CW, height: CH, channels: 4 } }).png().toBuffer()).toString('base64');
    } else if (proto === 'sixel') {
      const cellWpx = caps.areaW && out.columns ? caps.areaW / out.columns : 8;
      const Wp = Math.min(1000, Math.max(360, Math.round(cols * cellWpx)));
      const Hp = Math.round(Wp / 3);
      const cellHpx = caps.areaH && out.rows ? caps.areaH / out.rows : 16;
      renderRows = Math.max(4, Math.round(Hp / cellHpx));
      const sixelPx = async (i) => (await sharp(frameRaw(i), { raw: { width: CW, height: CH, channels: 4 } }).resize(Wp, Hp, { fit: 'fill' }).raw().toBuffer());
      // global palette from 2 representative frames (colours are stable across the loop)
      const samp = [...sampleColors(await sixelPx(0), 9), ...sampleColors(await sixelPx((N / 2) | 0), 9)];
      const palette = buildPalette(samp, 255), mapper = makeMapper(palette);
      buildOne = async (i) => encodeSixelFrame(await sixelPx(i), Wp, Hp, palette, mapper);
    } else {
      const [sc, sr] = cellMode === 'sextant' ? [2, 3] : [1, 2];
      const R = Math.max(3, Math.round((cols * sc) * CH / CW / sr)); renderRows = R;
      const W = cols * sc, H = R * sr;
      const glyph = cellMode === 'sextant' ? sextantChar : (v) => GHALF[v];
      buildOne = async (i) => {
        const { data: px } = await sharp(frameRaw(i), { raw: { width: CW, height: CH, channels: 4 } }).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).sharpen({ sigma: 0.7 }).raw().toBuffer({ resolveWithObject: true });
        let s = '';
        for (let cy = 0; cy < R; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            const sub = []; let anyT = false, anyO = false;
            for (let y = 0; y < sr; y++) for (let x = 0; x < sc; x++) { const o = ((cy * sr + y) * W + (cx * sc + x)) * 4, a = px[o + 3]; sub.push({ r: px[o], g: px[o + 1], b: px[o + 2], a }); if (a < 128) anyT = true; else anyO = true; }
            if (!anyO) { s += RESET + ' '; continue; }
            const op = sub.filter(p => p.a >= 128), lum = p => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
            let lo = op[0], hi = op[0];
            for (const p of op) { if (lum(p) < lum(lo)) lo = p; if (lum(p) > lum(hi)) hi = p; }
            const dist = (p, q) => (p.r - q.r) ** 2 + (p.g - q.g) ** 2 + (p.b - q.b) ** 2;
            let fr = 0, fG = 0, fb = 0, fn = 0, br = 0, bG = 0, bb = 0, bn = 0, bits = 0;
            for (let k = 0; k < sub.length; k++) { const p = sub[k]; if (p.a < 128) continue; if (dist(p, hi) <= dist(p, lo)) { bits |= (1 << k); fr += p.r; fG += p.g; fb += p.b; fn++; } else { br += p.r; bG += p.g; bb += p.b; bn++; } }
            const fc = fn ? [Math.round(fr / fn), Math.round(fG / fn), Math.round(fb / fn)] : null;
            const bc = bn ? [Math.round(br / bn), Math.round(bG / bn), Math.round(bb / bn)] : null;
            const full = (1 << sub.length) - 1;
            if (anyT) s += bits === 0 ? RESET + ' ' : RESET + fg(...(fc || bc)) + glyph(bits);
            else if (bits === 0) s += bg(...bc) + ' ';
            else if (bits === full) s += fg(...fc) + glyph(bits);
            else s += bg(...bc) + fg(...fc) + glyph(bits);
          }
          s += RESET; if (cy < R - 1) s += '\r\n';
        }
        return s;
      };
    }
    const getFrame = async (i) => { let v = cache.get(i); if (v === undefined) { v = await buildOne(i); cache.set(i, v); } return v; };

    // ---------------- emit / animate (bounded) ----------------
    const CHUNK = 4096;
    const kittyFrame = (b64, id) => {
      if (b64.length <= CHUNK) { out.write(`${ESC}_Gf=100,a=T,q=2,c=${cols},C=1,i=${id};${b64}${ST}`); return; }
      for (let i = 0; i < b64.length; i += CHUNK) { const piece = b64.slice(i, i + CHUNK), more = i + CHUNK < b64.length ? 1 : 0; out.write(i === 0 ? `${ESC}_Gf=100,a=T,q=2,c=${cols},C=1,i=${id},m=1;${piece}${ST}` : `${ESC}_Gm=${more};${piece}${ST}`); }
    };
    const kittyDel = (id) => out.write(`${ESC}_Ga=d,d=i,i=${id},q=2${ST}`);

    await getFrame(0);                    // build first frame before clearing space (hide latency)
    out.write(ESC + '[?25l');
    // Restore the cursor if interrupted mid-animation (else Ctrl-C leaves it hidden).
    onSig = () => { try { out.write(`${ESC}[0m${ESC}[?25h`); } catch { /* noop */ } process.exit(130); };
    process.once('SIGINT', onSig);
    if (proto === 'blocks' || proto === 'sixel') { for (let r = 0; r < renderRows; r++) out.write('\n'); out.write(`${ESC}[${renderRows}A`); }
    else out.write('\n');
    out.write(ESC + '7');

    let prevId = 0, flip = 1;
    const start = Date.now();
    let i = 0;
    while (Date.now() - start < maxMs) {
      const frame = await getFrame(i);
      out.write(SYNC_ON + ESC + '8');
      if (proto === 'kitty') { const id = flip; kittyFrame(frame, id); if (prevId) kittyDel(prevId); prevId = id; flip = flip === 1 ? 2 : 1; }
      else if (proto === 'iterm') out.write(`${ESC}]1337;File=inline=1;width=${cols};height=${renderRows};preserveAspectRatio=1:${frame}${BEL}`);
      else out.write(frame);
      out.write(SYNC_OFF);
      await sleep(frameMs);
      i = (i + 1) % N;
    }
    out.write(ESC + '8');                 // settle: leave final frame, move below
    out.write('\n'.repeat(renderRows + 1));
    out.write(RESET + ESC + '[?25h');
    if (onSig) process.removeListener('SIGINT', onSig);   // hand Ctrl-C back to the caller
    return true;
  } catch (err) {
    if (onSig) process.removeListener('SIGINT', onSig);
    if (env.SS_BANNER_DEBUG) process.stderr.write(`[banner] ${err && err.stack || err}\n`);
    try { out.write(`${ESC}[0m${ESC}[?25h`); } catch { /* noop */ }
    return false;
  }
}

export default showBanner;
