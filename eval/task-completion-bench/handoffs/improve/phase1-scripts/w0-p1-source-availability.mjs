#!/usr/bin/env node
// SLATE-B W0 gate — P1 dependency closure: the PINNED-SOURCE AVAILABILITY MAP.
//
// P1 proposes ss-deps: index the pinned installed dependency source so the agent can
// read the contract it currently guesses. pytask proves the idea for ONE Python task.
// This asks the generality question: across the admissible task set, how many
// ecosystems actually ship READABLE SOURCE for their dependencies inside the task
// image, offline?
//
// The distinction that decides whether ss-deps is a corpus feature or a per-language
// research programme:
//   SOURCE  — the dependency ships as the text a human would read (.py, .js, .ex,
//             .dart, .swift, .lua). ss-deps indexes it the way it indexes a repo.
//   BINARY  — it ships compiled or serialised (.jar, .dll, R's lazy-load .rdb).
//             Indexing needs a decompiler or per-ecosystem extractor; the "just walk
//             site-packages" mechanism does not transfer.
//   ABSENT  — no dependency tree in the image; nothing to index.
//
// v2 — roots are DISCOVERED, not assumed. v1 hardcoded a list of conventional paths
// and reported dart-lang__http as ABSENT; its pub cache is at /workspace/.pub-cache,
// not ~/.pub-cache, and the source was there all along at pinned versions. These
// images relocate caches, so any fixed path list under-reports availability and every
// under-report reads as evidence against P1. The probe now searches for cache
// directory NAMES and honours the relocation env vars, then classifies by counting
// file extensions under whatever it found — because "there is a directory called deps"
// is a different claim from "there is source in it".
//
// Per task: pull → probe with --network none → rmi. Peak disk stays at one image.
// Nothing is graded and no agent runs.
//
// Usage on the box: nohup node w0-p1-source-availability.mjs > /root/w0-avail.log 2>&1 &
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BENCH = process.env.BENCH || '/root/sweet-search-private/eval/task-completion-bench';
const TASKS = path.join(BENCH, 'select/.cache/tasks_full_luna_rotate20.json');
const BLOCKED = new Set(Object.keys(JSON.parse(
  readFileSync(path.join(BENCH, 'harness/task-blocklist.json'), 'utf8')).tasks));
const OUT = process.env.OUT || '/root/w0-p1-availability.json';

const PROBE = String.raw`
echo "CTX home=$HOME pwd=$(pwd)"
echo "ENV PUB_CACHE=$PUB_CACHE CARGO_HOME=$CARGO_HOME GOPATH=$GOPATH GOMODCACHE=$GOMODCACHE MIX_HOME=$MIX_HOME R_LIBS=$R_LIBS R_LIBS_USER=$R_LIBS_USER MAVEN_OPTS=$MAVEN_OPTS GRADLE_USER_HOME=$GRADLE_USER_HOME OPAMROOT=$OPAMROOT"

# Discover dependency roots by NAME, anywhere reachable, rather than assuming layout.
# -prune stops descent into a hit, so nested node_modules do not explode the walk.
FOUND=$(find / -xdev -maxdepth 6 \
  \( -path /proc -o -path /sys -o -path /dev -o -path /tmp \) -prune -o \
  -type d \( -name site-packages -o -name dist-packages -o -name node_modules \
    -o -name .pub-cache -o -name .m2 -o -name .gradle -o -name .nuget \
    -o -name registry -o -name mod -o -name .luarocks -o -name checkouts \
    -o -name site-library -o -name .opam -o -name .cabal -o -name .stack \
    -o -name _build -o -name deps -o -name vendor \
    -o -name start -o -name pack \) -prune -print 2>/dev/null | head -40)
# 'start'/'pack' are neovim's plugin layout (~/.local/share/nvim/site/pack/*/start).
# Editor-plugin ecosystems have no package-manager cache dir, so a name list built from
# conventional caches alone reports them ABSENT while the source sits right there.

# Env-var relocations the name search can still miss.
for extra in "$PUB_CACHE" "$CARGO_HOME/registry" "$GOMODCACHE" "$GOPATH/pkg/mod" \
             "$R_LIBS" "$R_LIBS_USER" "$GRADLE_USER_HOME" "$OPAMROOT"; do
  [ -n "$extra" ] && [ -d "$extra" ] && FOUND="$FOUND
$extra"
done

FOUND=$(echo "$FOUND" | sort -u | grep -v '^$')
if [ -z "$FOUND" ]; then echo "ROOTS=none"; exit 0; fi
echo "ROOTS<<"
echo "$FOUND"
echo ">>"

for r in $FOUND; do
  echo "--- $r"
  for ext in py js mjs cjs ts ex exs dart swift lua rb php R r java scala kt go rs erl; do
    n=$(find "$r" -name "*.$ext" -type f 2>/dev/null | head -30000 | wc -l)
    [ "$n" -gt 0 ] && echo "  SRC .$ext = $n"
  done
  for ext in jar dll pyc class rdb rdx beam nupkg; do
    n=$(find "$r" -name "*.$ext" -type f 2>/dev/null | head -30000 | wc -l)
    [ "$n" -gt 0 ] && echo "  BIN .$ext = $n"
  done
done
# The loop above ends on a test-and-echo. When the last extension count is zero that
# test exits 1, the shell inherits it, and execFileSync throws away a perfectly good
# probe as a failure. Land on a success explicitly.
# (No backticks in this comment: the probe lives in a String.raw template literal.)
exit 0
`;

const specs = JSON.parse(readFileSync(TASKS, 'utf8'));
const admissible = specs.filter(t => !BLOCKED.has(t.instance_id));
console.log(`task file: ${specs.length}   blocked: ${BLOCKED.size}   probing: ${admissible.length}`);
console.log('(the 2026-08-11 runs fielded 17 of these 18; the extra file-only task is probed too)\n');

const results = [];
for (const t of admissible) {
  const id = t.instance_id;
  const img = t.image_name;
  const t0 = Date.now();
  let probe = '', err = null;
  try {
    execFileSync('docker', ['pull', '-q', img], { stdio: 'ignore', timeout: 2400000 });
    probe = execFileSync('docker',
      ['run', '--rm', '--network', 'none', img, 'sh', '-lc', PROBE],
      { encoding: 'utf8', timeout: 1200000, maxBuffer: 64e6 });
  } catch (e) {
    // Belt and braces: a non-zero exit does not mean the probe printed nothing. Keep
    // whatever it wrote and let the classifier judge the CONTENT, not the exit code —
    // discarding stdout here is what turned 14 good probes into 14 ERRORs.
    probe = String(e.stdout || '');
    err = String(e.message || e).slice(0, 200);
  } finally {
    try { execFileSync('docker', ['rmi', '-f', img], { stdio: 'ignore', timeout: 300000 }); } catch { /* */ }
  }
  const byExt = {};
  for (const m of probe.matchAll(/(SRC|BIN) \.(\w+) = (\d+)/g)) {
    const k = `${m[1]}.${m[2]}`; byExt[k] = (byExt[k] || 0) + +m[3];
  }
  const src = Object.entries(byExt).filter(([k]) => k.startsWith('SRC')).reduce((a, [, v]) => a + v, 0);
  const bin = Object.entries(byExt).filter(([k]) => k.startsWith('BIN')).reduce((a, [, v]) => a + v, 0);
  const noRoots = /ROOTS=none/.test(probe);
  const ranAtAll = /^CTX /m.test(probe);      // the probe's first line — proof it executed
  // "readable source" means enough to be a corpus, not one stray script. ERROR is now
  // reserved for a probe that never ran, not one that merely exited non-zero.
  const verdict = !ranAtAll ? 'ERROR' : noRoots ? 'ABSENT' : src >= 50 ? 'SOURCE' : bin > 0 ? 'BINARY' : 'THIN';
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  results.push({ id, img, verdict, srcFiles: src, binFiles: bin, byExt, mins, err, probe });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  const top = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[${verdict.padEnd(6)}] ${id.padEnd(42)} src=${String(src).padStart(6)} bin=${String(bin).padStart(5)} ${mins}m  ${top}${err ? '  ERR ' + err.slice(0, 70) : ''}`);
}

console.log('\n=== availability map ===');
for (const v of ['SOURCE', 'BINARY', 'THIN', 'ABSENT', 'ERROR']) {
  const hits = results.filter(r => r.verdict === v);
  if (hits.length) console.log(`${v.padEnd(6)} ${hits.length}: ${hits.map(h => h.id).join(', ')}`);
}
const s = results.filter(r => r.verdict === 'SOURCE').length;
console.log(`\nss-deps could index ${s}/${results.length} probed tasks by walking a dependency tree.`);
console.log(`written: ${OUT}`);
