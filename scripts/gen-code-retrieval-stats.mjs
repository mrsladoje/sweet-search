#!/usr/bin/env node
// Generates assets/code-retrieval-stats.svg — a pixel-art benchmark headline
// styled to match assets/sweet-search-banner-pixelated.svg (crispEdges 4px grid,
// candy palette, dark terminal panel, animated candy sweep, pixel sparkles).
//
// Re-run after editing stats:  node scripts/gen-code-retrieval-stats.mjs
// then compress:               npx svgo assets/code-retrieval-stats.svg
import { writeFileSync } from 'node:fs';

// ---- 5x7 pixel font (1 = filled). Rows top->bottom. -----------------------
const G = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11111','00010','00100','00010','00001','10001','01110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
  '%': ['11001','11010','00100','00100','01000','10011','00011'],
  'x': ['00000','10001','01010','00100','01010','10001','00000'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  'p': ['00000','00000','11100','10010','11100','10000','10000'],
};

const PX = 6;           // pixel size on the 4px-spirited grid (multiple-of-2)
const COLS = 5, ROWS = 7;

// width (svg units) of a rendered string in the pixel font
function strWidth(s) {
  return s.length * COLS * PX + (s.length - 1) * PX; // 1-col gap between glyphs
}

// emit merged horizontal-run rects for one glyph string, centered on cx, top y0
function pixelText(s, cx, y0, fill) {
  const w = strWidth(s);
  let x0 = Math.round(cx - w / 2);
  const out = [];
  let penX = x0;
  for (const ch of s) {
    const g = G[ch];
    if (!g) { penX += (COLS + 1) * PX; continue; }
    for (let r = 0; r < ROWS; r++) {
      const row = g[r];
      let c = 0;
      while (c < COLS) {
        if (row[c] === '1') {
          let run = 1;
          while (c + run < COLS && row[c + run] === '1') run++;
          out.push(`<rect width="${run * PX}" height="${PX}" x="${penX + c * PX}" y="${y0 + r * PX}"/>`);
          c += run;
        } else c++;
      }
    }
    penX += (COLS + 1) * PX;
  }
  return `<g fill="${fill}">${out.join('')}</g>`;
}

// pixel sparkle (4-point candy star) centered at (cx,cy)
function sparkle(cx, cy, fill, op = 1) {
  return `<g fill="${fill}" opacity="${op}">` +
    `<rect width="12" height="4" x="${cx - 6}" y="${cy - 2}"/>` +
    `<rect width="4" height="12" x="${cx - 2}" y="${cy - 6}"/>` +
    `<rect width="4" height="4" x="${cx - 8}" y="${cy - 2}"/>` +
    `<rect width="4" height="4" x="${cx + 4}" y="${cy - 2}"/>` +
    `<rect width="4" height="4" x="${cx - 2}" y="${cy - 8}"/>` +
    `<rect width="4" height="4" x="${cx - 2}" y="${cy + 4}"/></g>`;
}

// ---- content --------------------------------------------------------------
const W = 920, H = 150;
const PINK = '#ff5ba3', PURPLE = '#a78bfa', GOLD = '#ffc247', GREEN = '#3fd08f';
const cells = [
  { cx: 115, num: '-34%',   label: 'LOWER COST · CODEX',     color: GREEN },
  { cx: 345, num: '-56%',   label: 'FEWER TOOL CALLS',       color: PURPLE },
  { cx: 575, num: '1.5-2x', label: 'USEFUL CONTEXT / RESP',  color: GOLD },
  { cx: 805, num: '+3pp',   label: 'ACCURACY · WEAK MODELS', color: PINK },
];
const NUM_TOP = 50;                       // top y of the 7-row pixel number
const NUM_CY = NUM_TOP + (ROWS * PX) / 2; // vertical center
const LABEL_Y = 116;

// dividers as pixel dashes
let dividers = '';
for (const dx of [230, 460, 690]) {
  for (let y = 44; y <= 92; y += 12) {
    dividers += `<rect width="2" height="6" x="${dx - 1}" y="${y}"/>`;
  }
}

// scattered faint background sparkles (purely decorative)
const bgSparkles = [
  sparkle(60, 30, PURPLE, 0.16), sparkle(190, 124, GREEN, 0.16),
  sparkle(420, 28, GOLD, 0.14), sparkle(700, 126, PINK, 0.16),
  sparkle(880, 30, PURPLE, 0.14),
].join('');

// hero sparkles next to each number, in the cell color
const heroSparkles = cells.map(c =>
  sparkle(Math.round(c.cx + strWidth(c.num) / 2 + 16), NUM_TOP + 6, c.color, 0.9)
).join('');

const numbers = cells.map(c => pixelText(c.num, c.cx, NUM_TOP, c.color)).join('');

const labels = cells.map(c =>
  `<text x="${c.cx}" y="${LABEL_Y}" fill="#8aa0c6" font-size="12" letter-spacing="0.5">${c.label.replace(/&/g, '&amp;')}</text>`
).join('');

const aria = 'Code-retrieval headline: up to 34 percent lower cost on Codex, ' +
  'up to 56 percent fewer tool calls, 1.5 to 2 times more useful context per response, ' +
  'and plus 3 percentage points accuracy on weak models.';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" shape-rendering="crispEdges" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"><defs>` +
  `<linearGradient id="bg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#131a3a"/><stop offset="1" stop-color="#070b1c"/></linearGradient>` +
  `<linearGradient id="candy" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#a78bfa" stop-opacity="0"/><stop offset="15%" stop-color="#a78bfa"/><stop offset="40%" stop-color="#3fd08f"/><stop offset="62%" stop-color="#ffc247"/><stop offset="85%" stop-color="#ff5ba3"/><stop offset="100%" stop-color="#ff5ba3" stop-opacity="0"/></linearGradient>` +
  `<clipPath id="round"><rect width="${W}" height="${H}" rx="16"/></clipPath>` +
  `</defs>` +
  `<g clip-path="url(#round)">` +
  `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
  // top + bottom candy hairlines
  `<rect width="${W}" height="3" x="0" y="0" fill="url(#candy)" opacity="0.85"/>` +
  `<rect width="${W}" height="3" x="0" y="${H - 3}" fill="url(#candy)" opacity="0.5"/>` +
  bgSparkles +
  `<g fill="#243056">${dividers}</g>` +
  numbers +
  heroSparkles +
  // top caption
  `<text x="${W / 2}" y="26" fill="#5f74a6" font-size="11" letter-spacing="1.5" text-anchor="middle">SWEET-SEARCH vs. NATIVE GREP-AND-READ · PAIRED · FDR-CONTROLLED · 11 CELLS</text>` +
  `<g text-anchor="middle" fill="#8aa0c6">${labels}</g>` +
  // animated candy sweep across the panel
  `<rect width="260" height="${H}" x="0" y="0" fill="url(#candy)" opacity="0" style="mix-blend-mode:screen"><animate attributeName="opacity" begin="0s" dur="9s" keyTimes="0;0.05;0.45;0.5;1" repeatCount="indefinite" values="0;0.22;0.22;0;0"/><animate attributeName="x" begin="0s" dur="9s" keyTimes="0;0.5;1" repeatCount="indefinite" values="-260;${W};${W}"/></rect>` +
  `</g></svg>`;

writeFileSync(new URL('../assets/code-retrieval-stats.svg', import.meta.url), svg + '\n');
console.log('wrote assets/code-retrieval-stats.svg', svg.length, 'bytes');
