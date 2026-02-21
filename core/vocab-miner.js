/**
 * Vocabulary Miner Module
 *
 * Extracts search vocabulary terms from multiple sources:
 *   1. Structural  – file paths, directories, package manifests
 *   2. Symbols     – identifiers from source code (imports, classes, functions)
 *   3. Code Graph  – entity names and hub detection from code-graph.db
 *   4. NL Content  – community-aware TF-IDF over comments/docstrings
 *   5. Git         – commit messages, branch names, frequently changed files
 *
 * Each miner returns { terms: [{ term, score, source }] } or equivalent.
 * `mineAll()` merges results from all miners into a unified term list.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, extname, relative, sep } from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { DB_PATHS, PROJECT_ROOT } from './config.js';
import { pageRank, loadGraph, buildAdjacency } from './repo-map.js';

// Import from sub-modules
import {
  STOP_WORDS, SOURCE_EXTENSIONS,
  splitIdentifier, addTerm, mergeTerms, termsToArray, walkShallow,
} from './vocab-miner-utils.js';

import {
  extractImports, extractExports, extractDefinitions, extractConstants,
  extractNpmDeps, extractCargoDeps, extractGoDeps, extractPipDeps, extractPyprojectDeps,
} from './vocab-miner-extractors.js';

import {
  mineNLContent, computeNLContentHash, extractNLText, isSecretLike,
  detectScript, tokenizeNL, extractBigrams, extractTrigrams,
  SECRET_PATTERNS, NL_MINING_TIMEOUT_MS,
} from './vocab-miner-nl.js';

// ---------------------------------------------------------------------------
// Barrel Re-exports (preserve all previously-exported symbols)
// ---------------------------------------------------------------------------

export {
  splitIdentifier, STOP_WORDS, SOURCE_EXTENSIONS,
  addTerm, mergeTerms, termsToArray, walkShallow,
} from './vocab-miner-utils.js';

export {
  extractImports, extractExports, extractDefinitions, extractConstants,
  extractNpmDeps, extractCargoDeps, extractGoDeps, extractPipDeps, extractPyprojectDeps,
} from './vocab-miner-extractors.js';

export {
  mineNLContent, computeNLContentHash, extractNLText, isSecretLike,
  detectScript, tokenizeNL, extractBigrams, extractTrigrams,
  SECRET_PATTERNS, NL_MINING_TIMEOUT_MS,
} from './vocab-miner-nl.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Manifest files to mine
const MANIFEST_FILES = [
  { file: 'package.json', extract: extractNpmDeps },
  { file: 'Cargo.toml', extract: extractCargoDeps },
  { file: 'go.mod', extract: extractGoDeps },
  { file: 'requirements.txt', extract: extractPipDeps },
  { file: 'pyproject.toml', extract: extractPyprojectDeps },
];

// ---------------------------------------------------------------------------
// 1. Structural Mining
// ---------------------------------------------------------------------------

/**
 * Mine vocabulary terms from file paths, directories, and package manifests.
 *
 * @param {string} [projectRoot] - Project root directory
 * @returns {{ terms: Array<{term: string, score: number, source: string}> }}
 */
export function mineStructural(projectRoot) {
  const root = projectRoot || PROJECT_ROOT;
  const terms = new Map(); // term -> { score, source }

  // Mine top-level directory names
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        addTerm(terms, entry.name, 0.5, 'directory');
        for (const part of splitIdentifier(entry.name)) {
          if (part.length > 2 && !STOP_WORDS.has(part)) {
            addTerm(terms, part, 0.3, 'directory-part');
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Mine source file paths (walk top 3 levels)
  try {
    const files = walkShallow(root, 3);
    for (const filePath of files) {
      const ext = extname(filePath);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const rel = relative(root, filePath);
      const parts = rel.split(sep).filter(Boolean);

      // File name tokens (without extension)
      const fileName = basename(filePath, ext);
      for (const part of splitIdentifier(fileName)) {
        if (part.length > 2 && !STOP_WORDS.has(part)) {
          addTerm(terms, part, 0.4, 'file-path');
        }
      }
      // Full compound name (e.g. LoginController)
      if (fileName.length > 3 && /[A-Z]/.test(fileName)) {
        addTerm(terms, fileName, 0.6, 'file-name');
      }

      // Directory path tokens (skip root-level)
      for (let i = 0; i < Math.min(parts.length - 1, 2); i++) {
        for (const part of splitIdentifier(parts[i])) {
          if (part.length > 2 && !STOP_WORDS.has(part)) {
            addTerm(terms, part, 0.3, 'path-segment');
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Mine package manifests
  for (const { file, extract } of MANIFEST_FILES) {
    const manifestPath = join(root, file);
    if (!existsSync(manifestPath)) continue;
    try {
      const content = readFileSync(manifestPath, 'utf-8');
      const deps = extract(content);
      for (const dep of deps) {
        addTerm(terms, dep, 0.5, 'dependency');
        // Split scoped/compound dep names
        const depParts = dep.replace(/^@[^/]+\//, '').split(/[-_./]/);
        for (const part of depParts) {
          if (part.length > 2 && !STOP_WORDS.has(part.toLowerCase())) {
            addTerm(terms, part.toLowerCase(), 0.3, 'dependency-part');
          }
        }
      }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
  }

  // Mine .env.example keys
  try {
    const envExPath = join(root, '.env.example');
    if (existsSync(envExPath)) {
      const content = readFileSync(envExPath, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
        if (match) {
          addTerm(terms, match[1], 0.3, 'env-key');
          for (const part of splitIdentifier(match[1])) {
            if (part.length > 2) addTerm(terms, part, 0.2, 'env-key-part');
          }
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  return { terms: termsToArray(terms) };
}

// ---------------------------------------------------------------------------
// 2. Symbol Mining
// ---------------------------------------------------------------------------

/**
 * Mine vocabulary from source code symbols: imports, exports, class/function names.
 *
 * @param {string} [projectRoot] - Project root directory
 * @param {object} [options]
 * @param {number} [options.maxFiles=500] - Max files to scan
 * @param {number} [options.maxFileSize=100000] - Max bytes per file
 * @returns {{ terms: Array<{term: string, score: number, source: string}> }}
 */
export function mineSymbols(projectRoot, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const maxFiles = options.maxFiles ?? 500;
  const maxFileSize = options.maxFileSize ?? 100_000;
  const terms = new Map();

  let files;
  try {
    files = walkShallow(root, 4).filter(f => SOURCE_EXTENSIONS.has(extname(f)));
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return { terms: [] };
  }

  // Limit file count
  if (files.length > maxFiles) files = files.slice(0, maxFiles);

  for (const filePath of files) {
    try {
      const stat = statSync(filePath);
      if (stat.size > maxFileSize) continue;
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      continue;
    }

    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
      continue;
    }

    const ext = extname(filePath);

    // Extract imports
    extractImports(content, ext, terms);

    // Extract exports
    extractExports(content, ext, terms);

    // Extract class/function/method names
    extractDefinitions(content, ext, terms);

    // Extract constants (SCREAMING_SNAKE_CASE)
    extractConstants(content, terms);
  }

  return { terms: termsToArray(terms) };
}

// ---------------------------------------------------------------------------
// 3. Code Graph Mining
// ---------------------------------------------------------------------------

/**
 * Mine vocabulary from the code-graph.db entity/relationship graph.
 * Leverages PageRank scores to weight terms by graph importance.
 *
 * @param {string} [dbPath] - Path to code-graph.db
 * @returns {{ terms: Array<{term: string, score: number, source: string}>, pageRankScores: Map<string, number> }}
 */
export function mineCodeGraph(dbPath) {
  const resolvedPath = dbPath || DB_PATHS.codeGraph;
  const terms = new Map();
  let pageRankScores = new Map();

  let graph;
  try {
    graph = loadGraph(resolvedPath);
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return { terms: [], pageRankScores };
  }

  if (graph.entities.length === 0) {
    return { terms: [], pageRankScores };
  }

  // Run PageRank for importance scoring
  const { outEdges, allNodes } = buildAdjacency(graph);
  pageRankScores = pageRank(outEdges, allNodes);

  // Compute in-degree for hub detection
  const inDegree = new Map();
  for (const rel of graph.relationships) {
    if (rel.target_id) {
      inDegree.set(rel.target_id, (inDegree.get(rel.target_id) || 0) + 1);
    }
  }

  // Mine entity names weighted by PageRank
  const maxPR = Math.max(...pageRankScores.values(), 0.001);

  for (const ent of graph.entities) {
    const pr = pageRankScores.get(ent.id) || 0;
    const normalizedPR = pr / maxPR;
    const inDeg = inDegree.get(ent.id) || 0;

    // Base score from PageRank
    let score = 0.3 + normalizedPR * 0.7; // 0.3 to 1.0 range

    // Hub bonus: high in-degree entities are more important
    if (inDeg > 5) score = Math.min(score * 1.3, 1.0);

    // Public API boost (exported, capitalized Go, etc.)
    const isPublic = ent.type === 'class' || ent.type === 'interface' ||
      ent.type === 'enum' || ent.type === 'module' || ent.type === 'service';
    if (isPublic) score = Math.min(score * 1.2, 1.0);

    // Leaf penalty
    const outDeg = (outEdges.get(ent.id)?.size) || 0;
    if (inDeg === 0 && outDeg <= 1) score *= 0.5;

    // Add entity name
    addTerm(terms, ent.name, score, 'graph-entity');

    // Add split parts
    for (const part of splitIdentifier(ent.name)) {
      if (part.length > 2 && !STOP_WORDS.has(part)) {
        addTerm(terms, part, score * 0.6, 'graph-entity-part');
      }
    }
  }

  return { terms: termsToArray(terms), pageRankScores };
}

// ---------------------------------------------------------------------------
// 5. Git Mining
// ---------------------------------------------------------------------------

/**
 * Mine vocabulary from git history: commit messages, branch names, hot files.
 *
 * @param {string} [projectRoot]
 * @param {object} [options]
 * @param {number} [options.maxCommits=200]
 * @param {number} [options.maxDays=30]
 * @returns {{ terms: Array<{term: string, score: number, source: string}> }}
 */
export function mineGit(projectRoot, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const maxCommits = options.maxCommits ?? 200;
  const maxDays = options.maxDays ?? 30;
  const terms = new Map();

  // Commit messages
  try {
    const since = `--since="${maxDays} days ago"`;
    const log = execSync(
      `git log --format="%s" -n ${maxCommits} ${since}`,
      { cwd: root, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    for (const line of log.split('\n').filter(Boolean)) {
      const tokens = tokenizeNL(line);
      for (const token of tokens) {
        addTerm(terms, token, 0.3, 'git-commit');
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Branch names
  try {
    const branches = execSync(
      'git branch --all --format="%(refname:short)"',
      { cwd: root, encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    for (const branch of branches.split('\n').filter(Boolean)) {
      const name = branch.replace(/^origin\//, '');
      if (name === 'main' || name === 'master' || name === 'HEAD') continue;
      for (const part of splitIdentifier(name)) {
        if (part.length > 2 && !STOP_WORDS.has(part)) {
          addTerm(terms, part, 0.4, 'git-branch');
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  // Frequently changed files (hot files)
  try {
    const hotFiles = execSync(
      `git log --format="" --name-only -n ${maxCommits} --since="${maxDays} days ago"`,
      { cwd: root, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const fileCounts = new Map();
    for (const file of hotFiles.split('\n').filter(Boolean)) {
      fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    }

    // Top 20 hottest files
    const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

    for (const [filePath, count] of sorted) {
      const score = 0.3 + 0.5 * (count / maxCount);
      const name = basename(filePath, extname(filePath));
      for (const part of splitIdentifier(name)) {
        if (part.length > 2 && !STOP_WORDS.has(part)) {
          addTerm(terms, part, score, 'git-hot-file');
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
  }

  return { terms: termsToArray(terms) };
}

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

/**
 * Run all miners and merge results into a unified term list.
 *
 * @param {string} [projectRoot]
 * @param {string} [dbPath]
 * @param {Array} [communities] - From detectCommunities()
 * @param {object} [options]
 * @param {boolean} [options.deep=false] - Include git mining
 * @param {boolean} [options.skipNL=false] - Skip NL mining
 * @returns {{ terms: Array<{term: string, score: number, source: string}>, pageRankScores: Map, communityPhrases: Array }}
 */
export function mineAll(projectRoot, dbPath, communities, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const mergedTerms = new Map();
  let pageRankScores = new Map();
  let communityPhrases = [];

  // 1. Structural mining
  const structural = mineStructural(root);
  mergeTerms(mergedTerms, structural.terms);

  // 2. Symbol mining
  const symbols = mineSymbols(root, options);
  mergeTerms(mergedTerms, symbols.terms);

  // 3. Code graph mining
  const graph = mineCodeGraph(dbPath);
  mergeTerms(mergedTerms, graph.terms);
  pageRankScores = graph.pageRankScores;

  // F9: Load entity names from code-graph.db for secret exemption
  let codeGraphNames = null;
  const resolvedDbPath = dbPath || DB_PATHS.codeGraph;
  if (existsSync(resolvedDbPath)) {
    try {
      const db = new Database(resolvedDbPath, { readonly: true, timeout: 3000 });
      try {
        const rows = db.prepare('SELECT DISTINCT name FROM entities').all();
        codeGraphNames = new Set(rows.map(r => r.name));
      } finally { db.close(); }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
  }

  // 4. Community NL mining
  if (!options.skipNL && communities && communities.length > 0) {
    const nl = mineNLContent(communities, root, { ...options, codeGraphNames });
    communityPhrases = nl.communityPhrases;

    // Flatten community phrases into terms
    for (const cp of communityPhrases) {
      for (const phrase of cp.phrases) {
        addTerm(mergedTerms, phrase.text, phrase.score, phrase.type);
      }
    }
  }

  // 5. Git mining (deep mode only)
  if (options.deep) {
    const git = mineGit(root, options);
    mergeTerms(mergedTerms, git.terms);
  }

  return {
    terms: termsToArray(mergedTerms),
    pageRankScores,
    communityPhrases,
  };
}

// ---------------------------------------------------------------------------
// Default Export
// ---------------------------------------------------------------------------

export default {
  mineStructural,
  mineSymbols,
  mineCodeGraph,
  mineNLContent,
  mineGit,
  mineAll,
  splitIdentifier,
};
