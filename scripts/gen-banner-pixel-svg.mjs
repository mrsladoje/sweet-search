#!/usr/bin/env node
/**
 * gen-banner-pixel-svg.mjs — PIXELATED variant of the sweet-search hero
 * banner, inspired by Anthropic's "Fable 5 Build Day" 8-bit Clawd promo.
 *
 * Same scene + choreography as gen-banner-svg.mjs, restyled as pixel art:
 *   - everything on a coarse cell grid (CELL=4px), run-merged <rect>s,
 *     shape-rendering=crispEdges, flat limited palette, no gradients/blurs
 *   - all motion quantized: calcMode=discrete keyframes (sprite-step feel)
 *   - Clawd's legs SWAP to drawn bent-pixel poses while he leans (like the
 *     video sprite), instead of just rotating with the body
 *   - fire is a classic 2-frame pixel flame; title shimmer sweeps in steps
 *
 *   node scripts/gen-banner-pixel-svg.mjs            -> assets/sweet-search-banner-pixelated.svg
 *   node scripts/gen-banner-pixel-svg.mjs --at 2.1 --out /tmp/f.svg   (freeze-frame QA)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const FREEZE = parseFloat(flag('--at') || '0') || 0;
const OUT = resolve(flag('--out') || resolve(__dirname, '..', 'assets', 'sweet-search-banner-pixelated.svg'));

const f = (n) => {
  const r = Number(n.toFixed(2));
  return Object.is(r, -0) ? 0 : r;
};
const CELL = 4;
const snap = (v) => Math.round(v / CELL) * CELL;

// ---------------------------------------------------------------------------
// Palette (flat; shades are fixed, no gradients anywhere)
// ---------------------------------------------------------------------------
const C = {
  sky1: '#69B4E8', sky2: '#8CC9F0', sky3: '#A9D9F6', sky4: '#C8E8F8',
  cloud: '#FFFFFF', cloudShade: '#DCEFFA',
  grass: '#79C26B', shadow: '#2E5C33',
  mtn: '#8E9BAA', snow: '#F4F8FB', forest1: '#56975F', forest2: '#4E8D58',
  treeTrunk: '#7E5A40', treeA: '#54A55A', treeB: '#62B364', pine: '#3E8C52',
  band0: '#060A1F', band1: '#0A1134', band2: '#0E1849', band4: '#162874',
  glyph: '#5A73DC', glyphHi: '#8CA0F0', glyphLo: '#4557C5', glyphShadow: '#0A1546',
  coral: '#D77757', ink: '#20201E',
  candy: '#FF5BA3', candyShade: '#C2407B', wrapPink: '#FF97C2',
  candyMint: '#3FD08F', candyViolet: '#A78BFA', candyGold: '#FFC247', candyOrange: '#FF8A5C',
  coxBands: ['#B1A7FF', '#95A2FF', '#7A9DFF', '#596FFF', '#3941FF'],
  coxBodyHi: '#7A9DFF', coxBodyLo: '#4549EE', coxLimb: '#515FF2', coxLimbFar: '#3A43D6',
  lap: '#262B40', lapHi: '#4A5378', screenGlow: '#9FE8FF',
  choc: '#7A4E2A', chocDark: '#58381E', chocSmudge: '#6B4226',
  beam: '#FFE875', beamCore: '#FFFDE6', flame1: '#FF8A3C', flame2: '#FFD24A',
  metal: '#3A3F4A', glass: '#CFE9FF', smoke: '#9AA0A8', char: '#4A3B33',
  caneRed: '#E8556F', caneDark: '#B23B52', stick: '#E8D9C0',
};

function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const rnd = lcg(0x5EE75);
const rr = (a, b) => a + (b - a) * rnd();

// ---------------------------------------------------------------------------
// SMIL helpers — same as the smooth banner, plus opts.discrete for stepped
// sprite motion. Freeze mode statically evaluates (discrete = hold value).
// ---------------------------------------------------------------------------
function evalAt(values, keyTimes, dur, begin, discrete) {
  const local = FREEZE - begin;
  const frac = (((local % dur) + dur) % dur) / dur;
  const vecs = values.map((v) => String(v).trim().split(/\s+/).map(Number));
  let i = keyTimes.length - 2;
  for (let k = 0; k < keyTimes.length - 1; k++) {
    if (frac >= keyTimes[k] && frac <= keyTimes[k + 1]) { i = k; break; }
  }
  if (discrete) return vecs[frac >= keyTimes[keyTimes.length - 1] ? keyTimes.length - 1 : i].map(f).join(' ');
  const span = keyTimes[i + 1] - keyTimes[i] || 1;
  const t = Math.min(1, Math.max(0, (frac - keyTimes[i]) / span));
  return vecs[i].map((a, j) => f(a + (vecs[i + 1][j] - a) * t)).join(' ');
}

function anim(attr, values, keyTimes, dur, opts = {}) {
  const begin = opts.begin || 0;
  if (FREEZE) return `<set attributeName="${attr}" to="${evalAt(values, keyTimes, dur, begin, opts.discrete)}"/>`;
  const mode = opts.discrete ? ' calcMode="discrete"'
    : opts.splines ? ` calcMode="spline" keySplines="${opts.splines.join(';')}"` : '';
  return `<animate attributeName="${attr}" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" dur="${dur}s"${mode} begin="${begin}s" repeatCount="indefinite"/>`;
}

function animT(type, values, keyTimes, dur, opts = {}) {
  const begin = opts.begin || 0;
  if (FREEZE) {
    if (opts.additive) return '';
    return `<animateTransform attributeName="transform" type="${type}" values="${evalAt(values, keyTimes, dur, begin, opts.discrete)}" dur="1s" fill="freeze" repeatCount="1"/>`;
  }
  const mode = opts.discrete ? ' calcMode="discrete"'
    : opts.splines ? ` calcMode="spline" keySplines="${opts.splines.join(';')}"` : '';
  const add = opts.additive ? ' additive="sum"' : '';
  return `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" dur="${dur}s"${mode}${add} begin="${begin}s" repeatCount="indefinite"/>`;
}

// rect emitters
const RX = (list) => list.map(([x, y, w, h, fill, op]) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${op != null ? ` opacity="${op}"` : ''}/>`).join('');

// rasterise a union of circles to grid-row runs (pixel clouds, humps, head)
function rasterCircles(circles, fill, cell = CELL) {
  let yMin = Infinity, yMax = -Infinity;
  for (const [, cy, r] of circles) { yMin = Math.min(yMin, cy - r); yMax = Math.max(yMax, cy + r); }
  yMin = Math.floor(yMin / cell) * cell; yMax = Math.ceil(yMax / cell) * cell;
  let out = '';
  for (let y = yMin; y < yMax; y += cell) {
    const ym = y + cell / 2;
    const iv = [];
    for (const [cx, cy, r] of circles) {
      const d = r * r - (ym - cy) * (ym - cy);
      if (d > 0) { const hw = Math.sqrt(d); iv.push([cx - hw, cx + hw]); }
    }
    if (!iv.length) continue;
    iv.sort((a, b) => a[0] - b[0]);
    const merged = [iv[0].slice()];
    for (let k = 1; k < iv.length; k++) {
      const last = merged[merged.length - 1];
      if (iv[k][0] <= last[1]) last[1] = Math.max(last[1], iv[k][1]);
      else merged.push(iv[k].slice());
    }
    for (const [a, b] of merged) {
      const x0 = Math.floor(a / cell) * cell, x1 = Math.ceil(b / cell) * cell;
      if (x1 > x0) out += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${cell}" fill="${fill}"/>`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. SWEET SEARCH half-block art (identical strings to cli-decoration.js)
// ---------------------------------------------------------------------------
const L1 = '█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█';
const L2 = '▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█';
const HB = { '█': [1, 1], '▀': [1, 0], '▄': [0, 1], ' ': [0, 0] };

function decodeBanner(l1, l2) {
  const a1 = [...l1], a2 = [...l2];
  const W = Math.max(a1.length, a2.length);
  const rows = [[], [], [], []];
  for (let i = 0; i < W; i++) {
    const [t1, b1] = HB[a1[i] ?? ' '] ?? [0, 0];
    const [t2, b2] = HB[a2[i] ?? ' '] ?? [0, 0];
    rows[0][i] = t1; rows[1][i] = b1; rows[2][i] = t2; rows[3][i] = b2;
  }
  return { rows, W, H: 4 };
}
const bmp = decodeBanner(L1, L2);

const PW = 16, PH = 16;
const artW = bmp.W * PW, artH = bmp.H * PH;
const PANEL = { w: artW + 64, h: artH + 56, x: 0, y: 76 };
PANEL.x = (1200 - PANEL.w) / 2;
const BX = 600 - artW / 2, BY = PANEL.y + (PANEL.h - artH) / 2;

function artRuns(dx = 0, dy = 0) {
  let out = '';
  for (let r = 0; r < bmp.H; r++) {
    let c = 0;
    while (c < bmp.W) {
      if (!bmp.rows[r][c]) { c++; continue; }
      let c2 = c;
      while (c2 + 1 < bmp.W && bmp.rows[r][c2 + 1]) c2++;
      out += `<rect x="${f(BX + c * PW + dx)}" y="${f(BY + r * PH + dy)}" width="${f((c2 - c + 1) * PW)}" height="${PH}"/>`;
      c = c2 + 1;
    }
  }
  return out;
}

// pixel-cornered rectangle (corners stepped by 2 cells)
function pixelPanelRects(x, y, w, h, fill) {
  return RX([
    [x + 8, y, w - 16, h, fill],
    [x + 4, y + 4, w - 8, h - 8, fill],
    [x, y + 8, w, h - 16, fill],
  ]);
}

function bannerPanel() {
  // fully pixel title (flat bands, flat glyphs, hard pixel shadow) — but the
  // two light effects (white shine + rainbow shimmer) glide smoothly across
  const bands = [
    [0, 0.13, C.band0], [0.13, 0.30, C.band1], [0.30, 0.44, C.band2],
    [0.44, 0.56, C.band4], [0.56, 0.70, C.band2], [0.70, 0.87, C.band1], [0.87, 1, C.band0],
  ].map(([a, b, col]) => [PANEL.x + snap(a * PANEL.w), PANEL.y, snap((b - a) * PANEL.w) + CELL, PANEL.h, col]);
  return `
  <g>
    ${animT('translate', ['0 0', '0 -4', '0 0'], [0, 0.5, 1], 7, { discrete: true })}
    <rect x="${PANEL.x + 6}" y="${PANEL.y + 8}" width="${PANEL.w - 12}" height="${PANEL.h}" fill="${C.band1}" opacity="0.35"/>
    <g clip-path="url(#panelClip)">${RX(bands)}</g>
    <g fill="${C.glyphShadow}">${artRuns(0, 4)}</g>
    <g fill="${C.glyph}">${artRuns()}</g>
    <g clip-path="url(#artClip)">
      <rect x="0" y="${f(BY - 8)}" width="130" height="${artH + 16}" fill="url(#sweepGrad)" opacity="0.38" transform="skewX(-18)">
        ${anim('x', [f(BX - 170), f(BX - 170), f(BX + artW + 90), f(BX + artW + 90)], [0, 0.3, 0.425, 1], 19, { begin: 1.6 })}
      </rect>
      <rect x="0" y="${f(BY - 8)}" width="240" height="${artH + 16}" fill="url(#candySweepGrad)" opacity="0" transform="skewX(-18)" style="mix-blend-mode:screen">
        ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.512, 0.52, 0.585, 0.6, 1], 23)}
        ${anim('x', [f(BX - 280), f(BX - 280), f(BX + artW + 60), f(BX + artW + 60)], [0, 0.51, 0.595, 1], 23)}
      </rect>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 2. Scenery — pixel sky bands, rasterised clouds, stepped mountains, sprites
// ---------------------------------------------------------------------------
const CLOUD_SHAPES = [
  [[0, 0, 22], [-24, 6, 15], [24, 6, 15], [-12, -10, 14], [13, -9, 15], [38, 9, 10]],
  [[0, 0, 16], [-30, 4, 12], [28, 4, 13], [-14, -8, 12], [12, -8, 13], [46, 7, 9], [-46, 7, 9]],
  [[0, 0, 15], [-14, 5, 11], [14, 5, 11], [0, -10, 12]],
];

function cloud(cx, cy, s, op, driftPx, driftDur, shape = 0) {
  const circles = CLOUD_SHAPES[shape].map(([x, y, r]) => [x * s, y * s, r * s]);
  const d = snap(Math.abs(driftPx)) * Math.sign(driftPx);
  const steps = ['0 0', `${d / 2} 0`, `${d} 0`, `${d / 2} 0`, '0 0'];
  return `<g transform="translate(${snap(cx)} ${snap(cy)})" opacity="${op}">
    ${animT('translate', steps, [0, 0.25, 0.5, 0.75, 1], driftDur, { additive: true, discrete: true })}
    ${rasterCircles(circles, C.cloud)}
  </g>`;
}

// stepped snow-capped triangle
function peakPx(cx, peakY, halfW) {
  const base = 330;
  let out = '';
  for (let y = snap(peakY); y < base; y += CELL) {
    const hw = snap(halfW * (y + CELL - peakY) / (base - peakY));
    if (hw <= 0) continue;
    const isSnow = y < peakY + 16;
    const isEdge = y >= peakY + 16 && y < peakY + 20;
    if (isEdge) {
      // zigzag snow boundary: alternate cells
      for (let x = cx - hw; x < cx + hw; x += CELL) {
        out += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${(Math.round(x / CELL) % 2 === 0) ? C.snow : C.mtn}"/>`;
      }
    } else {
      out += `<rect x="${cx - hw}" y="${y}" width="${2 * hw}" height="${CELL}" fill="${isSnow ? C.snow : C.mtn}"/>`;
    }
  }
  return out;
}

function forestPx(cx, topY) {
  return rasterCircles([[cx, topY + 26, 26], [cx - 34, topY + 34, 20], [cx + 34, topY + 34, 20]], C.forest1)
    + `<rect x="${snap(cx - 54)}" y="${snap(topY + 44)}" width="108" height="40" fill="${C.forest1}"/>`
    + `<rect x="${snap(cx - 34)}" y="${snap(topY + 36)}" width="68" height="8" fill="${C.forest2}"/>`;
}

function mountains() {
  return `<g opacity="0.65">
    ${peakPx(300, 254, 70)}
    ${forestPx(480, 264)}
    ${peakPx(742, 250, 84)}
    ${peakPx(802, 268, 56)}
    ${forestPx(885, 270)}
    ${peakPx(1135, 262, 64)}
  </g>`;
}

// pixel trees: c = cell size of the sprite (depth = smaller cells)
function tree(x, y, c, kind) {
  x = snap(x); y = snap(y);
  if (kind === 1) { // pine: stepped tiers
    return RX([
      [x - c / 2, y - c, c, c * 2.4, C.treeTrunk],
      [x - c / 2, y - c * 7, c, c, C.pine],
      [x - c * 1.5, y - c * 6, c * 3, c, C.pine],
      [x - c, y - c * 5, c * 2, c, C.pine],
      [x - c * 2.5, y - c * 4, c * 5, c, C.pine],
      [x - c * 1.5, y - c * 3, c * 3, c, C.pine],
      [x - c * 3.5, y - c * 2, c * 7, c, C.pine],
      [x - c * 2.5, y - c, c * 5, c * 0.0 + c, C.pine],
    ]);
  }
  if (kind === 2) { // oak
    return RX([
      [x - c / 2, y - c, c, c * 2.6, C.treeTrunk],
      [x - c * 1.5, y - c * 6, c * 3, c, C.treeB],
      [x - c * 2.5, y - c * 5, c * 5, c, C.treeB],
      [x - c * 3.5, y - c * 4, c * 7, c * 2, C.treeA],
      [x - c * 2.5, y - c * 2, c * 5, c, C.treeA],
    ]);
  }
  return RX([ // round
    [x - c / 2, y - c, c, c * 2.2, C.treeTrunk],
    [x - c, y - c * 5, c * 2, c, C.treeA],
    [x - c * 2, y - c * 4, c * 4, c * 2, C.treeA],
    [x - c, y - c * 2, c * 2, c, C.treeA],
  ]);
}

function daisy(x, y) {
  x = snap(x); y = snap(y);
  return RX([
    [x - 4, y, 12, 4, C.cloud], [x, y - 4, 4, 12, C.cloud], [x, y, 4, 4, C.candyGold],
  ]);
}

function sparkle(x, y, col, dur, begin) {
  x = snap(x); y = snap(y);
  return `<g opacity="0.4">
    ${anim('opacity', [0.15, 0.6, 0.15], [0, 0.5, 1], dur, { begin, discrete: true })}
    ${RX([[x - 6, y - 2, 12, 4, col], [x - 2, y - 6, 4, 12, col]])}
  </g>`;
}

function shootingStar() {
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push(`${snap(1185 - 32.3 * i)} ${snap(5 + 2.1 * i)}`);
  const kts = [0, 0.616];
  for (let i = 1; i <= 10; i++) kts.push(f(0.616 + 0.0032 * i));
  kts.push(1);
  return `
  <g opacity="0">
    ${anim('opacity', [0, 0, 0.95, 0.95, 0, 0], [0, 0.616, 0.622, 0.643, 0.649, 1], 47)}
    <g>
      ${animT('translate', [pts[0], ...pts, pts[10]], kts, 47, { discrete: true })}
      ${RX([
        [8, 0, 36, 4, C.cloud, 0.3], [4, 0, 24, 4, C.cloud, 0.6], [-4, -2, 8, 8, C.cloud],
      ])}
    </g>
  </g>`;
}

function scenery() {
  const trees = [
    [350, 300, 3, 1], [505, 298, 3, 0], [663, 300, 3, 2], [842, 298, 3, 1], [1112, 302, 3, 2],
    [418, 330, 5, 2], [590, 320, 4, 1], [752, 336, 5, 0], [902, 316, 4, 1],
  ].map(([x, y, c, k]) => tree(x, y, c, k)).join('');
  const daisies = [[342, 372], [520, 383], [702, 366], [880, 384], [148, 385]].map(([x, y]) => daisy(x, y)).join('');
  const sparkles = [
    sparkle(64, 146, C.glyph, 3.2, 0.4), sparkle(124, 64, '#FFFFFF', 4.1, 1.5),
    sparkle(1126, 132, C.glyph, 3.6, 0.9), sparkle(1172, 60, '#FFFFFF', 2.8, 2.2),
  ].join('');
  return `
  ${RX([
    [0, 0, 1200, 84, C.sky1], [0, 84, 1200, 84, C.sky2],
    [0, 168, 1200, 80, C.sky3], [0, 248, 1200, 68, C.sky4],
  ])}
  ${cloud(168, 54, 1.15, 0.95, 16, 34, 0)}
  ${cloud(452, 40, 1.3, 0.6, -16, 40, 1)}
  ${cloud(764, 52, 1.1, 0.85, 12, 28, 2)}
  ${cloud(1040, 38, 0.95, 0.55, -12, 31, 1)}
  ${cloud(612, 24, 0.75, 0.4, 8, 24, 2)}
  ${mountains()}
  ${RX([[0, 304, 1200, 96, C.grass]])}
  ${RX([
    [40, 300, 96, 4, C.grass], [200, 296, 140, 8, C.grass], [430, 300, 90, 4, C.grass],
    [640, 296, 120, 8, C.grass], [870, 300, 110, 4, C.grass], [1080, 298, 120, 6, C.grass],
  ])}
  ${trees}
  ${daisies}
  ${sparkles}
  ${shootingStar()}`;
}

// ---------------------------------------------------------------------------
// 3. Ground treats — pixel candy sprites
// ---------------------------------------------------------------------------
function candyPx(color, shade) {
  // pixel bonbon: rounded body + twist stems + wrapper flags
  return RX([
    [-10, -8, 20, 16, color], [-12, -4, 24, 8, color],
    [-10, 4, 20, 4, shade],
    [-16, -4, 4, 8, color],
    [-20, -10, 4, 10, color], [-20, 0, 4, 10, color],
    [12, -4, 4, 8, color],
    [16, -10, 4, 10, color], [16, 0, 4, 10, color],
  ]);
}

function groundTreats() {
  return `
  <g transform="translate(408 364)">${candyPx(C.candyGold, shadeOf(C.candyGold))}</g>
  <!-- candy cane: straight horizontal stripe cells -->
  <g transform="translate(496 356)">
    ${RX([
      [0, 0, 8, 36, '#FFFFFF'],
      [0, 4, 8, 4, C.caneRed], [0, 12, 8, 4, C.caneRed], [0, 20, 8, 4, C.caneRed], [0, 28, 8, 4, C.caneRed],
      [-8, -8, 12, 8, '#FFFFFF'], [-12, -4, 8, 8, C.caneRed], [-12, 0, 4, 8, '#FFFFFF'],
    ])}
  </g>
  <!-- lollipop -->
  <g transform="translate(648 360)">
    ${RX([
      [0, 12, 4, 16, C.stick],
      [-8, -8, 12, 16, C.candyViolet], [-4, -12, 8, 4, C.candyViolet], [-4, 8, 8, 4, C.candyViolet],
      [-8, 4, 12, 4, shadeOf(C.candyViolet)],
    ])}
  </g>
  <!-- bitten chocolate beside Codex -->
  <g transform="translate(928 368)">
    ${RX([
      [0, 0, 40, 20, C.choc],
      [32, 0, 8, 8, C.grass], [36, 8, 4, 4, C.grass],
      [12, 0, 4, 20, C.chocDark], [24, 0, 4, 20, C.chocDark], [0, 8, 40, 4, C.chocDark],
      [-8, -2, 10, 24, C.wrapPink], [-12, 2, 4, 16, C.wrapPink],
    ])}
  </g>`;
}
const shadeOf = (hex, k = 0.72) => '#' + hex.slice(1).match(/../g)
  .map((h) => Math.round(parseInt(h, 16) * k).toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------------------------------------------------------------------------
// 4. Clawd — quadrant body (already pixel art); legs swap to BENT pixel poses
//    during the lean; pixel mouth/cheek/eyes; pixel magnifier; stepped toss.
// ---------------------------------------------------------------------------
const EAT_DUR = 8;
// body WITHOUT any feet (feet are separate swappable sprites)
const CLAWD_BODY_NOFEET = 'M20,0 H140 V80 H20 Z';

function clawd() {
  // body slides sideways in cell steps (no rotation); legs r-bend instead
  const SHIFT_KT = [0, 0.04, 0.075, 0.105, 0.13, 0.155, 0.205, 0.235, 0.265, 0.285, 0.30, 1];
  const SHIFT_V = ['0 0', '0 0', '-4 0', '4 0', '8 0', '16 0', '16 0', '8 0', '4 0', '-4 0', '0 0', '0 0'];
  // the eating stump REACHES DOWN in pixel steps to the pile, then flicks
  const ARM_KT = [0, 0.04, 0.075, 0.105, 0.13, 0.155, 0.205, 0.235, 0.265, 0.30, 1];
  const ARM_V = ['0 0', '0 0', '0 8', '0 16', '0 24', '0 32', '0 32', '0 20', '0 8', '0 0', '0 0'];
  const FLIP_KT = [0, 0.30, 0.315, 0.345, 0.46, 1];
  const FLIP_V = [0, 0, 18, -55, 0, 0];

  // stepped toss: quad bezier (167,36.8)->(122,-34)->(80,53) sampled + snapped
  const FLY_PTS = ['168 36', '152 20', '140 8', '128 4', '116 8', '104 16', '92 32', '80 52'];
  const FLY_KT = [0, 0.336];
  for (let i = 1; i < 8; i++) FLY_KT.push(f(0.336 + i * 0.0055));
  FLY_KT.push(1);

  const candy = `${RX([
    [-10, -8, 20, 16, C.candy], [-12, -4, 24, 8, C.candy],
    [-10, 4, 20, 4, C.candyShade],
    [-16, -4, 4, 8, C.candy],
    [-20, -10, 4, 10, C.candy], [-20, 0, 4, 10, C.candy],
    [12, -4, 4, 8, C.candy],
    [16, -10, 4, 10, C.candy], [16, 0, 4, 10, C.candy],
  ])}`;

  const eatFlipper = `
    <g transform="translate(140 50)">
      <g>
        ${animT('translate', ARM_V, ARM_KT, EAT_DUR, { discrete: true })}
        <g>
        ${animT('rotate', FLIP_V, FLIP_KT, EAT_DUR, { discrete: true })}
        <rect x="-8" y="-10" width="28" height="20" fill="${C.coral}"/>
        <g transform="translate(30 0)">
          <g>
            ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.165, 0.175, 0.333, 0.336, 1], EAT_DUR)}
            ${candy}
          </g>
        </g>
        </g>
      </g>
    </g>`;

  // pixel magnifier held by the left stump
  const mag = `
    <g transform="translate(20 50)">
      <g>
        ${animT('rotate', [25, 28, 31, 28, 25], [0, 0.25, 0.5, 0.75, 1], 6, { discrete: true })}
        ${RX([[-38, -3, 10, 6, C.metal], [-30, -3, 10, 6, C.metal]])}
        <g transform="translate(-52 0)">
          ${RX([
            [-8, -20, 16, 4, C.metal], [-8, 16, 16, 4, C.metal],
            [-20, -8, 4, 16, C.metal], [16, -8, 4, 16, C.metal],
            [-16, -16, 8, 4, C.metal], [8, -16, 8, 4, C.metal],
            [-16, 12, 8, 4, C.metal], [8, 12, 8, 4, C.metal],
            [-16, -12, 4, 4, C.metal], [12, -12, 4, 4, C.metal],
            [-16, 8, 4, 4, C.metal], [12, 8, 4, 4, C.metal],
          ])}
          ${RX([
            [-16, -12, 32, 24, C.glass, 0.5], [-12, -16, 24, 4, C.glass, 0.5], [-12, 12, 24, 4, C.glass, 0.5],
            [-8, -8, 8, 4, '#FFFFFF', 0.7], [-12, -4, 4, 4, '#FFFFFF', 0.7],
          ])}
          <!-- sun catches the lens as he leans -->
          <g opacity="0">
            ${anim('opacity', [0, 0, 0.9, 0.35, 0, 0], [0, 0.147, 0.158, 0.205, 0.227, 1], EAT_DUR)}
            ${RX([[-16, -12, 32, 24, C.beamCore], [-12, -16, 24, 4, C.beamCore], [-12, 12, 24, 4, C.beamCore]])}
          </g>
          ${sparkle(2, 2, C.glyph, 3.4, 0)}
        </g>
        <rect x="-20" y="-10" width="28" height="20" fill="${C.coral}"/>
      </g>
    </g>`;

  // feet stay planted on the ground while the body slides; they swap to
  // r-shaped bent poses (top hooks toward the shift, like the Build Day
  // sprite), then snap straight when the body is back
  const FEET_X = [30, 50, 100, 120];
  const straightFeet = RX(FEET_X.map((x) => [x, 80, 10, 20, C.coral]));
  const bentFeet = RX(FEET_X.flatMap((x) => [
    [x + 8, 80, 10, 12, C.coral],
    [x, 90, 10, 10, C.coral],
  ]));
  const plantedFeet = `
    <g>
      ${anim('opacity', [1, 0, 1], [0, 0.07, 0.295], EAT_DUR, { discrete: true })}
      ${straightFeet}
    </g>
    <g>
      ${anim('opacity', [0, 1, 0], [0, 0.07, 0.295], EAT_DUR, { discrete: true })}
      ${bentFeet}
    </g>`;

  const body = `
    <g transform="translate(80 100)">
      <g>
        ${animT('scale', ['1 1', '1 1', '1.04 0.94', '0.98 1.03', '1 1', '1 1'], [0, 0.625, 0.655, 0.685, 0.715, 1], EAT_DUR, { discrete: true })}
        <g transform="translate(-80 -100)">
          <g>
            ${animT('translate', ['0 0', '0 0', '0 2', '0 0', '0 2', '0 0', '0 2', '0 0', '0 0'], [0, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 1], EAT_DUR, { additive: true, discrete: true })}
            <path d="${CLAWD_BODY_NOFEET}" fill="${C.coral}"/>
            <!-- pixel cheek bulge: stepped backwards-C, popping with the chews -->
            <g opacity="0">
              ${anim('opacity', [0, 0, 1, 0, 1, 0, 1, 0, 0], [0, 0.445, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 1], EAT_DUR, { discrete: true })}
              ${RX([[100, 44, 6, 5, C.ink], [104, 49, 5, 9, C.ink], [100, 58, 6, 5, C.ink]])}
            </g>
            <!-- eyes: tall quadrant rects; squeeze + stay shut after the gulp -->
            <g>
              ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.643, 0.658, 0.868, 0.883, 1], EAT_DUR)}
              <rect x="40" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28, 28, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR, { discrete: true })}
                ${anim('height', [20, 20, 4, 4, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR, { discrete: true })}
              </rect>
              <rect x="110" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28, 28, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR, { discrete: true })}
                ${anim('height', [20, 20, 4, 4, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR, { discrete: true })}
              </rect>
            </g>
            <!-- closed content-eyes: stepped pixel arcs -->
            <g opacity="0">
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.645, 0.66, 0.866, 0.881, 1], EAT_DUR)}
              ${RX([
                [36, 29, 5, 4, C.ink], [40, 26, 10, 4, C.ink], [49, 29, 5, 4, C.ink],
                [106, 29, 5, 4, C.ink], [110, 26, 10, 4, C.ink], [119, 29, 5, 4, C.ink],
              ])}
            </g>
            <!-- mouth: pixel rect, opens to catch, chews in steps -->
            <rect x="72" width="16" y="55" height="0" fill="${C.ink}">
              ${anim('y', [55, 55, 44, 44, 52, 48, 52, 48, 52, 48, 52, 53, 55, 55], [0, 0.295, 0.315, 0.375, 0.40, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 0.64, 1], EAT_DUR, { discrete: true })}
              ${anim('height', [0, 0, 22, 22, 6, 14, 6, 14, 6, 14, 6, 4, 0, 0], [0, 0.295, 0.315, 0.375, 0.40, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 0.64, 1], EAT_DUR, { discrete: true })}
            </rect>
          </g>
        </g>
      </g>
    </g>`;

  const flyingCandy = `
    <g opacity="0">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.336, 0.339, 0.378, 0.382, 1], EAT_DUR)}
      <g>
        ${animT('translate', [FLY_PTS[0], ...FLY_PTS, FLY_PTS[7]], FLY_KT, EAT_DUR, { discrete: true })}
        <g>
          ${animT('rotate', [0, 0, 90, 180, 270, 270], [0, 0.336, 0.347, 0.358, 0.369, 1], EAT_DUR, { discrete: true })}
          ${candy}
        </g>
      </g>
    </g>`;

  return `
  <rect x="104" y="350" width="128" height="6" fill="${C.shadow}" opacity="0.18">
    ${anim('x', [104, 104, 112, 112, 104, 104], [0, 0.075, 0.16, 0.21, 0.305, 1], EAT_DUR, { discrete: true })}
    ${anim('width', [128, 128, 116, 116, 128, 128], [0, 0.075, 0.16, 0.21, 0.305, 1], EAT_DUR, { discrete: true })}
  </rect>
  <g transform="translate(88 252)">
    ${animT('translate', ['0 0', '0 -4', '0 0'], [0, 0.5, 1], 5.3, { additive: true, discrete: true })}
    ${plantedFeet}
    <g>
      ${animT('translate', SHIFT_V, SHIFT_KT, EAT_DUR, { discrete: true })}
      ${mag}
      ${body}
      ${eatFlipper}
    </g>
    ${flyingCandy}
  </g>
  <!-- candy pile; he takes the top one each cycle -->
  <g>
    <rect x="248" y="350" width="48" height="5" fill="${C.shadow}" opacity="0.2"/>
    <g transform="translate(258 346)">${candyPx(C.candyViolet, shadeOf(C.candyViolet))}</g>
    <g transform="translate(286 345)">${candyPx(C.candyMint, shadeOf(C.candyMint))}</g>
    <g transform="translate(272 333)">
      <g>
        ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.16, 0.17, 0.93, 0.96, 1], EAT_DUR)}
        ${candy}
      </g>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 5. Death ray — staircase pixel beam, 2-frame pixel fire
// ---------------------------------------------------------------------------
function deathRay() {
  let beam = '';
  for (let i = 0; i < 7; i++) {
    const x = snap(70 - 7.5 * i), y = snap(274 + 1.9 * i);
    beam += `<rect x="${x - 4}" y="${y - 4}" width="16" height="16" fill="${C.beam}"/>`;
    beam += `<rect x="${x}" y="${y}" width="8" height="8" fill="${C.beamCore}"/>`;
  }
  const flameA = RX([
    [20, 282, 20, 10, C.flame1], [24, 274, 12, 8, C.flame1], [28, 266, 6, 8, C.flame2], [26, 280, 10, 8, C.flame2],
  ]);
  const flameB = RX([
    [20, 284, 20, 8, C.flame1], [22, 274, 14, 10, C.flame1], [24, 264, 6, 10, C.flame2], [30, 278, 8, 10, C.flame2],
  ]);
  return `
  <!-- victim tree (pixel) -->
  <g>
    ${tree(30, 304, 4, 0)}
    <g opacity="0">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.185, 0.2, 0.935, 0.965, 1], EAT_DUR)}
      ${RX([
        [22, 280, 16, 8, C.char], [14, 284, 32, 12, C.char], [22, 296, 16, 4, C.char],
        [28, 300, 8, 9, C.treeTrunk],
      ])}
    </g>
  </g>
  <!-- sun ray in (off-screen sun) -->
  <g opacity="0">
    ${anim('opacity', [0, 0, 0.42, 0.42, 0, 0], [0, 0.14, 0.155, 0.215, 0.235, 1], EAT_DUR)}
    ${RX([[68, 0, 4, 272, '#FFF6C9', 0.5], [72, 0, 8, 272, '#FFF6C9'], [80, 0, 4, 272, '#FFF6C9', 0.5]])}
  </g>
  <!-- staircase death ray -->
  <g opacity="0">
    ${anim('opacity', [0, 0, 0.9, 0.65, 0.9, 0.6, 0.9, 0, 0], [0, 0.153, 0.162, 0.175, 0.188, 0.2, 0.212, 0.23, 1], EAT_DUR)}
    ${beam}
  </g>
  <!-- 2-frame pixel fire -->
  <g opacity="0">
    ${anim('opacity', [0, 0, 1, 1, 0.65, 0, 0], [0, 0.175, 0.195, 0.598, 0.678, 0.738, 1], EAT_DUR)}
    <g>
      ${anim('opacity', [1, 0, 1], [0, 0.5, 1], 0.5, { discrete: true })}
      ${flameA}
    </g>
    <g>
      ${anim('opacity', [0, 1, 0], [0, 0.5, 1], 0.5, { discrete: true })}
      ${flameB}
    </g>
  </g>
  <!-- pixel smoke -->
  <g fill="${C.smoke}">
    <g opacity="0">
      ${anim('opacity', [0, 0, 0.55, 0.45, 0, 0], [0, 0.518, 0.598, 0.798, 0.868, 1], EAT_DUR)}
      <g>
        ${animT('translate', ['0 0', '0 0', '0 -8', '0 -16', '0 -24', '0 -32', '0 -32'], [0, 0.518, 0.6, 0.68, 0.76, 0.84, 1], EAT_DUR, { discrete: true })}
        <rect x="26" y="276" width="10" height="10"/>
      </g>
    </g>
    <g opacity="0">
      ${anim('opacity', [0, 0, 0.5, 0.4, 0, 0], [0, 0.598, 0.678, 0.838, 0.898, 1], EAT_DUR)}
      <g>
        ${animT('translate', ['0 0', '0 0', '0 -8', '0 -16', '0 -24', '0 -24'], [0, 0.598, 0.69, 0.78, 0.87, 1], EAT_DUR, { discrete: true })}
        <rect x="34" y="282" width="8" height="8"/>
      </g>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 6. Codex — rasterised pixel cloud head (banded shading), pixel >_< face,
//    stepped body, profile lotus, pixel laptop, stepped typing.
// ---------------------------------------------------------------------------
function codexHead() {
  const lobes = [
    [-17.2, -123.9, 19.1], [8.7, -121, 18.1], [26.9, -101.9, 17.6], [20, -77.4, 18.6],
    [-6.5, -68.1, 18.1], [-31.4, -80.3, 17.6], [-40.3, -106.3, 17.2], [-4, -96, 27],
  ];
  // banded "gradient": clip the raster into three horizontal colour bands
  const raster = (fill) => rasterCircles(lobes, fill);
  return `
  <g>
    ${animT('rotate', ['-2', '0', '-2'], [0, 0.5, 1], 0.55, { discrete: true })}
    ${C.coxBands.map((col, i) => `<g clip-path="url(#coxB${i})">${raster(col)}</g>`).join('')}
    <!-- pixel >_< : blocks; squint = squashed swap during the manic episode -->
    <g>
      ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.495, 0.505, 0.63, 0.64, 1], 37, { discrete: true })}
      ${RX([
        [-28, -106, 6, 6, '#FFFFFF'], [-22, -100, 6, 6, '#FFFFFF'], [-28, -94, 6, 6, '#FFFFFF'],
        [14, -106, 6, 6, '#FFFFFF'], [8, -100, 6, 6, '#FFFFFF'], [14, -94, 6, 6, '#FFFFFF'],
      ])}
    </g>
    <g opacity="0">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.495, 0.505, 0.63, 0.64, 1], 37, { discrete: true })}
      ${RX([
        [-28, -103, 6, 4, '#FFFFFF'], [-22, -100, 6, 4, '#FFFFFF'], [-28, -97, 6, 4, '#FFFFFF'],
        [14, -103, 6, 4, '#FFFFFF'], [8, -100, 6, 4, '#FFFFFF'], [14, -97, 6, 4, '#FFFFFF'],
      ])}
    </g>
    <!-- mouth dash <-> worried pixel zigzag -->
    <g>
      ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.495, 0.505, 0.63, 0.64, 1], 37, { discrete: true })}
      <rect x="-12" y="-80" width="16" height="5" fill="#FFFFFF">
        ${anim('height', [5, 5, 3, 5, 3, 5, 5], [0, 0.55, 0.62, 0.69, 0.76, 0.83, 1], 2.8, { discrete: true })}
      </rect>
    </g>
    <g opacity="0">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.495, 0.505, 0.63, 0.64, 1], 37, { discrete: true })}
      ${RX([
        [-12, -80, 5, 4, '#FFFFFF'], [-7, -83, 5, 4, '#FFFFFF'], [-2, -80, 5, 4, '#FFFFFF'], [3, -83, 5, 4, '#FFFFFF'],
      ])}
    </g>
    <!-- chocolate smudges -->
    ${RX([
      [-17, -74, 6, 4, C.chocSmudge], [6, -76, 5, 4, C.chocSmudge],
      [-4, -71, 7, 4, '#8A5A33'], [2, -83, 4, 3, C.chocSmudge],
    ])}
  </g>`;
}

function codex() {
  const typing = (phase) => animT('translate', phase ? ['0 -4', '0 0'] : ['0 0', '0 -4'], [0, 0.5], 0.21, { additive: true, discrete: true });
  const manic = animT('translate',
    ['0 0', '0 0', '0 -3', '0 1', '0 -3', '0 1', '0 -3', '0 1', '0 -3', '0 1', '0 -3', '0 1', '0 0', '0 0'],
    [0, 0.5, 0.511, 0.522, 0.533, 0.544, 0.555, 0.566, 0.577, 0.588, 0.599, 0.61, 0.635, 1], 37, { additive: true, discrete: true });
  return `
  <rect x="976" y="350" width="124" height="6" fill="${C.shadow}" opacity="0.18"/>
  <g transform="translate(1042 352)">
    ${animT('translate', ['0 0', '0 -2', '0 0'], [0, 0.5, 1], 3.1, { additive: true, discrete: true })}
    <g>
      ${animT('translate', ['0 0', '0 0', '2 0', '-2 0', '2 0', '0 0', '0 0'], [0, 0.85, 0.875, 0.9, 0.925, 0.95, 1], 3.4, { additive: true, discrete: true })}

      <!-- body: stepped corners, two shade bands -->
      ${RX([
        [-24, -52, 48, 4, C.coxBodyHi], [-28, -48, 56, 18, C.coxBodyHi],
        [-28, -30, 56, 22, C.coxBodyLo], [-24, -8, 48, 4, C.coxBodyLo],
      ])}
      <!-- profile lotus: chunky folded bars under the lap, knees front -->
      ${RX([
        [-34, -16, 34, 7, C.coxLimbFar], [-38, -13, 7, 8, C.coxLimbFar],
        [-34, -9, 38, 7, C.coxLimbFar], [0, -7, 10, 6, C.coxLimbFar],
      ])}
      ${RX([
        [-30, -13, 32, 7, C.coxLimb], [-34, -10, 7, 8, C.coxLimb],
        [-30, -6, 30, 7, C.coxLimb], [-40, -10, 11, 7, C.coxLimb],
      ])}

      <!-- pixel laptop: tall screen, longer deck -->
      ${RX([
        [-66, -62, 8, 46, C.lap], [-58, -58, 2, 38, C.screenGlow],
        [-64, -22, 56, 7, C.lap], [-64, -22, 56, 2, C.lapHi],
      ])}

      <!-- arms + square hands hammering in steps -->
      ${RX([[-18, -42, 8, 7, C.coxLimbFar], [-26, -37, 8, 7, C.coxLimbFar], [-34, -32, 8, 7, C.coxLimbFar]])}
      <g>${typing(0)}${manic}${RX([[-50, -30, 10, 9, C.coxLimbFar]])}</g>
      ${RX([[-9, -38, 7, 7, C.coxLimb], [-16, -33, 7, 7, C.coxLimb], [-22, -29, 7, 7, C.coxLimb]])}
      <g>${typing(1)}${manic}${RX([[-32, -28, 10, 9, C.coxLimb]])}</g>

      ${codexHead()}

      <!-- sugar-rush pixel sparks -->
      <g>
        <g opacity="0.9">${anim('opacity', [0, 1, 0], [0, 0.4, 1], 1.6, { discrete: true })}${RX([[44, -136, 4, 12, C.candyGold], [40, -132, 12, 4, C.candyGold]])}</g>
        <g opacity="0">${anim('opacity', [0, 1, 0], [0, 0.4, 1], 1.6, { begin: 0.8, discrete: true })}${RX([[56, -112, 4, 8, C.candyGold], [54, -110, 8, 4, C.candyGold]])}</g>
        <g opacity="0">
          ${anim('opacity', [0, 0, 1, 0, 1, 0, 1, 0, 0], [0, 0.5, 0.515, 0.53, 0.545, 0.56, 0.575, 0.605, 1], 37, { discrete: true })}
          ${RX([[32, -148, 4, 12, C.candyGold], [28, -144, 12, 4, C.candyGold]])}
        </g>
      </g>
    </g>
  </g>
  ${wrapperMound()}`;
}

// pixel wrapper: centre block + corner blocks (bow shape)
function wrapperPx(x, y, col, big = false) {
  x = snap(x); y = snap(y);
  const s = big ? 1 : 0.999;
  return RX([
    [x - 6, y - 5, 12, 10, col],
    [x - 13, y - 8, 7, 6, col], [x - 13, y + 2, 7, 6, col],
    [x + 6, y - 8, 7, 6, col], [x + 6, y + 2, 7, 6, col],
    [x - 2, y - 5, 4, 10, shadeOf(col)],
  ]).replace('SCALE', String(s));
}

function wrapperMound() {
  const cols = [C.wrapPink, C.candyViolet, C.candyGold, C.candyMint, C.candyOrange, C.candy];
  const rows = [
    { y: 380, n: 6, x0: 1072 }, { y: 370, n: 5, x0: 1082 }, { y: 360, n: 4, x0: 1092 },
    { y: 350, n: 3, x0: 1100 }, { y: 342, n: 2, x0: 1110 }, { y: 334, n: 1, x0: 1118 },
  ];
  let out = `<rect x="1058" y="380" width="120" height="6" fill="${C.shadow}" opacity="0.16"/>`;
  let i = 0;
  for (const row of rows)
    for (let k = 0; k < row.n; k++)
      out += wrapperPx(row.x0 + k * 19, row.y, cols[i++ % cols.length]);
  out += wrapperPx(1000, 374, C.candyMint);
  out += wrapperPx(1034, 380, C.candyGold);
  out += wrapperPx(966, 379, C.candyViolet);
  out += wrapperPx(1054, 384, C.candyOrange);
  out += `<g opacity="0">
    ${anim('opacity', [0, 0, 1, 1, 1, 0], [0, 0.6, 0.63, 0.93, 0.985, 1], 9)}
    <g>
      ${animT('translate', ['1118 326', '1118 326', '1106 338', '1090 352', '1076 364', '1068 370', '1068 370'], [0, 0.6, 0.66, 0.72, 0.78, 0.84, 1], 9, { discrete: true })}
      ${wrapperPx(0, 0, C.candy)}
    </g>
  </g>`;
  return out;
}

// ---------------------------------------------------------------------------
// 7. Assemble
// ---------------------------------------------------------------------------
const headBandClips = `
    <clipPath id="coxB0"><rect x="-70" y="-152" width="140" height="24"/></clipPath>
    <clipPath id="coxB1"><rect x="-70" y="-128" width="140" height="20"/></clipPath>
    <clipPath id="coxB2"><rect x="-70" y="-108" width="140" height="20"/></clipPath>
    <clipPath id="coxB3"><rect x="-70" y="-88" width="140" height="24"/></clipPath>
    <clipPath id="coxB4"><rect x="-70" y="-64" width="140" height="20"/></clipPath>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" shape-rendering="crispEdges" aria-label="sweet-search — pixel-art Clawd and Codex around the SWEET SEARCH terminal banner">
  <title>sweet-search (pixelated)</title>
  <defs>
    <linearGradient id="candySweepGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.candyViolet}" stop-opacity="0"/>
      <stop offset="15%" stop-color="${C.candyViolet}" stop-opacity="1"/>
      <stop offset="38%" stop-color="${C.candyMint}" stop-opacity="1"/>
      <stop offset="60%" stop-color="${C.candyGold}" stop-opacity="1"/>
      <stop offset="85%" stop-color="${C.candy}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${C.candy}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.85"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="artClip">${artRuns()}</clipPath>
    <clipPath id="panelClip">${pixelPanelRects(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 'x').replace(/fill="x"/g, '')}</clipPath>
    ${headBandClips}
    <clipPath id="frame">${pixelPanelRects(4, 4, 1192, 392, 'x').replace(/fill="x"/g, '')}</clipPath>
  </defs>

  <g clip-path="url(#frame)">
    ${scenery()}
    ${groundTreats()}
    ${deathRay()}
    ${bannerPanel()}
    ${clawd()}
    ${codex()}
  </g>
  <!-- stepped pixel frame border -->
  <g fill="${C.band4}">
    ${RX([
      [12, 0, 1176, 6, C.band4], [12, 394, 1176, 6, C.band4],
      [0, 12, 6, 376, C.band4], [1194, 12, 6, 376, C.band4],
      [6, 6, 10, 6, C.band4], [4, 10, 6, 8, C.band4],
      [1184, 6, 10, 6, C.band4], [1190, 10, 6, 8, C.band4],
      [6, 388, 10, 6, C.band4], [4, 382, 6, 8, C.band4],
      [1184, 388, 10, 6, C.band4], [1190, 382, 6, 8, C.band4],
    ])}
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, 'utf8');
console.log(`wrote ${OUT}  (${svg.length} bytes${FREEZE ? `, frozen at t=${FREEZE}s` : ''})`);
