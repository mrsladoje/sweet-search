#!/usr/bin/env bash
# COMMON BENCHMARK-HARNESS ENVIRONMENT. Sourced by EVERY executable in this
# directory, before it hands off to node.
#
# WHY IT IS NOT ENOUGH TO PIN THIS IN _ss-helpers.mjs. The pins used to live in
# that one file, which made them true for exactly the entry points that route
# through it (ss-grep, ss-find, ss-read, ss-search, ss-semantic, ss-trace) and
# false for the two that do not: `sweet-search` execs core/cli.js directly, and
# `ss-batch` execs `sweet-search`. A benchmark that mixed the two therefore
# started some daemons with a pinned intra-op thread count and some with the
# fleet-derived share — and ORT partitions its GEMM and reduction kernels by
# thread count, with floating-point addition not associative across partitions,
# so two daemons built at different counts are not guaranteed to agree at ties.
# That is a machine-state-dependent score wobble inside the harness whose entire
# job is to detect score changes.
#
# EVERY VALUE USES `${VAR=default}` — UNSET-ONLY — AND NOT `${VAR:=default}`.
# The difference is the whole point. `:=` substitutes when a variable is unset OR
# EMPTY, and the empty string is not a random value in this product: it is the
# documented opt-out for the resident-daemon cap and for the thread pin, relied
# on by search-server.js and by vitest.config.js. With `:=`, an operator who
# deliberately disabled the cap for a run (`SWEET_SEARCH_MAX_DAEMONS=`) silently
# got cap=3 through every ss-* shim, while _ss-helpers.mjs — which uses `??=`,
# i.e. undefined-only — preserved the opt-out. One run, two policies, and the
# file's own comment claiming the caller always wins was false.
#
# `${VAR=default}` is the exact bash equivalent of JavaScript's `??=`: it fills
# in only a variable that does not exist. So an explicit value from the caller
# ALWAYS wins, INCLUDING an explicit empty string. These are floors for
# reproducibility, not policy overrides.
#
# Keep the numbers here identical to the `??=` defaults in _ss-helpers.mjs;
# tests/search/ort-thread-sharing.test.js asserts that they agree, that the two
# files treat an EMPTY value identically, and that every entry point in this
# directory actually reaches node with them set.

# SCORE DETERMINISM. `bestIntraOpThreads` (core/infrastructure/onnx-session-utils.js)
# divides the intra-op thread count by the number of resident query engines, so a
# daemon started with one peer and a daemon started with three build different ORT
# thread pools. A replay walks a new repository every ~4.5 s, so the live peer
# count varies WITHIN one run. This pin wins outright over the share (see the
# early return in bestIntraOpThreads), so every process in a run builds the same
# session. 8 is inside the unshared band on every bench box we use, so it does not
# slow the run down either.
: "${SWEET_SEARCH_INTRA_OP_THREADS=8}"
export SWEET_SEARCH_INTRA_OP_THREADS

# Resident-engine cap for bench fan-outs. Daemon sockets are keyed per project
# root and a multi-repo replay never reuses one, so every task leaves a ~1.2 GB
# daemon plus a ~2.7 GB maintainer behind. At the observed ~1 daemon / 4.5 s a
# 200-task replay reaches ~265 resident daemons; it OOM-killed a 224 GB box twice.
# Production now defaults this ON at a RAM tier (2 / 3 / 6); this pin keeps the
# replay at the tighter, measured 3 regardless of host RAM.
: "${SWEET_SEARCH_MAX_DAEMONS=3}"
export SWEET_SEARCH_MAX_DAEMONS

# The maintainers, not the daemons, are the bigger half of the footprint (~2.7 GB
# each, versus ~1.2 GB for a daemon). The tier default is 30 minutes, which is far
# too slack for a fan-out that walks a new repository every ~4.5 s. Free in
# latency terms: the maintainer has no query route, so idling it out can never
# slow a search, and it respawns on demand.
: "${SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS=120000}"
export SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS

# Suppress engine boot/load banners ("BinaryHNSW: Loaded …", "Loading local
# model …", "Warming up embedding service…") on the agent tool surface. An
# in-process cold-start otherwise prints these onto the ss-* tool's stdout, which
# the agent captures as the result. Gated at the source via core/infrastructure/
# boot-log.js so it holds on every load path and regardless of exit code. Human
# CLI / indexer leave it unset and still see the banners.
: "${SS_QUIET_BOOT=1}"
export SS_QUIET_BOOT
