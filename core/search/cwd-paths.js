/**
 * Shell-cwd-aware path arguments for the agent tools.
 *
 * An agent that has run `cd okhttp/src/commonJvmAndroid/kotlin/okhttp3` types
 * `ss-read Dispatcher.kt 190 215` exactly as it would type `sed -n` or `cat`.
 * Every path argument used to resolve against the PROJECT ROOT only, so that call
 * failed with ENOENT while the native tools worked. The rule here is the shell's,
 * with one fallback:
 *
 *   1. a relative path that exists relative to the shell's cwd (and stays inside
 *      the repository) means THAT file;
 *   2. otherwise it keeps its old meaning, relative to the repository root — so a
 *      root-relative path copied from earlier tool output still works while the
 *      agent sits in a subdirectory.
 *
 * The answer is always handed on as a ROOT-RELATIVE path, so every downstream
 * consumer (readers, span ledgers, output headers) sees the same spelling it saw
 * before. At the root, or outside the repository, nothing changes at all.
 *
 * Only the CLIENT may apply this: it is the process that knows the shell's cwd. A
 * shared daemon must never resolve against its own cwd.
 */
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

function realOrResolved(p) {
  try { return realpathSync.native(p); } catch { return path.resolve(p); }
}

/**
 * Where `cwd` sits inside `root`, as a POSIX root-relative path: '' at the root,
 * null when cwd is outside the root (or either is missing). Symlinked spellings of
 * the same directory (macOS /tmp → /private/tmp) compare equal.
 */
export function cwdOffset({ cwd = process.cwd(), root } = {}) {
  if (!root || !cwd) return null;
  const rel = path.relative(realOrResolved(root), realOrResolved(cwd));
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * Resolve one path argument cwd-first (see the module comment). Returns the
 * root-relative spelling when the cwd reading applies, else `p` unchanged.
 *
 * @param {string} p - the path as the agent typed it
 * @param {{cwd?: string, root: string, exists?: (abs: string) => boolean}} opts
 */
export function resolveCwdPath(p, { cwd = process.cwd(), root, exists = existsSync } = {}) {
  if (typeof p !== 'string' || p === '' || path.isAbsolute(p)) return p;
  const offset = cwdOffset({ cwd, root });
  if (!offset) return p;                         // at the root or outside it: unchanged
  const candidate = path.posix.normalize(path.posix.join(offset, p.replace(/\\/g, '/')));
  if (candidate === '..' || candidate.startsWith('../')) return p;   // escapes the repository
  let found = false;
  try { found = exists(path.join(root, candidate)); } catch { found = false; }
  return found ? candidate : p;
}

const GLOB_META = /[*?[\]{}\\]/;

/**
 * Re-anchor one ss-grep / ss-find `-g` glob typed from the shell's cwd, so the engine only
 * ever sees ROOT-anchored or unanchored globs (core/search/grep-path-globs.js).
 *
 * ripgrep anchors a `-g` glob at the cwd (measured: from lib/, `rg -g '!tests/**'` drops
 * lib/tests and `-g '!lib/src/**'` drops nothing), so that is the first reading. The same
 * one fallback as resolveCwdPath applies: when the glob's literal leading path does not
 * exist under the cwd but does exist under the root, it keeps its root-relative meaning —
 * ss-grep prints root-relative paths, and an agent builds its next glob from them.
 *
 *   no `/` (`*.h`, `!tests`, `tests/`)   matches at any depth: unchanged
 *   leading `**`                         matches at any depth: unchanged
 *   an absolute path inside the root     the root-relative glob, anchored (`/lib/x/**`)
 *   `/x`, `./x`                          anchored at the cwd (rg's rule; `./` see the module)
 *   `a/b*`                               cwd-anchored, unless only `root/a` exists
 *
 * At the root, or outside the repository, the glob is returned unchanged. The native
 * client (crates/sweet-search-cli agent_tools.rs) forwards argv and the cwd untouched, so
 * this wrapper-side call is the only place a glob is re-anchored, on both paths.
 *
 * @param {string} glob - as the agent typed it, `!` included
 * @param {{cwd?: string, root: string, exists?: (abs: string) => boolean}} opts
 */
export function resolveCwdGlob(glob, { cwd = process.cwd(), root, exists = existsSync } = {}) {
  if (typeof glob !== 'string' || glob === '') return glob;
  const neg = glob.startsWith('!') ? '!' : '';
  const body = glob.slice(neg.length);
  // An absolute filesystem path under the root (pasted from a tool's absolute output).
  if (body.startsWith('/') && root) {
    for (const r of new Set([path.resolve(root), realOrResolved(root)])) {
      const prefix = r.split(path.sep).join('/').replace(/\/+$/, '');
      if (body === prefix || body.startsWith(`${prefix}/`)) {
        const rest = body.slice(prefix.length).replace(/^\/+/, '');
        return rest ? `${neg}/${rest}` : glob;
      }
    }
  }
  const offset = cwdOffset({ cwd, root });
  if (!offset) return glob;                               // at the root or outside it
  const trimmed = body.replace(/\/+$/, '');
  if (body.startsWith('**')) return glob;                 // any depth already
  const explicitHere = /^(?:\.\/|\/)/.test(body);
  if (!explicitHere && !trimmed.includes('/')) return glob;   // basename glob, any depth
  const rel = body.replace(/^(?:\.\/|\/)+/, '');
  // `..` is resolved lexically (`../src/**` from lib/ is `/src/**`); the engine matches
  // paths, not spellings. A glob that climbs out of the repository is left as typed.
  const joined = path.posix.normalize(`${offset}/${rel}`);
  if (joined === '..' || joined.startsWith('../')) return glob;
  const cwdAnchored = `${neg}/${joined}`;
  if (explicitHere) return cwdAnchored;
  // The literal leading path (segments before the first glob metacharacter).
  const literal = [];
  for (const seg of rel.split('/')) {
    if (seg === '' || GLOB_META.test(seg)) break;
    literal.push(seg);
  }
  if (literal.length === 0 || literal.includes('..') || literal.includes('.')) return cwdAnchored;
  const has = (p) => { try { return exists(p); } catch { return false; } };
  if (has(path.join(root, offset, ...literal))) return cwdAnchored;
  if (has(path.join(root, ...literal))) return glob;      // root-relative, as typed
  return cwdAnchored;                                     // neither exists: rg's reading
}

/**
 * The implicit search scope of a grep run from a subdirectory: the absolute path
 * of that subdirectory under `indexRoot` (the root the engine's match paths are
 * relative to), or null at the root / outside it. Absolute, because a relative
 * scope is matched as a segment run anywhere in a path, so `src` would also admit
 * `vendor/x/src/…` — not what `grep -r` from `src/` searches.
 *
 * `fileRoot` is where the agent's files live (a linked worktree may differ from
 * the index root); the offset is measured there and applied to `indexRoot`.
 *
 * The scope is anchored at the REAL path of `indexRoot`. The engine accepts an
 * absolute scope under its root as spelled or under that root's real path
 * (matchesGrepFileFilter), but not the reverse: a daemon whose root is
 * /private/tmp/x rejects /tmp/x/sub, and every hit was dropped.
 */
export function cwdGrepScope({ cwd = process.cwd(), fileRoot, indexRoot = fileRoot } = {}) {
  const offset = cwdOffset({ cwd, root: fileRoot });
  if (!offset || !indexRoot) return null;
  return path.join(realOrResolved(indexRoot), ...offset.split('/'));
}
