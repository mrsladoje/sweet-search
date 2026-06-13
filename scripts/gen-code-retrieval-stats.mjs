#!/usr/bin/env node
// Generates assets/code-retrieval-stats.svg — a benchmark headline card with a
// pixelated dark-blue border (banner-style stepped rounded corners) and faint
// pixel-candy decorations, on a light background. Headline numbers are a clean
// readable sans (NOT pixelated); only the border + decorations are pixel art.
//
// Re-run after editing stats:  node scripts/gen-code-retrieval-stats.mjs
// then compress:               npx svgo --config scripts/svgo.stats.mjs assets/code-retrieval-stats.svg
import { writeFileSync } from 'node:fs';

const W = 920, H = 150;

// ---- palette --------------------------------------------------------------
const BG = '#f3f5fb';          // light card interior
const BORDER = '#1f2d6b';      // dark blue pixel border
const BORDER_HI = '#3b4da0';   // subtle inner-edge highlight
const CAPTION = '#94a3b8';
const LABEL = '#5b6b87';
// readable headline colors (candy hues, darkened to read on light bg)
const C_GREEN = '#0e9f6e', C_PURPLE = '#7c3aed', C_AMBER = '#d97706', C_PINK = '#db2777';
// soft candy hues for background decoration
const SOFT = ['#ff5ba3', '#a78bfa', '#ffc247', '#3fd08f', '#5a73dc', '#fb7185'];

// ---- helpers --------------------------------------------------------------
// merge horizontal runs of '1' in a grid -> rect strings (crispEdges friendly)
function gridRects(grid, ox, oy, cs) {
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] === '1') {
        let run = 1;
        while (c + run < row.length && row[c + run] === '1') run++;
        out.push(`<rect width="${run * cs}" height="${cs}" x="${ox + c * cs}" y="${oy + r * cs}"/>`);
        c += run;
      } else c++;
    }
  }
  return out.join('');
}

// pixelated rounded-rect silhouette as horizontal bands.
// corner = inset (px) applied to the top N bands (each `step` tall), mirrored at bottom.
function pixelRoundRect(x, y, w, h, step, corner) {
  const n = corner.length;
  const bands = [];
  for (let i = 0; i < n; i++) {                       // top corner bands
    const ins = corner[i];
    bands.push(`<rect x="${x + ins}" y="${y + i * step}" width="${w - 2 * ins}" height="${step}"/>`);
  }
  const midY = y + n * step;
  const midH = h - 2 * n * step;
  bands.push(`<rect x="${x}" y="${midY}" width="${w}" height="${midH}"/>`); // straight body
  for (let i = 0; i < n; i++) {                       // bottom corner bands (mirror)
    const ins = corner[n - 1 - i];
    bands.push(`<rect x="${x + ins}" y="${y + h - (n - i) * step}" width="${w - 2 * ins}" height="${step}"/>`);
  }
  return bands.join('');
}

// ---- pixel candy sprites (grid strings, '1' = fill) -----------------------
const CANDY = {
  bonbon: [   // wrapped candy / bow-tie
    '100000001',
    '110111011',
    '111111111',
    '110111011',
    '100000001',
  ],
  round: [    // peppermint blob
    '00111100',
    '01111110',
    '11111111',
    '11111111',
    '01111110',
    '00111100',
  ],
  lolly: [    // lollipop: round head + stick
    '01110',
    '11111',
    '11111',
    '01110',
    '00100',
    '00100',
    '00100',
  ],
  drop: [     // gumdrop
    '00100',
    '01110',
    '11111',
    '11111',
    '11111',
  ],
};

function candy(type, x, y, cs, color, op) {
  return `<g fill="${color}" opacity="${op}">${gridRects(CANDY[type], x, y, cs)}</g>`;
}

// ---- build ----------------------------------------------------------------
const STEP = 6;                 // pixel grid for the border staircase
const CORNER = [18, 12, 6];     // 3-step pixelated rounded corner
const T = STEP;                 // border thickness

// outer dark-blue silhouette, then light interior inset by T -> leaves the border
const outer = pixelRoundRect(0, 0, W, H, STEP, CORNER);
// lighter-blue ring inset by T, then the light fill inset by 2T -> two-tone pixel border
const hiRing = pixelRoundRect(T, T, W - 2 * T, H - 2 * T, STEP, CORNER);
const fill = pixelRoundRect(2 * T, 2 * T, W - 4 * T, H - 4 * T, STEP, CORNER);

// faint background candies — spread out, low opacity, behind the text
const decos = [
  ['round',   40,  34, 5, SOFT[2], 0.14],
  ['bonbon', 150,  98, 4, SOFT[0], 0.12],
  ['drop',   268,  30, 5, SOFT[3], 0.13],
  ['lolly',  300, 100, 4, SOFT[1], 0.11],
  ['bonbon', 430,  96, 5, SOFT[4], 0.10],
  ['round',  500,  28, 4, SOFT[5], 0.13],
  ['drop',   636,  98, 5, SOFT[1], 0.12],
  ['lolly',  690,  26, 4, SOFT[3], 0.12],
  ['round',  812,  96, 5, SOFT[0], 0.12],
  ['bonbon', 858,  30, 4, SOFT[2], 0.12],
  ['drop',    98,  98, 4, SOFT[1], 0.10],
  ['lolly',  560, 100, 4, SOFT[5], 0.10],
].map(([t, x, y, cs, col, op]) => candy(t, x, y, cs, col, op)).join('');

// tiny solid candy "sprinkles" tucked into the four corners
const sprinkles = [
  [22, 22, C_PINK], [W - 28, 22, C_AMBER],
  [22, H - 28, C_PURPLE], [W - 28, H - 28, C_GREEN],
].map(([x, y, c]) => `<rect width="6" height="6" x="${x}" y="${y}" fill="${c}" opacity="0.85"/>`).join('');

// dividers: light pixel dashes between cells
let dividers = '';
for (const dx of [230, 460, 690]) {
  for (let yy = 46; yy <= 104; yy += 12) {
    dividers += `<rect width="2" height="6" x="${dx - 1}" y="${yy}"/>`;
  }
}

const cells = [
  { cx: 115, num: '−34%',  label: 'LOWER COST · CODEX',     color: C_GREEN },
  { cx: 345, num: '−56%',  label: 'FEWER TOOL CALLS',           color: C_PURPLE },
  { cx: 575, num: '1.5–2×', label: 'USEFUL CONTEXT / RESP', color: C_AMBER },
  { cx: 805, num: '+3pp',       label: 'ACCURACY · WEAK MODELS', color: C_PINK },
];
const numbers = cells.map(c =>
  `<text x="${c.cx}" y="80" fill="${c.color}" font-size="38" font-weight="800">${c.num}</text>`
).join('');
const labels = cells.map(c =>
  `<text x="${c.cx}" y="104" fill="${LABEL}" font-size="12" letter-spacing="0.4">${c.label}</text>`
).join('');

const aria = 'Code-retrieval headline: up to 34 percent lower cost on Codex, ' +
  'up to 56 percent fewer tool calls, 1.5 to 2 times more useful context per response, ' +
  'and plus 3 percentage points accuracy on weak models.';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" shape-rendering="crispEdges" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">` +
  `<g fill="${BORDER}">${outer}</g>` +
  `<g fill="${BORDER_HI}">${hiRing}</g>` +
  `<g fill="${BG}">${fill}</g>` +
  decos +
  sprinkles +
  `<g fill="#ccd5ea">${dividers}</g>` +
  `<g text-anchor="middle">` +
  `<text x="${W / 2}" y="28" fill="${CAPTION}" font-size="11" letter-spacing="1.2">SWEET-SEARCH vs. NATIVE GREP-AND-READ · PAIRED · FDR-CONTROLLED · 11 CELLS</text>` +
  numbers + labels +
  `</g></svg>`;

writeFileSync(new URL('../assets/code-retrieval-stats.svg', import.meta.url), svg + '\n');
console.log('wrote assets/code-retrieval-stats.svg', svg.length, 'bytes');
