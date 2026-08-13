import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mergeEvaluationReportFile, mergeTaskRecordFile } from './result-retention.mjs';
import { vaultTarName } from './env-ledger.mjs';   // derived-image vault tar filename (single source of truth)
import { stripCollidingPaths } from './patch-strip.mjs';

const DERIVED_VAULT = process.env.SS_DERIVED_BACKUP || '/workspace/docker-derived-backup';

function defaultGradeReportItem(item, spec, override = {}) {
  const f2pTotal = (spec.FAIL_TO_PASS || []).length;
  const f2pPassed = (item.from_fail_to_pass || []).length;
  const excludedP2p = new Set(override.excludeP2P || []);
  const p2pOk = (item.failed_from_pass_to_pass || [])
    .filter(name => !excludedP2p.has(name)).length === 0;
  const f2pFrac = f2pTotal ? f2pPassed / f2pTotal : 1;
  const status = f2pFrac === 1 && p2pOk
    ? 'FULL'
    : (f2pFrac > 0 && p2pOk ? 'PARTIAL' : 'NO');
  return { f2pFrac, p2pOk, status };
}

/**
 * Build the image, test, and grading adapters used by the pilot orchestrator.
 * @param {object} options
 * @returns {{ensureImage: Function, makeRunTests: Function, gradeArm: Function}}
 */
export function createEvaluatorRuntime(options) {
  const {
    benchDir, dataset, defaultTestTimeoutSec, dockerHost, dockerNetArgs,
    gradeReportItem = defaultGradeReportItem, imageNameFor, netLockdown, shellQuote,
    srEvalDir, srEvalRunner, srMode, taskById, taskOverrides, venvPython,
  } = options;

  function ensureImage(task) {
    const id = typeof task === 'string' ? task : task.instance_id;
    if (srMode) {
      const image = task.image_name;
      if (!image) throw new Error(`ensureImage: SR task ${id} has no image_name`);
      const available = () => {
        try {
          execFileSync('docker', ['image', 'inspect', image], {
            env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore',
          });
          return true;
        } catch { return false; }
      };
      if (task._origImage && !available()) {
        // Derived (warm/fixed) images aren't pullable — load from the vault tar on
        // demand. run-pilot GCs images per-task, so only one warm image is resident at
        // a time (disk-bounded, like stock images), which is what lets a full-200 run
        // cover all 47 warm tasks without pre-staging 100GB+ of images at once.
        const tar = path.join(DERIVED_VAULT, vaultTarName(image));
        if (existsSync(tar)) {
          try { execFileSync('docker', ['load', '-i', tar], { env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore', timeout: 900000 }); } catch { /* re-checked below */ }
        }
        if (!available()) throw new Error(`ensureImage: derived image ${image} not present and no loadable vault tar at ${tar} — build it (analysis/dockerfiles/${id}/) or vault it`);
        return image;
      }
      if (!available()) {
        let pulled = false;
        for (let attempt = 1; attempt <= 3 && !pulled; attempt++) {
          try {
            execFileSync('docker', ['pull', image], {
              env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore', timeout: 1800000,
            });
          } catch { /* re-checked below */ }
          pulled = available();
          if (!pulled && attempt < 3) {
            try { execFileSync('sleep', [String(5 * attempt)], { stdio: 'ignore' }); } catch { /* */ }
          }
        }
        if (!pulled) throw new Error(`ensureImage: docker pull failed for ${image} (${id}) after 3 attempts`);
      }
      return image;
    }

    const image = imageNameFor(id);
    const available = () => {
      try {
        execFileSync('docker', ['image', 'inspect', image], {
          env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore',
        });
        return true;
      } catch { return false; }
    };
    if (available()) return image;
    try {
      execFileSync(venvPython, ['-m', 'swebench.harness.run_evaluation',
        '--dataset_name', dataset, '--predictions_path', 'gold', '--max_workers', '1',
        '--instance_ids', id, '--run_id', `imgbuild-${id}`, '--cache_level', 'instance'], {
        cwd: path.join(benchDir, 'results'),
        env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore', timeout: 1800000,
      });
    } catch { /* checked below */ }
    if (!available()) throw new Error(`ensureImage: failed to build ${image} for ${id} (swebench gold build produced no image)`);
    return image;
  }

  function makeRunTests(image, checkoutDir, task) {
    if (srMode) {
      return async () => {
        const workdir = task.workdir || `/${task.repo.split('/')[1]}`;
        const testScript = [].concat(task.install_config?.test_cmd || []).join(' && ');
        if (!testScript) return '[run_tests] no test_cmd for this task';
        let diff = '';
        try {
          diff = execSync(`git -C ${checkoutDir} diff HEAD -- . ':(exclude).sweet-search'`, {
            encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
          });
        } catch { /* */ }
        const patchDir = `${checkoutDir}__rt`;
        try {
          rmSync(patchDir, { recursive: true, force: true });
          mkdirSync(patchDir, { recursive: true });
          writeFileSync(path.join(patchDir, 'agent.diff'), diff || '');
          const timeoutSec = task._testTimeoutSec || defaultTestTimeoutSec;
          const script = `cd ${workdir} && git reset --hard HEAD -q 2>/dev/null; git apply --3way --recount --ignore-space-change --whitespace=nowarn /patch/agent.diff 2>/dev/null || true; timeout ${timeoutSec} bash -c ${shellQuote(testScript)} 2>&1 | tail -60`;
          const output = execSync(`docker run --rm ${dockerNetArgs(task)}-v ${patchDir}:/patch:ro ${image} bash -c ${shellQuote(script)}`, {
            env: { ...process.env, DOCKER_HOST: dockerHost }, encoding: 'utf8',
            timeout: (timeoutSec + 60) * 1000, maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return output.slice(0, 8000);
        } catch (error) {
          return `[run_tests exit=${error.status ?? 1}]\n${(error.stdout || error.stderr || error.message || '').slice(0, 6000)}`;
        } finally {
          try { rmSync(patchDir, { recursive: true, force: true }); } catch { /* */ }
        }
      };
    }

    return async (rawArgs) => {
      const args = String(rawArgs || '').replace(/[;&|`$()<>\n]/g, ' ').slice(0, 300);
      try {
        const output = execSync(`docker run --rm --platform linux/amd64 ${netLockdown ? '--network none ' : ''}-v ${checkoutDir}:/testbed ${image} bash -lc "cd /testbed && timeout ${defaultTestTimeoutSec} python -m pytest ${args} -q 2>&1 | tail -50"`, {
          env: { ...process.env, DOCKER_HOST: dockerHost }, encoding: 'utf8',
          timeout: (defaultTestTimeoutSec + 60) * 1000, maxBuffer: 4 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return output.slice(0, 8000);
      } catch (error) {
        return `[run_tests exit=${error.status ?? 1}]\n${(error.stdout || error.stderr || error.message || '').slice(0, 6000)}`;
      }
    };
  }

  /**
   * Grader test-collision fix (patch-strip.mjs): drop agent hunks that touch a file
   * the HIDDEN test patch also touches, so the hidden patch applies cleanly and the
   * suite actually runs. Shared by both arms and both grading backends — a task must
   * never die on a merge mechanic instead of on merit (redboltz-239, protofire-224).
   * Returns rewritten predictions plus the per-task stripped-path map for row stamping.
   */
  function applyCollisionStrip(arm, predictions) {
    const strippedByTask = {};
    const prepared = predictions.map(prediction => {
      const spec = taskById.get(prediction.instance_id);
      const { patch, stripped } = stripCollidingPaths(prediction.model_patch || '', spec?.test_patch || '');
      if (!stripped.length) return prediction;
      strippedByTask[prediction.instance_id] = stripped;
      console.error(`[grade ${arm}] ${prediction.instance_id}: STRIPPED ${stripped.length} agent edit(s) `
        + `colliding with the hidden test patch — ${stripped.join(', ')}`
        + `${patch.trim() ? '' : ' (patch is now EMPTY — graded as a zero-hunk prediction)'}`);
      return { ...prediction, model_patch: patch };
    });
    return { prepared, strippedByTask };
  }

  function gradeArm(arm, predictions, runId, rep = 0) {
    const predDir = path.join(benchDir, 'results', runId, arm, ...(rep ? [`rep-${rep}`] : []));
    mkdirSync(predDir, { recursive: true });
    // Lite/swebench mode has no materialized test_patch in taskById, so the strip is
    // inert there; SR mode is the graded path for this bench.
    const { prepared, strippedByTask } = applyCollisionStrip(arm, predictions);
    if (!srMode) {
      const report = gradeSwebenchArm(arm, prepared, runId, predDir);
      return report ? { ...report, stripped_paths: strippedByTask } : report;
    }

    // Empty model patches still need an authoritative baseline grading run. Dropping
    // them here produced rows with gradeable=true even though no evaluator log or
    // framework result existed. The repository-owned evaluator skips only the empty
    // agent-patch apply step and still applies hidden tests and runs the suite.
    const predictionsToGrade = prepared;
    if (!predictionsToGrade.length) {
      return {
        resolved_instances: 0, total_instances: predictions.length, resolved_ids: [],
        score: {}, error_ids: [], missing_report_ids: [], no_test_evidence_ids: [],
        stripped_paths: strippedByTask,
      };
    }
    const batchSize = Math.max(1, +(process.env.GRADE_BATCH || 6));
    const tasksPath = path.join(predDir, 'tasks.json');
    const patchesPath = path.join(predDir, 'patches.json');
    const reportPath = path.join(predDir, 'report.json');
    mergeTaskRecordFile(tasksPath, predictionsToGrade.map(prediction => taskById.get(prediction.instance_id)).filter(Boolean));
    mergeTaskRecordFile(patchesPath, predictionsToGrade.map(prediction => ({
      instance_id: prediction.instance_id, patch: prediction.model_patch,
    })));

    const score = {};
    const resolvedIds = [];
    const errorIds = new Set();
    const missingReportIds = new Set();
    const noTestEvidenceIds = new Set();
    let gradedAny = false;
    for (let offset = 0; offset < predictionsToGrade.length; offset += batchSize) {
      const chunk = predictionsToGrade.slice(offset, offset + batchSize);
      const knownChunk = chunk.filter(prediction => {
        const known = taskById.has(prediction.instance_id);
        if (!known) errorIds.add(prediction.instance_id);
        return known;
      });
      const specs = knownChunk.map(prediction => taskById.get(prediction.instance_id));
      if (!specs.length) continue;
      const stem = path.join(predDir, `.grade-${process.pid}-${String(offset / batchSize).padStart(4, '0')}`);
      const batchPaths = {
        tasks: `${stem}-tasks.json`, patches: `${stem}-patches.json`, report: `${stem}-report.json`,
      };
      writeFileSync(batchPaths.tasks, JSON.stringify(specs));
      writeFileSync(batchPaths.patches, JSON.stringify(knownChunk.map(prediction => ({
        instance_id: prediction.instance_id, patch: prediction.model_patch,
      }))));
      try {
        runSrBatch(batchPaths, predDir);
        if (existsSync(batchPaths.report)) {
          gradedAny = true;
          const batchReport = JSON.parse(readFileSync(batchPaths.report, 'utf8'));
          mergeEvaluationReportFile(reportPath, batchReport);
          applyBatchScores(batchReport.items || [], knownChunk, score, resolvedIds, errorIds, missingReportIds, noTestEvidenceIds);
        } else {
          markMissing(knownChunk, errorIds, missingReportIds);
          console.error(`[grade ${arm} rep${rep}] eval.py produced NO report (batch @${offset}) — ${knownChunk.length} task(s) left ungraded`);
        }
      } finally {
        gcBatchImages(specs);
        Object.values(batchPaths).forEach(batchPath => {
          try { rmSync(batchPath, { force: true }); } catch { /* */ }
        });
      }
    }
    return {
      resolved_instances: resolvedIds.length,
      total_instances: predictions.length,
      resolved_ids: resolvedIds,
      score,
      error_ids: [...errorIds],
      missing_report_ids: [...missingReportIds],
      no_test_evidence_ids: [...noTestEvidenceIds],
      graded_any: gradedAny,
      stripped_paths: strippedByTask,
    };
  }

  function runSrBatch(batchPaths, predDir) {
    const networkFlags = netLockdown ? ['--network', 'none'] : [];
    try {
      execFileSync(venvPython, [srEvalRunner,
        '--json', batchPaths.tasks, '--patches', batchPaths.patches, '--max-workers', '2',
        // --reapply-install-seds (D-1 fix, 2026-08-12). eval.py's `git reset --hard HEAD`
        // reverts the image author's uncommitted working-tree shims (SDK pins, TFM trims)
        // that the image was frozen with, so the container asks for an SDK it does not have.
        // env-ledger-sweep.mjs has ALWAYS passed this flag when validating gold, so gold was
        // certified under one grader configuration and rollouts were graded under another.
        // dotnet__yarp-2825 is the only task in the rotate20 set carrying `sed -i` install
        // steps, and all 12 of its rows recorded f2pFrac=0 with no test ever executed.
        '--reapply-install-seds',
        '--report-json', batchPaths.report, ...networkFlags], {
        cwd: predDir,
        env: {
          ...process.env, SR_EVAL_DIR: srEvalDir, DOCKER_HOST: dockerHost,
          PYTHONPATH: path.join(srEvalDir, 'lib'),
        },
        stdio: 'inherit', timeout: 5400000,
      });
    } catch { /* non-zero is normal when any task is unresolved */ }
  }

  function applyBatchScores(items, predictions, score, resolvedIds, errorIds, missingReportIds, noTestEvidenceIds = new Set()) {
    const itemIds = new Set(items.map(item => item.instance_id));
    for (const prediction of predictions) {
      if (!itemIds.has(prediction.instance_id)) {
        errorIds.add(prediction.instance_id);
        missingReportIds.add(prediction.instance_id);
      }
    }
    for (const item of items) {
      if (item.error) {
        errorIds.add(item.instance_id);
        continue;
      }
      // --- D-1 TEST-EVIDENCE TRIPWIRE (2026-08-12) ---
      // eval.py raises no exception when the suite never runs, so a build/SDK outage and a
      // genuine all-tests-failed run both arrive here as from_fail_to_pass == []. Scoring
      // the first as f2pFrac=0 publishes a fabricated behavioral failure: that is exactly
      // how 12 dotnet__yarp-2825 rows were recorded gradeable=true with zero executed tests.
      // A task whose own log parser recovered NO test-result line has produced no evidence
      // of anything, so it must never be scored. Callers stamp gradeable=false and decide,
      // from whether EVERY patch on the task is evidence-free, whether this is a grader
      // defect (task-wide) or the agent's own patch breaking the build (patch-specific).
      // Missing is a broken evaluator contract, not permission to infer that tests
      // ran. Fail closed: both zero and absent/invalid counts are evidence-free.
      if (!Number.isSafeInteger(item.n_test_results) || item.n_test_results <= 0) {
        const evidenceReason = item.n_test_results === 0
          ? 'zero-test-results'
          : 'missing-n_test_results-contract';
        noTestEvidenceIds.add(item.instance_id);
        score[item.instance_id] = { f2pFrac: null, p2pOk: null, status: 'NO-TEST-EVIDENCE',
          nTestResults: Number.isSafeInteger(item.n_test_results) ? item.n_test_results : null,
          evidenceReason };
        console.error(`[grade] ${item.instance_id}: NO TEST EVIDENCE — ${evidenceReason}; `
          + `row marked ungradeable instead of scored f2pFrac=0 (exit=${item.exit_code}, log=${item.log_path || 'n/a'})`);
        continue;
      }
      const spec = taskById.get(item.instance_id) || {};
      const grade = gradeReportItem(item, spec, taskOverrides.tasks?.[item.instance_id] || {});
      score[item.instance_id] = {
        f2pFrac: grade.f2pFrac, p2pOk: grade.p2pOk, status: grade.status,
        nTestResults: item.n_test_results ?? null,
      };
      if (grade.status === 'FULL') resolvedIds.push(item.instance_id);
    }
  }

  function markMissing(predictions, errorIds, missingReportIds) {
    for (const prediction of predictions) {
      errorIds.add(prediction.instance_id);
      missingReportIds.add(prediction.instance_id);
    }
  }

  function gcBatchImages(specs) {
    if (process.env.NO_IMAGE_GC) return;
    for (const spec of specs) {
      if (spec.image_name && !spec._origImage) {
        try {
          execFileSync('docker', ['rmi', '-f', spec.image_name], {
            env: { ...process.env, DOCKER_HOST: dockerHost }, stdio: 'ignore', timeout: 60000,
          });
        } catch { /* */ }
      }
    }
  }

  function gradeSwebenchArm(arm, predictions, runId, predDir) {
    const predPath = path.join(predDir, 'preds.jsonl');
    writeFileSync(predPath, predictions.map(prediction => JSON.stringify(prediction)).join('\n') + '\n');
    try {
      execFileSync(venvPython, ['-m', 'swebench.harness.run_evaluation',
        '--dataset_name', dataset, '--predictions_path', predPath,
        '--max_workers', '2', '--instance_ids', ...predictions.map(prediction => prediction.instance_id),
        '--run_id', `${runId}-${arm}`, '--cache_level', 'instance'], {
        cwd: predDir, env: { ...process.env, DOCKER_HOST: dockerHost },
        stdio: 'inherit', timeout: 1800000,
      });
    } catch (error) { console.error(`[grade ${arm}] harness error: ${error.message}`); }
    const report = path.join(predDir, `${arm}.${runId}-${arm}.json`);
    return existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  }

  return { ensureImage, makeRunTests, gradeArm };
}
