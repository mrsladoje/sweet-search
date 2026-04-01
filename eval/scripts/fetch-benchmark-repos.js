#!/usr/bin/env node
/**
 * Fetch and pin benchmark repos for multi-repo ColGrep evaluation.
 * Clones repos at pinned SHAs into eval/repos/, indexes them, and verifies.
 * Repos are gitignored — only this script + query files are tracked.
 */

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REPOS_DIR = path.join(ROOT, 'eval', 'repos');

const REPOS = [
  { name: 'ripgrep', url: 'https://github.com/BurntSushi/ripgrep.git', sha: '4519153e5e461527f4bca45b042fff45c4ec6fb9', language: 'rust' },
  { name: 'gin', url: 'https://github.com/gin-gonic/gin.git', sha: 'd3ffc9985281dcf4d3bef604cce4e662b1a327a6', language: 'go' },
  { name: 'flask', url: 'https://github.com/pallets/flask.git', sha: '7ef2946fb5151b745df30201b8c27790cac53875', language: 'python' },
  { name: 'fastify', url: 'https://github.com/fastify/fastify.git', sha: '39f0f24233cf6da2fef48551f51be2f589f7d5d0', language: 'javascript' },
];

const skipIndex = process.argv.includes('--skip-index');
const force = process.argv.includes('--force');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Fetch benchmark repos for multi-repo ColGrep evaluation.

Usage: node eval/scripts/fetch-benchmark-repos.js [options]

Options:
  --skip-index   Clone repos but skip indexing
  --force        Re-clone even if repo directory exists
  --help, -h     Show this help
`);
  process.exit(0);
}

console.log('═'.repeat(50));
console.log('  Benchmark Repo Fetcher');
console.log('═'.repeat(50));

for (const repo of REPOS) {
  const repoDir = path.join(REPOS_DIR, repo.name);

  if (existsSync(repoDir) && !force) {
    console.log(`\n${repo.name}: already exists (use --force to re-clone)`);
    continue;
  }

  if (force && existsSync(repoDir)) {
    console.log(`\n${repo.name}: removing existing...`);
    rmSync(repoDir, { recursive: true, force: true });
  }

  console.log(`\n${repo.name}: cloning ${repo.url} @ ${repo.sha.slice(0, 8)}...`);
  execSync(`git clone --depth 100 ${repo.url} ${repoDir}`, { stdio: 'pipe' });
  execSync(`git -C ${repoDir} checkout ${repo.sha}`, { stdio: 'pipe' });

  // Remove .git to prevent hook scanning issues
  rmSync(path.join(repoDir, '.git'), { recursive: true, force: true });
  console.log(`  Cloned and pinned at ${repo.sha.slice(0, 8)}`);

  if (!skipIndex) {
    console.log(`  Indexing...`);
    const indexer = path.join(ROOT, 'core', 'indexing', 'index-codebase-v21.js');
    execSync(
      `SWEET_SEARCH_PROJECT_ROOT="${repoDir}" node "${indexer}" --full --sqlite-fast`,
      { stdio: 'inherit', timeout: 600000 }
    );
    console.log(`  Indexed`);
  }
}

console.log('\n' + '═'.repeat(50));
console.log('  Done. Repos are in eval/repos/ (gitignored).');
console.log('  Query files are in eval/data/pattern-benchmark-*/');
console.log('═'.repeat(50));
