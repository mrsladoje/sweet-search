#!/bin/bash
# Kernel A/B driver: our arm only, one job at a time, arms interleaved and their order rotated per rep.
# usage: ab.sh <setDir> <tag> <reps> "<name>|<env>" ...   (env = space-separated VAR=value, may be empty)
# Writes <setDir>/ab-<tag>-<name>-<rep>.json and appends to <setDir>/ab-<tag>.log.
# env: R (repo root), NODE, NQ, K
set -u
S=$1; TAG=$2; REPS=$3; shift 3; ARMS=("$@"); N=${#ARMS[@]}
R=${R:?}; NODE=${NODE:-node}; OURS=$(cd "$(dirname "$0")" && pwd)/ours.mjs
load() { if [ -r /proc/loadavg ]; then cut -d' ' -f1-3 /proc/loadavg; else sysctl -n vm.loadavg | tr -d '{}'; fi; }
for rep in $(seq 1 $REPS); do
  for i in $(seq 0 $((N - 1))); do
    IFS='|' read -r name envs <<< "${ARMS[$(( (i + rep - 1) % N ))]}"
    line=$(env $envs R=$R OUT=ab-$TAG-$name-$rep.json $NODE $OURS $S 2>&1 | grep -v '^\[' | tail -1)
    echo "$(date +%T) load $(load) | rep $rep $name [$envs] $line" | tee -a $S/ab-$TAG.log
  done
done
echo "$(date +%T) done $TAG" | tee -a $S/ab-$TAG.log
