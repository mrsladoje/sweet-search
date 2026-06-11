#!/usr/bin/env node
/**
 * gen-banner-svg.mjs — animated README hero banner for sweet-search.
 *
 * Composition (1200x400, daytime pastoral scene):
 *   - blue sky, drifting clouds (3 shapes), far hills + tiny trees, green field
 *   - CENTER: the real CLI banner — purple (#5A73DC) SWEET SEARCH half-block
 *             art on the dark-navy gradient band, exactly like the printout
 *   - LEFT  : Clawd (Claude Code mascot, exact terminal-quadrant silhouette,
 *             mono #D77757). His side STUMPS are the arms: he tips over to
 *             pick a candy off the pile with the right stump, rocks back,
 *             flicks it in a parabolic toss into his mouth, chews (animated
 *             ink mouth + ink cheek bump), gulps, smiles. The left stump
 *             holds the magnifying glass directly.
 *   - RIGHT : Codex (official OpenAI cloud, exact logo path) facing the
 *             viewer with a >_< sugar-rush face (mirrored official chevron =
 *             second eye, official dash recentred = mouth, chocolate smudges),
 *             body side-on typing on an L-shaped laptop, wrapper mountain.
 *
 * All animation is SMIL (GitHub strips <script> from README <img> SVGs; SMIL
 * plays fine through the camo proxy).
 *
 *   node scripts/gen-banner-svg.mjs                  -> assets/sweet-search-banner.svg
 *   node scripts/gen-banner-svg.mjs --at 2.1 --out /tmp/f.svg
 *       freeze-frame QA: animations are evaluated in JS at t=2.1s and emitted
 *       as static <set>/single-value transforms, so any renderer shows the
 *       exact pose (no dependence on the renderer's SMIL clock).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CLI flags -------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const FREEZE = parseFloat(flag('--at') || '0') || 0; // freeze-frame time (QA)
const OUT = resolve(flag('--out') || resolve(__dirname, '..', 'assets', 'sweet-search-banner.svg'));

const f = (n) => {
  const r = Number(n.toFixed(2));
  return Object.is(r, -0) ? 0 : r;
};

// darker tone of a hex colour (flat-design borders)
const shade = (hex, k = 0.72) => '#' + hex.slice(1).match(/../g)
  .map((h) => Math.round(parseInt(h, 16) * k).toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  // scene
  skyTop: '#69B4E8', skyMid: '#A9D9F6', skyLow: '#EAF7F0',
  cloud: '#FFFFFF',
  grass: '#79C26B',
  treeTrunk: '#7E5A40', treeA: '#54A55A', treeB: '#62B364',
  // CLI banner band (cli-decoration.js STYLE.colors, edge -> center)
  band0: '#060A1F', band1: '#0A1134', band2: '#0E1849', band4: '#162874',
  // glyphs = STYLE.colors.border (#5A73DC), bold purple
  glyphHi: '#8CA0F0', glyph: '#5A73DC', glyphLo: '#4557C5',
  // Clawd (claude-code cli.js: rgb(215,119,87))
  coral: '#D77757', ink: '#20201E',
  // candy
  candy: '#FF5BA3', wrapPink: '#FF97C2',
  candyMint: '#3FD08F', candyViolet: '#A78BFA', candyGold: '#FFC247', candyOrange: '#FF8A5C',
  // Codex (official logo gradient #B1A7FF -> #7A9DFF -> #3941FF)
  coxTop: '#B1A7FF', coxMid: '#7A9DFF', coxLow: '#3941FF',
  coxBody1: '#7A9DFF', coxBody2: '#4549EE',
  coxLimb: '#515FF2', coxLimbFar: '#3A43D6', coxLimbEdge: '#2F36BE',
  // laptop
  lap: '#262B40', lapHi: '#4A5378', screen: '#2A2F45', screenGlow: '#9FE8FF',
  choc: '#6B4226', chocHi: '#8A5A33',
};

// deterministic RNG (stable output across regenerations)
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const rnd = lcg(0x5EE75);
const rr = (a, b) => a + (b - a) * rnd();

// ---------------------------------------------------------------------------
// SMIL helpers. Normal mode emits looping <animate>/<animateTransform>.
// Freeze mode (--at T) evaluates the keyframes at T and emits constants, so
// QA screenshots are exact regardless of the renderer's animation clock.
// ---------------------------------------------------------------------------
function evalAt(values, keyTimes, dur, begin) {
  const local = FREEZE - begin;
  const frac = (((local % dur) + dur) % dur) / dur;
  const vecs = values.map((v) => String(v).trim().split(/\s+/).map(Number));
  let i = keyTimes.length - 2;
  for (let k = 0; k < keyTimes.length - 1; k++) {
    if (frac >= keyTimes[k] && frac <= keyTimes[k + 1]) { i = k; break; }
  }
  const span = keyTimes[i + 1] - keyTimes[i] || 1;
  const t = Math.min(1, Math.max(0, (frac - keyTimes[i]) / span));
  return vecs[i].map((a, j) => f(a + (vecs[i + 1][j] - a) * t)).join(' ');
}

function anim(attr, values, keyTimes, dur, opts = {}) {
  const begin = opts.begin || 0;
  if (FREEZE) return `<set attributeName="${attr}" to="${evalAt(values, keyTimes, dur, begin)}"/>`;
  const spline = opts.splines
    ? ` calcMode="spline" keySplines="${opts.splines.join(';')}"`
    : '';
  return `<animate attributeName="${attr}" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" dur="${dur}s"${spline} begin="${begin}s" repeatCount="indefinite"/>`;
}

function animT(type, values, keyTimes, dur, opts = {}) {
  const begin = opts.begin || 0;
  if (FREEZE) {
    if (opts.additive) return ''; // decorative bob/drift/jitter: skip in stills
    return `<animateTransform attributeName="transform" type="${type}" values="${evalAt(values, keyTimes, dur, begin)}" dur="1s" fill="freeze" repeatCount="1"/>`;
  }
  const spline = opts.splines
    ? ` calcMode="spline" keySplines="${opts.splines.join(';')}"`
    : '';
  const add = opts.additive ? ' additive="sum"' : '';
  return `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" dur="${dur}s"${spline}${add} begin="${begin}s" repeatCount="indefinite"/>`;
}

// capsule limb with a darker outline (two stacked round-cap lines)
function limb(x1, y1, x2, y2, w, fill, edge) {
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${edge}" stroke-width="${f(w + 3)}" stroke-linecap="round"/>`
    + `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${fill}" stroke-width="${f(w)}" stroke-linecap="round"/>`;
}

// wrapped candy (centred on 0,0) — flat: solid colour + darker border
function candyArt(color, s = 1) {
  return `<g${s !== 1 ? ` transform="scale(${s})"` : ''} stroke="${shade(color)}" stroke-width="1.5" stroke-linejoin="round">
    <path d="M-5.6,0 L-12.5,-5.2 L-12.5,5.2 Z" fill="${color}"/>
    <path d="M5.6,0 L12.5,-5.2 L12.5,5.2 Z" fill="${color}"/>
    <ellipse rx="6.6" ry="5.2" fill="${color}"/>
  </g>`;
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

// merged horizontal runs -> solid letterforms exactly like the terminal print
const PW = 16, PH = 16.5;
const artW = bmp.W * PW, artH = bmp.H * PH;
const PANEL = { w: artW + 68, h: artH + 56, x: 0, y: 77, rx: 14 };
PANEL.x = (1200 - PANEL.w) / 2;
const BX = 600 - artW / 2, BY = PANEL.y + (PANEL.h - artH) / 2;

function artRuns() {
  let out = '';
  for (let r = 0; r < bmp.H; r++) {
    let c = 0;
    while (c < bmp.W) {
      if (!bmp.rows[r][c]) { c++; continue; }
      let c2 = c;
      while (c2 + 1 < bmp.W && bmp.rows[r][c2 + 1]) c2++;
      // +0.6 vertical overlap kills antialias seams between rows
      out += `<rect x="${f(BX + c * PW)}" y="${f(BY + r * PH - 0.3)}" width="${f((c2 - c + 1) * PW)}" height="${f(PH + 0.6)}" rx="1.5"/>`;
      c = c2 + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Scenery
// ---------------------------------------------------------------------------
const CLOUD_SHAPES = [
  // classic cumulus
  [[0, 0, 22], [-24, 6, 15], [24, 6, 15], [-12, -10, 14], [13, -9, 15], [38, 9, 10]],
  // long, flat stratus
  [[0, 0, 16], [-30, 4, 12], [28, 4, 13], [-14, -8, 12], [12, -8, 13], [46, 7, 9], [-46, 7, 9]],
  // small round puff
  [[0, 0, 15], [-14, 5, 11], [14, 5, 11], [0, -10, 12]],
];

function cloud(cx, cy, s, op, driftPx, driftDur, shape = 0) {
  const body = CLOUD_SHAPES[shape]
    .map(([x, y, r]) => `<circle cx="${f(x * s)}" cy="${f(y * s)}" r="${f(r * s)}"/>`).join('');
  return `<g transform="translate(${cx} ${cy})" fill="${C.cloud}" opacity="${op}">
    ${animT('translate', [`0 0`, `${driftPx} 0`, `0 0`], [0, 0.5, 1], driftDur, { additive: true, splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    ${body}
  </g>`;
}

// three tree species so the treeline reads naturally
function tree(x, y, s, kind = 0) {
  if (kind === 1) { // pine (trunk overlaps the foliage so there is no gap)
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-1.6" y="-6" width="3.2" height="11" rx="1.2" fill="${C.treeTrunk}"/>
      <path d="M0,-26 L7,-14 L3.5,-14 L9,-4 L-9,-4 L-3.5,-14 L-7,-14 Z" fill="#3E8C52"/>
    </g>`;
  }
  if (kind === 2) { // bushy oak
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-1.8" y="-4" width="3.6" height="9" rx="1.4" fill="${C.treeTrunk}"/>
      <circle cx="0" cy="-13" r="7.5" fill="${C.treeB}"/>
      <circle cx="-6.5" cy="-8.5" r="5.5" fill="${C.treeA}"/>
      <circle cx="6.5" cy="-8.5" r="5.5" fill="${C.treeB}"/>
      <circle cx="0" cy="-6.5" r="6" fill="${C.treeA}"/>
    </g>`;
  }
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-1.6" y="-3" width="3.2" height="8" rx="1.2" fill="${C.treeTrunk}"/>
    <circle cx="0" cy="-9" r="6.4" fill="${C.treeA}"/>
    <circle cx="-4.8" cy="-5.5" r="4.6" fill="${C.treeA}"/>
    <circle cx="4.8" cy="-5.5" r="4.6" fill="${C.treeA}"/>
  </g>`;
}

// translucent far range behind the main hill: snow-capped peaks (singles and
// a twin range) plus dense forested humps — short, so the sky keeps dominating
function mountains() {
  // clean triangle + a snowcap whose edges sit exactly on the ridges (no grey
  // sliver peeking past the snow)
  const peak = (cx, peakY, halfW) => {
    const H = 330 - peakY, d = 18;
    const lx = cx - halfW * d / H - 0.8, rx2 = cx + halfW * d / H + 0.8;
    const zz = [];
    for (let i = 1; i <= 4; i++) {
      const x = lx + (rx2 - lx) * i / 5;
      zz.push(`${f(x)},${f(peakY + d - (i % 2 ? 6 : 1.5))}`);
    }
    return `<polygon points="${cx - halfW},330 ${cx},${peakY} ${cx + halfW},330" fill="#8E9BAA"/>
    <polygon points="${cx},${peakY} ${f(lx)},${peakY + d} ${zz.join(' ')} ${f(rx2)},${peakY + d}" fill="#F4F8FB"/>`;
  };
  const forest = (cx, topY) => `
    <circle cx="${cx}" cy="${topY + 26}" r="26" fill="#56975F"/>
    <circle cx="${cx - 34}" cy="${topY + 34}" r="20" fill="#4E8D58"/>
    <circle cx="${cx + 34}" cy="${topY + 34}" r="20" fill="#4E8D58"/>
    <rect x="${cx - 54}" y="${topY + 44}" width="108" height="40" fill="#56975F"/>`;
  return `<g opacity="0.65">
    ${peak(300, 254, 70)}
    ${forest(480, 264)}
    ${peak(742, 250, 84)}
    ${peak(802, 268, 56)}
    ${forest(885, 270)}
    ${peak(1135, 262, 64)}
  </g>`;
}

function daisy(x, y) {
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    petals += `<circle cx="${f(Math.cos(a) * 2.6)}" cy="${f(Math.sin(a) * 2.6)}" r="1.5" fill="#FFFFFF"/>`;
  }
  return `<g transform="translate(${x} ${y})" opacity="0.85">${petals}<circle r="1.4" fill="${C.candyGold}"/></g>`;
}

function sparkle(x, y, sc, col, dur, begin) {
  return `<path transform="translate(${x} ${y}) scale(${sc})" fill="${col}" opacity="0.4"
    d="M0,-4 L1.1,-1.1 L4,0 L1.1,1.1 L0,4 L-1.1,1.1 L-4,0 L-1.1,-1.1 Z">
    ${anim('opacity', [0.12, 0.6, 0.12], [0, 0.5, 1], dur, { begin })}
  </path>`;
}

function scenery() {
  // far trees sit high on the horizon, near trees lower in the field and
  // larger — irregular spacing, mixed species
  const trees = [
    [350, 299, 0.95, 1], [505, 297, 0.85, 0], [663, 300, 1.0, 2], [842, 298, 0.9, 1], [1112, 301, 0.95, 2],
    [418, 330, 1.55, 2], [590, 320, 1.45, 1], [752, 336, 1.65, 0], [902, 316, 1.25, 1],
  ].map(([x, y, s, k]) => tree(x, y, s, k)).join('');
  const daisies = [[342, 372], [520, 383], [702, 366], [880, 384], [148, 385]].map(([x, y]) => daisy(x, y)).join('');
  const sparkles = [
    sparkle(64, 146, 0.9, C.glyph, 3.2, 0.4), sparkle(124, 64, 0.7, '#FFFFFF', 4.1, 1.5),
    sparkle(1126, 132, 0.85, C.glyph, 3.6, 0.9), sparkle(1172, 60, 0.65, '#FFFFFF', 2.8, 2.2),
  ].join('');
  return `
  <!-- sky -->
  <rect width="1200" height="400" fill="url(#skyGrad)"/>
  <!-- clouds (3 shapes, bigger, some translucent, drifting gently) -->
  ${cloud(168, 54, 1.15, 0.95, 16, 34, 0)}
  ${cloud(452, 40, 1.3, 0.6, -14, 40, 1)}
  ${cloud(764, 52, 1.1, 0.85, 12, 28, 2)}
  ${cloud(1040, 38, 0.95, 0.55, -10, 31, 1)}
  ${cloud(612, 24, 0.75, 0.4, 8, 24, 2)}
  <!-- translucent mountain range behind the hills -->
  ${mountains()}
  <!-- far hills + field (flat single green; shapes unchanged) -->
  <path d="M0,312 C150,296 290,305 430,301 C570,297 700,308 845,301 C985,295 1100,305 1200,300 L1200,340 L0,340 Z" fill="${C.grass}"/>
  <path d="M0,322 C180,308 340,316 520,311 C700,306 880,316 1040,310 C1110,308 1160,311 1200,310 L1200,350 L0,350 Z" fill="${C.grass}"/>
  <rect x="0" y="316" width="1200" height="84" fill="${C.grass}"/>
  ${trees}
  ${daisies}
  ${sparkles}`;
}

// ---------------------------------------------------------------------------
// 3. Center: the printed CLI banner — navy band + purple half-block art
// ---------------------------------------------------------------------------
function bannerPanel() {
  return `
  <g>
    ${animT('translate', ['0 0', '0 -2.5', '0 0'], [0, 0.5, 1], 7, { splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    <rect x="${f(PANEL.x + 4)}" y="${f(PANEL.y + 10)}" width="${PANEL.w - 8}" height="${PANEL.h}" rx="${PANEL.rx}" fill="#0A1134" opacity="0.3" filter="url(#softBlur)"/>
    <rect x="${f(PANEL.x)}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="${PANEL.rx}" fill="url(#bandGrad)" stroke="${C.glyph}" stroke-opacity="0.35" stroke-width="1"/>
    <g fill="url(#glyphGrad)">
      <use href="#artRuns" filter="url(#glow)" opacity="0.45">
        ${anim('opacity', [0.3, 0.55, 0.3], [0, 0.5, 1], 4.2)}
      </use>
      <use href="#artRuns"/>
    </g>
    <g clip-path="url(#artClip)">
      <rect x="0" y="${f(BY - 8)}" width="130" height="${f(artH + 16)}" fill="url(#sweepGrad)" opacity="0.38" transform="skewX(-18)">
        ${anim('x', [f(BX - 170), f(BX + artW + 90), f(BX + artW + 90)], [0, 0.55, 1], 6, { begin: 1.6 })}
      </rect>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 4. Clawd — exact terminal-quadrant silhouette, q = 10px per quadrant-width.
//
//    ▐▛███▜▌     head band  y0..40,  x20..140 (eyes = the two empty quadrants)
//   ▝▜█████▛▘    arm band   y40..60; the side stumps ARE the arms (animated
//     ▘▘ ▝▝      as separate flippers); lower band y60..80; feet y80..100
//
// Eat cycle: tip over (rotate about the right foot corner) -> grab the top
// pile candy with the right stump -> rock back -> flick the candy in a
// parabolic toss into the open mouth -> chew (ink mouth + ink cheek bump)
// -> gulp -> smile.
// ---------------------------------------------------------------------------
// the x120-130 foot is OMITTED here: it is the planted pivot foot, drawn as a
// separate static rect so it stays flat on the ground while the body leans.
const CLAWD_BODY = 'M20,0 H140 V80 H110 V100 H100 V80 H60 V100 H50 V80 H40 V100 H30 V80 H20 Z';

const EAT_DUR = 8;
function clawd() {
  // body lean about the right foot corner (130,100); +28.5deg puts the
  // candy held by the +20deg flipper exactly on the pile-top candy.
  const LEAN_KT = [0, 0.04, 0.075, 0.155, 0.205, 0.265, 0.30, 1];
  const LEAN_V = ['0 130 100', '0 130 100', '-5 130 100', '28.5 130 100', '28.5 130 100', '-4 130 100', '0 130 100', '0 130 100'];
  const LEAN_SPL = ['0 0 1 1', '0.4 0 0.6 1', '0.35 0 0.5 1', '0 0 1 1', '0.3 0 0.5 1', '0.35 0 0.6 1', '0 0 1 1'];

  // right stump (the eater): reach down with the lean, hold the candy level
  // on the way back, wind up, flick (follow-through to -55), recover.
  const FLIP_KT = [0, 0.04, 0.075, 0.155, 0.205, 0.30, 0.315, 0.345, 0.46, 1];
  const FLIP_V = [0, 0, 20, 20, 8, 8, 18, -55, 0, 0];
  const FLIP_SPL = ['0 0 1 1', '0.4 0 0.6 1', '0 0 1 1', '0.3 0 0.6 1', '0 0 1 1', '0.4 0 0.6 1', '0.5 0 0.8 1', '0.3 0 0.5 1', '0 0 1 1'];

  // candy toss: release at flipper ~-26deg -> parabola sampled from the
  // quadratic (167,36.8) Q(122,-34) (80,53); lands in the open mouth.
  const FLY_KT = [0, 0.336, 0.347, 0.358, 0.369, 0.380, 1];
  const FLY_V = ['167 36.8', '167 36.8', '137.3 7.2', '108.4 12.6', '94.1 28.4', '80 53', '80 53'];

  const eatFlipper = `
    <g transform="translate(140 50)">
      <g>
        ${animT('rotate', FLIP_V, FLIP_KT, EAT_DUR, { splines: FLIP_SPL })}
        <rect x="-7" y="-10" width="27" height="20" rx="2.5" fill="${C.coral}"/>
        <g transform="translate(30 0)">
          <g>
            ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.165, 0.175, 0.333, 0.336, 1], EAT_DUR)}
            ${candyArt(C.candy, 1.7)}
          </g>
        </g>
      </g>
    </g>`;

  const magFlipper = `
    <g transform="translate(20 50)">
      <g>
        ${animT('rotate', [25, 31, 25], [0, 0.5, 1], 6, { splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
        <line x1="-14" y1="0" x2="-31" y2="0" stroke="#3A3F4A" stroke-width="7" stroke-linecap="round"/>
        <g transform="translate(-49 0)">
          <circle r="19" fill="#CFE9FF" opacity="0.4"/>
          <!-- sun catches the lens right as he leans for the candy -->
          <circle r="16" fill="#FFF9D6" opacity="0">
            ${anim('opacity', [0, 0, 0.9, 0.35, 0, 0], [0, 0.147, 0.158, 0.205, 0.227, 1], EAT_DUR)}
          </circle>
          <circle r="19" fill="none" stroke="#3A3F4A" stroke-width="5.5"/>
          <circle r="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.4"/>
          <line x1="-9" y1="6" x2="5" y2="-8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.5">
            ${anim('opacity', [0.15, 0.7, 0.15], [0, 0.5, 1], 4.5, { begin: 0.8 })}
          </line>
          <path d="M0,-3.2 L0.9,-0.9 L3.2,0 L0.9,0.9 L0,3.2 L-0.9,0.9 L-3.2,0 L-0.9,-0.9 Z" fill="${C.glyph}" opacity="0.7" transform="translate(5 4)">
            ${anim('opacity', [0.25, 0.85, 0.25], [0, 0.5, 1], 3.4)}
          </path>
        </g>
        <rect x="-20" y="-10" width="27" height="20" rx="2.5" fill="${C.coral}"/>
      </g>
    </g>`;

  // body + face. Chew = animated ink mouth + ink cheek bump pulsing beside it
  // (food pouched in the cheek when the mouth closes).
  const body = `
    <g transform="translate(80 100)">
      <g>
        ${animT('scale', ['1 1', '1 1', '1.035 0.95', '0.985 1.025', '1 1', '1 1'], [0, 0.625, 0.655, 0.685, 0.715, 1], EAT_DUR, { splines: ['0 0 1 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0 0 1 1'] })}
        <g transform="translate(-80 -100)">
          <g>
            ${animT('translate', ['0 0', '0 0', '0 1.4', '0 0', '0 1.4', '0 0', '0 1.4', '0 0', '0 0'], [0, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 1], EAT_DUR, { additive: true })}
            <path d="${CLAWD_BODY}" fill="${C.coral}"/>
            <!-- eyes: squeeze shut on the gulp and stay contently shut for a
                 beat — closed eyes are slightly wider, gently bowed arcs -->
            <g>
              ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.643, 0.658, 0.868, 0.883, 1], EAT_DUR)}
              <rect x="40" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28.5, 28.5, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR)}
                ${anim('height', [20, 20, 3, 3, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR)}
              </rect>
              <rect x="110" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28.5, 28.5, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR)}
                ${anim('height', [20, 20, 3, 3, 20, 20], [0, 0.625, 0.65, 0.875, 0.905, 1], EAT_DUR)}
              </rect>
            </g>
            <g opacity="0" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round" fill="none">
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.645, 0.66, 0.866, 0.881, 1], EAT_DUR)}
              <path d="M38.5,30 Q45,26.5 51.5,30"/>
              <path d="M108.5,30 Q115,26.5 121.5,30"/>
            </g>
            <!-- cheek bulge: crescent outline (orange inside) puffing out beside
                 the mouth between chomps -->
            <g transform="translate(104 53)">
              <g>
                ${animT('scale', [0, 0, 0.5, 1, 0.45, 1, 0.45, 1, 0, 0], [0, 0.42, 0.445, 0.46, 0.49, 0.52, 0.55, 0.58, 0.62, 1], EAT_DUR, { splines: ['0 0 1 1', '0.3 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0 0 1 1'] })}
                <path d="M0,-7.5 A7.5,7.5 0 0 1 0,7.5" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
              </g>
            </g>
            <!-- mouth: opens to catch the toss, then chews (ink, animated) -->
            <ellipse cx="80" cy="55" rx="7" ry="0.01" fill="${C.ink}" opacity="0">
              ${anim('ry', [0.01, 0.01, 10.5, 10.5, 2.5, 6, 2.5, 6, 2.5, 6, 2.5, 2, 0.01, 0.01], [0, 0.295, 0.315, 0.375, 0.40, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 0.64, 1], EAT_DUR)}
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.295, 0.31, 0.63, 0.66, 1], EAT_DUR)}
            </ellipse>
          </g>
        </g>
      </g>
    </g>`;

  // tossed candy flies outside the lean group (the body is upright by then)
  const flyingCandy = `
    <g opacity="0">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.336, 0.339, 0.378, 0.382, 1], EAT_DUR)}
      <g>
        ${animT('translate', FLY_V, FLY_KT, EAT_DUR)}
        <g>
          ${animT('rotate', [0, 0, 300, 300], [0, 0.336, 0.380, 1], EAT_DUR)}
          ${candyArt(C.candy, 1.7)}
        </g>
      </g>
    </g>`;

  return `
  <ellipse cx="168" cy="355" rx="70" ry="7.5" fill="#2E5C33" opacity="0.18">
    ${anim('rx', [70, 70, 61, 61, 70, 70], [0, 0.075, 0.16, 0.21, 0.305, 1], EAT_DUR)}
  </ellipse>
  <g transform="translate(88 252)">
    ${animT('translate', ['0 0', '0 -2', '0 0'], [0, 0.5, 1], 5.3, { additive: true, splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    <!-- planted pivot foot: stays vertical but slides sideways to keep up
         with the tipping body (foot shuffle) -->
    <g>
      ${animT('translate', ['0 0', '0 0', '-1.72 0', '10.15 0', '10.15 0', '-1.38 0', '0 0', '0 0'], LEAN_KT, EAT_DUR, { splines: LEAN_SPL })}
      <rect x="120" y="70" width="10" height="30" fill="${C.coral}"/>
    </g>
    <g>
      ${animT('rotate', LEAN_V, LEAN_KT, EAT_DUR, { splines: LEAN_SPL })}
      ${magFlipper}
      ${body}
      ${eatFlipper}
    </g>
    ${flyingCandy}
  </g>
  <!-- candy pile; he visibly takes the top one each cycle -->
  <g>
    <ellipse cx="272" cy="352.5" rx="25" ry="3.6" fill="#2E5C33" opacity="0.2"/>
    <g transform="translate(262 346) rotate(-14)">${candyArt(C.candyViolet, 1.6)}</g>
    <g transform="translate(281 345.5) rotate(12)">${candyArt(C.candyMint, 1.6)}</g>
    <g transform="translate(271.5 335) rotate(-4)">
      <g>
        ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.16, 0.17, 0.93, 0.96, 1], EAT_DUR)}
        ${candyArt(C.candy, 1.7)}
      </g>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 5. Codex — official cloud head facing the viewer with a >_< sugar-rush face
//    (official chevron + its mirror as the two eyes, official dash recentred
//    as the mouth, chocolate smudges). Body side-on, typing on an L-shaped
//    laptop; wrapper mountain behind.
// ---------------------------------------------------------------------------
const CODEX_CLOUD = 'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z';
const CODEX_CHEVRON = 'M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z';
const CODEX_DASH = 'M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z';

function codexHead() {
  // head in logo path-space (24x24), scaled k, facing the viewer; quick
  // little nod (sugar rush). Face = >_< from the official glyphs.
  const k = 4.9;
  return `
  <g transform="translate(-4 -96)">
    <g>
      ${animT('rotate', ['-2.5', '-0.2', '-2.5'], [0, 0.5, 1], 0.55, { splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
      <g transform="scale(${k}) translate(-12 -12)">
        <path d="${CODEX_CLOUD}" fill="url(#coxGrad)"/>
        <!-- eyes: official chevron + its mirror (>_<), with a squeezy blink -->
        <g transform="translate(12 11.93)"><g>
          ${animT('scale', ['1 1', '1 1', '1 0.25', '1 1', '1 1'], [0, 0.9, 0.93, 0.96, 1], 3.7)}
          <g transform="translate(-12 -11.93)">
            <path d="${CODEX_CHEVRON}" fill="#FFFFFF"/>
            <path d="${CODEX_CHEVRON}" fill="#FFFFFF" transform="matrix(-1 0 0 1 24 0)"/>
          </g>
        </g></g>
        <!-- mouth: official dash recentred under the eyes; chews while typing -->
        <g transform="translate(-2.36 1.8)"><g transform="translate(14.36 14.55)"><g>
          ${animT('scale', ['1 1', '1 1', '1 0.55', '1 1', '1 0.62', '1 1', '1 1'], [0, 0.55, 0.62, 0.69, 0.76, 0.83, 1], 2.8)}
          <g transform="translate(-14.36 -14.55)"><path d="${CODEX_DASH}" fill="#FFFFFF"/></g>
        </g></g></g>
        <!-- chocolate-smudged mouth -->
        <g fill="${C.choc}">
          <ellipse cx="9.7" cy="17.1" rx="0.8" ry="0.6" opacity="0.92"/>
          <ellipse cx="14.4" cy="17.4" rx="0.7" ry="0.55" opacity="0.88"/>
          <ellipse cx="12.1" cy="18.1" rx="1.0" ry="0.58" fill="${C.chocHi}" opacity="0.9"/>
          <ellipse cx="8.9" cy="15.6" rx="0.45" ry="0.35" opacity="0.8"/>
          <ellipse cx="15.3" cy="15.9" rx="0.5" ry="0.4" opacity="0.85"/>
        </g>
      </g>
    </g>
  </g>`;
}

function codex() {
  const typing = (phase) => animT('translate', phase ? ['0 -2.4', '0 0', '0 -2.4'] : ['0 0', '0 -2.4', '0 0'], [0, 0.5, 1], 0.17, { additive: true });
  return `
  <ellipse cx="1036" cy="356" rx="62" ry="7" fill="#2E5C33" opacity="0.18"/>
  <g transform="translate(1042 352)">
    ${animT('translate', ['0 0', '0 -1.5', '0 0'], [0, 0.5, 1], 3.1, { additive: true, splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    <g>
      ${animT('translate', ['0 0', '0 0', '1 0', '-1 0', '0.7 0', '-0.5 0', '0 0', '0 0'], [0, 0.85, 0.875, 0.9, 0.925, 0.95, 0.975, 1], 3.4, { additive: true })}

      <!-- far leg -->
      ${limb(-6, -16, -38, -13, 13, C.coxLimbFar, C.coxLimbEdge)}
      ${limb(-38, -13, -40, -3, 12, C.coxLimbFar, C.coxLimbEdge)}
      <ellipse cx="-44" cy="-2" rx="8.5" ry="4.8" fill="${C.coxLimbFar}"/>
      <!-- body (stocky) -->
      <rect x="-28" y="-52" width="56" height="48" rx="20" fill="url(#coxBodyGrad)"/>
      <!-- near leg -->
      ${limb(0, -14, -34, -11, 13, C.coxLimb, C.coxLimbEdge)}
      ${limb(-34, -11, -36, -1, 12, C.coxLimb, C.coxLimbEdge)}
      <ellipse cx="-40" cy="0.5" rx="8.5" ry="4.8" fill="${C.coxLimb}"/>

      <!-- L-shaped laptop (side view: tall screen, longer keyboard deck) -->
      <g>
        <polygon points="-58,-59 -14,-87 -14,-37 -58,-23" fill="url(#screenCone)" opacity="0.14">
          ${anim('opacity', [0.09, 0.17, 0.11, 0.16, 0.09], [0, 0.3, 0.55, 0.8, 1], 1.3)}
        </polygon>
        <rect x="-66" y="-63" width="7.5" height="46" rx="2.5" fill="${C.screen}"/>
        <rect x="-59.2" y="-60" width="1.6" height="40" rx="0.8" fill="${C.screenGlow}" opacity="0.6"/>
        <rect x="-64" y="-22.5" width="56" height="6.5" rx="2.5" fill="${C.lap}"/>
        <rect x="-64" y="-22.5" width="56" height="2" rx="1" fill="${C.lapHi}"/>
      </g>

      <!-- arms hammering the keys -->
      <g>
        ${limb(-16, -42, -42, -27, 11, C.coxLimbFar, C.coxLimbEdge)}
        <g>${typing(0)}<circle cx="-46" cy="-25" r="6" fill="${C.coxLimbFar}"/></g>
      </g>
      <g>
        ${limb(-6, -38, -24, -25.5, 10, C.coxLimb, C.coxLimbEdge)}
        <g>${typing(1)}<circle cx="-28" cy="-23.5" r="6" fill="${C.coxLimb}"/></g>
      </g>

      ${codexHead()}

      <!-- sugar-rush sparks -->
      <g fill="${C.candyGold}">
        <path transform="translate(48 -132)" d="M0,-4.4 L1.2,-1.2 L4.4,0 L1.2,1.2 L0,4.4 L-1.2,1.2 L-4.4,0 L-1.2,-1.2 Z">
          ${anim('opacity', [0, 1, 0], [0, 0.4, 1], 1.6)}
        </path>
        <path transform="translate(60 -108) scale(0.7)" d="M0,-4.4 L1.2,-1.2 L4.4,0 L1.2,1.2 L0,4.4 L-1.2,1.2 L-4.4,0 L-1.2,-1.2 Z">
          ${anim('opacity', [0, 1, 0], [0, 0.4, 1], 1.6, { begin: 0.8 })}
        </path>
      </g>
    </g>
  </g>
  ${wrapperMound()}`;
}

// candy-wrapper bowtie — flat: solid colour + darker border
function wrapper(x, y, rot, col, s = 1, op = 1) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(s)})" opacity="${op}" stroke="${shade(col)}" stroke-width="1.3" stroke-linejoin="round">
    <path d="M-4.5,-3 L-10,-5.5 L-9,0 L-10,5.5 L-4.5,3 Z" fill="${col}"/>
    <path d="M4.5,-3 L10,-5.5 L9,0 L10,5.5 L4.5,3 Z" fill="${col}"/>
    <rect x="-5" y="-3.6" width="10" height="7.2" rx="2" fill="${col}"/>
  </g>`;
}

function wrapperMound() {
  const cols = [C.wrapPink, C.candyViolet, C.candyGold, C.candyMint, C.candyOrange, C.candy];
  const rows = [
    { y: 380, n: 6, x0: 1072, dx: 18 },
    { y: 372, n: 5, x0: 1081, dx: 18 },
    { y: 364, n: 4, x0: 1090, dx: 18 },
    { y: 356, n: 3, x0: 1099, dx: 18 },
    { y: 348.5, n: 2, x0: 1108, dx: 18 },
    { y: 342, n: 1, x0: 1117, dx: 18 },
  ];
  let out = `<ellipse cx="1118" cy="384" rx="60" ry="5.5" fill="#2E5C33" opacity="0.16"/>`;
  let i = 0;
  for (const row of rows)
    for (let kI = 0; kI < row.n; kI++)
      out += wrapper(row.x0 + kI * row.dx + rr(-2.5, 2.5), row.y + rr(-1.5, 1.5), rr(-50, 50), cols[i++ % cols.length], rr(0.85, 1.12));
  // strays around his seat + one on the laptop deck
  out += wrapper(1000, 376, 24, C.candyMint, 0.95);
  out += wrapper(1034, 381, -33, C.candyGold, 1.0);
  out += wrapper(966, 380, 60, C.candyViolet, 0.9);
  out += wrapper(1054, 383, -12, C.candyOrange, 0.95);
  out += wrapper(1002, 327, -8, C.candy, 0.72);
  // one wrapper tumbles down the mound now and then
  out += `<g opacity="0">
    ${anim('opacity', [0, 0, 1, 1, 1, 0], [0, 0.6, 0.63, 0.93, 0.985, 1], 9)}
    <g>
      ${animT('translate', ['1117 338', '1117 338', '1098 351', '1074 368', '1066 374', '1066 374'], [0, 0.6, 0.71, 0.8, 0.84, 1], 9, { splines: ['0 0 1 1', '0.45 0 0.9 1', '0.3 0 0.8 1', '0 0 0.4 1', '0 0 1 1'] })}
      <g>
        ${animT('rotate', ['0', '0', '-210', '-210'], [0, 0.6, 0.84, 1], 9)}
        ${wrapper(0, 0, 0, C.candy, 0.95)}
      </g>
    </g>
  </g>`;
  return out;
}

// ---------------------------------------------------------------------------
// 6. The death-ray gag. While Clawd leans for his candy (totally clueless),
//    an off-screen sun catches the raised magnifying glass, which focuses a
//    beam that sets the far-left tree on fire. It blazes while he munches,
//    smoulders into smoke, and regrows just before the next grab.
//    Drawn BEHIND Clawd (the beam comes from behind the glass); the lens
//    itself flashes inside the flipper group so it tracks the glass.
// ---------------------------------------------------------------------------
// scattered treats on the grass: a gold bonbon, a candy cane, a lollipop,
// and an unwrapped, bitten chocolate bar beside Codex — all flat + bordered
function groundTreats() {
  // candy cane as a filled outline so the classic straight diagonal stripes
  // can be clipped into it
  const caneOutline = 'M2.8,14 L2.8,-4 A8.3,8.3 0 0 0 -13.8,-4 L-13.8,0 A2.8,2.8 0 0 0 -8.2,0 L-8.2,-4 A2.7,2.7 0 0 1 -2.8,-4 L-2.8,14 A2.8,2.8 0 0 0 2.8,14 Z';
  let stripes = '';
  for (let k = -28; k <= 10; k += 7) {
    stripes += `<line x1="${k}" y1="-22" x2="${k + 44}" y2="22" stroke="#E8556F" stroke-width="3.6"/>`;
  }
  return `
  <g transform="translate(408 367) rotate(-9)">${candyArt(C.candyGold, 1.3)}</g>
  <g transform="translate(498 372) rotate(14)">
    <clipPath id="caneClip"><path d="${caneOutline}"/></clipPath>
    <path d="${caneOutline}" fill="#FFFFFF"/>
    <g clip-path="url(#caneClip)">${stripes}</g>
    <path d="${caneOutline}" fill="none" stroke="#B23B52" stroke-width="1.5" stroke-linejoin="round"/>
  </g>
  <g transform="translate(652 375) rotate(24)">
    <line x1="0" y1="2" x2="0" y2="16" stroke="${shade('#E8D9C0')}" stroke-width="4" stroke-linecap="round"/>
    <line x1="0" y1="2" x2="0" y2="16" stroke="#E8D9C0" stroke-width="2.4" stroke-linecap="round"/>
    <circle cy="-4" r="7.5" fill="${C.candyViolet}" stroke="${shade(C.candyViolet)}" stroke-width="1.5"/>
    <circle cy="-4" r="3.4" fill="none" stroke="${shade(C.candyViolet)}" stroke-width="1.5"/>
  </g>
  <g transform="translate(945 377) rotate(-11)">
    <path d="M-14,-5.5 Q-14,-8 -11.5,-8 L1,-8 A4.4,4.4 0 0 0 8.6,-6.2 A3.6,3.6 0 0 0 14,-2.6 L14,5.5 Q14,8 11.5,8 L-11.5,8 Q-14,8 -14,5.5 Z" fill="#7A4E2A" stroke="${shade('#7A4E2A')}" stroke-width="1.4" stroke-linejoin="round"/>
    <g stroke="${shade('#7A4E2A')}" stroke-width="1.1" opacity="0.85">
      <line x1="-4.7" y1="-8" x2="-4.7" y2="8"/>
      <line x1="4.7" y1="-1" x2="4.7" y2="8"/>
      <line x1="-14" y1="0" x2="14" y2="0"/>
    </g>
    <path d="M-17,-9 L-9,-9 L-9,9 L-17,9 Q-19,5 -17,2 Q-19,-2 -17,-5 Z" fill="${C.wrapPink}" stroke="${shade(C.wrapPink)}" stroke-width="1.3" stroke-linejoin="round"/>
  </g>`;
}

function deathRay() {
  const FLAME_BIG = 'M0,10 C-8,4 -6,-8 0,-18 C6,-8 8,4 0,10 Z';
  const FLAME_SMALL = 'M0,7 C-4.5,2.5 -3.5,-4 0,-10 C3.5,-4 4.5,2.5 0,7 Z';
  const flicker = animT('scale', ['1 1', '1.12 0.9', '0.93 1.08', '1.07 0.94', '1 1'], [0, 0.25, 0.5, 0.75, 1], 0.46);
  return `
  <!-- victim tree (far left) -->
  <g transform="translate(30 303) scale(1.1)">
    <rect x="-1.6" y="-3" width="3.2" height="8" rx="1.2" fill="${C.treeTrunk}"/>
    <circle cx="0" cy="-9" r="6.4" fill="${C.treeA}"/>
    <circle cx="-4.8" cy="-5.5" r="4.6" fill="${C.treeA}"/>
    <circle cx="4.8" cy="-5.5" r="4.6" fill="${C.treeA}"/>
    <!-- charred crown while burnt; regreens just before the next zap -->
    <g opacity="0" fill="#4A3B33">
      ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.185, 0.2, 0.935, 0.965, 1], EAT_DUR)}
      <circle cx="0" cy="-9" r="6.4"/>
      <circle cx="-4.8" cy="-5.5" r="4.6"/>
      <circle cx="4.8" cy="-5.5" r="4.6"/>
    </g>
  </g>
  <!-- sun ray in (off-screen sun) -->
  <polygon points="88,0 130,0 121,212 115,212" fill="#FFF6C9" opacity="0">
    ${anim('opacity', [0, 0, 0.42, 0.42, 0, 0], [0, 0.14, 0.155, 0.215, 0.235, 1], EAT_DUR)}
  </polygon>
  <!-- focused death ray out -->
  <polygon points="115,211.6 121,218.4 35.9,298.8 24.1,285.2" fill="#FFE875" opacity="0">
    ${anim('opacity', [0, 0, 0.85, 0.6, 0.85, 0.55, 0.85, 0, 0], [0, 0.153, 0.162, 0.175, 0.188, 0.2, 0.212, 0.23, 1], EAT_DUR)}
  </polygon>
  <line x1="118" y1="215" x2="30" y2="292" stroke="#FFFDE6" stroke-width="2.6" stroke-linecap="round" opacity="0">
    ${anim('opacity', [0, 0, 1, 0.7, 1, 0.7, 1, 0, 0], [0, 0.153, 0.162, 0.175, 0.188, 0.2, 0.212, 0.23, 1], EAT_DUR)}
  </line>
  <!-- fire (long burn while Clawd obliviously munches) -->
  <g opacity="0">
    ${anim('opacity', [0, 0, 1, 1, 0.65, 0, 0], [0, 0.175, 0.195, 0.598, 0.678, 0.738, 1], EAT_DUR)}
    <g transform="translate(30 290)">
      <g>
        ${flicker}
        <path d="${FLAME_BIG}" fill="#FF8A3C" stroke="${shade('#FF8A3C')}" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="${FLAME_SMALL}" fill="#FFD24A"/>
        <g transform="translate(-8 4) rotate(-14) scale(0.6)"><path d="${FLAME_BIG}" fill="#FF8A3C" stroke="${shade('#FF8A3C')}" stroke-width="1.3" stroke-linejoin="round"/></g>
        <g transform="translate(8 5) rotate(13) scale(0.5)"><path d="${FLAME_BIG}" fill="#FFB347"/></g>
      </g>
    </g>
  </g>
  <!-- smoke as the fire dies down -->
  <g fill="#9AA0A8">
    <g opacity="0">
      ${anim('opacity', [0, 0, 0.55, 0.45, 0, 0], [0, 0.518, 0.598, 0.798, 0.868, 1], EAT_DUR)}
      <g>
        ${animT('translate', ['0 0', '0 0', '0 -12', '0 -24', '0 -32', '0 -32'], [0, 0.518, 0.638, 0.758, 0.868, 1], EAT_DUR)}
        <circle cx="30" cy="281" r="5"/>
      </g>
    </g>
    <g opacity="0">
      ${anim('opacity', [0, 0, 0.5, 0.4, 0, 0], [0, 0.598, 0.678, 0.838, 0.898, 1], EAT_DUR)}
      <g>
        ${animT('translate', ['0 0', '0 0', '0 -10', '0 -20', '0 -26', '0 -26'], [0, 0.598, 0.718, 0.818, 0.898, 1], EAT_DUR)}
        <circle cx="35" cy="285" r="3.8"/>
      </g>
    </g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 7. Assemble
// ---------------------------------------------------------------------------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="sweet-search — Clawd and Codex enjoying candy around the SWEET SEARCH terminal banner">
  <title>sweet-search</title>
  <defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.skyTop}"/><stop offset="55%" stop-color="${C.skyMid}"/><stop offset="100%" stop-color="${C.skyLow}"/>
    </linearGradient>
    <linearGradient id="bandGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.band0}"/><stop offset="18%" stop-color="${C.band1}"/><stop offset="36%" stop-color="${C.band2}"/>
      <stop offset="50%" stop-color="${C.band4}"/>
      <stop offset="64%" stop-color="${C.band2}"/><stop offset="82%" stop-color="${C.band1}"/><stop offset="100%" stop-color="${C.band0}"/>
    </linearGradient>
    <linearGradient id="glyphGrad" gradientUnits="userSpaceOnUse" x1="0" y1="${f(BY)}" x2="0" y2="${f(BY + artH)}">
      <stop offset="0%" stop-color="${C.glyphHi}"/><stop offset="48%" stop-color="${C.glyph}"/><stop offset="100%" stop-color="${C.glyphLo}"/>
    </linearGradient>
    <linearGradient id="coxGrad" gradientUnits="userSpaceOnUse" x1="12" y1="3" x2="12" y2="21">
      <stop offset="0%" stop-color="${C.coxTop}"/><stop offset="50%" stop-color="${C.coxMid}"/><stop offset="100%" stop-color="${C.coxLow}"/>
    </linearGradient>
    <linearGradient id="coxBodyGrad" gradientUnits="userSpaceOnUse" x1="0" y1="-52" x2="0" y2="-4">
      <stop offset="0%" stop-color="${C.coxBody1}"/><stop offset="100%" stop-color="${C.coxBody2}"/>
    </linearGradient>
    <linearGradient id="screenCone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.screenGlow}" stop-opacity="0.9"/><stop offset="100%" stop-color="${C.screenGlow}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.85"/><stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/></feMerge>
    </filter>
    <filter id="softBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
    <g id="artRuns">${artRuns()}</g>
    <clipPath id="artClip"><use href="#artRuns"/></clipPath>
    <clipPath id="frame"><rect width="1200" height="400" rx="16"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    ${scenery()}
    ${groundTreats()}
    ${deathRay()}
    ${bannerPanel()}
    ${clawd()}
    ${codex()}
  </g>
  <rect x="3" y="3" width="1194" height="394" rx="13" fill="none" stroke="#162874" stroke-width="6"/>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, 'utf8');
console.log(`wrote ${OUT}  (${svg.length} bytes${FREEZE ? `, frozen at t=${FREEZE}s` : ''})`);
