import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STRUCTURAL_CONTEXT_TASKS } from '../../eval/structural-context/tasks.js';
import { buildStructuralArtifact } from '../../eval/structural-context/run-bench.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadSplit(name) {
  return JSON.parse(readFileSync(path.join(repoRoot, 'eval/splits/structural-context', `${name}.json`), 'utf8')).ids;
}

describe('structural-context benchmark split', () => {
  it('has disjoint dev and heldout IDs covering all structural tasks', () => {
    const dev = loadSplit('dev');
    const heldout = loadSplit('heldout');
    const taskIds = STRUCTURAL_CONTEXT_TASKS.filter(t => t.benchmarkSplit !== 'fresh').map(t => t.id).sort();

    expect(new Set(dev).size).toBe(dev.length);
    expect(new Set(heldout).size).toBe(heldout.length);
    expect(dev.filter(id => heldout.includes(id))).toEqual([]);
    expect([...dev, ...heldout].sort()).toEqual(taskIds);
  });

  it('stratifies 60/40 by repo', () => {
    const dev = new Set(loadSplit('dev'));
    const heldout = new Set(loadSplit('heldout'));
    const byRepo = new Map();
    for (const task of STRUCTURAL_CONTEXT_TASKS.filter(t => t.benchmarkSplit !== 'fresh')) {
      if (!byRepo.has(task.repo)) byRepo.set(task.repo, { dev: 0, heldout: 0 });
      const counts = byRepo.get(task.repo);
      if (dev.has(task.id)) counts.dev++;
      if (heldout.has(task.id)) counts.heldout++;
    }

    for (const counts of byRepo.values()) {
      expect(counts).toEqual({ dev: 3, heldout: 2 });
    }
  });

  it('keeps the fresh public-repo slice outside canonical dev and heldout', () => {
    const dev = loadSplit('dev');
    const heldout = loadSplit('heldout');
    const fresh = loadSplit('fresh');
    const freshTasks = STRUCTURAL_CONTEXT_TASKS.filter(t => t.benchmarkSplit === 'fresh');

    expect(fresh).toHaveLength(20);
    expect(new Set(fresh).size).toBe(fresh.length);
    expect(fresh.filter(id => dev.includes(id) || heldout.includes(id))).toEqual([]);
    expect(freshTasks.map(t => t.id).sort()).toEqual([...fresh].sort());
    expect(new Set(freshTasks.map(t => t.repo))).toEqual(new Set(['express']));
  });

  it('redacts per-task details for heldout artifacts', () => {
    const artifact = buildStructuralArtifact({
      opts: { split: 'heldout', model: 'haiku', conditions: ['sweet-search-structural'] },
      tasks: STRUCTURAL_CONTEXT_TASKS.slice(0, 2),
      summaries: { 'sweet-search-structural': { n: 2, avgFileRecall: 1 } },
      runs: [{ taskId: 'secret', answer: { answer: 'details' }, score: { fileRecall: 1 } }],
    });

    expect(artifact.taskCount).toBe(2);
    expect(artifact.tasks).toBeUndefined();
    expect(artifact.runs).toBeUndefined();
    expect(artifact.heldoutPolicy).toContain('aggregate-only');
  });

  it('keeps per-task diagnostics for dev artifacts', () => {
    const runs = [{ taskId: 'fastify:route-handler-impact', score: { fileRecall: 1 } }];
    const artifact = buildStructuralArtifact({
      opts: { split: 'dev', model: 'haiku', conditions: ['sweet-search-structural'] },
      tasks: STRUCTURAL_CONTEXT_TASKS.slice(0, 1),
      summaries: { 'sweet-search-structural': { n: 1, avgFileRecall: 1 } },
      runs,
    });

    expect(artifact.tasks).toEqual([STRUCTURAL_CONTEXT_TASKS[0].id]);
    expect(artifact.runs).toBe(runs);
    expect(artifact.heldoutPolicy).toBeUndefined();
  });

  it('keeps per-task diagnostics for fresh artifacts', () => {
    const runs = [{ taskId: 'express:response-send-callees', score: { fileRecall: 1 } }];
    const artifact = buildStructuralArtifact({
      opts: { split: 'fresh', model: 'haiku', conditions: ['sweet-search-structural'] },
      tasks: STRUCTURAL_CONTEXT_TASKS.filter(t => t.benchmarkSplit === 'fresh').slice(0, 1),
      summaries: { 'sweet-search-structural': { n: 1, avgFileRecall: 1 } },
      runs,
    });

    expect(artifact.tasks).toEqual(['express:create-application-impact']);
    expect(artifact.runs).toBe(runs);
    expect(artifact.heldoutPolicy).toBeUndefined();
  });

  it('ships structural-only blockers for forbidden native readers', () => {
    for (const name of ['grep', 'head', 'rg', 'sed']) {
      const file = path.join(repoRoot, 'eval/structural-context/bin', name);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).mode & 0o111).not.toBe(0);
    }
  });
});
