#!/usr/bin/env node
/**
 * postinstall — print a short "what next" message after install.
 *
 * Deliberately plain text: during `npm install` npm writes its own progress
 * spinner to the terminal CONCURRENTLY with this script, which would interrupt
 * any graphics/animation escape sequence mid-stream and leak its payload as
 * garbage text. So the rich animated banner is reserved for `sweet-search init`
 * and `sweet-search index` (where we own the TTY); install just prints a clean,
 * escape-light pointer. Best-effort; always exits 0 so it can't fail an install.
 */
import process from 'node:process';

function run() {
  const env = process.env;
  if (env.NO_BANNER || env.SWEET_SEARCH_NO_BANNER) return;
  try {
    const c = (n, s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
    const lines = [
      '',
      `  ${c('1;38;5;213', 'sweet-search')} installed ${c('2', '— SOTA hybrid code search')}`,
      '',
      `  ${c('1', 'Get started:')}`,
      `    ${c('36', 'sweet-search init')}        set up the current project`,
      `    ${c('36', 'sweet-search index')}       build the search index`,
      `    ${c('36', 'sweet-search "query"')}     search your code`,
      `  ${c('2', '(installed locally? prefix with')} ${c('2;36', 'npx')}${c('2', ', e.g. `npx sweet-search init`)')}`,
      '',
    ];
    process.stdout.write(lines.join('\n') + '\n');
  } catch { /* never break an install */ }
}

run();
