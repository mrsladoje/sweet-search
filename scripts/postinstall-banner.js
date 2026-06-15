#!/usr/bin/env node
/**
 * postinstall — print a short "what next" message after install.
 *
 * npm pipes postinstall stdout (and swallows it for `-g`), so we write to the
 * controlling terminal (/dev/tty) directly — same reason the message vanished
 * when we used process.stdout. It is deliberately PLAIN TEXT (no graphics /
 * animation): during `npm install` npm writes its own spinner to the same
 * terminal concurrently, which would corrupt a large chunked escape sequence
 * (the base64 garbage we saw) — a short text line is atomic and safe. The rich
 * animated banner is reserved for `sweet-search init` / `index`, where we own
 * the TTY. Best-effort; never throws.
 */
import process from 'node:process';
import { openSync, writeSync, closeSync } from 'node:fs';

function run() {
  const env = process.env;
  if (env.NO_BANNER || env.SWEET_SEARCH_NO_BANNER) return;

  // Choose a real-terminal sink: stdout if it's already a TTY (foreground
  // scripts), otherwise the controlling terminal. Windows has no /dev/tty →
  // the banner shows on `init`/`index` instead.
  let fd = -1;
  const useStdout = !!process.stdout.isTTY;
  if (!useStdout) {
    if (process.platform === 'win32') return;
    try { fd = openSync('/dev/tty', 'w'); } catch { return; } // no controlling terminal → skip
  }

  const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
  // SWEET SEARCH half-block wordmark (kept in sync with core/search/cli-decoration.js).
  const L1 = '█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█';
  const L2 = '▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█';
  const msg = [
    '',
    `  ${c('1;38;2;90;115;220', L1)}`,
    `  ${c('1;38;2;90;115;220', L2)}`,
    '',
    `  ${c('1', 'Get started:')}`,
    `    ${c('36', 'sweet-search init')}        set up the current project`,
    `    ${c('36', 'sweet-search index')}       build the search index`,
    `    ${c('36', 'sweet-search "query"')}     search your code`,
    `  ${c('2', '(installed locally? prefix with')} ${c('2;36', 'npx')}${c('2', ')')}`,
    '',
    '',
  ].join('\n');

  try {
    if (useStdout) process.stdout.write(msg);
    else { writeSync(fd, msg); }
  } catch { /* best-effort */ }
  finally { if (fd >= 0) { try { closeSync(fd); } catch { /* noop */ } } }
}

run();
