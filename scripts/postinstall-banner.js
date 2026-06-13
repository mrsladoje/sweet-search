#!/usr/bin/env node
/**
 * postinstall — play the animated banner once after install.
 *
 * npm pipes lifecycle-script stdout (it's not a TTY), so we render to the
 * controlling terminal directly via /dev/tty when possible. This is Unix-only;
 * on Windows (no /dev/tty) or when there is no controlling terminal (CI, detached,
 * sandboxed installs) we simply skip.
 *
 * Defensive by design: renders only to a real terminal, honours CI / NO_BANNER /
 * SWEET_SEARCH_NO_BANNER, swallows every error, and always exits 0 so it can never
 * fail `npm install`.
 */
import process from 'node:process';
import tty from 'node:tty';
import { openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function run() {
  const env = process.env;
  if (env.CI || env.NO_BANNER || env.SWEET_SEARCH_NO_BANNER) return;

  // Pick an output stream that is a real terminal.
  let stream = process.stdout.isTTY ? process.stdout : null;
  let ownedFd = -1;
  if (!stream && process.platform !== 'win32') {
    try {
      ownedFd = openSync('/dev/tty', 'r+');     // throws if no controlling terminal
      const s = new tty.WriteStream(ownedFd);
      if (s.isTTY) stream = s;
    } catch { /* no controlling terminal — skip */ }
  }
  if (!stream) return;

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const { showBanner } = await import(join(here, '..', 'core', 'banner', 'render-banner.js'));
    // query:false — we have no matching stdin for this tty stream; rely on env-based detection.
    const shown = await showBanner({ stream, env, query: false, maxMs: 2200 });
    if (shown) stream.write('  sweet-search installed — run `sweet-search init` to get started.\n');
  } catch { /* never break an install */ }
  finally { if (ownedFd >= 0) { try { closeSync(ownedFd); } catch { /* noop */ } } }
}

run().finally(() => process.exit(0));
