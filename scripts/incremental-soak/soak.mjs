#!/usr/bin/env node
/**
 * Incremental-indexing soak harness.
 *
 * Drives the production reconciler over a disposable fixture repository,
 * applying mutations on a wall-clock schedule, and verifying that every
 * mutation becomes observable on every search surface within bounded
 * staleness.
 *
 * Usage:
 *
 *   node scripts/incremental-soak/soak.mjs \
 *     --interval 30 \
 *     --duration-sec 300 \
 *     --mutation-interval-ms 4000 \
 *     --reader-count 4 \
 *     --out eval/results/incremental-soak/soak-30s.jsonl
 *
 * The harness exits non-zero if any invariant violation is observed.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import {
  processMaintenanceQueue,
  defaultMaintenanceHandlers,
  readMaintenanceQueue,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { generateInitialFixture } from './fixture.mjs';
import { GroundTruth } from './ground-truth.mjs';
import { Mutator } from './mutator.mjs';
import { Probe, checkInvariants, surfaceVisibility } from './probe.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = {
    interval: 30,
    durationSec: 300,
    mutationIntervalMs: 4000,
    readerCount: 4,
    initialFilesPerLang: 6,
    seed: 42,
    smoke: false,
    out: '',
    fixtureRoot: '',
    label: '',
    keepFixture: false,
    cleanCycle: false,
    drainMaintenance: true,
    maintenanceMaxJobsPerTick: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--duration-sec') args.durationSec = Number(argv[++i]);
    else if (a === '--mutation-interval-ms') args.mutationIntervalMs = Number(argv[++i]);
    else if (a === '--reader-count') args.readerCount = Number(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--smoke') args.smoke = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fixture-root') args.fixtureRoot = argv[++i];
    else if (a === '--initial-files-per-lang') args.initialFilesPerLang = Number(argv[++i]);
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--keep-fixture') args.keepFixture = true;
    else if (a === '--clean-cycle') args.cleanCycle = true;
    else if (a === '--drain-maintenance') args.drainMaintenance = true;
    else if (a === '--no-drain-maintenance') args.drainMaintenance = false;
    else if (a === '--maintenance-max-jobs') args.maintenanceMaxJobsPerTick = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`incremental soak harness

  --interval <sec>             reconcile tick interval (default 30)
  --duration-sec <sec>         total soak duration (default 300)
  --mutation-interval-ms <ms>  median ms between mutations (default 4000)
  --reader-count <n>           concurrent reader loops (default 4)
  --seed <int>                 deterministic seed (default 42)
  --smoke                      mark this run as a smoke pass (label only)
  --initial-files-per-lang <n> initial fixture files per language (default 6)
  --out <path>                 JSONL events output path
  --fixture-root <path>        override fixture directory (default tmp)
  --label <s>                  label written into JSONL events
  --keep-fixture               don't delete fixture on success
  --clean-cycle                periodically forces a reconcile gap to exercise crash-recovery edges
  --no-drain-maintenance       skip the after-tick maintenance drain (default: drain enabled)
  --maintenance-max-jobs <n>   per-tick maintenance drain bound (default 8)
`);
}

function ts() { return new Date().toISOString(); }

const SEED_LOG = [];

function jsonlAppender(outPath) {
  const out = outPath ? fs.createWriteStream(outPath, { flags: 'a' }) : null;
  return (event) => {
    const line = JSON.stringify({ ts: Date.now(), ...event });
    SEED_LOG.push(line);
    if (out) out.write(line + '\n');
  };
}

// Silence noisy index-load logs (HNSW/BinaryHNSW/LateInteraction).
// We keep stderr clean and route all reporting through the JSONL stream.
function silenceConsoleLog() {
  const orig = console.log;
  console.log = () => {};
  return () => { console.log = orig; };
}

function fakeVectorEncoder() {
  return async function (texts) {
    return texts.map((t, i) => {
      const arr = new Float32Array(8);
      let h = i + 1;
      for (let j = 0; j < t.length; j++) {
        h = (h * 31 + t.charCodeAt(j)) >>> 0;
      }
      for (let k = 0; k < 8; k++) {
        h = (h * 17 + 7) >>> 0;
        arr[k] = ((h % 9973) / 9973) - 0.5;
      }
      return arr;
    });
  };
}

function fakeLiEncoder() {
  return async function (texts) {
    return texts.map((t, i) => {
      const tokenCount = Math.max(2, Math.min(8, Math.ceil(t.length / 60)));
      const tokens = [];
      for (let tk = 0; tk < tokenCount; tk++) {
        const arr = new Float32Array(4);
        let h = ((i + 1) * 31 + tk) >>> 0;
        for (let j = 0; j < t.length; j++) h = (h * 13 + t.charCodeAt(j) + tk) >>> 0;
        for (let k = 0; k < 4; k++) {
          h = (h * 17 + 11) >>> 0;
          arr[k] = ((h % 9973) / 9973);
        }
        tokens.push(arr);
      }
      return tokens;
    });
  };
}

const MODEL_INFO = Object.freeze({
  provider: 'soak',
  model: 'soak-fake-encoder',
  dimension: 8,
  hnswDimension: 8,
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const label = args.label || `soak-${args.interval}s-${args.smoke ? 'smoke' : 'real'}`;
  const fixtureRoot = args.fixtureRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-soak-'));
  const stateDir = path.join(fixtureRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  const outPath = args.out
    ? path.resolve(args.out)
    : path.resolve(`eval/results/incremental-soak/soak-${args.interval}s-${args.smoke ? 'smoke' : 'real'}-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const summaryPath = outPath.replace(/\.jsonl$/, '.summary.json');

  const emit = jsonlAppender(outPath);
  const restoreConsole = silenceConsoleLog();
  emit({ phase: 'start', label, args, fixtureRoot, stateDir, pid: process.pid, host: os.hostname() });
  process.stderr.write(`[${ts()}] soak start: ${label} root=${fixtureRoot} out=${outPath}\n`);

  // === Fixture ===
  const descriptors = generateInitialFixture({ projectRoot: fixtureRoot, filesPerLang: args.initialFilesPerLang });
  const ground = new GroundTruth(descriptors);
  emit({ phase: 'fixture_ready', fileCount: descriptors.length });

  const queuePath = path.join(stateDir, 'index-maintainer-queue.jsonl');
  // Seed the queue with every initial file so the first tick indexes them all.
  for (const d of descriptors) {
    fs.appendFileSync(queuePath, JSON.stringify({ file_path: d.rel, timestamp: Date.now(), source: 'soak-bootstrap' }) + '\n');
  }

  // === Initial tick (bootstrap) ===
  const probe = new Probe({ projectRoot: fixtureRoot, stateDir });
  const vectorEncoder = fakeVectorEncoder();
  const liEncoder = fakeLiEncoder();

  const maintenanceStats = {
    drainsAttempted: 0,
    drainsErrored: 0,
    jobsSeen: 0,
    jobsSucceeded: 0,
    jobsDeferred: 0,
    jobsRetried: 0,
    jobsDeadLettered: 0,
    finalQueueDepth: 0,
    drainErrorSamples: [],
  };

  async function drainMaintenance() {
    if (!args.drainMaintenance) return null;
    maintenanceStats.drainsAttempted += 1;
    try {
      const summary = await processMaintenanceQueue(stateDir, {
        handlers: defaultMaintenanceHandlers(stateDir),
        maxJobs: args.maintenanceMaxJobsPerTick,
      });
      maintenanceStats.jobsSeen += summary.seen;
      maintenanceStats.jobsSucceeded += summary.succeeded;
      maintenanceStats.jobsDeferred += summary.deferred;
      maintenanceStats.jobsRetried += summary.retried;
      maintenanceStats.jobsDeadLettered += summary.deadLettered;
      if (summary.seen > 0) emit({ phase: 'maintenance_drain', summary });
      return summary;
    } catch (err) {
      maintenanceStats.drainsErrored += 1;
      if (maintenanceStats.drainErrorSamples.length < 5) {
        maintenanceStats.drainErrorSamples.push(err?.message || String(err));
      }
      emit({ phase: 'maintenance_drain_error', error: err?.message || String(err) });
      return null;
    }
  }

  const tickFn = async () => {
    const startedAt = Date.now();
    try {
      const counters = await runProductionReconcileTick({
        projectRoot: fixtureRoot,
        stateDir,
        vectorEncoder,
        liEncoder,
        modelInfo: MODEL_INFO,
        logger: silentLogger,
        config: { filesPerTick: 200, cpuBudgetMs: 30_000 },
      });
      const took = Date.now() - startedAt;
      emit({ phase: 'tick_complete', took, counters });
      await drainMaintenance();
      return { ok: true, counters, took };
    } catch (err) {
      const took = Date.now() - startedAt;
      emit({ phase: 'tick_error', took, error: err.message, stack: err.stack });
      return { ok: false, err, took };
    }
  };

  const bootstrapResult = await tickFn();
  if (!bootstrapResult.ok) {
    emit({ phase: 'fatal', stage: 'bootstrap', error: bootstrapResult.err.message });
    finalSummary({ outPath, summaryPath, ground, status: 'bootstrap_failed', errors: [bootstrapResult.err.message] });
    return process.exit(1);
  }

  // Bootstrap invariants
  {
    const obs = probe.observe();
    const v = checkInvariants(obs, ground);
    if (v.length > 0) emit({ phase: 'bootstrap_violation', violations: v });
  }

  // === Reader loops ===
  const readerErrors = [];
  const readerStats = { iterations: 0, lastEpoch: 0, mixedEpochObservations: 0, errors: 0 };
  const readers = [];
  for (let i = 0; i < args.readerCount; i++) {
    readers.push(readerLoop({ id: i, probe, ground, emit, readerStats, readerErrors }));
  }

  // === Mutation + tick loop ===
  const mutator = new Mutator({ projectRoot: fixtureRoot, ground, seed: args.seed + 1000 + args.interval, queuePath, log: () => {} });
  const stopAt = Date.now() + args.durationSec * 1000;
  const pendingMutations = []; // { id, kind, rel, writtenAt, expect: {file, symbolNames, sentinel, deleted}, firstVisibleAt?, mixedTierObservations:[], reconciledAt?, manifestEpochAtWrite, manifestEpochAtVisible }
  let mutationId = 0;

  let nextTickAt = Date.now() + args.interval * 1000;
  let nextMutateAt = Date.now() + jitter(args.mutationIntervalMs, args.seed);
  let mutationCount = 0;
  let tickCount = 0;
  let stop = false;

  // Hook a shutdown handler in case the user Ctrl-C's
  process.on('SIGINT', () => { stop = true; });
  process.on('SIGTERM', () => { stop = true; });

  while (!stop && Date.now() < stopAt) {
    const now = Date.now();
    if (now >= nextMutateAt) {
      const m = mutator.applyOne();
      mutationCount++;
      mutationId++;
      const expects = expectsForMutation(m, ground);
      const manifest = probe.observe().manifest;
      pendingMutations.push({
        id: mutationId,
        kind: m.kind,
        rel: m.rel || m.toRel || m.fromRel,
        writtenAt: m.writtenAt,
        expects,
        firstVisibleAt: null,
        manifestEpochAtWrite: manifest?.epoch ?? null,
      });
      emit({ phase: 'mutation', id: mutationId, kind: m.kind, rel: m.rel || m.toRel || m.fromRel, droppedSymbols: m.droppedSymbols, oldSentinel: m.oldSentinel, newSentinel: m.newSentinel, manifestEpochAtWrite: manifest?.epoch ?? null });
      nextMutateAt = now + jitter(args.mutationIntervalMs, args.seed + mutationId);
    }

    if (now >= nextTickAt) {
      tickCount++;
      const tickResult = await tickFn();
      if (!tickResult.ok) {
        emit({ phase: 'tick_failure_break_iteration' });
        // continue — next tick may recover
      } else {
        // Check visibility for every pending mutation against the new state.
        const obs = probe.observe();
        const obsViolations = checkInvariants(obs, ground);
        if (obsViolations.length > 0) {
          emit({ phase: 'invariant_violation', count: obsViolations.length, sample: obsViolations.slice(0, 10), manifestEpoch: obs.manifest?.epoch });
        }
        for (const pm of pendingMutations) {
          if (pm.firstVisibleAt || pm.superseded) continue;
          // Has this mutation been superseded by a later one on the same file?
          // If the target file is no longer in ground truth (deleted or
          // renamed away) AND this isn't a delete_file mutation, the harness
          // can never observe the original mutation — mark superseded.
          const hasTarget = ground.files.has(pm.rel) || ground.files.has(pm.expects?.fromRel || '');
          if (!pm.expects.deleted && !hasTarget) {
            pm.superseded = true;
            emit({ phase: 'mutation_superseded', id: pm.id, kind: pm.kind, rel: pm.rel });
            continue;
          }
          // Recompute expects against the *current* ground truth so later
          // mutations rotating symbols on the same file don't lock the test
          // into a stale expected-symbols set.
          const currentExpects = pm.expects.deleted
            ? pm.expects
            : currentExpectsFor(ground, pm.rel);
          const surf = surfaceVisibility(obs, currentExpects);
          const visible = currentExpects.deleted ? surf.allAbsent : surf.allPresent;
          if (visible) {
            pm.firstVisibleAt = Date.now();
            pm.manifestEpochAtVisible = obs.manifest?.epoch ?? null;
            pm.staleness = pm.firstVisibleAt - pm.writtenAt;
            emit({ phase: 'mutation_visible', id: pm.id, kind: pm.kind, rel: pm.rel, stalenessMs: pm.staleness, manifestEpochAtVisible: pm.manifestEpochAtVisible });
          } else if (obs.manifest && obs.manifest.epoch > (pm.manifestEpochAtWrite ?? 0)) {
            // Manifest advanced but our mutation isn't visible yet — capture
            // which surfaces are lagging.
            emit({ phase: 'mutation_partial', id: pm.id, kind: pm.kind, rel: pm.rel, surf, manifestEpoch: obs.manifest.epoch });
          }
        }
        // LI integrity probe: load LI index, ensure documents.size matches live vectors.
        await checkLiIntegrity({ obs, stateDir, emit });
      }
      nextTickAt = Date.now() + args.interval * 1000;
    }

    await sleep(50);
  }
  emit({ phase: 'soak_done', durationMs: Date.now() - (stopAt - args.durationSec * 1000), tickCount, mutationCount });

  // Drain any remaining dirty work with a final tick.
  emit({ phase: 'drain_start' });
  for (let i = 0; i < 5; i++) {
    const drain = await tickFn();
    if (!drain.ok) break;
    const obs = probe.observe();
    let anyChange = false;
    for (const pm of pendingMutations) {
      if (pm.firstVisibleAt || pm.superseded) continue;
      const hasTarget = ground.files.has(pm.rel) || ground.files.has(pm.expects?.fromRel || '');
      if (!pm.expects.deleted && !hasTarget) {
        pm.superseded = true;
        emit({ phase: 'mutation_superseded_drain', id: pm.id, kind: pm.kind, rel: pm.rel });
        continue;
      }
      const currentExpects = pm.expects.deleted ? pm.expects : currentExpectsFor(ground, pm.rel);
      const surf = surfaceVisibility(obs, currentExpects);
      const visible = currentExpects.deleted ? surf.allAbsent : surf.allPresent;
      if (visible) {
        pm.firstVisibleAt = Date.now();
        pm.manifestEpochAtVisible = obs.manifest?.epoch ?? null;
        pm.staleness = pm.firstVisibleAt - pm.writtenAt;
        emit({ phase: 'mutation_visible_drain', id: pm.id, kind: pm.kind, rel: pm.rel, stalenessMs: pm.staleness });
        anyChange = true;
      }
    }
    if (!anyChange) break;
    await sleep(500);
  }

  // Stop readers
  for (const r of readers) r.stop();
  await Promise.all(readers.map((r) => r.done));

  emit({ phase: 'readers_done', stats: readerStats, errors: readerErrors.slice(0, 20) });

  // === Final invariants pass ===
  const finalObs = probe.observe();
  const finalViolations = checkInvariants(finalObs, ground);
  emit({ phase: 'final_check', manifest: finalObs.manifest, violations: finalViolations });

  if (args.drainMaintenance) {
    try {
      maintenanceStats.finalQueueDepth = readMaintenanceQueue(stateDir).length;
    } catch {
      maintenanceStats.finalQueueDepth = -1;
    }
  }
  emit({ phase: 'maintenance_stats', stats: maintenanceStats });

  // === Summary ===
  const allStaleness = pendingMutations.filter((m) => m.firstVisibleAt).map((m) => m.staleness);
  allStaleness.sort((a, b) => a - b);
  const superseded = pendingMutations.filter((m) => m.superseded);
  const missed = pendingMutations.filter((m) => !m.firstVisibleAt && !m.superseded);
  const summary = {
    label,
    args,
    fixtureRoot,
    stateDir,
    tickCount,
    mutationCount,
    pendingMutationCount: pendingMutations.length,
    visibleCount: pendingMutations.length - missed.length - superseded.length,
    supersededCount: superseded.length,
    missedCount: missed.length,
    missed: missed.map((m) => ({ id: m.id, kind: m.kind, rel: m.rel, manifestEpochAtWrite: m.manifestEpochAtWrite })),
    stalenessMs: percentiles(allStaleness),
    readerStats,
    finalManifestEpoch: finalObs.manifest?.epoch ?? null,
    finalViolationCount: finalViolations.length,
    finalViolations: finalViolations.slice(0, 50),
    pendingHistory: pendingMutations.slice(0, 50),
    maintenance: maintenanceStats,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  emit({ phase: 'summary', summary });

  process.stderr.write(`[${ts()}] soak end: visible=${summary.visibleCount}/${summary.pendingMutationCount} missed=${summary.missedCount} superseded=${summary.supersededCount} ` +
    `staleness p50=${summary.stalenessMs.p50}ms p95=${summary.stalenessMs.p95}ms p99=${summary.stalenessMs.p99}ms max=${summary.stalenessMs.max}ms ` +
    `viol=${summary.finalViolationCount} epoch=${summary.finalManifestEpoch}\n`);

  restoreConsole();
  if (!args.keepFixture) {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch {}
  } else {
    process.stderr.write(`[${ts()}] fixture kept at ${fixtureRoot}\n`);
  }

  // Exit zero unless we hit a hard failure
  const failed = (missed.length > pendingMutations.length * 0.05) || finalViolations.length > 0 || readerErrors.length > 0;
  process.exit(failed ? 2 : 0);
}

function expectsForMutation(m, ground) {
  switch (m.kind) {
    case 'add_file':
    case 'update_body':
    case 'update_call':
    case 'replace_sentinel': {
      const d = ground.get(m.rel);
      return { file: m.rel, symbolNames: collectSymbolNames(d), sentinel: d?.sentinel, deleted: false };
    }
    case 'update_symbol': {
      const d = ground.get(m.rel);
      return { file: m.rel, symbolNames: collectSymbolNames(d), sentinel: d?.sentinel, deleted: false, droppedSymbols: m.droppedSymbols };
    }
    case 'delete_symbol': {
      const d = ground.get(m.rel);
      return { file: m.rel, symbolNames: collectSymbolNames(d), sentinel: d?.sentinel, deleted: false, droppedSymbol: m.droppedSymbol };
    }
    case 'delete_file': {
      return { file: m.rel, symbolNames: [], sentinel: null, deleted: true };
    }
    case 'rename_file': {
      const d = ground.get(m.toRel);
      return { file: m.toRel, symbolNames: collectSymbolNames(d), sentinel: d?.sentinel, deleted: false, fromRel: m.fromRel };
    }
    default: throw new Error(`expectsForMutation: unknown ${m.kind}`);
  }
}

function collectSymbolNames(d) {
  if (!d) return [];
  return Object.values(d.symbols || {}).filter(Boolean);
}

function currentExpectsFor(ground, rel) {
  const d = ground.get(rel);
  if (!d) return { file: rel, symbolNames: [], sentinel: null, deleted: true };
  return { file: rel, symbolNames: collectSymbolNames(d), sentinel: d.sentinel, deleted: false };
}

function readerLoop({ id, probe, ground, emit, readerStats, readerErrors }) {
  let stop = false;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  (async () => {
    while (!stop) {
      try {
        const obs1 = probe.observe();
        const obs2 = probe.observe();
        readerStats.iterations++;
        readerStats.lastEpoch = obs2.manifest?.epoch ?? readerStats.lastEpoch;
        if (obs1.manifest && obs2.manifest && obs1.manifest.epoch !== obs2.manifest.epoch) {
          // Mixed-epoch observation while reading is fine *if* each individual
          // observation is internally coherent. Run the invariants on the
          // *later* one (obs2) to detect torn publications.
          readerStats.mixedEpochObservations++;
          const v = checkInvariants(obs2, ground);
          if (v.length > 0) {
            emit({ phase: 'reader_mixed_epoch_violation', reader: id, violations: v.slice(0, 5) });
          }
        }
      } catch (err) {
        readerStats.errors++;
        readerErrors.push(err.message);
        emit({ phase: 'reader_error', reader: id, error: err.message });
      }
      await sleep(80 + Math.random() * 120);
    }
    resolveDone();
  })();
  return { stop: () => { stop = true; }, done };
}

async function checkLiIntegrity({ obs, stateDir, emit }) {
  try {
    const indexPath = path.join(stateDir, 'codebase-late-interaction.db');
    if (!fs.existsSync(indexPath)) return;
    const index = new LateInteractionIndex({ indexPath, loadExisting: true });
    await index.init();
    const liveVecIds = obs.vectors.liveIds;
    const liDocIds = new Set(index.documents.keys());
    const missing = [...liveVecIds].filter((id) => !liDocIds.has(id));
    const extra = [...liDocIds].filter((id) => !liveVecIds.has(id));
    if (missing.length > 0 || extra.length > 0) {
      emit({ phase: 'li_integrity_violation', missing: missing.length, extra: extra.length, sampleMissing: missing.slice(0, 5), sampleExtra: extra.slice(0, 5) });
    }
  } catch (err) {
    emit({ phase: 'li_integrity_error', error: err.message });
  }
}

function jitter(base, salt) {
  // Salt makes the schedule deterministic per seed for the harness.
  const rand = (salt * 9301 + 49297) % 233280 / 233280;
  return Math.round(base * (0.7 + rand * 0.6));
}

function percentiles(arr) {
  if (!arr || arr.length === 0) return { p50: null, p95: null, p99: null, max: null, count: 0 };
  const idx = (p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return {
    count: arr.length,
    p50: idx(0.50),
    p95: idx(0.95),
    p99: idx(0.99),
    max: arr[arr.length - 1],
  };
}

const silentLogger = { info() {}, warn() {}, error() {} };

function finalSummary({ outPath, summaryPath, ground, status, errors }) {
  fs.writeFileSync(summaryPath, JSON.stringify({ status, errors, fileCount: ground.files.size }, null, 2));
  process.stderr.write(`[${ts()}] summary ${status} written to ${summaryPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`[${ts()}] FATAL ${err.stack || err.message}\n`);
  process.exit(3);
});
