#!/usr/bin/env bash
# seq.sh <bindir> <outdir> [VAR=val...]: short same-thread sequence (within the 30-call window)
BIN=$1; OUT=$2; shift 2; mkdir -p "$OUT"; . $HOME/ss-ft-fixes-scratch/env.sh
n=0; run() { n=$((n+1)); env "$@" > "$OUT/$(printf %02d $n).out" 2> "$OUT/$(printf %02d $n).err"; }
X=("$@")
run "${X[@]}" $BIN/ss-search "how does the router handle path parameters"
run "${X[@]}" $BIN/ss-read context.go 505 570
run "${X[@]}" $BIN/ss-search "how does the router handle path parameters"
run "${X[@]}" $BIN/ss-find "route params" --regex "func \(n \*node\)" -k 6
run "${X[@]}" $BIN/ss-read tree.go 80 134
run "${X[@]}" $BIN/ss-find "route params" --regex "func \(n \*node\)" -k 6
run "${X[@]}" $BIN/ss-semantic tree.go "how are wildcard params inserted"
run "${X[@]}" $BIN/ss-read tree.go 80 134
run "${X[@]}" $BIN/ss-read tree.go 90 100
run "${X[@]}" $BIN/ss-search "middleware recovery from panic"
run "${X[@]}" $BIN/ss-search "middleware recovery from panic"
