#!/usr/bin/env bash
# index-repos.sh — build the index each sweet arm runs on, the same way for both arms (PLAN.md §6.1, §7.2).
#
#   bash index-repos.sh before [repo ...]   copies of eval/repos/<repo> WITHOUT .sweet-search, at
#                                           $BEFORE_REPOS/<repo> (APFS clones), indexed by the BEFORE checkout
#   bash index-repos.sh after  [repo ...]   eval/repos/<repo> in place, indexed by the FINAL checkout (= §6.1)
#   bash index-repos.sh after --stamp-only  §6.1 was built some other way: record its index as-is
#   (default repos: the 11 repos of questions.json)
#
# Rules (memory: indexer-serial, bench-flags, indexer-verbose, no-model-coexist):
#   - ONE repo at a time, never next to another index build, bench or GCSN job: before each repo the
#     script waits until `fr_busy` (config.sh) is empty.
#   - `--full --sqlite-fast --verbose --concurrency=1`, Metal/CoreML (the checkout's own native addon,
#     prepare-native.sh). A repo whose log does not show a GPU backend fails unless ALLOW_CPU_INDEX=1.
#   - The indexer's daemons / maintainers are reaped after each repo (spawn ledger + open files).
#   - A stamp $FR_STATE/index-stamps/<arm>/<repo>.json records commit, backend, duration and a digest of
#     the .sweet-search file list; the bench (--require-index-stamp) refuses a before-arm source whose
#     stamp names another commit, and the run driver refuses any sweet arm without a stamp.
# Resumable: a repo whose stamp matches the code commit and whose index digest still matches is skipped.
set -uo pipefail
. "$(dirname "$0")/config.sh"
ARM="${1:-}"; shift || true
STAMP_ONLY=0; REPOS=()
for a in "$@"; do [ "$a" = "--stamp-only" ] && STAMP_ONLY=1 || REPOS+=("$a"); done
[ ${#REPOS[@]} -eq 0 ] && read -r -a REPOS <<< "$(fr_repos)"
case "$ARM" in
  before) CODE="$BEFORE_ROOT"; DEST="$BEFORE_REPOS" ;;
  after)  CODE="$FINAL_ROOT";  DEST="$(cd "$AFTER_REPOS" && pwd -P)" ;;
  *) echo "usage: index-repos.sh before|after [--stamp-only] [repo ...]"; exit 2 ;;
esac
SRC_REPOS="$(cd "$MAIN_ROOT/eval/repos" && pwd -P)"
COMMIT=$(git -C "$CODE" rev-parse HEAD)
STAMPS="$FR_STATE/index-stamps/$ARM"; LOGS="$FR_STATE/logs/index-$ARM"
mkdir -p "$STAMPS" "$LOGS" "$DEST"
log() { echo "$(date '+%F %T') [index $ARM] $*" | tee -a "$LOGS/queue.log"; }
digest() { node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const root = path.join(process.argv[1], ".sweet-search"), rows = [];
  const RUNTIME = /(^|\/)(index-maintainer\.(log|lock)|rebuild-queue\.jsonl|[^\/]*-shm|[^\/]*\.pid|[^\/]*\.sock)$/; // same rule as retrieval-bench-282.mjs
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (e.isFile() && !RUNTIME.test(path.relative(root, f))) rows.push(`${path.relative(root, f)}\t${fs.statSync(f).size}`); } };
  walk(root); rows.sort(); console.log(crypto.createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 16));' "$1"; }
stamp_ok() { # <repo> <dst>
  node -e 'const s=require(process.argv[1]); process.exit(s.commit===process.argv[2] && s.indexDigest===process.argv[3] ? 0 : 1)' \
    "$STAMPS/$1.json" "$COMMIT" "$(digest "$2" 2>/dev/null)" 2>/dev/null; }
write_stamp() { # <repo> <dst> <backend> <t0> <logfile>
  node -e '
    const [f, arm, repo, dst, commit, code, backend, t0, logf, dig] = process.argv.slice(1);
    const txt = (() => { try { return require("fs").readFileSync(logf, "utf8"); } catch { return ""; } })();
    const files = /Files indexed:?\s*([\d,]+)/i.exec(txt)?.[1] ?? null;
    require("fs").writeFileSync(f, JSON.stringify({ arm, repo, source: dst, commit, codeRoot: code, backend,
      flags: "--full --sqlite-fast --verbose --concurrency=1", startedAt: new Date(+t0 * 1000).toISOString(),
      finishedAt: new Date().toISOString(), durationSec: Math.round(Date.now() / 1000 - t0), filesIndexed: files,
      indexDigest: dig, log: logf }, null, 1) + "\n");' \
    "$STAMPS/$1.json" "$ARM" "$1" "$2" "$COMMIT" "$CODE" "$3" "$4" "$5" "$(digest "$2")"; }
wait_idle() {
  local n=0
  while [ -n "$(fr_busy)" ]; do
    [ $((n % 10)) -eq 0 ] && log "waiting for idle machine: $(fr_busy | head -3 | tr '\n' ';')"
    n=$((n + 1)); sleep 60
  done
  # Leftover bench daemons / maintainers (cwd under ~/.ss-eval) hold ORT CPU models; stop them so none
  # is resident while the indexer loads GPU models (memory: no-model-coexist). Others are only reported.
  for pid in $(pgrep -f "sweet-search-daemon|sweet-search-maintainer"); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    # Only this run's own roots: other benches under ~/.ss-eval (another session's work) are left alone.
    case "$cwd" in "$FR_STATE/"*|"$BEFORE_REPOS/"*|"$HOME/.ss-eval/r282-repos/"*) kill "$pid" 2>/dev/null && log "stopped leftover bench process $pid ($cwd)";;
      *) log "WARN resident sweet-search process $pid ($cwd) — not ours, left running";; esac
  done
  sleep 5
}
reap() { # <dst> <ledger>
  ( cd "$FINAL_ROOT" && node --input-type=module -e '
    const [dst, ledger] = process.argv.slice(1);
    const { reapRoots } = await import(process.cwd() + "/eval/task-completion-bench/harness/spawn-ledger-reap.mjs");
    const k = await reapRoots({ ledgerDir: ledger, roots: [dst] });
    if (k.length) console.log(`reaped ${k.length}: ${k.map(x => `${x.comm}(${x.pid})`).join(", ")}`);' "$1" "$2" ) 2>&1 | tee -a "$LOGS/queue.log"
}
[ "$ARM" = before ] && { [ "$(git -C "$BEFORE_ROOT" rev-parse HEAD)" = "$(git -C "$BEFORE_ROOT" rev-parse "$BEFORE_COMMIT^{commit}")" ] || { log "before worktree is not at $BEFORE_COMMIT"; exit 2; }; }
[ "$STAMP_ONLY" = 1 ] || bash "$FR_HERE/prepare-native.sh" "$([ "$ARM" = before ] && echo before || echo final)" || { log "native build/verify failed"; exit 2; }
log "code $CODE @ ${COMMIT:0:8}; repos: ${REPOS[*]}"
fail=0
for r in "${REPOS[@]}"; do
  src="$SRC_REPOS/$r"; dst="$DEST/$r"
  [ -d "$src" ] || { log "$r: no source $src"; fail=1; continue; }
  if [ -d "$dst/.sweet-search" ] && stamp_ok "$r" "$dst"; then log "$r: current (stamp ${COMMIT:0:8}), skip"; continue; fi
  if [ "$STAMP_ONLY" = 1 ]; then
    [ -d "$dst/.sweet-search" ] || { log "$r: no index to stamp"; fail=1; continue; }
    write_stamp "$r" "$dst" "external (stamp-only)" "$(date +%s)" ""; log "$r: stamped as-is"; continue
  fi
  wait_idle
  if [ "$ARM" = before ]; then
    # A copy of the bench repo with the source tree only: no index, no runtime state of any arm.
    rm -rf "$dst" "$dst.tmp"
    cp -c -p -R "$src" "$dst.tmp" || { log "$r: copy failed"; fail=1; continue; }
    rm -rf "$dst.tmp/.sweet-search"
    if [ -e "$dst.tmp/.claude/agents/sweet-search.md" ] || [ -e "$dst.tmp/.claude/rules/sweet-search.md" ]; then log "$r: source carries sweet-search product files — clean eval/repos first"; rm -rf "$dst.tmp"; fail=1; continue; fi
    mv "$dst.tmp" "$dst"
  else
    rm -rf "$dst/.sweet-search"   # §6.1: rebuild from scratch, nothing of the old index survives
  fi
  lf="$LOGS/$r.log"; ledger="$FR_STATE/spawn-ledger/index-$ARM-$r"; rm -rf "$ledger"; mkdir -p "$ledger"
  t0=$(date +%s); log "$r: indexing → $lf"
  ( cd "$dst" && env -u SWEET_SEARCH_SERVER_ENTRY SWEET_SEARCH_PROJECT_ROOT="$dst" SWEET_SEARCH_VOCAB_AUTO_EXPAND=0 \
      SWEET_SEARCH_MAINTAINER_WATCH=0 SWEET_SEARCH_RUNTIME_DIR="$FR_STATE/rt-index-$ARM" SWEET_SEARCH_SPAWN_LEDGER_DIR="$ledger" \
      node "$CODE/core/indexing/index-codebase-v21.js" --full --sqlite-fast --verbose --concurrency=1 ) > "$lf" 2>&1
  rc=$?
  sleep 5; reap "$dst" "$ledger"
  backend=$(grep -oE "GPU index pool armed \([^)]*\)" "$lf" | head -1 | sed -E 's/.*\((.*)\)/\1/')
  if [ $rc -ne 0 ] || ! grep -q "INDEXING COMPLETE" "$lf"; then log "$r: FAILED rc=$rc (see $lf)"; fail=1; continue; fi
  if [ -z "$backend" ] && [ "${ALLOW_CPU_INDEX:-0}" != 1 ]; then log "$r: no GPU backend in the log (ORT CPU?) — refusing to stamp; ALLOW_CPU_INDEX=1 to accept"; fail=1; continue; fi
  write_stamp "$r" "$dst" "${backend:-cpu}" "$t0" "$lf"
  log "$r: done in $(( $(date +%s) - t0 )) s, backend ${backend:-cpu}"
done
log "finished (fail=$fail)"
exit $fail
