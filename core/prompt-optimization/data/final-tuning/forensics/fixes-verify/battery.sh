#!/usr/bin/env bash
# Scratch layout used: $HOME/ss-ft-fixes-scratch/{gin (cp -c -R of eval/repos/gin), runtime, out}. See FIXES-IMPL.md.
# usage: battery.sh <bindir> <outdir> [VAR=val ...]
BIN=$1; OUT=$2; shift 2
mkdir -p "$OUT"
. $HOME/ss-ft-fixes-scratch/env.sh
run() { # name cmd args...
  local name=$1; shift
  env "${EXTRA[@]}" "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"; echo "rc=$?" >> "$OUT/$name.err"
}
EXTRA=("$@")
S="$BIN/ss-search"; F="$BIN/ss-find"; G="$BIN/ss-grep"; R="$BIN/ss-read"; T="$BIN/ss-trace"; M="$BIN/ss-semantic"
i=0
while IFS= read -r q; do i=$((i+1)); run search$i $S "$q"; done <<'Q'
how does the router handle path parameters
middleware recovery from panic
bind JSON request body to struct
render HTML template
logger formatter default
static file serving
context abort and next
group routes with prefix
basic auth middleware
handle 404 not found route
Q
run find1 $F "error handling" --regex "func.*Error"
run find2 $F "route params" --regex "func \(n \*node\)" -k 6
run find3 $F "json rendering" --regex "JSON"
run find4 $F "middleware chain" --regex "handlers"
run grep1 $G "func.*Params"
run grep2 $G "Context"
run grep3 $G "func("
run grep4 $G "ZZQQnothing"
run grep5 $G "abortindex"
run grep6 $G "Recovery"
run grep7 $G "Context" --in context.go -k 8
run grep8 $G "ServeHTTP" -k 8
run read1 $R gin.go 1 40
run read2 $R tree.go 60 100
run read3 $R tree.go 418 440
run sem1 $M tree.go "how are wildcard params inserted"
run sem2 $M context.go "abort the request chain"
run sem3 $M gin.go "how requests are dispatched"
run trace1 $T handleHTTPRequest
run trace2 $T handleHTTPRequest callers
run trace3 $T Next callees
run trace4 $T ServeHTTP impact
run trace5 $T getValue --in nonexistent.go
run trace6 $T Header
run trace7 $T Next --in context.go callers
