#!/usr/bin/env node
// Generates assets/code-retrieval-stats.svg — the held-out code-retrieval card (ho1005):
// 5 model × harness cells, sweet-search vs native, 200 questions × 3 reps.
// Source: core/prompt-optimization/data/final-run/HO1005-RESULTS.md (aggregates only).
//
// Re-run after editing stats:  node scripts/gen-code-retrieval-stats.mjs
// then compress (lossless):    npx svgo --config scripts/svgo.stats.mjs assets/code-retrieval-stats.svg
import { writeFileSync } from 'node:fs';

const W = 920, H = 372;
// value colour classes: a = accuracy win, c = cost win, k = calls win, x = not significant after BH, w = significant, worse than native
const GOOD = { acc: 'a', billed: 'c', calls: 'k' };

// sig: 'g' = significant win, 'b' = significant loss, 'n' = not significant (BH q = 0.05)
const rows = [
  { model: 'Sonnet 5.5 high', harness: 'Claude Code', bar: '#a78bfa',
    acc: ['+2.4%', 'g', '89.9 / 87.9'], billed: ['−7.6%', 'g', '$0.059 / $0.064'], calls: ['−14.1%', 'g', '4.2 / 4.9'] },
  { model: 'Opus 5.5 medium', harness: 'Claude Code', bar: '#a78bfa',
    acc: ['+0.2%', 'n', '89.1 / 88.9'], billed: ['−9.5%', 'g', '$0.073 / $0.081'], calls: ['−22.8%', 'g', '3.0 / 3.9'] },
  { model: 'Opus 5.5 high', harness: 'Claude Code', bar: '#a78bfa',
    acc: ['−0.5%', 'n', '90.6 / 91.1'], billed: ['−9.5%', 'g', '$0.081 / $0.089'], calls: ['−22.8%', 'g', '3.2 / 4.2'] },
  { model: 'Sol 6.1 high', harness: 'opencode', bar: '#ffc247',
    acc: ['−2.8%', 'b', '86.9 / 89.3'], billed: ['−50.2%', 'g', '$0.030 / $0.061'], calls: ['−33.1%', 'g', '7.5 / 11.2'] },
  { model: 'Sol 6.1 high', harness: 'Codex', bar: '#3fd08f',
    acc: ['−2.5%', 'b', '85.8 / 88.0'], billed: ['−7.7%', 'g', '$0.043 / $0.047'], calls: ['+0.6%', 'n', '4.4 / 4.4'] },
];
const cols = [['acc', 422, 'Accuracy'], ['billed', 607, 'Billed cost'], ['calls', 792, 'Tool calls']];

// pixelated rounded rect as one path: 3-step corners of `s` px, inset i
const frame = (i, s = 6) => {
  const x = i, y = i, w = W - 2 * i, h = H - 2 * i;
  return `M${x + 3 * s} ${y}h${w - 6 * s}v${s}h${s}v${s}h${s}v${s}h${s}v${h - 6 * s}h-${s}v${s}h-${s}v${s}h-${s}v${s}H${x + 3 * s}v-${s}h-${s}v-${s}h-${s}v-${s}h-${s}V${y + 3 * s}h${s}v-${s}h${s}v-${s}h${s}z`;
};
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h-${w}z`;
const T0 = 90, RH = 46, GAP = 49;
const rowY = i => T0 + i * GAP;
const colour = (k, s) => (s === 'g' ? GOOD[k] : s === 'b' ? 'w' : 'x');

let body = '';
rows.forEach((r, i) => {
  const y = rowY(i);
  body += `<text x="51" y="${y + 29}" class="n">${r.model}</text><text x="262" y="${y + 28}" class="m">${r.harness}</text>`;
  for (const [k, cx] of cols) {
    const [v, s, sub] = r[k];
    body += `<text x="${cx}" y="${y + 23}" class="v ${colour(k, s)}">${v}</text><text x="${cx}" y="${y + 39}" class="s">${sub}</text>`;
  }
});

const aria = 'Held-out code-retrieval results, sweet-search versus native grep-and-read, 200 questions, 3 reps. ' +
  'Claude Code: Sonnet 5.5 high accuracy plus 2.4 percent, billed cost minus 7.6 percent; Opus 5.5 medium and high accuracy plus 0.2 and minus 0.5 percent, not significant, billed cost minus 9.5 percent, tool calls minus 22.8 percent. ' +
  'opencode with Sol 6.1: accuracy minus 2.8 percent, billed cost minus 50.2 percent. Codex with Sol 6.1: accuracy minus 2.5 percent, billed cost minus 7.7 percent; tool calls equal.';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" fill="#1f2d6b" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji,sans-serif" font-weight="800" shape-rendering="crispEdges" text-anchor="middle">` +
  `<style>.v{font-size:21px}.s,.h,.l{fill:#65738d;font-size:12px;font-weight:700}.s{font-size:9.5px;font-weight:600;letter-spacing:0}.l{font-weight:600;letter-spacing:.4px}.n,.l{text-anchor:start}.n{font-size:15.5px}.m{font-size:14.5px;font-weight:700}.a{fill:#db2777}.c{fill:#0e9f6e}.k{fill:#7c3aed}.x{fill:#7b88a3}.w{fill:#c2410c}</style>` +
  `<path d="${frame(0)}"/><path fill="#3b4da0" d="${frame(6)}"/><path fill="#f3f5fb" d="${frame(12)}"/>` +
  `<path fill="#db2777" opacity=".85" d="${rect(22, 22, 6, 6)}"/><path fill="#d97706" opacity=".85" d="${rect(892, 22, 6, 6)}"/>` +
  `<path fill="#7c3aed" opacity=".85" d="${rect(22, H - 28, 6, 6)}"/><path fill="#0e9f6e" opacity=".85" d="${rect(892, H - 28, 6, 6)}"/>` +
  `<path fill="#ffc247" opacity=".14" d="M44 39h12v4H44zm-4 4h20v4H40zm-4 4h28v4H36zm4 4h20v4H40zm4 4h12v4H44z"/>` +
  `<path fill="#ff5ba3" opacity=".12" d="M858 39h4v4h-4zm24 0h4v4h-4zm-24 4h8v4h-8zm8 4h8v4h-8zm8-4h8v4h-8zm-16 8h28v4h-28z"/>` +
  `<g font-size="18"><text x="300" y="48">🍬 sweet-search</text><text x="460" y="48" fill="#7b88a3" font-size="14">vs.</text><text x="635" y="48">🐌 native grep-and-read</text></g>` +
  `<g class="h"><text x="50" y="82" text-anchor="start">Model</text><text x="262" y="82">Harness</text>${cols.map(([, cx, t]) => `<text x="${cx}" y="82">${t}</text>`).join('')}</g>` +
  `<path fill="#fff" d="${[0, 2, 4].map(i => rect(35, rowY(i), 850, RH)).join('')}"/>` +
  `<path fill="#e9edf7" d="${[1, 3].map(i => rect(35, rowY(i), 850, RH)).join('')}"/>` +
  rows.map((r, i) => `<path fill="${r.bar}" d="${rect(35, rowY(i), 6, RH)}"/>`).join('') +
  `<path fill="#ccd5ea" d="${[195, 330, 515, 700].map(x => rect(x, T0, 2, rowY(4) + RH - T0)).join('')}"/>` +
  body +
  `</svg>`;

writeFileSync(new URL('../assets/code-retrieval-stats.svg', import.meta.url), svg + '\n');
console.log('wrote assets/code-retrieval-stats.svg', svg.length, 'bytes');
