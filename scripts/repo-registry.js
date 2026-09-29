/**
 * Machine-wide record of the repos where `sweet-search init` ran.
 *
 * `sweet-search uninstall --all` needs it: the model cache is shared by every
 * repo, and each repo carries its own agent wiring (hooks, output style, rules)
 * that would keep calling a removed CLI. The record is a plain JSON list of
 * absolute paths; stale entries (deleted repos) are skipped by the reader.
 *
 * Location: ~/.cache/sweet-search/repos.json, overridable with
 * SWEET_SEARCH_REPO_REGISTRY (the test suite points it at a temp file).
 * Every function is best-effort and never throws: a missing record only means
 * `--all` falls back to cleaning the current repo.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function repoRegistryPath(env = process.env) {
  return env.SWEET_SEARCH_REPO_REGISTRY || join(homedir(), '.cache', 'sweet-search', 'repos.json');
}

export function readRepoRegistry(env = process.env) {
  try {
    const doc = JSON.parse(readFileSync(repoRegistryPath(env), 'utf-8'));
    return Array.isArray(doc?.repos) ? doc.repos.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function writeRepoRegistry(repos, env) {
  const file = repoRegistryPath(env);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ repos }, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function registerRepo(projectRoot, env = process.env) {
  const root = resolve(projectRoot);
  const repos = readRepoRegistry(env);
  if (repos.includes(root)) return true;
  return writeRepoRegistry([...repos, root], env);
}

export function unregisterRepos(projectRoots, env = process.env) {
  const drop = new Set(projectRoots.map((p) => resolve(p)));
  const repos = readRepoRegistry(env);
  const kept = repos.filter((p) => !drop.has(p));
  if (kept.length === repos.length) return true;
  return writeRepoRegistry(kept, env);
}

/** Registered repos that still exist on disk. */
export function existingRegisteredRepos(env = process.env) {
  return readRepoRegistry(env).filter((p) => existsSync(p));
}
