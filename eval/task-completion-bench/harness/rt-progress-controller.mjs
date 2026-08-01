// Default-OFF edit/test progress telemetry and advisory-only recovery guidance.
// This module never restores, terminates, or edits the graded checkout. It records
// trustworthy run_tests cycles and retains immutable source checkpoints outside it.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  realpathSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RT_PROGRESS_VERSION = 'rt-progress-v1';
export const RT_PROGRESS_SCHEMA = 1;
const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H_VALUES = new Set([2, 3, 4]);
const MAX_FILES = 128;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.rs', '.go', '.java', '.kt',
  '.kts', '.scala', '.cs', '.fs', '.fsx', '.swift', '.m', '.mm', '.js', '.jsx',
  '.mjs', '.cjs', '.ts', '.tsx', '.py', '.pyi', '.rb', '.php', '.ex', '.exs',
  '.erl', '.hrl', '.clj', '.cljs', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.sql',
  '.vue', '.svelte', '.html', '.css', '.scss', '.less', '.json', '.yaml', '.yml',
  '.toml', '.xml', '.gradle', '.properties', '.proto', '.graphql', '.lua', '.r',
]);
const SOURCE_BASENAMES = new Set([
  'makefile', 'dockerfile', 'gemfile', 'rakefile', 'build', 'workspace', 'meson.build',
]);
const POLICY = Object.freeze({
  version: RT_PROGRESS_VERSION,
  schema: RT_PROGRESS_SCHEMA,
  thresholds: [2, 3, 4],
  advisory: [
    'recovery.streak-N.current-ID.best-ID.allowance-1',
    'restore-submit.streak-N.best-ID',
  ],
  rank: ['issuePass', 'introducedCount', 'buildStage', 'prohibitedFiles', 'patchBytes'],
  limits: { files: MAX_FILES, fileBytes: MAX_FILE_BYTES, totalBytes: MAX_TOTAL_BYTES },
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const safeLabel = value => String(value || 'unknown').replace(/[^\w.@-]/g, '_');
const inside = (root, target) => {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
};
const relativeRetentionPath = value => value ? path.relative(BENCH_DIR, value) : null;

/** Resolve arm-symmetric controller flags. Invalid partial T1 configs fail closed. */
export function resolveProgressFlags(env = process.env) {
  const telemetry = env.SS_RT_PROGRESS === '1';
  const advisory = env.SS_RT_ADVISORY === '1';
  const rawH = String(env.SS_RT_H || '').trim();
  if (advisory && !telemetry) throw new Error('SS_RT_ADVISORY=1 requires SS_RT_PROGRESS=1');
  if (!advisory && rawH) throw new Error('SS_RT_H is valid only when SS_RT_ADVISORY=1');
  const h = advisory ? Number(rawH) : null;
  if (advisory && (!Number.isInteger(h) || !H_VALUES.has(h))) {
    throw new Error('SS_RT_ADVISORY=1 requires frozen SS_RT_H in {2,3,4}');
  }
  return Object.freeze({ telemetry, advisory, h });
}

export function progressPolicyHash(flags = resolveProgressFlags()) {
  return sha256(stable({ policy: POLICY, telemetry: flags.telemetry, advisory: flags.advisory, h: flags.h }));
}

export function progressRowFields(config = {}) {
  const flags = config.flags || config;
  return {
    rtProgressVersion: RT_PROGRESS_VERSION,
    rtProgressSchema: RT_PROGRESS_SCHEMA,
    rtProgressTelemetry: flags.telemetry === true,
    rtProgressAdvisory: flags.advisory === true,
    rtProgressH: flags.advisory === true ? flags.h : null,
    rtProgressPolicyHash: config.policyHash || progressPolicyHash(flags),
    rtProgressLog: relativeRetentionPath(config.logPath),
    rtProgressRawDir: relativeRetentionPath(config.rawDir),
    rtProgressCheckpointDir: relativeRetentionPath(config.checkpointDir),
  };
}

/** Build one rollout config and open an append-only controller session. */
export function createProgressRunConfig({
  flags = resolveProgressFlags(), controllerDir = null, rundir, taskId, arm, runId = 'adhoc',
  injectedFiles = [],
} = {}) {
  const base = {
    flags, version: RT_PROGRESS_VERSION, schema: RT_PROGRESS_SCHEMA,
    policyHash: progressPolicyHash(flags), taskId: taskId || null, arm: arm || null, runId,
    controllerDir: null, logPath: null, rawDir: null, checkpointDir: null, sessionId: null,
    injectedFiles: [],
  };
  if (!flags.telemetry) return base;
  if (!controllerDir) throw new Error('progress telemetry requires an out-of-tree controllerDir');
  if (!rundir || inside(rundir, controllerDir) || path.resolve(rundir) === path.resolve(controllerDir)) {
    throw new Error('progress controllerDir must be outside the graded workspace');
  }
  const sessionId = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`;
  const config = {
    ...base, controllerDir: path.resolve(controllerDir), sessionId,
    logPath: path.join(controllerDir, 'cycles.jsonl'),
    rawDir: path.join(controllerDir, 'raw', sessionId),
    checkpointDir: path.join(controllerDir, 'checkpoints'),
    injectedFiles: snapshotInjectedFiles(rundir, injectedFiles),
  };
  mkdirSync(config.rawDir, { recursive: true });
  mkdirSync(config.checkpointDir, { recursive: true });
  appendFileSync(config.logPath, JSON.stringify({
    kind: 'session', schema: config.schema, version: config.version, policyHash: config.policyHash,
    sessionId, task: config.taskId, arm: config.arm, run: config.runId,
    flags: { telemetry: true, advisory: flags.advisory, h: flags.h },
    timestamp: new Date().toISOString(),
  }) + '\n');
  return config;
}

function snapshotInjectedFiles(rundir, files) {
  const snapshots = [];
  for (const rel of [...new Set(files || [])].sort()) {
    if (!isSafeRepoRelative(rel) || !isProtectedCheckpointPath(rel)) continue;
    const absolute = path.resolve(rundir, ...rel.replace(/\\/g, '/').split('/'));
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || !inside(rundir, absolute)) continue;
      snapshots.push({ path: rel.replace(/\\/g, '/'), sha256: sha256(readFileSync(absolute)), bytes: stat.size });
    } catch { /* absent injected surface cannot be an exclusion baseline */ }
  }
  return snapshots;
}

function matchesInjectedSnapshot(rundir, rel, snapshots) {
  const expected = (snapshots || []).find(item => item.path === rel.replace(/\\/g, '/'));
  if (!expected) return false;
  try {
    const absolute = path.resolve(rundir, ...rel.replace(/\\/g, '/').split('/'));
    const stat = lstatSync(absolute);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.bytes
      && sha256(readFileSync(absolute)) === expected.sha256;
  } catch { return false; }
}

export function normalizeTestScope(scope = 'full', pattern = '') {
  if (scope !== 'targeted') return 'full';
  const normalized = String(pattern || '').trim().replace(/\s+/g, ' ');
  return normalized ? `targeted:${normalized}` : 'full';
}

export function isSafeRepoRelative(value) {
  const raw = String(value || '');
  if (!raw || raw.includes('\0') || path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return false;
  const parts = raw.replace(/\\/g, '/').split('/');
  return parts.every(part => part && part !== '.' && part !== '..');
}

export function isProtectedCheckpointPath(value) {
  if (!isSafeRepoRelative(value)) return true;
  const rel = value.replace(/\\/g, '/');
  const parts = rel.toLowerCase().split('/');
  const base = parts.at(-1);
  if (parts.some(p => ['.git', '.sweet-search', '.codex-bin', '.claude', '__tests__', 'test', 'tests',
    'benchmark', 'benchmarks'].includes(p))) return true;
  if (rel.toLowerCase().startsWith('eval/task-completion-bench/')) return true;
  if (['agents.md', 'claude.md', '.cursorrules'].includes(base)) return true;
  if (/^_?(?:run_tests|rt_)/i.test(base)) return true;
  return /(?:^|[._-])(?:test|spec)\.[^.]+$/i.test(base);
}

export function isSourcePath(value) {
  const base = path.posix.basename(String(value || '').replace(/\\/g, '/')).toLowerCase();
  return SOURCE_EXTENSIONS.has(path.posix.extname(base)) || SOURCE_BASENAMES.has(base);
}

function git(rundir, args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  return execFileSync('git', ['-C', rundir, ...args], {
    encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer,
  });
}

function zlist(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

function captureUntracked(rundir) {
  let names = [];
  try { names = zlist(git(rundir, ['ls-files', '--others', '--exclude-standard', '-z'])); }
  catch { return { names: [], accepted: [], rejected: [{ path: null, reason: 'git-list-failed' }], fingerprint: null, complete: false }; }
  const accepted = []; const rejected = []; let total = 0;
  for (const rel of names.sort()) {
    if (accepted.length >= MAX_FILES) { rejected.push({ path: rel, reason: 'file-count-limit' }); continue; }
    if (!isSafeRepoRelative(rel)) { rejected.push({ path: rel, reason: 'unsafe-path' }); continue; }
    if (isProtectedCheckpointPath(rel)) { rejected.push({ path: rel, reason: 'protected-path' }); continue; }
    if (!isSourcePath(rel)) { rejected.push({ path: rel, reason: 'not-source' }); continue; }
    const absolute = path.resolve(rundir, ...rel.replace(/\\/g, '/').split('/'));
    if (!inside(rundir, absolute)) { rejected.push({ path: rel, reason: 'outside-workspace' }); continue; }
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) { rejected.push({ path: rel, reason: 'not-regular' }); continue; }
      const real = realpathSync(absolute);
      if (!inside(realpathSync(rundir), real)) { rejected.push({ path: rel, reason: 'symlink-escape' }); continue; }
      if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_TOTAL_BYTES) {
        rejected.push({ path: rel, reason: 'size-limit' }); continue;
      }
      const content = readFileSync(real);
      if (content.length > MAX_FILE_BYTES || total + content.length > MAX_TOTAL_BYTES) {
        rejected.push({ path: rel, reason: 'size-limit' }); continue;
      }
      total += content.length;
      accepted.push({ path: rel.replace(/\\/g, '/'), bytes: content.length, sha256: sha256(content), content });
    } catch { rejected.push({ path: rel, reason: 'read-failed' }); }
  }
  const manifest = accepted.map(({ path: p, bytes, sha256: hash }) => ({ path: p, bytes, sha256: hash }));
  const incompleteEntries = rejected.filter(item => item.reason !== 'protected-path' && item.reason !== 'not-source');
  return {
    names, accepted, rejected,
    fingerprint: sha256(stable({ manifest, incompleteEntries })),
    totalBytes: total, complete: incompleteEntries.length === 0,
  };
}

/** Capture the current source state; protected/test/instruction edits are never bundled. */
export function captureSourceState(rundir, diffText = '', { injectedFiles = [] } = {}) {
  let trackedChangedFiles = [];
  try { trackedChangedFiles = zlist(git(rundir, ['diff', '--name-only', '-z', 'HEAD', '--', '.'])).sort(); }
  catch { /* state remains explicitly empty */ }
  const trackedSourceFiles = trackedChangedFiles.filter(p => !isProtectedCheckpointPath(p) && isSourcePath(p));
  let binaryPatch = Buffer.alloc(0);
  if (trackedSourceFiles.length) {
    try { binaryPatch = git(rundir, ['diff', '--binary', 'HEAD', '--', ...trackedSourceFiles]); }
    catch { binaryPatch = Buffer.alloc(0); }
  }
  const untracked = captureUntracked(rundir);
  const changedFiles = [...new Set([...trackedChangedFiles, ...untracked.names])].sort();
  const ignoredInjectedFiles = changedFiles.filter(p => isProtectedCheckpointPath(p)
    && matchesInjectedSnapshot(rundir, p, injectedFiles));
  const ignored = new Set(ignoredInjectedFiles);
  const prohibitedFiles = changedFiles.filter(p => isProtectedCheckpointPath(p) && !ignored.has(p));
  const untrackedManifest = untracked.accepted.map(({ path: p, bytes, sha256: hash }) => ({ path: p, bytes, sha256: hash }));
  const sourceStateHash = sha256(Buffer.concat([
    binaryPatch, Buffer.from('\0'), Buffer.from(untracked.fingerprint || 'unavailable'),
  ]));
  return {
    diffHash: sha256(String(diffText || '')), binaryPatch, binaryPatchHash: sha256(binaryPatch),
    sourceStateHash, changedFiles, trackedSourceFiles, prohibitedFiles,
    ignoredInjectedFiles,
    untrackedManifest, untrackedRejected: untracked.rejected,
    untrackedFingerprint: untracked.fingerprint,
    retentionComplete: untracked.complete,
    patchBytes: binaryPatch.length + (untracked.totalBytes || 0),
    hasSourceEdit: binaryPatch.length > 0 || untracked.accepted.length > 0,
    _untracked: untracked.accepted,
  };
}

function retainCheckpoint(config, state) {
  if (!state.hasSourceEdit) return { id: null, path: null, error: null };
  if (!state.retentionComplete) return { id: null, path: null, error: 'untracked source retention incomplete' };
  const id = `cp-${state.sourceStateHash.slice(0, 16)}`;
  const dir = path.join(config.checkpointDir, id);
  try {
    if (!existsSync(dir)) {
      mkdirSync(path.join(dir, 'untracked'), { recursive: true });
      writeFileSync(path.join(dir, 'binary.patch'), state.binaryPatch, { flag: 'wx' });
      for (const file of state._untracked) {
        const destination = path.join(dir, 'untracked', ...file.path.split('/'));
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, file.content, { flag: 'wx' });
      }
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        schema: RT_PROGRESS_SCHEMA, version: RT_PROGRESS_VERSION, checkpointId: id,
        binaryPatchHash: state.binaryPatchHash, sourceStateHash: state.sourceStateHash,
        trackedSourceFiles: state.trackedSourceFiles, changedFiles: state.changedFiles,
        prohibitedFiles: state.prohibitedFiles, ignoredInjectedFiles: state.ignoredInjectedFiles,
        untrackedSource: state.untrackedManifest,
        untrackedRejected: state.untrackedRejected, patchBytes: state.patchBytes,
      }, null, 2) + '\n', { flag: 'wx' });
    }
    return { id, path: relativeRetentionPath(dir), error: null };
  } catch (error) {
    return { id: null, path: null, error: String(error?.message || error).slice(0, 240) };
  }
}

const sorted = values => [...new Set(values || [])].sort();
const strictSubset = (left, right) => left.length < right.length && left.every(x => right.includes(x));
const failureStateHash = observation => sha256(stable({
  introduced: sorted(observation.introducedFailures), raw: sorted(observation.rawFailures),
  status: observation.status,
}));

/** Classify one cycle without using model prose or the gold patch. */
export function classifyProgress(previous, current, history = []) {
  if (!current.executed || !current.trustworthy || current.status === 'INFRA') {
    return { kind: 'pause', reason: 'untrusted-or-infra', oscillation: null, degradation: false };
  }
  if (!previous) {
    const betterCanonical = current.scopeKey === 'full' && current.hasSourceEdit;
    return { kind: betterCanonical ? 'progress' : 'establish', reason: betterCanonical ? 'first-canonical' : 'first-result', oscillation: null, degradation: false };
  }
  const sameState = current.sourceStateHash === previous.sourceStateHash;
  const sameFailures = current.failureStateHash === previous.failureStateHash;
  const recurred = history.slice(0, -1).some(row => row.sourceStateHash === current.sourceStateHash && row.failureStateHash === current.failureStateHash);
  const oscillation = recurred ? 'a-b-repeat' : (sameState ? 'exact-state-repeat' : (sameFailures ? 'failure-state-repeat' : null));
  if (sameState) return { kind: 'pause', reason: 'no-source-change', oscillation, degradation: false };
  const subset = strictSubset(sorted(current.introducedFailures), sorted(previous.introducedFailures));
  const issueAdvanced = current.issuePass === true && previous.issuePass !== true;
  const buildAdvanced = Number.isInteger(current.buildStage) && Number.isInteger(previous.buildStage) && current.buildStage > previous.buildStage;
  const newFailures = current.introducedFailures.some(x => !previous.introducedFailures.includes(x));
  const buildRegressed = Number.isInteger(current.buildStage) && Number.isInteger(previous.buildStage) && current.buildStage < previous.buildStage;
  if (subset || issueAdvanced || buildAdvanced) {
    return { kind: 'progress', reason: subset ? 'introduced-subset' : (issueAdvanced ? 'issue-pass' : 'build-advance'), oscillation, degradation: false };
  }
  return { kind: 'non-progress', reason: 'no-objective-improvement', oscillation, degradation: newFailures || buildRegressed };
}

function compareCheckpoints(a, b) {
  const av = [a.issuePass ? 1 : 0, -(a.introducedCount ?? Infinity), Number.isInteger(a.buildStage) ? a.buildStage : -1,
    a.prohibitedCount === 0 ? 1 : 0, -(a.patchBytes ?? Infinity)];
  const bv = [b.issuePass ? 1 : 0, -(b.introducedCount ?? Infinity), Number.isInteger(b.buildStage) ? b.buildStage : -1,
    b.prohibitedCount === 0 ? 1 : 0, -(b.patchBytes ?? Infinity)];
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
  return String(a.id).localeCompare(String(b.id));
}

export function rankCheckpoints(checkpoints, { verifiedOnly = false } = {}) {
  return [...(checkpoints || [])].filter(c => c?.id && (!verifiedOnly || c.verified)).sort(compareCheckpoints);
}

export function advisoryGuidance({ advisory, h, streak, currentId, verifiedBestId, trustworthy }) {
  if (!advisory || !trustworthy || !Number.isInteger(h)) return 'none';
  const current = safeLabel(currentId || 'none').slice(0, 24);
  const best = safeLabel(verifiedBestId || 'none').slice(0, 24);
  if (streak === h) return `recovery.streak-${streak}.current-${current}.best-${best}.allowance-1`;
  if (streak >= h + 1) return `restore-submit.streak-${streak}.best-${best}`;
  return 'none';
}

function readSessionRows(config) {
  if (!config.logPath || !existsSync(config.logPath)) return [];
  const rows = [];
  for (const line of readFileSync(config.logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.kind === 'invocation' && row.sessionId === config.sessionId) rows.push(row);
    } catch { /* tolerate a torn append-only tail */ }
  }
  return rows;
}

/** Record a completed run_tests invocation and return the advisory token for line 3. */
export function recordProgressInvocation(config, input) {
  if (config?.flags?.telemetry !== true) return { guidance: 'none', record: null };
  const rows = readSessionRows(config);
  const call = rows.length + 1;
  const rawPath = path.join(config.rawDir, `call-${String(call).padStart(4, '0')}.txt`);
  writeFileSync(rawPath, String(input.rawOutput || ''));
  const state = captureSourceState(input.rundir, input.diffText, { injectedFiles: config.injectedFiles });
  const checkpoint = retainCheckpoint(config, state);
  const scopeKey = normalizeTestScope(input.scope, input.pattern);
  const rawFailures = sorted(input.rawFailures);
  const introducedFailures = sorted(input.introducedFailures);
  const preExistingFailures = sorted(input.preExistingFailures);
  const previousSameScope = [...rows].reverse().find(row => row.scopeKey === scopeKey && row.executed && row.trustworthy && row.status !== 'INFRA');
  const priorScopeRows = rows.filter(row => row.scopeKey === scopeKey && row.executed && row.trustworthy && row.status !== 'INFRA');
  const previousState = rows.at(-1);
  const cycle = state.hasSourceEdit
    ? ((previousState?.cycle || 0) + (previousState?.sourceStateHash === state.sourceStateHash ? 0 : 1))
    : (previousState?.cycle || 0);
  const current = {
    scopeKey, status: input.status, executed: input.executed !== false,
    trustworthy: input.trustworthy === true, sourceStateHash: state.sourceStateHash,
    hasSourceEdit: state.hasSourceEdit, rawFailures, introducedFailures,
    issuePass: input.issuePass === true, buildStage: Number.isInteger(input.buildStage) ? input.buildStage : null,
  };
  current.failureStateHash = failureStateHash(current);
  const classification = classifyProgress(previousSameScope, current, priorScopeRows);
  const priorStreak = previousSameScope?.triggerCount || 0;
  const triggerCount = classification.kind === 'progress' ? 0
    : (classification.kind === 'non-progress' ? priorStreak + 1 : priorStreak);
  const candidate = checkpoint.id && current.executed && current.trustworthy && input.status !== 'INFRA'
    ? {
        id: checkpoint.id, verified: scopeKey === 'full' && state.prohibitedFiles.length === 0,
        issuePass: current.issuePass, introducedCount: introducedFailures.length,
        buildStage: current.buildStage, prohibitedCount: state.prohibitedFiles.length,
        patchBytes: state.patchBytes,
      }
    : null;
  const candidates = rows.map(row => row.checkpoint).filter(Boolean);
  if (candidate) candidates.push(candidate);
  const candidateBestId = rankCheckpoints(candidates)[0]?.id || null;
  const verifiedBestId = rankCheckpoints(candidates, { verifiedOnly: true })[0]?.id || null;
  const guidance = advisoryGuidance({
    advisory: config.flags.advisory, h: config.flags.h, streak: triggerCount,
    currentId: checkpoint.id, verifiedBestId, trustworthy: current.trustworthy && current.executed && current.status !== 'INFRA',
  });
  const record = {
    kind: 'invocation', schema: config.schema, version: config.version,
    policyHash: config.policyHash, sessionId: config.sessionId, task: config.taskId,
    arm: config.arm, run: config.runId, call, modelTurn: null,
    modelTurnSource: 'raw-ndjson-posthoc', cycle, timestamp: new Date().toISOString(),
    scope: input.scope === 'targeted' ? 'targeted' : 'full', scopeKey,
    normalizedPattern: scopeKey.startsWith('targeted:') ? scopeKey.slice(9) : null,
    status: input.status, verdict: input.verdict, exitCode: input.exitCode,
    executed: current.executed, trustworthy: current.trustworthy,
    diffHash: state.diffHash, binaryPatchHash: state.binaryPatchHash,
    sourceStateHash: state.sourceStateHash, untrackedSourceFingerprint: state.untrackedFingerprint,
    changedFiles: state.changedFiles, sourceFiles: [...state.trackedSourceFiles, ...state.untrackedManifest.map(x => x.path)].sort(),
    prohibitedFiles: state.prohibitedFiles, ignoredInjectedFiles: state.ignoredInjectedFiles,
    patchBytes: state.patchBytes,
    rawFailureSignatures: rawFailures, introducedFailures, preExistingFailures,
    targetStatus: input.targetStatus || input.status, buildStatus: input.buildStatus || null,
    buildStage: current.buildStage, dedupDecision: input.dedupDecision || 'none',
    cacheDecision: input.cacheDecision || null, suiteExecuted: current.executed,
    progress: classification.kind, progressReason: classification.reason,
    oscillation: classification.oscillation, degradation: classification.degradation,
    checkpoint: candidate, checkpointId: checkpoint.id, checkpointError: checkpoint.error,
    candidateBestId, verifiedBestId, triggerCount, advisory: guidance,
    actionSincePrior: previousState ? (previousState.sourceStateHash === state.sourceStateHash ? 'retest' : 'source-edit') : 'initial-test',
    subsequentActionClass: null, rawResultPath: relativeRetentionPath(rawPath),
    checkpointPath: checkpoint.path,
  };
  appendFileSync(config.logPath, JSON.stringify(record) + '\n');
  return { guidance, record };
}

/**
 * Backfill the broker's cycle-to-model-step relation from the retained agent
 * stream. The cycle rows stay append-only; this final record is the immutable
 * join table used by post-run threshold and behavior adjudication.
 */
export function finalizeProgressModelTurns(config, toolCalls = []) {
  if (config?.flags?.telemetry !== true) return { complete: true, mappings: [] };
  const invocations = readSessionRows(config);
  const tests = (toolCalls || []).filter(call => call?.kind === 'test');
  const mappings = invocations.map((row, index) => ({
    call: row.call,
    modelTurn: Number.isInteger(tests[index]?.modelTurn) ? tests[index].modelTurn : null,
    messageId: tests[index]?.messageId || null,
  }));
  const complete = tests.length === invocations.length
    && mappings.every(row => Number.isInteger(row.modelTurn) && row.modelTurn > 0);
  const record = {
    kind: 'model-turn-map', schema: config.schema, version: config.version,
    policyHash: config.policyHash, sessionId: config.sessionId, task: config.taskId,
    arm: config.arm, run: config.runId, source: 'raw-ndjson-posthoc',
    invocationCount: invocations.length, testToolCount: tests.length,
    complete, mappings, timestamp: new Date().toISOString(),
  };
  appendFileSync(config.logPath, JSON.stringify(record) + '\n');
  return record;
}
