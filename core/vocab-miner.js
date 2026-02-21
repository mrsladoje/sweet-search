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
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { DB_PATHS, PROJECT_ROOT } from './config.js';
import { pageRank, loadGraph, buildAdjacency } from './repo-map.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Secret patterns to redact from NL content
const SECRET_PATTERNS = [
  /[A-Za-z0-9+/]{32,}={0,2}/,   // base64 > 32 chars
  /sk-[A-Za-z0-9]{20,}/,          // OpenAI keys
  /ghp_[A-Za-z0-9]{30,}/,         // GitHub PATs
  /gho_[A-Za-z0-9]{30,}/,         // GitHub OAuth
  /Bearer\s+\S{20,}/i,            // Bearer tokens
  /token=[A-Za-z0-9_\-]{16,}/i,   // token= params
  /password\s*=\s*\S{6,}/i,       // password= assignments
  /api[_-]?key\s*[:=]\s*\S{10,}/i, // apikey assignments
];

const NL_MINING_TIMEOUT_MS = 6000;

// Common stop words to exclude from NL terms
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'that', 'this', 'it', 'its', 'i', 'we', 'they',
  'he', 'she', 'you', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'our', 'their', 'what', 'which', 'who', 'whom',
  // Code stop words
  'var', 'let', 'const', 'function', 'return', 'class', 'new', 'true',
  'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
  'import', 'export', 'default', 'from', 'require', 'module',
]);

// File extensions for source code scanning
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyi', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.rb',
  '.php', '.swift', '.scala', '.ex', '.exs', '.lua',
]);

// Manifest files to mine
const MANIFEST_FILES = [
  { file: 'package.json', extract: extractNpmDeps },
  { file: 'Cargo.toml', extract: extractCargoDeps },
  { file: 'go.mod', extract: extractGoDeps },
  { file: 'requirements.txt', extract: extractPipDeps },
  { file: 'pyproject.toml', extract: extractPyprojectDeps },
];

// ---------------------------------------------------------------------------
// Identifier Splitting
// ---------------------------------------------------------------------------

/**
 * Split an identifier into constituent words.
 * Handles camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case.
 *
 * Examples:
 *   getUserData       → [get, User, Data]
 *   XMLParser         → [XML, Parser]
 *   http_server_utils → [http, server, utils]
 *   MAX_RETRY_COUNT   → [MAX, RETRY, COUNT]
 *
 * @param {string} ident - Identifier to split
 * @returns {string[]} Lowercase token parts
 */
export function splitIdentifier(ident) {
  if (!ident || ident.length < 2) return ident ? [ident.toLowerCase()] : [];

  // Replace separators (_, -, .) with spaces first
  let spaced = ident.replace(/[_\-./]/g, ' ');

  // Insert space before transitions: aB, ABc (acronym → word), 2D (digit → upper)
  spaced = spaced.replace(/([a-z])([A-Z])/g, '$1 $2');
  spaced = spaced.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  spaced = spaced.replace(/([0-9])([A-Z])/g, '$1 $2');

  // Split on whitespace and filter
  const parts = spaced
    .split(/\s+/)
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  return parts;
}

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
  } catch { /* root unreadable */ }

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
  } catch { /* walk failure */ }

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
    } catch { /* manifest parse failure */ }
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
  } catch { /* .env.example unreadable */ }

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
  } catch {
    return { terms: [] };
  }

  // Limit file count
  if (files.length > maxFiles) files = files.slice(0, maxFiles);

  for (const filePath of files) {
    try {
      const stat = statSync(filePath);
      if (stat.size > maxFileSize) continue;
    } catch { continue; }

    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch { continue; }

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
  } catch {
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
// 4. Community-Aware NL Mining
// ---------------------------------------------------------------------------

/**
 * Mine natural language terms from comments and docstrings,
 * weighted by community distinctiveness using c-TF-IDF.
 *
 * @param {Array<{id: number, entityIds: Array, fileIds: string[]}>} communities
 * @param {string} [projectRoot]
 * @param {object} [options]
 * @param {number} [options.timeoutMs=6000] - Max wall-clock time
 * @param {number} [options.maxFileSize=100000] - Max bytes per file
 * @returns {{ communityPhrases: Array<{communityId: number, phrases: Array<{text: string, score: number, type: string}>}> }}
 */
export function mineNLContent(communities, projectRoot, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const timeoutMs = options.timeoutMs ?? NL_MINING_TIMEOUT_MS;
  const maxFileSize = options.maxFileSize ?? 100_000;
  const codeGraphNames = options.codeGraphNames || null;
  const deadline = Date.now() + timeoutMs;

  if (!communities || communities.length === 0) {
    return { communityPhrases: [] };
  }

  // Phase 1: Extract NL text per community
  const communityTexts = []; // [{communityId, text}]

  for (const comm of communities) {
    if (Date.now() > deadline) break;

    const texts = [];
    const filesSeen = new Set();

    for (const filePath of (comm.fileIds || [])) {
      if (Date.now() > deadline) break;
      if (filesSeen.has(filePath)) continue;
      filesSeen.add(filePath);

      const fullPath = filePath.startsWith('/') ? filePath : join(root, filePath);
      try {
        const stat = statSync(fullPath);
        if (stat.size > maxFileSize) continue;
        const content = readFileSync(fullPath, 'utf-8');
        const nlText = extractNLText(content, extname(filePath), codeGraphNames);
        if (nlText) texts.push(nlText);
      } catch { continue; }
    }

    communityTexts.push({
      communityId: comm.id,
      text: texts.join(' '),
    });
  }

  // Phase 2: TF-IDF per community
  const totalDocs = communityTexts.length;
  const dfMap = new Map(); // term -> number of communities containing it

  const communityTermFreqs = communityTexts.map(({ communityId, text }) => {
    const tokens = tokenizeNL(text);
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }
    return { communityId, tf, totalTokens: tokens.length };
  });

  // Document frequency
  for (const { tf } of communityTermFreqs) {
    for (const term of tf.keys()) {
      dfMap.set(term, (dfMap.get(term) || 0) + 1);
    }
  }

  // Phase 3: c-TF-IDF scoring
  const communityPhrases = [];

  for (const { communityId, tf, totalTokens } of communityTermFreqs) {
    if (Date.now() > deadline) {
      communityPhrases.push({ communityId, phrases: [], partial: true });
      continue;
    }

    if (totalTokens === 0) {
      communityPhrases.push({ communityId, phrases: [] });
      continue;
    }

    const scored = [];
    for (const [term, count] of tf) {
      const termFreq = count / totalTokens;
      const df = dfMap.get(term) || 1;
      const idf = Math.log(1 + totalDocs / df);

      // c-TF-IDF: weight by distinctiveness (terms unique to this community score higher)
      const ctfIdf = termFreq * idf;
      scored.push({ text: term, score: ctfIdf, type: 'unigram' });
    }

    // Also extract bigrams and trigrams from the text
    const nlTokens = tokenizeNL(communityTexts.find(c => c.communityId === communityId)?.text || '');
    const bigrams = extractBigrams(nlTokens);
    for (const [bigram, count] of bigrams) {
      const termFreq = count / Math.max(totalTokens - 1, 1);
      const idf = Math.log(1 + totalDocs / (dfMap.get(bigram) || 1));
      scored.push({ text: bigram, score: termFreq * idf * 1.5, type: 'bigram' });
    }
    const trigrams = extractTrigrams(nlTokens);
    for (const [trigram, count] of trigrams) {
      const termFreq = count / Math.max(totalTokens - 2, 1);
      const idf = Math.log(1 + totalDocs / (dfMap.get(trigram) || 1));
      scored.push({ text: trigram, score: termFreq * idf * 1.8, type: 'trigram' });
    }

    // Sort by score descending, take top 50
    scored.sort((a, b) => b.score - a.score);
    communityPhrases.push({
      communityId,
      phrases: scored.slice(0, 50),
    });
  }

  return { communityPhrases };
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
  } catch { /* git not available or not a repo */ }

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
  } catch { /* git not available */ }

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
  } catch { /* git not available */ }

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
    } catch { /* non-fatal */ }
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
// NL Content Hash (F3: dual-hash freshness)
// ---------------------------------------------------------------------------

/**
 * Compute sha256 hash of NL content sources (comments, README, recent commits).
 * Used for incremental gating: only re-run NL phrase extraction when hash changes.
 *
 * @param {Array<{fileIds: string[]}>} communities - Communities with file paths
 * @param {string} [projectRoot]
 * @param {object} [options]
 * @param {number} [options.maxBytes=102400] - Max total text to hash (100KB)
 * @param {number} [options.maxCommits=200]
 * @param {number} [options.maxDays=30]
 * @returns {string} hex digest
 */
export function computeNLContentHash(communities, projectRoot, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const maxBytes = options.maxBytes ?? 102_400;
  const hash = createHash('sha256');
  let totalBytes = 0;

  // Hash NL text from community files (comments, docstrings)
  const seenFiles = new Set();
  for (const comm of (communities || [])) {
    for (const filePath of (comm.fileIds || [])) {
      if (seenFiles.has(filePath) || totalBytes >= maxBytes) continue;
      seenFiles.add(filePath);
      const fullPath = filePath.startsWith('/') ? filePath : join(root, filePath);
      try {
        if (!existsSync(fullPath)) continue;
        const stat = statSync(fullPath);
        if (stat.size > 100_000) continue;
        const content = readFileSync(fullPath, 'utf-8');
        const nlText = extractNLText(content, extname(filePath));
        if (nlText) {
          const chunk = nlText.slice(0, maxBytes - totalBytes);
          hash.update(chunk);
          totalBytes += chunk.length;
        }
      } catch { continue; }
    }
  }

  // Hash README content
  for (const readme of ['README.md', 'README.rst', 'README.txt', 'README']) {
    const readmePath = join(root, readme);
    try {
      if (existsSync(readmePath) && totalBytes < maxBytes) {
        const content = readFileSync(readmePath, 'utf-8');
        const chunk = content.slice(0, maxBytes - totalBytes);
        hash.update(chunk);
        totalBytes += chunk.length;
      }
    } catch { /* ignore */ }
  }

  // Hash recent commit messages (bounded)
  try {
    const maxCommits = options.maxCommits ?? 200;
    const maxDays = options.maxDays ?? 30;
    const since = `--since="${maxDays} days ago"`;
    const log = execSync(
      `git log --format="%s" -n ${maxCommits} ${since}`,
      { cwd: root, encoding: 'utf-8', timeout: 5000 }
    ).trim();
    if (log && totalBytes < maxBytes) {
      const chunk = log.slice(0, maxBytes - totalBytes);
      hash.update(chunk);
    }
  } catch { /* git not available */ }

  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Internal: Import/Export Extraction
// ---------------------------------------------------------------------------

function extractImports(content, ext, terms) {
  // JS/TS: import { X, Y } from 'module'; import X from 'module'
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    const importRe = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRe.exec(content))) {
      const names = match[1] || match[2];
      const modulePath = match[3];
      if (names) {
        for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim())) {
          if (name && name.length > 1) {
            addTerm(terms, name, 0.6, 'import');
            for (const part of splitIdentifier(name)) {
              if (part.length > 2 && !STOP_WORDS.has(part)) {
                addTerm(terms, part, 0.4, 'import-part');
              }
            }
          }
        }
      }
      // Module name
      if (modulePath && !modulePath.startsWith('.')) {
        const modName = modulePath.replace(/^@[^/]+\//, '');
        addTerm(terms, modName, 0.4, 'import-module');
      }
    }
    return;
  }

  // Python: from X import Y; import X
  if (['.py', '.pyi'].includes(ext)) {
    const pyImportRe = /(?:from\s+([\w.]+)\s+import\s+([^#\n]+)|import\s+([\w.]+))/g;
    let match;
    while ((match = pyImportRe.exec(content))) {
      const module = match[1] || match[3];
      const names = match[2];
      if (module) {
        const parts = module.split('.');
        for (const part of parts) {
          if (part.length > 2) addTerm(terms, part, 0.5, 'import');
        }
      }
      if (names) {
        for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim())) {
          if (name && name.length > 1 && name !== '*') {
            addTerm(terms, name, 0.6, 'import');
          }
        }
      }
    }
    return;
  }

  // Go: import "pkg" or import ( "pkg" )
  if (ext === '.go') {
    const goImportRe = /import\s+(?:\(\s*([\s\S]*?)\)|"([^"]+)")/g;
    let match;
    while ((match = goImportRe.exec(content))) {
      const block = match[1] || `"${match[2]}"`;
      const pkgRe = /"([^"]+)"/g;
      let pkgMatch;
      while ((pkgMatch = pkgRe.exec(block))) {
        const pkg = pkgMatch[1];
        const lastPart = pkg.split('/').pop();
        if (lastPart && lastPart.length > 1) {
          addTerm(terms, lastPart, 0.5, 'import');
        }
      }
    }
    return;
  }

  // Java/Kotlin: import com.example.Foo;
  if (['.java', '.kt', '.kts'].includes(ext)) {
    const javaImportRe = /import\s+(?:static\s+)?([\w.]+)/g;
    let match;
    while ((match = javaImportRe.exec(content))) {
      const parts = match[1].split('.');
      const className = parts[parts.length - 1];
      if (className && className !== '*' && className.length > 1) {
        addTerm(terms, className, 0.6, 'import');
      }
    }
    return;
  }

  // Rust: use std::collections::HashMap;
  if (ext === '.rs') {
    const rustUseRe = /use\s+([\w:]+(?:::\{[^}]+\})?)/g;
    let match;
    while ((match = rustUseRe.exec(content))) {
      const path = match[1];
      const braceMatch = path.match(/::\{([^}]+)\}/);
      if (braceMatch) {
        for (const name of braceMatch[1].split(',').map(n => n.trim())) {
          if (name.length > 1) addTerm(terms, name, 0.6, 'import');
        }
      } else {
        const parts = path.split('::');
        const last = parts[parts.length - 1];
        if (last && last.length > 1) addTerm(terms, last, 0.5, 'import');
      }
    }
  }
}

function extractExports(content, ext, terms) {
  // JS/TS: export { X, Y }; export class X; export function X; export default X
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    const exportRe = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = exportRe.exec(content))) {
      addTerm(terms, match[1], 0.8, 'export');
      for (const part of splitIdentifier(match[1])) {
        if (part.length > 2 && !STOP_WORDS.has(part)) {
          addTerm(terms, part, 0.5, 'export-part');
        }
      }
    }
  }
}

function extractDefinitions(content, ext, terms) {
  // Universal: class/function/method patterns
  const defPatterns = [
    // JS/TS: class X, function X, const X =
    /(?:class|interface|enum|type)\s+([A-Z]\w+)/g,
    /(?:function)\s+([a-zA-Z_$]\w+)/g,
    /(?:async\s+function)\s+([a-zA-Z_$]\w+)/g,
    // Method definitions: x(params) {
    /^\s+(?:async\s+)?([a-zA-Z_$]\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm,
  ];

  for (const pattern of defPatterns) {
    let match;
    while ((match = pattern.exec(content))) {
      const name = match[1];
      if (name && name.length > 1 && !STOP_WORDS.has(name.toLowerCase())) {
        addTerm(terms, name, 0.5, 'definition');
        for (const part of splitIdentifier(name)) {
          if (part.length > 2 && !STOP_WORDS.has(part)) {
            addTerm(terms, part, 0.3, 'definition-part');
          }
        }
      }
    }
    pattern.lastIndex = 0; // Reset global regex
  }
}

function extractConstants(content, terms) {
  // SCREAMING_SNAKE_CASE constants
  const constRe = /\b([A-Z][A-Z0-9_]{2,})\b/g;
  let match;
  while ((match = constRe.exec(content))) {
    const name = match[1];
    // Skip common non-terms
    if (['TODO', 'FIXME', 'NOTE', 'HACK', 'XXX', 'BUG'].includes(name)) continue;
    addTerm(terms, name, 0.4, 'constant');
    for (const part of splitIdentifier(name)) {
      if (part.length > 2 && !STOP_WORDS.has(part)) {
        addTerm(terms, part, 0.2, 'constant-part');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: Manifest Extractors
// ---------------------------------------------------------------------------

function extractNpmDeps(content) {
  try {
    const pkg = JSON.parse(content);
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
    return deps.filter(d => d.length > 1);
  } catch { return []; }
}

function extractCargoDeps(content) {
  const deps = [];
  const depRe = /^\[dependencies(?:\.[^\]]+)?\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/gm;
  let match;
  while ((match = depRe.exec(content))) {
    const block = match[1];
    for (const line of block.split('\n')) {
      const nameMatch = line.match(/^(\w[\w-]*)\s*=/);
      if (nameMatch) deps.push(nameMatch[1]);
    }
  }
  return deps;
}

function extractGoDeps(content) {
  const deps = [];
  const modRe = /require\s*\(\s*([\s\S]*?)\)/g;
  let match;
  while ((match = modRe.exec(content))) {
    for (const line of match[1].split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] && parts[0].includes('/')) {
        deps.push(parts[0].split('/').pop());
      }
    }
  }
  return deps.filter(Boolean);
}

function extractPipDeps(content) {
  return content.split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => line && !line.startsWith('-'))
    .map(line => line.split(/[>=<~!]/)[0].trim())
    .filter(d => d.length > 1);
}

function extractPyprojectDeps(content) {
  const deps = [];
  const match = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (match) {
    for (const line of match[1].split('\n')) {
      const depMatch = line.match(/["']([^"'>=<~!]+)/);
      if (depMatch) deps.push(depMatch[1].trim());
    }
  }
  return deps.filter(d => d.length > 1);
}

// ---------------------------------------------------------------------------
// Internal: NL Text Extraction
// ---------------------------------------------------------------------------

/**
 * Extract natural language text from source code (comments, docstrings).
 * @param {string} content
 * @param {string} ext
 * @param {Set<string>} [codeGraphNames] - Known entity names for secret exemption
 */
function extractNLText(content, ext, codeGraphNames) {
  const texts = [];

  // Line comments: // or #
  const lineCommentRe = /(?:^|\s)(?:\/\/|#)\s*(.+)$/gm;
  let match;
  while ((match = lineCommentRe.exec(content))) {
    const text = match[1].trim();
    if (text.length > 5 && !isSecretLike(text, codeGraphNames)) {
      texts.push(text);
    }
  }

  // Block comments: /* ... */ or """ ... """
  const blockRe = /\/\*\*?\s*([\s\S]*?)\*\/|"""([\s\S]*?)"""|'''([\s\S]*?)'''/g;
  while ((match = blockRe.exec(content))) {
    const text = (match[1] || match[2] || match[3] || '')
      .replace(/^\s*\*\s?/gm, '') // strip leading * in JSDoc
      .trim();
    if (text.length > 5 && !isSecretLike(text, codeGraphNames)) {
      texts.push(text);
    }
  }

  return texts.join(' ');
}

/**
 * Check if text looks like it contains a secret/credential.
 * F9: If the term also appears as an identifier name in the code graph,
 * it's a variable name, not a secret value — exempt it.
 *
 * @param {string} text
 * @param {Set<string>} [codeGraphNames] - Known entity names from code-graph.db
 * @returns {boolean}
 */
function isSecretLike(text, codeGraphNames) {
  if (!SECRET_PATTERNS.some(pattern => pattern.test(text))) return false;
  // F9: If any word in the text appears as a code graph identifier, exempt it.
  // Comments like "// Validates password_hash" contain entity names embedded
  // in natural language — check each word, not the full string.
  if (codeGraphNames && codeGraphNames.size > 0) {
    const words = text.trim().split(/[\s.,;:()[\]{}<>!?'"=+\-*/&|^~#@]+/);
    if (words.some(w => w.length > 1 && codeGraphNames.has(w))) return false;
  }
  return true;
}

/**
 * Detect dominant Unicode script of text.
 * Returns 'latin', 'cjk', or 'other' based on first 5000 chars.
 */
function detectScript(text) {
  const sample = text.slice(0, 5000);
  let latin = 0, cjk = 0, other = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code <= 0x7F || (code >= 0xC0 && code <= 0x024F)) latin++;
    else if ((code >= 0x4E00 && code <= 0x9FFF) ||
             (code >= 0x3400 && code <= 0x4DBF) ||
             (code >= 0x3040 && code <= 0x30FF) ||
             (code >= 0xAC00 && code <= 0xD7AF)) cjk++;
    else other++;
  }
  const total = latin + cjk + other || 1;
  if (cjk / total > 0.8) return 'cjk';
  if (latin / total > 0.5) return 'latin';
  return 'other';
}

/**
 * Tokenize NL text into lowercase words, filtering stop words and short tokens.
 * F8: CJK/non-Latin support via Intl.Segmenter when >80% is CJK script.
 */
function tokenizeNL(text) {
  if (!text) return [];

  const script = detectScript(text);

  // F8: Use Intl.Segmenter for CJK-dominant text
  if (script === 'cjk' && typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      const segments = segmenter.segment(text.toLowerCase());
      return [...segments]
        .filter(s => s.isWordLike && s.segment.length > 1)
        .map(s => s.segment);
    } catch {
      // Fall through to default tokenizer
    }
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Extract bigrams from a token list.
 * @returns {Map<string, number>} bigram -> count
 */
function extractBigrams(tokens) {
  const bigrams = new Map();
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }
  return bigrams;
}

/**
 * Extract trigrams from a token list.
 * @returns {Map<string, number>} trigram -> count
 */
function extractTrigrams(tokens) {
  const trigrams = new Map();
  for (let i = 0; i < tokens.length - 2; i++) {
    const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    trigrams.set(trigram, (trigrams.get(trigram) || 0) + 1);
  }
  return trigrams;
}

// ---------------------------------------------------------------------------
// Internal: Utility Functions
// ---------------------------------------------------------------------------

/**
 * Add or update a term in the terms map. Keeps the highest score.
 */
function addTerm(terms, term, score, source) {
  if (!term || term.length < 2) return;
  const key = term.toLowerCase();
  const existing = terms.get(key);
  if (!existing || existing.score < score) {
    terms.set(key, { term: existing?.term || term, score, source });
  }
}

/**
 * Merge an array of term objects into a Map.
 */
function mergeTerms(target, termArray) {
  for (const t of termArray) {
    addTerm(target, t.term, t.score, t.source);
  }
}

/**
 * Convert terms Map to sorted array.
 */
function termsToArray(terms) {
  return [...terms.values()]
    .sort((a, b) => b.score - a.score);
}

/**
 * Walk directory tree up to maxDepth levels deep. Returns file paths.
 * Skips hidden dirs, node_modules, .git, and other noise.
 */
function walkShallow(dir, maxDepth, depth = 0) {
  if (depth >= maxDepth) return [];

  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.sweet-search', '.agentic-qe',
    'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
    '__pycache__', '.venv', 'venv', 'target', '.swarm',
  ]);

  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { return results; }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkShallow(join(dir, entry.name), maxDepth, depth + 1));
    } else if (entry.isFile()) {
      results.push(join(dir, entry.name));
    }
  }

  return results;
}

export default {
  mineStructural,
  mineSymbols,
  mineCodeGraph,
  mineNLContent,
  mineGit,
  mineAll,
  splitIdentifier,
};
