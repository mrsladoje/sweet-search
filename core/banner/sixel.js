/**
 * Minimal, dependency-free Sixel encoder for the terminal banner.
 *
 * Sixel renders crisp raster images on Windows Terminal (>=1.22), Konsole, xterm,
 * foot, Contour and much of Linux — terminals that lack the Kitty graphics protocol.
 *
 * We build ONE shared palette across all frames (pixel art reuses colours, so a global
 * palette is both faster and lets frames share colour definitions) and emit each frame
 * with run-length-encoded sixel bands. Fully-transparent pixels are left unset so the
 * terminal background shows through (rounded banner corners).
 */

const TRANSPARENT = -1;

function boxStats(box) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const [r, g, b] of box) {
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  const dr = rMax - rMin, dg = gMax - gMin, db = bMax - bMin;
  const range = Math.max(dr, dg, db);
  const channel = range === dr ? 0 : range === dg ? 1 : 2;
  return { range, channel };
}
function avgColor(box) {
  let r = 0, g = 0, b = 0;
  for (const c of box) { r += c[0]; g += c[1]; b += c[2]; }
  const n = box.length || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** Median-cut quantisation over a sample of opaque colours. Returns up to maxColors [r,g,b]. */
export function buildPalette(samples, maxColors = 255) {
  if (samples.length === 0) return [[0, 0, 0]];
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const { range } = boxStats(boxes[i]);
      if (range > best) { best = range; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    const { channel } = boxStats(box);
    box.sort((a, b) => a[channel] - b[channel]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map(avgColor);
}

/** Fast rgb->palette-index mapper with a per-colour cache (pixel art has few unique colours). */
export function makeMapper(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache.set(key, best);
    return best;
  };
}

/** Collect a colour sample from a raw RGBA frame (every `step`-th opaque pixel). */
export function sampleColors(rgba, step = 7) {
  const out = [];
  for (let i = 0; i < rgba.length; i += 4 * step) {
    if (rgba[i + 3] >= 128) out.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return out;
}

/** Encode one RGBA frame to a Sixel string using a shared palette + mapper. */
export function encodeSixelFrame(rgba, width, height, palette, mapper) {
  // index buffer: palette index per pixel, or TRANSPARENT
  const idx = new Int16Array(width * height);
  for (let p = 0, o = 0; p < idx.length; p++, o += 4) {
    idx[p] = rgba[o + 3] < 128 ? TRANSPARENT : mapper(rgba[o], rgba[o + 1], rgba[o + 2]);
  }

  let s = '\x1bP0;1;0q';                 // DCS; P2=1 => 0-bit pixels stay transparent
  s += `"1;1;${width};${height}`;        // raster attributes (1:1 aspect)
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i];
    s += `#${i};2;${Math.round(r / 255 * 100)};${Math.round(g / 255 * 100)};${Math.round(b / 255 * 100)}`;
  }

  const used = [];
  for (let by = 0; by < height; by += 6) {
    const bandH = Math.min(6, height - by);
    // which palette indices appear in this band
    used.length = 0;
    const seen = new Set();
    for (let y = by; y < by + bandH; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) { const c = idx[row + x]; if (c !== TRANSPARENT && !seen.has(c)) { seen.add(c); used.push(c); } }
    }
    for (let u = 0; u < used.length; u++) {
      const ci = used[u];
      if (u > 0) s += '$';               // return to band start, overlay next colour
      s += `#${ci}`;
      let runChar = -1, runLen = 0, line = '';
      for (let x = 0; x < width; x++) {
        let bits = 0;
        for (let k = 0; k < bandH; k++) if (idx[(by + k) * width + x] === ci) bits |= (1 << k);
        const ch = 63 + bits;
        if (ch === runChar) { runLen++; }
        else { if (runLen) line += runLen > 3 ? `!${runLen}${String.fromCharCode(runChar)}` : String.fromCharCode(runChar).repeat(runLen); runChar = ch; runLen = 1; }
      }
      if (runLen) line += runLen > 3 ? `!${runLen}${String.fromCharCode(runChar)}` : String.fromCharCode(runChar).repeat(runLen);
      s += line;
    }
    s += '-';                            // graphics newline
  }
  s += '\x1b\\';                         // ST
  return s;
}
