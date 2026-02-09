#!/usr/bin/env node

/**
 * SEARCH 100x Performance Benchmark Harness
 *
 * Comprehensive benchmarking for indexing and search performance.
 * Implements methodology from docs/benchmarking/PERFORMANCE_BENCHMARKING_METHODOLOGY.md
 *
 * Usage:
 *   node benchmark-harness.js                    # Run all benchmarks
 *   node benchmark-harness.js --full-index      # Full index benchmark only
 *   node benchmark-harness.js --incremental     # Incremental index benchmarks
 *   node benchmark-harness.js --search          # Search latency benchmarks
 *   node benchmark-harness.js --overhead        # Daemon overhead benchmarks
 *   node benchmark-harness.js --baseline        # Generate baseline file
 *   node benchmark-harness.js --compare <file>  # Compare against baseline
 *   node benchmark-harness.js --ci              # CI mode (fail on regression)
 */

import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Result storage
  resultsDir: path.join(PROJECT_ROOT, '.claude/benchmarks/results'),

  // Iteration counts
  fullIndexIterations: 3,       // Expensive, fewer runs
  incrementalIterations: 5,     // Faster, more runs
  searchIterations: 100,        // Fast, many runs for percentiles
  overheadDurationMin: 5,       // Minutes for overhead measurement

  // Timeouts
  fullIndexTimeoutMs: 10 * 60 * 1000,   // 10 minutes
  incrementalTimeoutMs: 3 * 60 * 1000,  // 3 minutes

  // Regression thresholds
  regressionThreshold: 0.15,    // 15% regression triggers warning
  failureThreshold: 0.30,       // 30% regression triggers failure

  // Paths
  indexerPath: path.join(__dirname, '..', 'core', 'index-codebase-v21.js'),
  smartSearchPath: path.join(__dirname, '..', 'ss'),
  daemonPath: path.join(PROJECT_ROOT, '.claude/hooks/index-maintainer.mjs'),
  agentdbDir: path.join(PROJECT_ROOT, '.agentdb'),
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(60)}`, 'bright');
  log(title, 'bright');
  log('='.repeat(60), 'bright');
}

/**
 * Calculate statistics from an array of numbers
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return { mean: 0, median: 0, stddev: 0, cv: '0%', min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  const variance = sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1 || 1);
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? ((stddev / mean) * 100).toFixed(2) + '%' : '0%';

  return {
    n,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stddev: Math.round(stddev * 100) / 100,
    cv,
    min: sorted[0],
    max: sorted[n - 1],
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)] || sorted[n - 1],
    p99: sorted[Math.floor(n * 0.99)] || sorted[n - 1],
  };
}

/**
 * Get nested value from object by dot-notation path
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Get hardware information
 */
function getHardwareInfo() {
  const cpuModel = (() => {
    try {
      return execSync('cat /proc/cpuinfo | grep "model name" | head -1', { encoding: 'utf-8' })
        .replace('model name\t:', '')
        .trim();
    } catch {
      return os.cpus()[0]?.model || 'unknown';
    }
  })();

  const memoryTotal = (() => {
    try {
      return execSync('free -h | grep Mem | awk \'{print $2}\'', { encoding: 'utf-8' }).trim();
    } catch {
      return `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}G`;
    }
  })();

  return {
    cpu: cpuModel,
    cores: os.cpus().length,
    memory: memoryTotal,
    platform: os.platform(),
    node: process.version,
    arch: os.arch(),
  };
}

/**
 * Clean index artifacts for fresh start
 */
async function cleanIndexArtifacts() {
  const artifacts = [
    'code-graph.db',
    'codebase.db',
    'codebase-hnsw.idx',
    'codebase-hnsw.meta.json',
    'codebase-binary-hnsw.idx',
    'codebase-binary-hnsw.meta.json',
    'codebase-binary-hnsw.int8.json',
    'codebase-colbert.db',
    'merkle-state.json',
    'query-vocabulary.json',
    'code-summaries.json',
    'artifact-state.json',
  ];

  for (const artifact of artifacts) {
    const filePath = path.join(CONFIG.agentdbDir, artifact);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist, that's fine
    }
  }

  // Try to drop OS page cache (requires sudo, may fail)
  try {
    execSync('sync && echo 3 | sudo tee /proc/sys/vm/drop_caches > /dev/null 2>&1', { timeout: 5000 });
  } catch {
    // Not critical if this fails
  }
}

/**
 * Run a command and return timing + output
 */
async function runCommand(command, args, options = {}) {
  const { timeout = 60000, stdin = null, cwd = PROJECT_ROOT } = options;

  return new Promise((resolve) => {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        duration: performance.now() - startTime,
        stdout,
        stderr,
        error: 'TIMEOUT',
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      const endMemory = process.memoryUsage();
      resolve({
        success: code === 0,
        exitCode: code,
        duration: performance.now() - startTime,
        stdout,
        stderr,
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
        },
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        duration: performance.now() - startTime,
        stdout,
        stderr,
        error: err.message,
      });
    });
  });
}

// =============================================================================
// BENCHMARK FUNCTIONS
// =============================================================================

/**
 * Benchmark full index rebuild
 */
async function benchmarkFullIndex(iterations = CONFIG.fullIndexIterations) {
  logSection('FULL INDEX BENCHMARK');
  log(`Running ${iterations} iterations...`, 'cyan');

  const results = [];

  for (let i = 0; i < iterations; i++) {
    log(`\nIteration ${i + 1}/${iterations}:`, 'yellow');

    // Clean state
    log('  Cleaning artifacts...', 'dim');
    await cleanIndexArtifacts();

    // Wait for system to settle
    await new Promise(r => setTimeout(r, 2000));

    // Run full index
    log('  Running full index...', 'dim');
    const result = await runCommand('node', [CONFIG.indexerPath, '--full', '--quiet'], {
      timeout: CONFIG.fullIndexTimeoutMs,
    });

    if (result.success) {
      log(`  Completed in ${(result.duration / 1000).toFixed(2)}s`, 'green');

      // Parse indexer output for stats
      let stats = {};
      try {
        const jsonMatch = result.stdout.match(/\{.*"success".*\}/);
        if (jsonMatch) {
          stats = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Couldn't parse, use defaults
      }

      results.push({
        duration: result.duration,
        success: true,
        entities: stats.entities || 0,
        chunks: stats.chunks || 0,
        embeddings: stats.embeddings || 0,
      });
    } else {
      log(`  FAILED: ${result.error || result.stderr?.substring(0, 100)}`, 'red');
      results.push({
        duration: result.duration,
        success: false,
        error: result.error || result.stderr?.substring(0, 200),
      });
    }
  }

  const successfulRuns = results.filter(r => r.success);
  const durations = successfulRuns.map(r => r.duration);
  const stats = calculateStats(durations);

  // Get memory stats from last successful run
  let memoryPeakMB = 0;
  try {
    const statusPath = `/proc/${process.pid}/status`;
    if (existsSync(statusPath)) {
      const status = readFileSync(statusPath, 'utf-8');
      const vmPeak = status.match(/VmPeak:\s+(\d+)/)?.[1];
      memoryPeakMB = vmPeak ? parseInt(vmPeak, 10) / 1024 : 0;
    }
  } catch {
    // Couldn't read memory stats
  }

  return {
    ...stats,
    successRate: `${successfulRuns.length}/${results.length}`,
    memoryPeakMB,
    avgEntities: Math.round(successfulRuns.reduce((sum, r) => sum + (r.entities || 0), 0) / successfulRuns.length),
    avgChunks: Math.round(successfulRuns.reduce((sum, r) => sum + (r.chunks || 0), 0) / successfulRuns.length),
  };
}

/**
 * Benchmark incremental indexing with N changed files
 */
async function benchmarkIncremental(fileCount, iterations = CONFIG.incrementalIterations) {
  log(`\nIncremental ${fileCount} files (${iterations} iterations)...`, 'cyan');

  // First ensure we have a full index to work from
  if (!existsSync(path.join(CONFIG.agentdbDir, 'merkle-state.json'))) {
    log('  Building initial index...', 'dim');
    await runCommand('node', [CONFIG.indexerPath, '--full', '--quiet'], {
      timeout: CONFIG.fullIndexTimeoutMs,
    });
  }

  const results = [];

  for (let i = 0; i < iterations; i++) {
    // Find random files to "touch"
    const findResult = await runCommand('find', [
      'Sloth Web', '-name', '*.java', '-type', 'f',
    ]);
    const allFiles = findResult.stdout.trim().split('\n').filter(f => f);
    const selectedFiles = [];

    // Randomly select files
    const shuffled = allFiles.sort(() => Math.random() - 0.5);
    for (let j = 0; j < Math.min(fileCount, shuffled.length); j++) {
      selectedFiles.push(shuffled[j]);
    }

    // Touch files (update mtime to trigger reindex)
    for (const file of selectedFiles) {
      await runCommand('touch', [file]);
    }

    // Wait a moment for filesystem to settle
    await new Promise(r => setTimeout(r, 100));

    // Run incremental index
    const result = await runCommand('node', [CONFIG.indexerPath, '--quiet'], {
      timeout: CONFIG.incrementalTimeoutMs,
    });

    if (result.success) {
      results.push({
        duration: result.duration,
        success: true,
        filesChanged: selectedFiles.length,
      });
    } else {
      results.push({
        duration: result.duration,
        success: false,
      });
    }
  }

  const successfulRuns = results.filter(r => r.success);
  const durations = successfulRuns.map(r => r.duration);

  return calculateStats(durations);
}

/**
 * Benchmark search latency across query types
 */
async function benchmarkSearchLatency(iterations = CONFIG.searchIterations) {
  logSection('SEARCH LATENCY BENCHMARK');

  // Ensure index exists
  if (!existsSync(path.join(CONFIG.agentdbDir, 'codebase.db'))) {
    log('Building index first...', 'yellow');
    await runCommand('node', [CONFIG.indexerPath, '--full', '--quiet'], {
      timeout: CONFIG.fullIndexTimeoutMs,
    });
  }

  const queries = {
    lexical: [
      'AuthService',
      'LoginController',
      'EmployeeService',
      'JwtTokenProvider',
      'ConfigHandler',
    ],
    semantic: [
      'how does authentication work',
      'where are gRPC events processed',
      'employee time tracking logic',
      'password validation methods',
    ],
    hybrid: [
      'AuthService login flow',
      'employee monitoring screenshot',
      'JWT token refresh',
      'gRPC event streaming',
    ],
    structural: [
      'what calls AuthService',
      'implementations of DetectionHeuristic',
      'what does BotDetectionService call',
    ],
  };

  const results = {};

  // Warmup
  log('\nWarming up search system...', 'dim');
  await runCommand(CONFIG.smartSearchPath, ['test', '--quiet']);

  for (const [mode, queryList] of Object.entries(queries)) {
    log(`\nBenchmarking ${mode} queries (${iterations} per query)...`, 'cyan');
    const latencies = [];

    for (let i = 0; i < iterations; i++) {
      const query = queryList[i % queryList.length];
      const modeArg = mode === 'structural' ? '--mode=lexical' : `--mode=${mode}`;

      const start = performance.now();
      await runCommand(CONFIG.smartSearchPath, [query, modeArg, '--quiet', '--top', '10']);
      const duration = performance.now() - start;

      latencies.push(duration);

      if ((i + 1) % 25 === 0) {
        log(`  Progress: ${i + 1}/${iterations}`, 'dim');
      }
    }

    results[mode] = calculateStats(latencies);
    log(`  ${mode}: p50=${results[mode].p50.toFixed(2)}ms, p95=${results[mode].p95.toFixed(2)}ms`, 'green');
  }

  return results;
}

/**
 * Benchmark daemon overhead
 */
async function benchmarkOverhead(durationMinutes = CONFIG.overheadDurationMin) {
  logSection('DAEMON OVERHEAD BENCHMARK');
  log(`Measuring daemon overhead for ${durationMinutes} minutes...`, 'cyan');

  const samples = [];
  let daemonProcess = null;

  try {
    // Start daemon
    daemonProcess = spawn('node', [CONFIG.daemonPath], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    // Wait for daemon to start
    await new Promise(r => setTimeout(r, 5000));

    log('Daemon started, collecting samples...', 'dim');

    const sampleInterval = 10000; // 10 seconds
    const totalSamples = (durationMinutes * 60 * 1000) / sampleInterval;

    for (let i = 0; i < totalSamples; i++) {
      // Get daemon's CPU usage via /proc
      try {
        const stat = readFileSync(`/proc/${daemonProcess.pid}/stat`, 'utf-8');
        const fields = stat.split(' ');
        const utime = parseInt(fields[13], 10);
        const stime = parseInt(fields[14], 10);

        const status = readFileSync(`/proc/${daemonProcess.pid}/status`, 'utf-8');
        const vmRss = status.match(/VmRSS:\s+(\d+)/)?.[1];

        samples.push({
          timestamp: Date.now(),
          cpuTicks: utime + stime,
          memoryKB: parseInt(vmRss, 10) || 0,
        });
      } catch {
        // Process may have ended
        break;
      }

      await new Promise(r => setTimeout(r, sampleInterval));

      if ((i + 1) % 6 === 0) {
        log(`  Progress: ${i + 1}/${totalSamples} samples`, 'dim');
      }
    }

  } finally {
    if (daemonProcess) {
      daemonProcess.kill('SIGTERM');
    }
  }

  // Analyze results
  if (samples.length < 2) {
    return {
      idleCpuPercent: 0,
      memoryGrowthMBPerHour: 0,
      error: 'Insufficient samples',
    };
  }

  // Calculate CPU usage (approximate)
  const cpuTicksPerSecond = 100; // Usually 100 on Linux
  const elapsedSeconds = (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000;
  const cpuTicksDelta = samples[samples.length - 1].cpuTicks - samples[0].cpuTicks;
  const cpuPercent = (cpuTicksDelta / cpuTicksPerSecond / elapsedSeconds) * 100;

  // Calculate memory growth
  const memoryStartKB = samples[0].memoryKB;
  const memoryEndKB = samples[samples.length - 1].memoryKB;
  const memoryGrowthKB = memoryEndKB - memoryStartKB;
  const memoryGrowthMBPerHour = (memoryGrowthKB / 1024) / (elapsedSeconds / 3600);

  return {
    idleCpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryStartMB: Math.round(memoryStartKB / 1024),
    memoryEndMB: Math.round(memoryEndKB / 1024),
    memoryGrowthMBPerHour: Math.round(memoryGrowthMBPerHour * 100) / 100,
    samples: samples.length,
    durationMinutes: Math.round(elapsedSeconds / 60),
  };
}

// =============================================================================
// REGRESSION DETECTION
// =============================================================================

/**
 * Compare current results against baseline
 */
function checkRegression(baseline, current) {
  const checks = [
    { path: 'fullIndex.mean', name: 'Full Index Duration', target: '<' },
    { path: 'incremental.1.mean', name: 'Incremental 1-file', target: '<' },
    { path: 'incremental.10.mean', name: 'Incremental 10-file', target: '<' },
    { path: 'searchLatency.lexical.p50', name: 'Lexical Search P50', target: '<' },
    { path: 'searchLatency.semantic.p50', name: 'Semantic Search P50', target: '<' },
    { path: 'searchLatency.hybrid.p50', name: 'Hybrid Search P50', target: '<' },
    { path: 'overhead.idleCpuPercent', name: 'Daemon Idle CPU', target: '<' },
    { path: 'overhead.memoryGrowthMBPerHour', name: 'Memory Growth', target: '<' },
  ];

  const regressions = [];
  const improvements = [];

  for (const check of checks) {
    const baseVal = getNestedValue(baseline.benchmarks, check.path);
    const currVal = getNestedValue(current.benchmarks, check.path);

    if (baseVal === undefined || currVal === undefined) continue;
    if (baseVal === 0) continue; // Can't compute change from 0

    const change = (currVal - baseVal) / baseVal;

    if (change > CONFIG.regressionThreshold) {
      regressions.push({
        metric: check.name,
        baseline: baseVal,
        current: currVal,
        change: `+${(change * 100).toFixed(1)}%`,
        severity: change > CONFIG.failureThreshold ? 'FAIL' : 'WARN',
      });
    } else if (change < -CONFIG.regressionThreshold) {
      improvements.push({
        metric: check.name,
        baseline: baseVal,
        current: currVal,
        change: `${(change * 100).toFixed(1)}%`,
      });
    }
  }

  return { regressions, improvements };
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

/**
 * Generate human-readable report
 */
function generateReport(results) {
  logSection('BENCHMARK REPORT');

  log(`\nTimestamp: ${results.timestamp}`, 'dim');
  log(`Hardware: ${results.hardware.cpu}`, 'dim');
  log(`Cores: ${results.hardware.cores}, Memory: ${results.hardware.memory}`, 'dim');
  log(`Node: ${results.hardware.node}, Platform: ${results.hardware.platform}`, 'dim');

  if (results.benchmarks.fullIndex) {
    log('\n--- Full Index ---', 'cyan');
    const fi = results.benchmarks.fullIndex;
    log(`  Duration: ${(fi.mean / 1000).toFixed(2)}s (p95: ${(fi.p95 / 1000).toFixed(2)}s)`, 'reset');
    log(`  Variance: CV=${fi.cv}`, 'dim');
    log(`  Success Rate: ${fi.successRate}`, fi.successRate === '3/3' ? 'green' : 'yellow');
    log(`  Entities: ${fi.avgEntities}, Chunks: ${fi.avgChunks}`, 'dim');
  }

  if (results.benchmarks.incremental) {
    log('\n--- Incremental Index ---', 'cyan');
    for (const [fileCount, stats] of Object.entries(results.benchmarks.incremental)) {
      log(`  ${fileCount} files: ${(stats.mean / 1000).toFixed(2)}s (p95: ${(stats.p95 / 1000).toFixed(2)}s)`, 'reset');
    }
  }

  if (results.benchmarks.searchLatency) {
    log('\n--- Search Latency (warm) ---', 'cyan');
    const sl = results.benchmarks.searchLatency;
    for (const [mode, stats] of Object.entries(sl)) {
      const p50Color = stats.p50 < 50 ? 'green' : stats.p50 < 200 ? 'yellow' : 'red';
      log(`  ${mode.padEnd(12)} p50: ${stats.p50.toFixed(1)}ms, p95: ${stats.p95.toFixed(1)}ms`, p50Color);
    }
  }

  if (results.benchmarks.overhead) {
    log('\n--- Daemon Overhead ---', 'cyan');
    const oh = results.benchmarks.overhead;
    const cpuColor = oh.idleCpuPercent < 0.5 ? 'green' : oh.idleCpuPercent < 2 ? 'yellow' : 'red';
    log(`  Idle CPU: ${oh.idleCpuPercent}%`, cpuColor);
    const memColor = oh.memoryGrowthMBPerHour < 10 ? 'green' : oh.memoryGrowthMBPerHour < 50 ? 'yellow' : 'red';
    log(`  Memory Growth: ${oh.memoryGrowthMBPerHour} MB/hour`, memColor);
    log(`  Samples: ${oh.samples} over ${oh.durationMinutes} minutes`, 'dim');
  }

  log('\n' + '='.repeat(60), 'bright');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const runFullIndex = args.includes('--full-index') || args.length === 0;
  const runIncremental = args.includes('--incremental') || args.length === 0;
  const runSearch = args.includes('--search') || args.length === 0;
  const runOverhead = args.includes('--overhead') || args.length === 0;
  const isBaseline = args.includes('--baseline');
  const isCI = args.includes('--ci');
  const compareIndex = args.indexOf('--compare');
  const compareFile = compareIndex !== -1 ? args[compareIndex + 1] : null;

  log('\n' + '='.repeat(60), 'bright');
  log('SEARCH 100x PERFORMANCE BENCHMARK', 'bright');
  log('='.repeat(60), 'bright');

  const results = {
    timestamp: new Date().toISOString(),
    hardware: getHardwareInfo(),
    benchmarks: {},
  };

  try {
    // Run requested benchmarks
    if (runFullIndex) {
      results.benchmarks.fullIndex = await benchmarkFullIndex();
    }

    if (runIncremental) {
      logSection('INCREMENTAL INDEX BENCHMARK');
      results.benchmarks.incremental = {
        1: await benchmarkIncremental(1),
        10: await benchmarkIncremental(10),
        100: await benchmarkIncremental(100),
      };
    }

    if (runSearch) {
      results.benchmarks.searchLatency = await benchmarkSearchLatency();
    }

    if (runOverhead) {
      results.benchmarks.overhead = await benchmarkOverhead();
    }

    // Generate report
    generateReport(results);

    // Save results
    await fs.mkdir(CONFIG.resultsDir, { recursive: true });
    const filename = isBaseline ? 'baseline.json' : `benchmark-${Date.now()}.json`;
    const outputPath = path.join(CONFIG.resultsDir, filename);
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
    log(`\nResults saved to: ${outputPath}`, 'green');

    // Compare against baseline if requested
    if (compareFile) {
      log('\n--- Regression Check ---', 'cyan');
      try {
        const baseline = JSON.parse(await fs.readFile(compareFile, 'utf-8'));
        const { regressions, improvements } = checkRegression(baseline, results);

        if (improvements.length > 0) {
          log('\nImprovements:', 'green');
          for (const imp of improvements) {
            log(`  ${imp.metric}: ${imp.baseline} -> ${imp.current} (${imp.change})`, 'green');
          }
        }

        if (regressions.length > 0) {
          log('\nRegressions:', 'red');
          for (const reg of regressions) {
            const color = reg.severity === 'FAIL' ? 'red' : 'yellow';
            log(`  [${reg.severity}] ${reg.metric}: ${reg.baseline} -> ${reg.current} (${reg.change})`, color);
          }

          if (isCI && regressions.some(r => r.severity === 'FAIL')) {
            log('\nCI FAILURE: Performance regression detected!', 'red');
            process.exit(1);
          }
        } else {
          log('\nNo regressions detected.', 'green');
        }
      } catch (err) {
        log(`Failed to compare: ${err.message}`, 'red');
      }
    }

  } catch (err) {
    log(`\nBenchmark failed: ${err.message}`, 'red');
    console.error(err.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export {
  benchmarkFullIndex,
  benchmarkIncremental,
  benchmarkSearchLatency,
  benchmarkOverhead,
  calculateStats,
  checkRegression,
};
