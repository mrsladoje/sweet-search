/**
 * Sets process.title without exposing the environment in `ps`.
 *
 * libuv writes the title over the original argv block and truncates it to that
 * block's size. On macOS, `ps` reads argc strings from the block, and an
 * overlong title leaves no NUL for argv[1..]: `ps` then prints the first
 * environment variable after the title (`node t.mjs` titled
 * 'sweet-search-query-encoder' shows `sweet-sear MANPATH=...`). The title must
 * leave one NUL per remaining argument, so it is cut to that size here.
 */
import path from 'node:path';

// Lower bound on the original argv block. process.argv[1] is path.resolve() of the
// string the process got, so that string ends with the same base name, except
// for '.' or '..', which resolve to the cwd or one of its parents.
function scriptSlotLowerBound(script, cwd) {
  const rel = path.relative(cwd, script);
  if (rel === '' || rel.split(path.sep).every((p) => p === '..')) return 'x';
  return path.basename(script) || 'x';
}

export function maxProcessTitleLength({ argv0 = process.argv0, execArgv = process.execArgv, argv = process.argv, cwd = process.cwd() } = {}) {
  const args = [argv0, ...execArgv];
  if (argv.length > 1) args.push(scriptSlotLowerBound(argv[1], cwd), ...argv.slice(2));
  const capacity = args.reduce((sum, a) => sum + Buffer.byteLength(String(a)) + 1, 0);
  return Math.max(0, capacity - args.length);
}

export function setProcessTitle(title, opts) {
  const max = maxProcessTitleLength(opts);
  let t = String(title);
  while (Buffer.byteLength(t) > max) t = t.slice(0, -1);
  if (!t) return;
  try { process.title = t; } catch { /* best-effort */ }
}
