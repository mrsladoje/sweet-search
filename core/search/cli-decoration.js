/**
 * CLI decoration rendering for sweet-search tools.
 *
 * Pure presentation: ANSI styling, the pixel-art banner, the stats line, and a
 * compact per-tool identity line. WHERE these may be emitted is decided by
 * output-policy.js — this module only renders to the channel the policy chose.
 *
 * Kept dependency-light (only output-policy + node:fs) so the read/trace/
 * semantic tools can import it without pulling the search engine.
 */

import { createDecorationWriter, detectOutputPolicy } from './output-policy.js';

// =============================================================================
// CLI STYLING (ANSI truecolor w/ fallback)
// =============================================================================

export const STYLE = (() => {
  // 5 shades of dark blue (edge -> center)
  const colors = {
    darkest:       { r: 6,   g: 10,  b: 31  },
    darker:        { r: 10,  g: 17,  b: 52  },
    dark:          { r: 14,  g: 24,  b: 73  },
    lightDark:     { r: 18,  g: 32,  b: 95  },
    lightestDark:  { r: 22,  g: 40,  b: 116 },
    border:        { r: 90,  g: 115, b: 220 },
    white:         { r: 255, g: 255, b: 255 },
  };

  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  const lerp = (c1, c2, t) => ({
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  });

  // Convert RGB to xterm-256 color code (fallback for terminals without truecolor)
  const rgbToAnsi256 = (r, g, b) => {
    // Grayscale range
    if (r === g && g === b) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return Math.round(((r - 8) / 247) * 24) + 232;
    }

    const to6 = (v) => Math.round((v / 255) * 5);
    const rr = to6(r);
    const gg = to6(g);
    const bb = to6(b);
    return 16 + (36 * rr) + (6 * gg) + bb;
  };

  const fg24 = (c) => `\x1b[38;2;${c.r};${c.g};${c.b}m`;
  const bg24 = (c) => `\x1b[48;2;${c.r};${c.g};${c.b}m`;

  const fg256 = (c) => `\x1b[38;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;
  const bg256 = (c) => `\x1b[48;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;

  const detectColorMode = () => {
    const forced = (process.env.SWEET_SEARCH_COLOR_MODE || process.env.SMART_SEARCH_COLOR_MODE || '').trim().toLowerCase();
    if (forced === 'none' || forced === '0' || forced === 'off') return 'none';
    if (forced === '256' || forced === 'ansi256' || forced === 'xterm256') return 'ansi256';
    if (forced === 'truecolor' || forced === '24bit' || forced === 'rgb') return 'truecolor';

    if (process.env.NO_COLOR) return 'none';

    const colorterm = process.env.COLORTERM || '';
    if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';

    // Windows Terminal + VS Code terminals are typically truecolor-capable.
    if (process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode') return 'truecolor';

    const term = process.env.TERM || '';
    if (/256color/i.test(term)) return 'ansi256';

    return 'none';
  };

  const colorMode = detectColorMode(); // 'truecolor' | 'ansi256' | 'none'
  const fg = colorMode === 'truecolor' ? fg24 : colorMode === 'ansi256' ? fg256 : () => '';
  const bg = colorMode === 'truecolor' ? bg24 : colorMode === 'ansi256' ? bg256 : () => '';

  const headerStyleEnv = (process.env.SWEET_SEARCH_HEADER_STYLE || process.env.SMART_SEARCH_HEADER_STYLE || '').trim().toLowerCase();
  const headerStyle =
    headerStyleEnv === 'zones' || headerStyleEnv === 'gradient'
      ? headerStyleEnv
      : (colorMode === 'truecolor' ? 'gradient' : 'zones');

  return {
    colors,
    fg,
    bg,
    reset: colorMode === 'none' ? '' : reset,
    bold: colorMode === 'none' ? '' : bold,
    lerp,
    colorMode,
    headerStyle,
  };
})();

// Colorless style — same geometry as STYLE but emits no ANSI escapes. Used when
// the output policy keeps the banner but disables color (e.g. NO_COLOR set, or a
// captured /dev/tty side-channel where we still want plain pixel art).
export const PLAIN_STYLE = {
  colors: STYLE.colors,
  fg: () => '',
  bg: () => '',
  reset: '',
  bold: '',
  lerp: STYLE.lerp,
  colorMode: 'none',
  headerStyle: STYLE.headerStyle,
};

// Default line writer for decoration when no policy writer is supplied: stdout.
const _stdoutLine = (line = '') => process.stdout.write(`${line}\n`);

// 2-line pixel art using half-blocks - SWEET SEARCH
const SWEET_SEARCH_L1 = '█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█';
const SWEET_SEARCH_L2 = '▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█';

// Per-tool glyphs so each of the six tools is recognizable at a glance.
const TOOL_ICONS = {
  search: '✨',
  lexical: '⚡',
  semantic: '🧠',
  hybrid: '⚗️',
  pattern: '⌗',
  grep: '#',
  structural: '🔗',
  trace: '🔗',
  read: '📄',
  'read-semantic': '🧠',
};

/**
 * Print styled header - 2-line pixel art with query on right = 2 content lines.
 *
 * @param {string} query
 * @param {Object} [opts]
 * @param {(line?: string) => void} [opts.write]  line writer (default: stdout)
 * @param {Object} [opts.style]                   STYLE or PLAIN_STYLE
 */
export function printStyledHeader(query, opts = {}) {
  const write = opts.write || _stdoutLine;
  const width = Math.min(process.stdout.columns || 80, 80);
  const { colors, fg, bg, reset, bold } = opts.style || STYLE;

  const artLen = SWEET_SEARCH_L2.length;
  const maxQueryLen = width - artLen - 8;
  const displayQuery = query.length > maxQueryLen
    ? query.slice(0, maxQueryLen - 3) + '...'
    : query;

  const palette = [
    colors.darkest,
    colors.darker,
    colors.dark,
    colors.lightDark,
    colors.lightestDark,
  ];

  const getBgColor = (i, w) => {
    const pos = i / Math.max(1, w - 1);
    const t = 1 - Math.abs(0.5 - pos) * 2;
    const zone = Math.min(Math.floor(t * palette.length), palette.length - 1);
    return palette[zone];
  };

  const buildLine = (leftContent, rightContent = null, isArt = false) => {
    let result = '';
    const leftPad = 2;
    const rightPad = 2;
    const rightStart = rightContent ? width - rightPad - rightContent.length : width;

    for (let i = 0; i < width; i++) {
      const bgColor = getBgColor(i, width);
      const leftCharIdx = i - leftPad;
      const rightCharIdx = i - rightStart;

      if (rightContent && rightCharIdx >= 0 && rightCharIdx < rightContent.length) {
        result += bold + fg(colors.white) + bg(bgColor) + rightContent[rightCharIdx];
      } else if (leftCharIdx >= 0 && leftCharIdx < leftContent.length) {
        const fgColor = isArt ? colors.border : colors.white;
        result += bold + fg(fgColor) + bg(bgColor) + leftContent[leftCharIdx];
      } else {
        result += bg(bgColor) + ' ';
      }
    }
    return result + reset;
  };

  const queryStr = `"${displayQuery}"`;

  write('');
  write(buildLine(SWEET_SEARCH_L1, null, true));
  write(buildLine(SWEET_SEARCH_L2, queryStr, true));
}

/**
 * Print styled stats line. The mode glyph distinguishes search-family variants
 * (lexical/semantic/hybrid/pattern/grep), giving each its own identity.
 *
 * @param {Object} stats
 * @param {boolean} [isWarm=false]
 * @param {Object} [opts]
 * @param {(line?: string) => void} [opts.write]  line writer (default: stdout)
 * @param {Object} [opts.style]                   STYLE or PLAIN_STYLE
 */
export function printStyledStats(stats, isWarm = false, opts = {}) {
  const write = opts.write || _stdoutLine;
  const { colors, fg, reset } = opts.style || STYLE;
  const mode = stats.routing?.mode || stats.mode || 'auto';
  const pathType = stats.path || 'hybrid';
  const timeMs = stats.server_ms || stats.total_ms || 0;

  const modeIcon = TOOL_ICONS[mode] || '◆';
  const warmIcon = isWarm ? `${fg(colors.border)}●${reset}` : `${fg(colors.darker)}○${reset}`;

  write(
    `  ${modeIcon} ${fg(colors.white)}${mode}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.border)}${pathType}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.white)}${timeMs}ms${reset} ${warmIcon}`
  );
  write('');
}

/**
 * Emit the search banner (header + stats) on the channel the policy chose.
 * Results always go to stdout separately; this only handles decoration. When
 * the policy disables the banner, nothing is written.
 */
export function emitDecoration(policy, query, stats, isWarm) {
  if (!policy.bannerEnabled) return;
  const style = policy.colorEnabled ? STYLE : PLAIN_STYLE;
  const deco = createDecorationWriter(policy);
  try {
    printStyledHeader(query, { write: deco.write, style });
    printStyledStats(stats, isWarm, { write: deco.write, style });
  } finally {
    deco.close();
  }
}

/**
 * Convenience wrapper: resolve the output policy from the current environment +
 * stdout, then emit the tool identity. Used by the read/trace/semantic CLIs.
 *
 * @param {string} tool
 * @param {string} [detail]
 * @param {{plain?: boolean, noBanner?: boolean}} [flags]
 */
export function emitToolIdentityAuto(tool, detail = '', flags = {}) {
  const policy = detectOutputPolicy({
    format: flags.plain ? 'plain' : null,
    noBanner: !!flags.noBanner,
    env: process.env,
    stream: process.stdout,
  });
  emitToolIdentity(policy, tool, detail);
}

/**
 * Emit a compact, branded one-line identity for a tool (read/trace/semantic and
 * any other tool that should not carry the full banner). Routed to the policy's
 * decoration channel; a no-op when the policy disables the banner.
 *
 * @param {import('./output-policy.js').OutputPolicy} policy
 * @param {string} tool    e.g. 'read', 'trace', 'read-semantic'
 * @param {string} [detail] short context shown after the tool name
 */
export function emitToolIdentity(policy, tool, detail = '') {
  if (!policy || !policy.bannerEnabled) return;
  const style = policy.colorEnabled ? STYLE : PLAIN_STYLE;
  const { colors, fg, reset, bold } = style;
  const icon = TOOL_ICONS[tool] || '✦';
  const deco = createDecorationWriter(policy);
  try {
    const sep = `${fg(colors.dark)}·${reset}`;
    const detailStr = detail ? ` ${sep} ${fg(colors.border)}${detail}${reset}` : '';
    deco.write('');
    deco.write(
      `  ${icon} ${bold}${fg(colors.white)}sweet-search${reset} ${sep} ${fg(colors.white)}${tool}${reset}${detailStr}`,
    );
  } finally {
    deco.close();
  }
}
