#!/usr/bin/env bash
# sizes.sh dir... : total stdout chars per tool class
cd $HOME/ss-ft-fixes-scratch/out
printf "%-10s" tool; for d in "$@"; do printf "%12s" $d; done; echo
for cls in search find grep read sem trace; do
  printf "%-10s" $cls
  for d in "$@"; do t=0; for f in $d/${cls}*.out; do t=$((t + $(wc -c < $f))); done; printf "%12s" $t; done; echo
done
