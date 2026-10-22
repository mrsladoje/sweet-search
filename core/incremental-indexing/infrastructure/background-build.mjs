/**
 * A maintenance build in a child process (background-build-child.mjs), so the
 * maintainer keeps ticking while a large base is rebuilt. The maintainer polls
 * the job on its later drains and publishes the result itself (the single
 * writer); the child only writes staged files.
 */
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'background-build-child.mjs');

/**
 * Start a `kind` build ('binary_hnsw' | 'sparse_gram') with `args`. Returns a job
 * whose `done` becomes true when the child ends, with `result` or `error`. The
 * child is killed when this process exits.
 */
export function startBackgroundBuild(kind, args) {
  const job = { kind, done: false, result: null, error: null, child: null };
  const child = fork(CHILD, [JSON.stringify({ kind, args })], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  job.child = child;
  child.on('message', (msg) => {
    if (msg?.ok) job.result = msg.result;
    else job.error = new Error(msg?.error || `${kind} background build failed`);
  });
  child.on('exit', (code) => {
    if (!job.result && !job.error) job.error = new Error(`${kind} background build exited (code ${code})`);
    job.done = true;
  });
  child.on('error', (err) => { job.error = err; job.done = true; });
  const kill = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  process.once('exit', kill);
  child.on('exit', () => process.removeListener('exit', kill));
  return job;
}
