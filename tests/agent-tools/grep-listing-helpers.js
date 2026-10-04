/**
 * Read the ss-grep listing (2026-10-04: no header; each file's path once, `LINE:text` rows
 * under it, `(+N more)` on its own line after a file's last row (owner review 2026-10-04),
 * `# +N more hits` / `# +N more files with M hits` lines).
 */

/** Every hit the listing accounts for: shown rows plus every count of hidden hits. */
export function grepHitCount(out) {
  let n = 0;
  for (const line of String(out).split('\n')) {
    if (/^\d+:/.test(line)) n++;
    const more = /^\(\+(\d+) more\)$/.exec(line) || /^# \+(\d+) more hits? \(raise -k\)/.exec(line);
    if (more) n += Number(more[1]);
    const files = /^# \+\d+ more files? with (\d+) hits?/.exec(line);
    if (files) n += Number(files[1]);
  }
  return n;
}

/** The path lines, in print order (a `(+N more)` line is not one). */
export function grepFiles(out) {
  return String(out).split('\n')
    .filter((l) => l && !/^(\d|#|--|\()/.test(l));
}
