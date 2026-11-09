#!/usr/bin/env node
// Bench entry for the ss-* tools: `node _ss-helpers.mjs <subcommand> …`, used by the
// bench's direct callers and by tests. It prints stdout AND stderr whatever the exit code
// (a script reads the route and trace meta lines from stderr) and pins the bench defaults
// below. The tools themselves are product code: core/agent-tools/run-agent-tool.mjs.
// The agent-facing entry is core/agent-tools/cli.js.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export * from '../../../core/agent-tools/run-agent-tool.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Resident-daemon cap for bench fan-outs. Daemon sockets are keyed per project
  // root, so a multi-repo replay never reuses one: search-read-replay --execute-current
  // checks out a different golden repo per task, so every task takes the `action='spawned'`
  // branch and leaves behind a ~1.2GB daemon plus a ~2.7GB maintainer. The cap used to
  // ship OFF (SWEET_SEARCH_MAX_DAEMONS=0) with only a 20-minute idle-TTL, which at the
  // observed ~1 daemon / 4.5s reaches ~265 resident daemons on a 200-task replay — it
  // OOM-killed a 224GB box twice. The cap now ships ON at a RAM-tier default (2 on
  // <=12 GiB, 3 on <=24 GiB, 6 above), so a bench box would settle at 6 rather than 265;
  // this pin keeps the replay at the tighter, measured 3 regardless of host RAM. An
  // explicit caller env still wins over both.
  //
  // LATENCY: this must never cost a cold start. The cap evicts by LRU only when the count
  // is exceeded, and a replay walks repos strictly in sequence — the evicted daemon serves
  // a task that is already finished and is never queried again. The idle-TTL is left at the
  // production default ON PURPOSE: shortening it can reap a daemon that a slow task is still
  // between calls on, which would force a ~2.5s cold start instead of the ~80ms warm path.
  // Bound the count, never the lifetime.
  //
  // The cap gates registry participation at daemon STARTUP (search-server.js `capEnabled`),
  // so a daemon spawned with the cap explicitly OFF ('' or '0') never registers and is
  // invisible to LRU eviction. Kill stray daemons before a run rather than mixing opted-out
  // ones with capped ones.
  process.env.SWEET_SEARCH_MAX_DAEMONS ??= '3';

  // SCORE DETERMINISM — this pin exists for accuracy, not for speed, and it must
  // not be removed without replacing it.
  //
  // `bestIntraOpThreads` (core/infrastructure/onnx-session-utils.js) divides the
  // intra-op thread count by the number of resident daemons, so a daemon started
  // with 1 peer and a daemon started with 3 peers build DIFFERENT ORT thread
  // pools. ORT partitions its GEMM and reduction kernels by thread count and
  // floating-point addition is not associative, so the two are not guaranteed to
  // produce bit-identical logits — and a replay walks a new repository every
  // ~4.5 s, so the live peer count varies across a single 200-task run depending
  // on eviction timing. Two runs of the same benchmark on the same commit could
  // therefore encode two different thread configurations and disagree at ties: a
  // silent, machine-state-dependent MRR wobble in the harness whose whole job is
  // to detect MRR changes.
  //
  // `SWEET_SEARCH_INTRA_OP_THREADS` wins outright and bypasses the share (see the
  // early return in bestIntraOpThreads), so every replay daemon builds the same
  // session regardless of how many peers happen to be resident. 8 is inside the
  // unshared band on every bench box we use, so it does not slow the run down to
  // the shared value either.
  process.env.SWEET_SEARCH_INTRA_OP_THREADS ??= '8';

  // The maintainers, not the daemons, are the bigger half of the footprint (~2.7GB each
  // and ratcheting, vs ~1.2GB for a daemon). maintainerIdleTtlMs() auto-tunes off the
  // memory tier. It used to return 0 = NEVER self-exit on a roomy host; it now returns
  // 30 minutes on every tier, which is still far too slack for a bench fan-out that walks
  // a new repo every ~4.5s. An explicit env value always wins over the tier default, so
  // pin the much tighter 2 minutes here.
  //
  // LATENCY: free. The maintainer has NO query route (index-maintainer.mjs) — it only does
  // background reconcile — so idling it out can never slow a search, and it respawns
  // on demand. Idle is counted as consecutive ticks that found nothing to do, so the repo
  // being actively searched keeps its maintainer; only finished repos are reclaimed.
  process.env.SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS ??= '120000';

  const { runAgentToolInProcess } = await import('../../../core/agent-tools/cli.js');
  await runAgentToolInProcess(process.argv[2], process.argv.slice(3), { stderr: 'always' });
}
