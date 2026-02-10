/**
 * Sweet Search Result Matcher
 *
 * Matches search results against ground truth expectations.
 * Supports four match types:
 * - exact: Must match file + optional name/type/lineRange
 * - anyOf: At least N from a set must appear
 * - contains: Pattern matching with mode (any/all)
 * - excluded: Must NOT appear (negative testing)
 *
 * Relevance grades: 3 = highly relevant, 2 = relevant, 1 = marginal, 0 = not relevant
 */

import { minimatch } from 'minimatch';
import path from 'path';

// P0: Maximum regex pattern length to prevent ReDoS attacks
const MAX_REGEX_LENGTH = 100;

// P0: Dangerous regex patterns that can cause catastrophic backtracking (ReDoS)
const DANGEROUS_REGEX_PATTERNS = [
  /\([^)]*[+*][^)]*\)[+*]/,  // Nested quantifiers like (a+)+
  /\(\?[^)]*[+*]/,           // Non-capturing groups with quantifiers
  /\[[^\]]*\][+*]{2,}/,      // Character classes with multiple quantifiers
];

/**
 * Check if a regex pattern is potentially unsafe (ReDoS vulnerability)
 * @param {string} pattern - Regex pattern to check
 * @returns {object} { unsafe: boolean, reason?: string }
 */
function isUnsafeRegex(pattern) {
  // Check length
  if (pattern.length > MAX_REGEX_LENGTH) {
    return { unsafe: true, reason: 'pattern too long' };
  }

  // Check for dangerous patterns that can cause exponential backtracking
  for (const dangerous of DANGEROUS_REGEX_PATTERNS) {
    if (dangerous.test(pattern)) {
      return { unsafe: true, reason: 'potential catastrophic backtracking' };
    }
  }

  return { unsafe: false };
}

/**
 * ResultMatcher - Matches search results against ground truth
 */
export class ResultMatcher {
  constructor(options = {}) {
    this.options = {
      normalizePathSeparators: true,
      caseSensitive: false,
      ...options,
    };
  }

  /**
   * Normalize a file path for comparison
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized path
   */
  normalizePath(filePath) {
    if (!filePath) return '';

    let normalized = filePath;

    // Normalize path separators
    if (this.options.normalizePathSeparators) {
      normalized = normalized.replace(/\\/g, '/');
    }

    // Extract just the filename if it's a full path
    const basename = path.basename(normalized);

    return this.options.caseSensitive ? basename : basename.toLowerCase();
  }

  /**
   * Normalize a full file path (preserves full path, just normalizes separators)
   * @param {string} filePath - Path to normalize
   * @returns {string} Normalized full path
   */
  normalizeFullPath(filePath) {
    if (!filePath) return '';

    let normalized = filePath;

    // Normalize path separators
    if (this.options.normalizePathSeparators) {
      normalized = normalized.replace(/\\/g, '/');
    }

    return this.options.caseSensitive ? normalized : normalized.toLowerCase();
  }

  /**
   * P2 DRY: Normalize a search result object for comparison
   * Extracts and normalizes file, name, type, and line from result
   * Handles multiple possible field names for each property
   * @param {object} result - Search result with various possible field names
   * @returns {object} { file, fullPath, name, type, line }
   */
  normalizeResult(result) {
    if (!result) {
      return { file: '', fullPath: '', name: '', type: '', line: 0 };
    }

    // Handle multiple possible field names for file
    const rawFile = result.file || result.filePath || result.file_path || result.path ||
                    result.fileName || result.documentPath || '';

    // Handle multiple possible field names for name
    const rawName = result.name || result.symbolName || result.identifier ||
                    result.entityName || '';

    // Handle multiple possible field names for type
    const rawType = result.type || result.symbolType || result.entityType ||
                    result.kind || '';

    // Handle multiple possible field names for line
    const rawLine = result.line || result.lineNumber || result.startLine || result.start_line ||
                    result.lineStart || 0;

    // Also check metadata object if present
    const meta = result.metadata || {};

    return {
      file: this.normalizePath(rawFile || meta.file || ''),
      fullPath: this.normalizeFullPath(rawFile || meta.file || ''),
      name: this.options.caseSensitive
        ? (rawName || meta.name || '')
        : (rawName || meta.name || '').toLowerCase(),
      type: (rawType || meta.type || '').toLowerCase(),
      line: rawLine || meta.startLine || meta.line || 0,
    };
  }

  /**
   * Match a single result against expected criteria
   *
   * @param {object} result - Search result { file, name, type, line, score }
   * @param {object} expected - Expected object { exact, anyOf, contains, excluded }
   * @returns {object} { matched: boolean, relevanceGrade: 3|2|1|0, matchType: string, details: string }
   */
  matchResult(result, expected) {
    if (!result || !expected) {
      return { matched: false, relevanceGrade: 0, matchType: null, details: 'Missing result or expected' };
    }

    // Check excluded first (negative test)
    if (expected.excluded && expected.excluded.length > 0) {
      const exclusionMatch = this.matchExcluded(result, expected.excluded);
      if (exclusionMatch.matched) {
        return {
          matched: false,
          relevanceGrade: 0,
          matchType: 'excluded',
          details: `Excluded: ${exclusionMatch.pattern}`,
        };
      }
    }

    // Check exact matches (highest priority, grade 3)
    if (expected.exact && expected.exact.length > 0) {
      const exactMatch = this.matchExact(result, expected.exact);
      if (exactMatch.matched) {
        return {
          matched: true,
          relevanceGrade: exactMatch.relevanceGrade || 3,
          matchType: 'exact',
          details: exactMatch.details,
        };
      }
    }

    // Check anyOf matches (grade 2)
    if (expected.anyOf && expected.anyOf.length > 0) {
      const anyOfMatch = this.matchAnyOf(result, expected.anyOf);
      if (anyOfMatch.matched) {
        return {
          matched: true,
          relevanceGrade: 2,
          matchType: 'anyOf',
          details: anyOfMatch.details,
        };
      }
    }

    // Check contains matches (grade 1-2 depending on mode)
    if (expected.contains && expected.contains.length > 0) {
      const containsMatch = this.matchContains(result, expected.contains);
      if (containsMatch.matched) {
        return {
          matched: true,
          relevanceGrade: containsMatch.relevanceGrade || 1,
          matchType: 'contains',
          details: containsMatch.details,
        };
      }
    }

    return { matched: false, relevanceGrade: 0, matchType: null, details: 'No match' };
  }

  /**
   * Match against exact criteria
   *
   * @param {object} result - Search result
   * @param {Array} exactList - Array of { file, name?, type?, lineRange?, relevanceGrade? }
   * @returns {object} { matched: boolean, relevanceGrade: number, details: string }
   */
  matchExact(result, exactList) {
    // P2 DRY: Use normalizeResult for consistent extraction
    const normalized = this.normalizeResult(result);
    const resultFile = normalized.file;
    const resultFullPath = normalized.fullPath;
    const resultName = normalized.name;
    const resultType = normalized.type;
    const resultLine = normalized.line;

    for (const exact of exactList) {
      // P1 FIX: Use exact basename matching instead of bidirectional includes
      // Old bug: "Auth.java" matched "AuthService.java" because "Auth" includes in "AuthService"
      const exactBasename = this.normalizePath(exact.file);
      const exactFullPath = this.normalizeFullPath(exact.file);

      // Match if basenames are identical OR result path ends with expected path
      if (resultFile !== exactBasename && !resultFullPath.endsWith(exactFullPath)) {
        continue;
      }

      // Name match (optional)
      if (exact.name) {
        const exactName = this.options.caseSensitive
          ? exact.name
          : exact.name.toLowerCase();
        if (resultName !== exactName) {
          continue;
        }
      }

      // Type match (optional)
      if (exact.type) {
        const exactType = exact.type.toLowerCase();
        if (resultType !== exactType) {
          continue;
        }
      }

      // Line range match (optional)
      if (exact.lineRange) {
        const [minLine, maxLine] = exact.lineRange;
        if (resultLine < minLine || resultLine > maxLine) {
          continue;
        }
      }

      return {
        matched: true,
        relevanceGrade: exact.relevanceGrade || 3,
        details: `Exact match: ${exact.file}${exact.name ? ':' + exact.name : ''}`,
      };
    }

    return { matched: false, relevanceGrade: 0, details: 'No exact match' };
  }

  /**
   * Match against anyOf criteria (at least N from set)
   *
   * @param {object} result - Search result
   * @param {Array} anyOfList - Array of { files: [], minMatches: 1 }
   * @returns {object} { matched: boolean, details: string }
   */
  matchAnyOf(result, anyOfList) {
    // P2 DRY: Use normalizeResult for consistent extraction
    const normalized = this.normalizeResult(result);
    const resultFile = normalized.file;
    const resultFullPath = normalized.fullPath;

    for (const anyOf of anyOfList) {
      const files = anyOf.files || [];

      for (const file of files) {
        const expectedBasename = this.normalizePath(file);
        const expectedFullPath = this.normalizeFullPath(file);

        // P1 FIX: Use exact basename matching instead of bidirectional includes
        if (resultFile === expectedBasename || resultFullPath.endsWith(expectedFullPath)) {
          return {
            matched: true,
            details: `AnyOf match: ${file}`,
          };
        }
      }
    }

    return { matched: false, details: 'No anyOf match' };
  }

  /**
   * Match against contains criteria (pattern matching)
   *
   * @param {object} result - Search result
   * @param {Array} containsList - Array of { mode?: 'any'|'all', filePattern?, namePattern?, typeIn?: [] }
   * @returns {object} { matched: boolean, relevanceGrade: number, details: string }
   */
  matchContains(result, containsList) {
    // P2 DRY: Use normalizeResult for consistent extraction (but keep raw file for glob matching)
    // P1 FIX: Also check metadata.file for SweetSearch results which store file path there
    const rawFile = result.file || result.filePath || result.metadata?.file || '';
    const normalized = this.normalizeResult(result);
    const resultName = result.name || result.metadata?.name || ''; // Use original case for regex matching
    const resultType = normalized.type;

    for (const contains of containsList) {
      const mode = contains.mode || 'any';
      const patterns = [];
      const matches = [];

      // File pattern (glob)
      if (contains.filePattern) {
        patterns.push({ type: 'filePattern', pattern: contains.filePattern });
        const fileMatches = minimatch(rawFile, contains.filePattern, { nocase: !this.options.caseSensitive });
        if (fileMatches) {
          matches.push('filePattern');
        }
      }

      // Name pattern (regex)
      if (contains.namePattern) {
        // P0 FIX: ReDoS protection - check for unsafe patterns
        // When a pattern is detected as unsafe (potential catastrophic backtracking),
        // we add it to the patterns array with skipped: true for transparency in
        // debugging/logging, but it won't contribute to match evaluation.
        // This preserves visibility of what was attempted while preventing DoS.
        const safetyCheck = isUnsafeRegex(contains.namePattern);
        if (safetyCheck.unsafe) {
          console.warn(`[ResultMatcher] Skipping unsafe regex pattern (${safetyCheck.reason}): ${contains.namePattern.slice(0, 50)}...`);
          // Add to patterns with skipped flag for transparency, but don't test it
          patterns.push({ type: 'namePattern', pattern: contains.namePattern, skipped: true });
        } else {
          // Safe to use
          patterns.push({ type: 'namePattern', pattern: contains.namePattern });
          try {
            const flags = this.options.caseSensitive ? '' : 'i';
            const regex = new RegExp(contains.namePattern, flags);
            // Match against name OR file path (for structural queries where name is method but file has class)
            const resultFile = result.file || result.file_path || result.filePath || '';
            if (regex.test(resultName) || regex.test(resultFile)) {
              matches.push('namePattern');
            }
          } catch (err) {
            // P2 FIX: Log invalid regex patterns instead of silent failure
            console.warn(`[ResultMatcher] Invalid regex pattern '${contains.namePattern}': ${err.message}`);
          }
        }
      }

      // Type filter
      if (contains.typeIn && contains.typeIn.length > 0) {
        patterns.push({ type: 'typeIn', pattern: contains.typeIn.join('|') });
        const normalizedTypes = contains.typeIn.map(t => t.toLowerCase());
        if (normalizedTypes.includes(resultType)) {
          matches.push('typeIn');
        }
      }

      // Evaluate based on mode
      // Filter out skipped patterns from count - they can't contribute to matches
      const activePatterns = patterns.filter(p => !p.skipped);
      if (activePatterns.length === 0) {
        continue; // No active patterns specified (all were skipped or none defined)
      }

      if (mode === 'all') {
        // All active (non-skipped) patterns must match
        if (matches.length === activePatterns.length) {
          return {
            matched: true,
            relevanceGrade: 2, // 'all' mode gets higher grade
            details: `Contains (all): ${matches.join(', ')}`,
          };
        }
      } else {
        // 'any' mode - at least one pattern matches
        if (matches.length > 0) {
          return {
            matched: true,
            relevanceGrade: 1,
            details: `Contains (any): ${matches.join(', ')}`,
          };
        }
      }
    }

    return { matched: false, relevanceGrade: 0, details: 'No contains match' };
  }

  /**
   * Check if result matches any excluded pattern (negative test)
   *
   * @param {object} result - Search result
   * @param {Array} excludedList - Array of file patterns that must NOT appear
   * @returns {object} { matched: boolean, pattern: string }
   */
  matchExcluded(result, excludedList) {
    // P2 DRY: Use normalizeResult for consistent extraction
    const rawFile = result.file || result.filePath || '';
    const normalized = this.normalizeResult(result);
    const resultFile = normalized.file;
    const resultFullPath = normalized.fullPath;

    for (const excluded of excludedList) {
      const excludedBasename = this.normalizePath(excluded);
      const excludedFullPath = this.normalizeFullPath(excluded);

      // Check for exact basename match, path suffix match, or glob pattern
      if (resultFile === excludedBasename ||
          resultFullPath.endsWith(excludedFullPath) ||
          minimatch(rawFile, excluded, { nocase: !this.options.caseSensitive })) {
        return { matched: true, pattern: excluded };
      }
    }

    return { matched: false, pattern: null };
  }

  /**
   * Evaluate all results against expected criteria
   *
   * @param {Array} results - Array of search results
   * @param {object} expected - Expected object { exact, anyOf, contains, excluded }
   * @returns {object} { matchedResults: [], unmatchedResults: [], summary: {} }
   */
  evaluateResults(results, expected) {
    if (!results || results.length === 0) {
      return {
        matchedResults: [],
        unmatchedResults: [],
        summary: {
          totalResults: 0,
          matched: 0,
          unmatched: 0,
          excluded: 0,
          avgRelevanceGrade: 0,
        },
      };
    }

    const matchedResults = [];
    const unmatchedResults = [];
    let excludedCount = 0;
    let totalGrade = 0;

    for (const result of results) {
      const match = this.matchResult(result, expected);

      const evaluatedResult = {
        ...result,
        match,
      };

      if (match.matchType === 'excluded') {
        excludedCount++;
        unmatchedResults.push(evaluatedResult);
      } else if (match.matched) {
        matchedResults.push(evaluatedResult);
        totalGrade += match.relevanceGrade;
      } else {
        unmatchedResults.push(evaluatedResult);
      }
    }

    return {
      matchedResults,
      unmatchedResults,
      summary: {
        totalResults: results.length,
        matched: matchedResults.length,
        unmatched: unmatchedResults.length,
        excluded: excludedCount,
        avgRelevanceGrade: matchedResults.length > 0
          ? Math.round((totalGrade / matchedResults.length) * 100) / 100
          : 0,
      },
    };
  }

  /**
   * Check if a query's results meet minimum relevance requirements
   *
   * @param {Array} results - Array of evaluated results (with match info)
   * @param {number} minRelevant - Minimum number of relevant results required (default 1)
   * @param {number} k - Top K results to consider (default 10)
   * @returns {object} { success: boolean, relevantCount: number, minRequired: number }
   */
  checkMinRelevant(results, minRelevant = 1, k = 10) {
    const topK = results.slice(0, k);
    const relevantCount = topK.filter(r =>
      r.match?.matched && r.match?.relevanceGrade > 0
    ).length;

    return {
      success: relevantCount >= minRelevant,
      relevantCount,
      minRequired: minRelevant,
    };
  }
}

/**
 * Evaluate a single query's results against ground truth
 *
 * @param {object} query - Query object from query set { id, query, expected, minRelevant }
 * @param {Array} results - Search results
 * @param {object} stats - Stats from SweetSearch
 * @param {object} options - Matcher options
 * @returns {object} Evaluated query object
 */
export function evaluateQuery(query, results, stats = {}, options = {}) {
  const matcher = new ResultMatcher(options);
  const evaluation = matcher.evaluateResults(results, query.expected);
  const minCheck = matcher.checkMinRelevant(evaluation.matchedResults, query.minRelevant || 1);

  return {
    id: query.id,
    query: query.query,
    expectedRoute: query.expectedRoute,
    actualRoute: stats?.routing?.mode || 'unknown',
    structuralSubtype: query.structuralSubtype,
    results: results,
    matchedResults: evaluation.matchedResults,
    unmatchedResults: evaluation.unmatchedResults,
    expected: query.expected,
    minRelevant: query.minRelevant || 1,
    stats,
    summary: evaluation.summary,
    success: minCheck.success,
  };
}

export default ResultMatcher;
