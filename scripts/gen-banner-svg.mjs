#!/usr/bin/env node
/**
 * gen-banner-svg.mjs — animated README hero banner for sweet-search.
 *
 * Composition (1200x400, daytime pastoral scene):
 *   - blue sky, drifting clouds, far hills + tiny trees, green field
 *   - CENTER: the real CLI banner — purple (#5A73DC) SWEET SEARCH half-block
 *             art on the dark-navy gradient band, exactly like the printout
 *   - LEFT  : Clawd (Claude Code mascot, exact terminal-quadrant silhouette,
 *             mono #D77757). Two-joint IK arm picks a candy from a pile,
 *             brings it to his mouth, chews (cheek bump), gulps, smiles.
 *             Other (right) arm holds a magnifying glass.
 *   - RIGHT : Codex (official OpenAI cloud + white >_ mark, exact logo path)
 *             sitting side-on, typing furiously on an L-shaped laptop,
 *             chocolate-smudged mouth, mountain of candy wrappers behind.
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

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  // scene
  skyTop: '#69B4E8', skyMid: '#A9D9F6', skyLow: '#EAF7F0',
  cloud: '#FFFFFF',
  hillFar: '#B4DCA0', hillNear: '#96CC85',
  fieldHi: '#8ED073', fieldLo: '#4E9C4F',
  treeTrunk: '#7E5A40', treeA: '#54A55A', treeB: '#62B364',
  // CLI banner band (cli-decoration.js STYLE.colors, edge -> center)
  band0: '#060A1F', band1: '#0A1134', band2: '#0E1849', band4: '#162874',
  // glyphs = STYLE.colors.border (#5A73DC), bold purple
  glyphHi: '#8CA0F0', glyph: '#5A73DC', glyphLo: '#4557C5',
  // Clawd (claude-code cli.js: rgb(215,119,87))
  coral: '#D77757', coralEdge: '#B85230', ink: '#20201E',
  // candy
  candyHi: '#FFB3D6', candy: '#FF5BA3', candyLo: '#DD2F7E', wrapPink: '#FF97C2',
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
function cloud(cx, cy, s, op, driftPx, driftDur) {
  const puffs = [
    [0, 0, 22], [-24, 6, 15], [24, 6, 15], [-12, -10, 14], [13, -9, 15], [38, 9, 10],
  ];
  const body = puffs.map(([x, y, r]) => `<circle cx="${f(x * s)}" cy="${f(y * s)}" r="${f(r * s)}"/>`).join('');
  return `<g transform="translate(${cx} ${cy})" fill="${C.cloud}" opacity="${op}">
    ${animT('translate', [`0 0`, `${driftPx} 0`, `0 0`], [0, 0.5, 1], driftDur, { additive: true, splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    ${body}
  </g>`;
}

function tree(x, y, s, alt) {
  const crown = alt ? C.treeA : C.treeB;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-1.6" y="-3" width="3.2" height="8" rx="1.2" fill="${C.treeTrunk}"/>
    <circle cx="0" cy="-9" r="6.4" fill="${crown}"/>
    <circle cx="-4.8" cy="-5.5" r="4.6" fill="${crown}"/>
    <circle cx="4.8" cy="-5.5" r="4.6" fill="${crown}"/>
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
  const trees = [[95, 305, 1.0, 0], [320, 303, 0.8, 1], [430, 306, 1.1, 0], [562, 303, 0.85, 1],
    [690, 306, 1.0, 0], [852, 303, 0.9, 1], [1108, 305, 1.05, 0], [930, 306, 0.75, 1]]
    .map(([x, y, s, a]) => tree(x, y, s, a)).join('');
  const daisies = [[342, 372], [520, 388], [702, 366], [880, 384], [148, 391]].map(([x, y]) => daisy(x, y)).join('');
  const sparkles = [
    sparkle(64, 146, 0.9, C.glyph, 3.2, 0.4), sparkle(124, 64, 0.7, '#FFFFFF', 4.1, 1.5),
    sparkle(1126, 132, 0.85, C.glyph, 3.6, 0.9), sparkle(1172, 60, 0.65, '#FFFFFF', 2.8, 2.2),
  ].join('');
  return `
  <!-- sky -->
  <rect width="1200" height="400" fill="url(#skyGrad)"/>
  <!-- clouds (drift gently) -->
  ${cloud(168, 56, 0.9, 0.92, 16, 34)}
  ${cloud(452, 42, 1.05, 0.95, -14, 40)}
  ${cloud(764, 54, 0.8, 0.9, 12, 28)}
  ${cloud(1040, 40, 0.7, 0.85, -10, 31)}
  ${cloud(612, 26, 0.5, 0.55, 8, 24)}
  <!-- far hills + field -->
  <path d="M0,312 C150,296 290,305 430,301 C570,297 700,308 845,301 C985,295 1100,305 1200,300 L1200,340 L0,340 Z" fill="${C.hillFar}"/>
  <path d="M0,322 C180,308 340,316 520,311 C700,306 880,316 1040,310 C1110,308 1160,311 1200,310 L1200,350 L0,350 Z" fill="${C.hillNear}"/>
  <rect x="0" y="316" width="1200" height="84" fill="url(#fieldGrad)"/>
  <path d="M0,316 C200,310 420,318 640,314 C860,310 1040,318 1200,313 L1200,330 L0,330 Z" fill="${C.fieldHi}" opacity="0.55"/>
  ${trees}
  <path d="M-40,372 C260,352 560,386 900,366 C1040,358 1140,366 1240,360" stroke="#FFFFFF" stroke-width="14" fill="none" opacity="0.05"/>
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
//   ▝▜█████▛▘    arm band   y40..60, x0..160 (side nubs are the arm roots)
//     ▘▘ ▝▝      lower band y60..80, x20..140; feet y80..100
// ---------------------------------------------------------------------------
const CLAWD_OUTLINE = 'M20,0 H140 V40 H160 V60 H140 V80 H130 V100 H120 V80 H110 V100 H100 V80 H60 V100 H50 V80 H40 V100 H30 V80 H20 V60 H0 V40 H20 Z';

// two-joint IK: shoulder S, segment lengths Lu/Lf, target T. Returns rotations
// (deg) for a rig whose zero pose points straight down; positive = clockwise.
function ik(S, Lu, Lf, T, elbowSign = 1) {
  const dx = T[0] - S[0], dy = T[1] - S[1];
  const d = Math.min(Math.hypot(dx, dy), Lu + Lf - 0.01);
  const thT = Math.atan2(-dx / d, dy / d) * 180 / Math.PI;
  const beta = Math.acos(Math.min(1, Math.max(-1, (d * d + Lu * Lu - Lf * Lf) / (2 * d * Lu)))) * 180 / Math.PI;
  const C = Math.acos(Math.min(1, Math.max(-1, (Lu * Lu + Lf * Lf - d * d) / (2 * Lu * Lf)))) * 180 / Math.PI;
  return { s: thT - elbowSign * beta, e: elbowSign * (180 - C) };
}

const EAT_DUR = 8;
function clawd() {
  const S = [150, 50];           // eating-arm shoulder (his left = viewer right)
  const Lu = 36, Lf = 38;
  const MOUTH = [80, 51];
  const PILE = [185, 95];        // local; candy pile on the grass beside him

  // all poses on the same elbow branch (+1) so the swing never passes through
  // full extension (which would sweep the hand below the grass); CARRY is a
  // tucked mid-swing pose the arm folds through on the way up AND back.
  const pPile = ik(S, Lu, Lf, PILE, 1);
  const pDip = ik(S, Lu, Lf, [PILE[0] + 1, PILE[1] + 3], 1);
  const pCarry = ik(S, Lu, Lf, [135, 65], 1);
  const pMouth = ik(S, Lu, Lf, MOUTH, 1);
  const pOver = ik(S, Lu, Lf, [MOUTH[0] - 3, MOUTH[1] - 2], 1);

  // master keyTimes for the eat cycle (8s):
  // rest .. grab(0.05) .. lift(0.075-0.225 via carry) .. bite(0.252)
  // return(0.27-0.42 via carry) .. chew(0.30-0.575) .. gulp(0.575-0.685)
  // smile(0.625-0.885)
  const KT = [0, 0.035, 0.055, 0.075, 0.135, 0.195, 0.225, 0.27, 0.345, 0.42, 1];
  const SPL = ['0 0 1 1', '0.4 0 0.6 1', '0 0 1 1', '0.35 0 0.5 1', '0.3 0 0.4 1', '0.3 0 0.5 1', '0 0 1 1', '0.4 0 0.5 1', '0.25 0 0.5 1', '0 0 1 1'];
  const vS = [pPile.s, pPile.s, pDip.s, pDip.s, pCarry.s, pOver.s, pMouth.s, pMouth.s, pCarry.s, pPile.s, pPile.s].map(f);
  const vE = [pPile.e, pPile.e, pDip.e, pDip.e, pCarry.e, pOver.e, pMouth.e, pMouth.e, pCarry.e, pPile.e, pPile.e].map(f);

  const armRig = `
    <g transform="translate(${S[0]} ${S[1]})">
      <g>
        ${animT('rotate', vS, KT, EAT_DUR, { splines: SPL })}
        ${limb(0, 0, 0, Lu, 12, C.coral, C.coralEdge)}
        <g transform="translate(0 ${Lu})">
          <g>
            ${animT('rotate', vE, KT, EAT_DUR, { splines: SPL })}
            ${limb(0, 2, 0, Lf - 4, 11, C.coral, C.coralEdge)}
            <g transform="translate(0 ${Lf})">
              <circle r="6.5" fill="${C.coral}" stroke="${C.coralEdge}" stroke-width="1.5"/>
              <!-- candy appears at the grab, vanishes at the bite -->
              <g>
                ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.048, 0.06, 0.251, 0.255, 1], EAT_DUR)}
                <path d="M-6,0 L-13,-5.5 L-13,5.5 Z" fill="${C.wrapPink}"/>
                <path d="M6,0 L13,-5.5 L13,5.5 Z" fill="${C.wrapPink}"/>
                <ellipse rx="6.8" ry="5.4" fill="url(#candyGrad)"/>
                <ellipse cx="-1.8" cy="-1.6" rx="2.4" ry="1.5" fill="#FFFFFF" opacity="0.65"/>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>`;

  // magnifying glass arm (his right = viewer left), gentle sway
  const mag = `
    <g>
      ${animT('rotate', ['-3 10 50', '3 10 50', '-3 10 50'], [0, 0.5, 1], 6, { splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
      ${limb(10, 50, -7, 20.6, 12, C.coral, C.coralEdge)}
      ${limb(-7, 20.6, -29.3, 0.5, 11, C.coral, C.coralEdge)}
      <line x1="-29.3" y1="0.5" x2="-41.2" y2="-10.2" stroke="#3A3F4A" stroke-width="7" stroke-linecap="round"/>
      <g transform="translate(-55.3 -22.9)">
        <circle r="19" fill="#CFE9FF" opacity="0.4"/>
        <circle r="19" fill="none" stroke="#3A3F4A" stroke-width="5.5"/>
        <circle r="16" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.4"/>
        <line x1="-9" y1="6" x2="5" y2="-8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.5">
          ${anim('opacity', [0.15, 0.7, 0.15], [0, 0.5, 1], 4.5, { begin: 0.8 })}
        </line>
        <path d="M0,-3.2 L0.9,-0.9 L3.2,0 L0.9,0.9 L0,3.2 L-0.9,0.9 L-3.2,0 L-0.9,-0.9 Z" fill="${C.glyph}" opacity="0.7" transform="translate(5 4)">
          ${anim('opacity', [0.25, 0.85, 0.25], [0, 0.5, 1], 3.4)}
        </path>
      </g>
      <circle cx="-29.3" cy="0.5" r="6" fill="${C.coral}" stroke="${C.coralEdge}" stroke-width="1.5"/>
    </g>`;

  // body: one mono-coral path. Eyes/mouth/cheek ride inside the gulp-squash rig.
  const body = `
    <g transform="translate(80 100)">
      <g>
        ${animT('scale', ['1 1', '1 1', '1.035 0.95', '0.985 1.025', '1 1', '1 1'], [0, 0.575, 0.615, 0.65, 0.685, 1], EAT_DUR, { splines: ['0 0 1 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0 0 1 1'] })}
        <g transform="translate(-80 -100)">
          <g>
            ${animT('translate', ['0 0', '0 0', '0 1.4', '0 0', '0 1.4', '0 0', '0 1.4', '0 0', '0 0'], [0, 0.3, 0.345, 0.39, 0.435, 0.48, 0.525, 0.575, 1], EAT_DUR, { additive: true })}
            <path d="${CLAWD_OUTLINE}" fill="${C.coral}"/>
            <!-- cheek bump (chews up in his right cheek = viewer left, chipmunk-style) -->
            <g transform="translate(19.5 27)">
              <g>
                ${animT('scale', [0, 0, 1, 0.3, 1, 0.3, 1, 0, 0], [0, 0.3, 0.345, 0.39, 0.435, 0.48, 0.525, 0.575, 1], EAT_DUR, { splines: ['0 0 1 1', '0.3 0 0.5 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0.4 0 0.6 1', '0 0 1 1'] })}
                <ellipse rx="8" ry="10.5" fill="${C.coral}"/>
              </g>
            </g>
            <!-- eyes: normal tall quadrants <-> happy arcs after the gulp -->
            <g>
              ${anim('opacity', [1, 1, 0, 0, 1, 1], [0, 0.615, 0.645, 0.855, 0.885, 1], EAT_DUR)}
              <rect x="40" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28.5, 28.5, 20, 20, 28.5, 20, 20], [0, 0.59, 0.61, 0.655, 0.675, 0.92, 0.935, 0.95, 1], EAT_DUR)}
                ${anim('height', [20, 20, 3, 3, 20, 20, 3, 20, 20], [0, 0.59, 0.61, 0.655, 0.675, 0.92, 0.935, 0.95, 1], EAT_DUR)}
              </rect>
              <rect x="110" width="10" fill="${C.ink}">
                ${anim('y', [20, 20, 28.5, 28.5, 20, 20, 28.5, 20, 20], [0, 0.59, 0.61, 0.655, 0.675, 0.92, 0.935, 0.95, 1], EAT_DUR)}
                ${anim('height', [20, 20, 3, 3, 20, 20, 3, 20, 20], [0, 0.59, 0.61, 0.655, 0.675, 0.92, 0.935, 0.95, 1], EAT_DUR)}
              </rect>
            </g>
            <g opacity="0" stroke="${C.ink}" stroke-width="4.2" stroke-linecap="round" fill="none">
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.615, 0.645, 0.855, 0.885, 1], EAT_DUR)}
              <path d="M38,33 Q45,25 52,33"/>
              <path d="M108,33 Q115,25 122,33"/>
            </g>
            <!-- mouth: opens for the bite (peeks below the incoming candy) -->
            <ellipse cx="80" cy="55" rx="7" ry="0.01" fill="${C.ink}" opacity="0">
              ${anim('ry', [0.01, 0.01, 8, 8, 0.01, 0.01], [0, 0.165, 0.2, 0.26, 0.295, 1], EAT_DUR)}
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.16, 0.19, 0.27, 0.3, 1], EAT_DUR)}
            </ellipse>
            <!-- smile after the swallow -->
            <path d="M66,49 Q80,61 94,49" stroke="${C.ink}" stroke-width="4.2" stroke-linecap="round" fill="none" opacity="0">
              ${anim('opacity', [0, 0, 1, 1, 0, 0], [0, 0.625, 0.66, 0.845, 0.885, 1], EAT_DUR)}
            </path>
          </g>
        </g>
      </g>
    </g>`;

  return `
  <ellipse cx="168" cy="355" rx="70" ry="7.5" fill="#2E5C33" opacity="0.18"/>
  <g transform="translate(88 252)">
    ${animT('translate', ['0 0', '0 -2', '0 0'], [0, 0.5, 1], 5.3, { additive: true, splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
    ${mag}
    ${body}
    ${armRig}
  </g>
  <!-- candy pile (in front of the reaching claw) -->
  <g>
    <ellipse cx="273" cy="351.5" rx="17" ry="3.2" fill="#2E5C33" opacity="0.2"/>
    <g transform="translate(264 347.5) rotate(-14)"><path d="M-5.6,0 L-12,-5 L-12,5 Z" fill="${C.candyViolet}"/><path d="M5.6,0 L12,-5 L12,5 Z" fill="${C.candyViolet}"/><ellipse rx="6.2" ry="4.9" fill="${C.candyViolet}"/><ellipse cx="-1.6" cy="-1.4" rx="2" ry="1.2" fill="#FFFFFF" opacity="0.55"/></g>
    <g transform="translate(279 347) rotate(12)"><path d="M-5.6,0 L-12,-5 L-12,5 Z" fill="${C.candyMint}"/><path d="M5.6,0 L12,-5 L12,5 Z" fill="${C.candyMint}"/><ellipse rx="6.2" ry="4.9" fill="${C.candyMint}"/><ellipse cx="-1.6" cy="-1.4" rx="2" ry="1.2" fill="#FFFFFF" opacity="0.55"/></g>
    <g transform="translate(271 341) rotate(-4)"><path d="M-5.6,0 L-12,-5 L-12,5 Z" fill="${C.wrapPink}"/><path d="M5.6,0 L12,-5 L12,5 Z" fill="${C.wrapPink}"/><ellipse rx="6.4" ry="5" fill="url(#candyGrad)"/><ellipse cx="-1.6" cy="-1.5" rx="2.1" ry="1.3" fill="#FFFFFF" opacity="0.6"/></g>
  </g>`;
}

// ---------------------------------------------------------------------------
// 5. Codex — official cloud (+ >_) head, exact logo path, sat side-on typing
//    on an L-shaped laptop; chocolate-smudged mouth; sugar-rush energy.
// ---------------------------------------------------------------------------
const CODEX_CLOUD = 'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z';
const CODEX_CHEVRON = 'M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z';
const CODEX_DASH = 'M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z';

function codexHead() {
  // head in logo path-space (24x24), scaled k, gently nodding (sugar rush)
  const k = 4.9;
  return `
  <g transform="translate(-4 -96)">
    <g>
      ${animT('rotate', ['-7', '-4.4', '-7'], [0, 0.5, 1], 0.55, { splines: ['0.4 0 0.6 1', '0.4 0 0.6 1'] })}
      <g transform="scale(${k}) translate(-12 -12)">
        <path d="${CODEX_CLOUD}" fill="url(#coxGrad)"/>
        <!-- official >_ : chevron = profile eye, dash = mouth -->
        <g transform="translate(8.85 11.93)"><g>
          ${animT('scale', ['1 1', '1 1', '1 0.12', '1 1', '1 1'], [0, 0.9, 0.93, 0.96, 1], 3.7)}
          <g transform="translate(-8.85 -11.93)"><path d="${CODEX_CHEVRON}" fill="#FFFFFF"/></g>
        </g></g>
        <g transform="translate(14.36 14.55)"><g>
          ${animT('scale', ['1 1', '1 1', '1 0.55', '1 1', '1 0.62', '1 1', '1 1'], [0, 0.55, 0.62, 0.69, 0.76, 0.83, 1], 2.8)}
          <g transform="translate(-14.36 -14.55)"><path d="${CODEX_DASH}" fill="#FFFFFF"/></g>
        </g></g>
        <!-- chocolate-smudged mouth -->
        <g fill="${C.choc}">
          <ellipse cx="12.05" cy="15.7" rx="0.85" ry="0.62" opacity="0.92"/>
          <ellipse cx="17.15" cy="14.4" rx="0.7" ry="0.55" opacity="0.88"/>
          <ellipse cx="14.6" cy="16.35" rx="1.05" ry="0.6" fill="${C.chocHi}" opacity="0.9"/>
          <ellipse cx="13.35" cy="13.2" rx="0.45" ry="0.35" opacity="0.8"/>
          <ellipse cx="16.2" cy="16.05" rx="0.55" ry="0.42" opacity="0.85"/>
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
      ${limb(-4, -14, -36, -11, 11, C.coxLimbFar, C.coxLimbEdge)}
      ${limb(-36, -11, -38, -2, 10, C.coxLimbFar, C.coxLimbEdge)}
      <ellipse cx="-42" cy="-1.5" rx="7.5" ry="4.2" fill="${C.coxLimbFar}"/>
      <!-- body -->
      <rect x="-22" y="-50" width="42" height="46" rx="18" fill="url(#coxBodyGrad)"/>
      <!-- near leg -->
      ${limb(0, -12, -32, -9, 11, C.coxLimb, C.coxLimbEdge)}
      ${limb(-32, -9, -34, 0, 10, C.coxLimb, C.coxLimbEdge)}
      <ellipse cx="-38" cy="0.5" rx="7.5" ry="4.2" fill="${C.coxLimb}"/>

      <!-- L-shaped laptop (side view: tall screen, longer keyboard deck) -->
      <g>
        <polygon points="-56,-58 -12,-86 -12,-36 -56,-22" fill="url(#screenCone)" opacity="0.14">
          ${anim('opacity', [0.09, 0.17, 0.11, 0.16, 0.09], [0, 0.3, 0.55, 0.8, 1], 1.3)}
        </polygon>
        <rect x="-64" y="-62" width="7.5" height="46" rx="2.5" fill="${C.screen}"/>
        <rect x="-57.4" y="-59" width="1.6" height="40" rx="0.8" fill="${C.screenGlow}" opacity="0.6"/>
        <rect x="-62" y="-21" width="54" height="6.5" rx="2.5" fill="${C.lap}"/>
        <rect x="-62" y="-21" width="54" height="2" rx="1" fill="${C.lapHi}"/>
      </g>

      <!-- arms hammering the keys -->
      <g>
        ${limb(-13, -41, -41, -26.5, 9, C.coxLimbFar, C.coxLimbEdge)}
        <g>${typing(0)}<circle cx="-45" cy="-24.5" r="5.2" fill="${C.coxLimbFar}"/></g>
      </g>
      <g>
        ${limb(-5, -37, -21, -24.5, 9, C.coxLimb, C.coxLimbEdge)}
        <g>${typing(1)}<circle cx="-25" cy="-22.5" r="5.2" fill="${C.coxLimb}"/></g>
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

// candy-wrapper bowtie
function wrapper(x, y, rot, col, s = 1, op = 1) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(s)})" opacity="${op}">
    <path d="M-4.5,-3 L-10,-5.5 L-9,0 L-10,5.5 L-4.5,3 Z" fill="${col}"/>
    <path d="M4.5,-3 L10,-5.5 L9,0 L10,5.5 L4.5,3 Z" fill="${col}"/>
    <rect x="-5" y="-3.6" width="10" height="7.2" rx="2" fill="${col}"/>
    <line x1="-1.4" y1="-2.4" x2="-1.4" y2="2.4" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1"/>
  </g>`;
}

function wrapperMound() {
  const cols = [C.wrapPink, C.candyViolet, C.candyGold, C.candyMint, C.candyOrange, C.candy];
  const rows = [
    { y: 387, n: 6, x0: 1072, dx: 18 },
    { y: 378, n: 5, x0: 1081, dx: 18 },
    { y: 369, n: 4, x0: 1090, dx: 18 },
    { y: 360, n: 3, x0: 1099, dx: 18 },
    { y: 352, n: 2, x0: 1108, dx: 18 },
    { y: 345, n: 1, x0: 1117, dx: 18 },
  ];
  let out = `<ellipse cx="1118" cy="390" rx="60" ry="6" fill="#2E5C33" opacity="0.16"/>`;
  let i = 0;
  for (const row of rows)
    for (let kI = 0; kI < row.n; kI++)
      out += wrapper(row.x0 + kI * row.dx + rr(-2.5, 2.5), row.y + rr(-1.5, 1.5), rr(-50, 50), cols[i++ % cols.length], rr(0.85, 1.12));
  // strays around his seat + one on the laptop deck
  out += wrapper(1000, 380, 24, C.candyMint, 0.95);
  out += wrapper(1036, 390, -33, C.candyGold, 1.0);
  out += wrapper(968, 387, 60, C.candyViolet, 0.9);
  out += wrapper(1058, 394, -12, C.candyOrange, 0.95);
  out += wrapper(1002, 327, -8, C.candy, 0.72);
  // one wrapper tumbles down the mound now and then
  out += `<g opacity="0">
    ${anim('opacity', [0, 0, 1, 1, 1, 0], [0, 0.6, 0.63, 0.93, 0.985, 1], 9)}
    <g>
      ${animT('translate', ['1117 342', '1117 342', '1100 355', '1078 372', '1072 378', '1072 378'], [0, 0.6, 0.71, 0.8, 0.84, 1], 9, { splines: ['0 0 1 1', '0.45 0 0.9 1', '0.3 0 0.8 1', '0 0 0.4 1', '0 0 1 1'] })}
      <g>
        ${animT('rotate', ['0', '0', '-210', '-210'], [0, 0.6, 0.84, 1], 9)}
        ${wrapper(0, 0, 0, C.candy, 0.95)}
      </g>
    </g>
  </g>`;
  return out;
}

// ---------------------------------------------------------------------------
// 6. Assemble
// ---------------------------------------------------------------------------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" width="1200" height="400" role="img" aria-label="sweet-search — Clawd and Codex enjoying candy around the SWEET SEARCH terminal banner">
  <title>sweet-search</title>
  <defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.skyTop}"/><stop offset="55%" stop-color="${C.skyMid}"/><stop offset="100%" stop-color="${C.skyLow}"/>
    </linearGradient>
    <linearGradient id="fieldGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.fieldHi}"/><stop offset="100%" stop-color="${C.fieldLo}"/>
    </linearGradient>
    <linearGradient id="bandGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.band0}"/><stop offset="18%" stop-color="${C.band1}"/><stop offset="36%" stop-color="${C.band2}"/>
      <stop offset="50%" stop-color="${C.band4}"/>
      <stop offset="64%" stop-color="${C.band2}"/><stop offset="82%" stop-color="${C.band1}"/><stop offset="100%" stop-color="${C.band0}"/>
    </linearGradient>
    <linearGradient id="glyphGrad" gradientUnits="userSpaceOnUse" x1="0" y1="${f(BY)}" x2="0" y2="${f(BY + artH)}">
      <stop offset="0%" stop-color="${C.glyphHi}"/><stop offset="48%" stop-color="${C.glyph}"/><stop offset="100%" stop-color="${C.glyphLo}"/>
    </linearGradient>
    <radialGradient id="candyGrad" cx="40%" cy="35%" r="70%">
      <stop offset="0%" stop-color="${C.candyHi}"/><stop offset="55%" stop-color="${C.candy}"/><stop offset="100%" stop-color="${C.candyLo}"/>
    </radialGradient>
    <linearGradient id="coxGrad" gradientUnits="userSpaceOnUse" x1="12" y1="3" x2="12" y2="21">
      <stop offset="0%" stop-color="${C.coxTop}"/><stop offset="50%" stop-color="${C.coxMid}"/><stop offset="100%" stop-color="${C.coxLow}"/>
    </linearGradient>
    <linearGradient id="coxBodyGrad" gradientUnits="userSpaceOnUse" x1="0" y1="-50" x2="0" y2="-4">
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
    ${bannerPanel()}
    ${clawd()}
    ${codex()}
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, 'utf8');
console.log(`wrote ${OUT}  (${svg.length} bytes${FREEZE ? `, frozen at t=${FREEZE}s` : ''})`);
