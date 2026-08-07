#!/usr/bin/env node
/**
 * Reconstruct the SOURCE STATE a best-verified-checkpoint selector would have
 * submitted, and emit it as a gradeable prediction patch (EDIT_THRASHING.md §4.2:
 * "write both final and selected-best patches to dev predictions and grade both with
 * the real evaluator").
 *
 * The codex runner records every edit as an `apply_patch` payload in the raw rollout,
 * so replaying the first m payloads onto the base checkout reproduces the state
 * observed at the m-th edit boundary. Reconstruction is PROVEN, not assumed: the
 * sha256 of the reconstructed `git diff` is compared against the diffSha the rt-dedup
 * ledger recorded for that same run_tests call. A mismatch is reported so the caller
 * can discard the row; a hunk that cannot be located unambiguously throws rather than
 * guessing (the payload format carries no line numbers).
 *
 * Base file contents are read out of the task image with `git show HEAD:<path>`, so no
 * checkout is needed and nothing is written into a graded workspace.
 *
 * Usage:
 *   node stats/checkpoint-reconstruct.mjs --run results/<run> --tasks <specs.json> \
 *     --task <instance_id> --arm native|sweet --rep N --upto-call K [--outdir DIR]
 *
 * Grade the result with the standard evaluator path:
 *   sr-eval.py --json <specs> --patches [{instance_id,patch}] --network none
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HO2_RE = /tasks_heldout2|heldout2(?:[_.\/-]|$)|(?:^|[_.\/-])ho2(?:[_.\/-]|$)/i;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;

/** Parse one codex `*** Begin Patch … *** End Patch` payload into per-file hunks. */
export function parseApplyPatch(text) {
  const files = [];
  let file = null, hunk = null;
  for (const line of String(text).split('\n')) {
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) { file = { op: header[1], file: header[2], hunks: [] }; files.push(file); hunk = null; continue; }
    if (/^\*\*\* (Begin|End) Patch$/.test(line)) continue;
    if (!file) continue;
    if (line.startsWith('@@')) { hunk = { old: [], new: [] }; file.hunks.push(hunk); continue; }
    if (!hunk) { hunk = { old: [], new: [] }; file.hunks.push(hunk); }
    if (line.startsWith('-')) hunk.old.push(line.slice(1));
    else if (line.startsWith('+')) hunk.new.push(line.slice(1));
    else { const context = line.startsWith(' ') ? line.slice(1) : line; hunk.old.push(context); hunk.new.push(context); }
  }
  return files;
}

/** Ordered edits and run_tests boundaries of one raw rollout. */
export function rolloutTimeline(file) {
  const events = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    const payload = event.payload;
    if (!payload) continue;
    if (payload.type === 'custom_tool_call' && payload.name === 'exec') {
      const input = typeof payload.input === 'string' ? payload.input : JSON.stringify(payload.input);
      const match = /"\*\*\* Begin Patch\\n([\s\S]*?)\*\*\* End Patch"/.exec(input);
      if (match) events.push({ kind: 'edit', patch: JSON.parse(`"*** Begin Patch\\n${match[1]}*** End Patch"`) });
    } else if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') {
      const text = Array.isArray(payload.output) ? payload.output.map(part => part?.text || '').join('')
        : (typeof payload.output === 'string' ? payload.output : '');
      if (/\[run_tests verdict\]/.test(text)) events.push({ kind: 'test' });
    }
  }
  return events;
}

/** The diffSha the dedup ledger recorded for call K of this rollout. */
function recordedCall(runDir, task, arm, rep, call) {
  const file = path.join(runDir, 'rt-dedup', `${task}-${arm}.jsonl`);
  const byRep = new Map();
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.kind === 'session') { cur = []; byRep.set(/__r(\d+)__/.exec(row.rundir || '')?.[1] ?? String(byRep.size), cur); continue; }
    if (cur) cur.push(row);
  }
  return (byRep.get(String(rep)) || [])[call - 1] || null;
}

/** Strip the per-rollout run directory prefix off an absolute workspace path. */
export function toRepoRelative(value) {
  const match = /__r\d+__\d+\/(.+)$/.exec(String(value));
  return match ? match[1] : String(value).replace(/^\/+/, '');
}

export function reconstruct({ runDir, tasksFile, task, arm, rep, uptoCall, outDir }) {
  for (const value of [runDir, tasksFile, task]) {
    if (HO2_RE.test(String(value))) throw new Error(`refusing forbidden HO2 path: ${value}`);
  }
  const spec = JSON.parse(readFileSync(tasksFile, 'utf8')).find(s => s.instance_id === task);
  if (!spec) throw new Error(`no spec for ${task} in ${tasksFile}`);
  const row = JSON.parse(readFileSync(path.join(runDir, 'rows.json'), 'utf8'))
    .find(r => r.taskId === task && r.arm === arm && String(r.rep) === String(rep));
  if (!row?.rolloutFile) throw new Error(`no rollout for ${task}/${arm}/r${rep}`);

  // Edits preceding the uptoCall-th run_tests.
  const timeline = rolloutTimeline(row.rolloutFile);
  const edits = [];
  let tests = 0;
  for (const event of timeline) {
    if (event.kind === 'edit') edits.push(event.patch);
    else if (event.kind === 'test' && ++tests === uptoCall) break;
  }
  if (tests < uptoCall) throw new Error(`rollout has only ${tests} footer-bearing run_tests calls, wanted ${uptoCall}`);

  const workdir = spec.workdir || '/testbed';
  const parsed = edits.map(parseApplyPatch);
  const touched = new Set();
  for (const files of parsed) for (const file of files) touched.add(toRepoRelative(file.file));

  // Pull chatter goes to stderr — stdout is reserved for the JSON result.
  execFileSync('docker', ['pull', '-q', spec.image_name], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 1800000 });
  const base = new Map();
  for (const rel of touched) {
    base.set(rel, execSync(
      `docker run --rm --network none ${spec.image_name} bash -c ${shellQuote(`cd ${workdir} && git show HEAD:${rel}`)}`,
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  }

  // Replay every hunk as a unique, unambiguous text substitution.
  const current = new Map(base);
  for (const files of parsed) {
    for (const file of files) {
      const rel = toRepoRelative(file.file);
      let text = current.get(rel);
      for (const hunk of file.hunks) {
        const oldText = hunk.old.join('\n');
        const newText = hunk.new.join('\n');
        const at = text.indexOf(oldText);
        if (at < 0) throw new Error(`hunk not found in ${rel}: ${JSON.stringify(oldText.slice(0, 120))}`);
        if (text.indexOf(oldText, at + 1) >= 0) throw new Error(`ambiguous hunk in ${rel} — not reconstructible, report as missing`);
        text = text.slice(0, at) + newText + text.slice(at + oldText.length);
      }
      current.set(rel, text);
    }
  }

  // Render as a unified diff against the base.
  mkdirSync(outDir, { recursive: true });
  const aDir = path.join(outDir, '.a');
  const bDir = path.join(outDir, '.b');
  rmSync(aDir, { recursive: true, force: true });
  rmSync(bDir, { recursive: true, force: true });
  let patch = '';
  for (const rel of touched) {
    const aFile = path.join(aDir, rel);
    const bFile = path.join(bDir, rel);
    mkdirSync(path.dirname(aFile), { recursive: true });
    mkdirSync(path.dirname(bFile), { recursive: true });
    writeFileSync(aFile, base.get(rel));
    writeFileSync(bFile, current.get(rel));
    let rendered = '';
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', aFile, bFile],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (error) { rendered = String(error.stdout || ''); }
    // git prints the absolute temp paths behind the a//b/ prefixes; fold them back to
    // repo-relative so the patch applies at the repo root the grader checks out.
    patch += rendered.split('\n').map(line => line
      .split(`a${aDir}/`).join('a/').split(`b${bDir}/`).join('b/')
      .split(`${aDir}/`).join('').split(`${bDir}/`).join(''))
      .join('\n');
  }
  patch = patch.replace(/\n{3,}/g, '\n\n');
  if (patch && !patch.endsWith('\n')) patch += '\n';

  const recorded = recordedCall(runDir, task, arm, rep, uptoCall);
  return {
    task, arm, rep: Number(rep), uptoCall,
    editsReplayed: parsed.length, filesTouched: [...touched],
    expectedDiffSha: recorded?.diffSha ?? null, reconstructedDiffSha: sha256(patch),
    exactMatch: recorded?.diffSha === sha256(patch),
    patchBytes: Buffer.byteLength(patch), recordedBytes: recorded?.diffBytes ?? null,
    patch,
  };
}

function main() {
  const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : fallback;
  };
  const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const options = {
    runDir: arg('run'),
    tasksFile: arg('tasks', path.join(bench, 'select/.cache/tasks_full_luna_rotate20.json')),
    task: arg('task'), arm: arg('arm'), rep: arg('rep'),
    uptoCall: Number(arg('upto-call')),
    outDir: arg('outdir', path.join(bench, '.checkpoint-recon')),
  };
  for (const key of ['runDir', 'task', 'arm', 'rep']) {
    if (!options[key]) { console.error('usage: checkpoint-reconstruct.mjs --run <dir> --task <id> --arm <arm> --rep <n> --upto-call <k>'); process.exit(2); }
  }
  const result = reconstruct(options);
  writeFileSync(path.join(options.outDir, `${options.task}-${options.arm}-r${options.rep}-call${options.uptoCall}.json`),
    JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, patch: result.patch.slice(0, 1200) }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
