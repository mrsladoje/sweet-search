// Would ss-grep accept this grep argv without a usage error? Emulates cmdGrep's pure parse steps.
// usage: node coverage.mjs <argparse.mjs> <branch|main> < argv.jsonl
import fs from 'node:fs';
const [modPath, version] = process.argv.slice(2);
const A = await import(modPath);
const lines = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
const out = {};
for (const line of lines) {
  const { argv, tool } = JSON.parse(line);
  let raw = argv.slice(1);
  if (tool === 'egrep') raw = ['-E', ...raw];
  if (tool === 'fgrep') raw = ['-F', ...raw];
  let why = 'ok';
  try {
    const args = version === 'branch' ? A.normalizeArgs(raw, { boolShorts: A.GREP_BOOL_SHORTS }) : A.normalizeArgs(raw);
    const flags = ['-i', '--ignore-case', '-w', '--word-regexp', '-F', '--fixed-strings'];
    if (version === 'branch') flags.push('-E', '--extended-regexp', '-l', '--files-with-matches', '-c', '--count', '-o', '--only-matching');
    for (const f of flags) A.parseBoolFlag(args, [f]);
    A.parseValueFlag(args, ['-k', '--top'], 20);
    const ctx = A.parseContextFlags(args);
    if (ctx.error) why = 'context';
    const inp = A.parseRepeatedValueFlag(args, ['--in']);
    const g = A.parseGlobFlags(args);
    if (why === 'ok' && (g?.error || inp?.error)) why = 'glob/in';
    A.stripInertFlags(args);
    const inPaths = [];
    if (A.absorbPositionalPaths) A.absorbPositionalPaths(args, inPaths, () => true);
    if (why === 'ok' && version === 'branch') { const u = A.unsupportedGrepOption(args); if (u) why = 'unsupported ' + u.flag; }
    if (why === 'ok') { const e = A.extraPositionals ? A.extraPositionals(args) : []; if (e && e.length) why = 'extra positionals'; }
    if (why === 'ok') { const p = A.extractPositional(args); if (p.unknownFlag) why = 'unknown ' + p.unknownFlag.replace(/=.*/, '='); else if (p.pattern === undefined) why = 'no pattern'; }
  } catch (e) { why = 'throw ' + String(e.message).slice(0, 40); }
  out[why] = (out[why] || 0) + 1;
}
console.log(JSON.stringify(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25)));
