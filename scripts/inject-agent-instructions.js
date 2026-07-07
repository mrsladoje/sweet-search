/**
 * Multi-file injection of the sweet-search agent policy across every major
 * coding-agent harness (CLAUDE.md / AGENTS.md / GEMINI.md / Cursor rule).
 *
 * Canonical source: **CLAUDE.md** by default (sweet-search is Claude-first;
 * the existing project CLAUDE.md is where users look). Other harnesses get
 * `@CLAUDE.md` import shims (or symlinks). When the user disables Claude
 * Code with `--no-claude-code`, AGENTS.md is promoted to canonical so other
 * harnesses still receive the policy body.
 *
 * NOTE: this design diverges from the plan's §3.3 / §10 which framed
 * AGENTS.md as canonical. The flip was a user-driven product call (sweet-
 * search ships best on Claude, the existing CLAUDE.md is the natural home,
 * and Codex / Gemini both follow `@imports` so the cross-harness chain works
 * with either canonical). Plan doc update is tracked as a follow-up.
 *
 * Marker contract (idempotent rewrite — never modify content outside it):
 *   <!-- sweet-search:agent-instructions:begin -->
 *   ... managed body ...
 *   <!-- sweet-search:agent-instructions:end -->
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER_BEGIN = '<!-- sweet-search:agent-instructions:begin -->';
export const MARKER_END = '<!-- sweet-search:agent-instructions:end -->';

export const AGENTS_FILE = 'AGENTS.md';
export const CLAUDE_FILE = 'CLAUDE.md';
export const GEMINI_FILE = 'GEMINI.md';
export const CURSOR_FILE = '.cursor/rules/sweet-search.mdc';

/**
 * Public harness identifiers used by the per-harness `--no-<name>` flags
 * in `scripts/init.js`. Order matches `--help` output.
 */
export const ALL_HARNESSES = ['claude-code', 'agents', 'gemini', 'cursor'];

const MARKER_RE = new RegExp(
  `${escapeRegex(MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Canonical policy body = the M+++++ champion (integration seam) ──────────
//
// Plan §10 / §3.7.1 step 13 / DDD "Integration seam": scripts/init.js is the
// SOLE consumer of the prompt-optimization ship-file. We read that artifact at
// load time and strip its YAML front-matter; the remaining body is the M+++++
// champion (PHASE7 M++ — held-out 0.988 Maximin, OOD 0.952, HOMP/SCS/counter
// all pass, 5-cell cross-harness validated — plus the stop-discipline scoping
// edits that fix M++'s over-stopping on FIX tasks, plus the verdict-gated
// trust line that scans already-delivered lower ranks before any new search;
// tool routing unchanged), injected VERBATIM into the harness files.
// Per-harness shims (Cursor frontmatter, @imports) are applied at write-time,
// not embedded here.
//
// The artifact is generated from Mppppp.md by
// `core/prompt-optimization/sweep/finalize-mpp.mjs` and shipped via the
// package.json "files" list. If it is missing we fail LOUDLY rather than
// silently shipping a placeholder/older policy.

const SHIP_FILE_REL = 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';

// MCP-tool variant of the policy (init --mcp --no-cli). Same strategy core; the
// tool-mechanics layer is remapped from the ss-* CLI surface onto the
// sweet-search MCP tool surface. Read lazily — only the variant actually
// requested needs to exist, so importing this module never requires the MCP
// ship-file to be present.
const MCP_SHIP_FILE_REL = 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt-mcp.md';

/** Strip a leading YAML front-matter block (`---\n … \n---\n`) if present. */
export function stripFrontMatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function readShippedPolicy(rel = SHIP_FILE_REL, { label = 'M+++++' } = {}) {
  const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/scripts
  const shipPath = join(here, '..', rel);
  let raw;
  try {
    raw = readFileSync(shipPath, 'utf8');
  } catch (err) {
    throw new Error(
      `inject-agent-instructions: cannot read the ${label} ship-file at ${shipPath}. ` +
      'It MUST be present (packaged via package.json "files"). Regenerate with ' +
      '`node core/prompt-optimization/sweep/finalize-mpp.mjs`. ' +
      `Cause: ${err.message}`,
    );
  }
  const body = stripFrontMatter(raw).trimEnd();
  if (!body) {
    throw new Error(`inject-agent-instructions: ${label} ship-file at ${shipPath} has an empty body.`);
  }
  return body;
}

export const CANONICAL_POLICY_BODY = readShippedPolicy();

let _mcpPolicyBody = null;
/** Lazily read + cache the MCP-variant policy body. */
export function getMcpPolicyBody() {
  if (_mcpPolicyBody == null) {
    _mcpPolicyBody = readShippedPolicy(MCP_SHIP_FILE_REL, { label: 'M+++++ (MCP variant)' });
  }
  return _mcpPolicyBody;
}

/**
 * Resolve the policy body for a contact-surface variant.
 *   'cli' (default) → the frozen ss-* CLI champion (CANONICAL_POLICY_BODY)
 *   'mcp'           → the MCP-tool variant (init --mcp --no-cli)
 */
export function getPolicyBody(variant = 'cli') {
  return variant === 'mcp' ? getMcpPolicyBody() : CANONICAL_POLICY_BODY;
}

const CURSOR_FRONTMATTER = `---
description: Sweet Search tool-routing, stopping, and citation policy
alwaysApply: false
filePattern: "**/*"
---

`;

// ─── Block builders ──────────────────────────────────────────────────────────

function wrapMarker(body) {
  return `${MARKER_BEGIN}\n${body.trimEnd()}\n${MARKER_END}\n`;
}

/**
 * Body for the canonical-source file (CLAUDE.md by default; AGENTS.md when
 * the user opts out of Claude Code with `--no-claude-code`). Inlines the
 * full policy plus, for CLAUDE.md, an extra `@.claude/rules/sweet-search.md`
 * import line so the Claude-specific shim is loaded.
 */
export function buildCanonicalBlock({ extraImports = [], policyBody = CANONICAL_POLICY_BODY } = {}) {
  if (extraImports.length === 0) {
    return wrapMarker(policyBody);
  }
  const importLines = extraImports.map(t => `@${t}`).join('\n');
  return wrapMarker(`${policyBody}\n${importLines}\n`);
}

/**
 * Body for non-canonical harnesses that prefer to @import the canonical
 * file (Codex CLI, Gemini CLI when symlinks aren't used, AGENTS.md when
 * canonical is CLAUDE.md). Cursor doesn't get this — it inlines the body
 * because its frontmatter is required.
 */
export function buildImportBlock({ importTargets }) {
  const lines = importTargets.map(t => `@${t}`).join('\n');
  return wrapMarker(
    `<!-- Auto-generated by \`sweet-search init\`. Edit the canonical file (CLAUDE.md by default, AGENTS.md when --no-claude) instead. -->\n\n${lines}`,
  );
}

/** Body for the cursor .mdc (frontmatter + inlined canonical body). */
export function buildCursorFile(policyBody = CANONICAL_POLICY_BODY) {
  return CURSOR_FRONTMATTER + wrapMarker(policyBody);
}

// ─── Marker injection ───────────────────────────────────────────────────────

/**
 * Idempotent rewrite of the marker block.
 *  - File missing: write `block` (with optional `prefix` like cursor frontmatter).
 *  - Marker present: replace in-place.
 *  - File exists, no marker: prepend `block` followed by an empty line.
 * @returns 'created' | 'replaced' | 'prepended' | 'unchanged'
 */
export function injectMarkerBlock({ filePath, block, prefix = '' }) {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, prefix + block);
    return 'created';
  }
  const current = readFileSync(filePath, 'utf8');
  if (MARKER_RE.test(current)) {
    const next = current.replace(MARKER_RE, block);
    if (next === current) return 'unchanged';
    writeFileSync(filePath, next);
    return 'replaced';
  }
  // No marker — prepend the block. Keeps user content intact.
  writeFileSync(filePath, block + '\n' + current);
  return 'prepended';
}

/**
 * Strip just the marker block (keep all surrounding user content).
 * Used by uninstall.
 * @returns 'removed' | 'not-found' | 'file-deleted'
 *   `file-deleted` means the file became empty after stripping the marker
 *   (i.e. it was wholly sweet-search-managed) and the file itself was unlinked.
 */
export function stripMarkerBlock({ filePath, deleteIfEmpty = true }) {
  if (!existsSync(filePath)) return 'not-found';
  const stat = lstatSync(filePath);
  // Symlinks: never edit the link target — caller handles symlink removal
  // explicitly via removeSymlinkIfOurs.
  if (stat.isSymbolicLink()) return 'not-found';
  const current = readFileSync(filePath, 'utf8');
  if (!MARKER_RE.test(current)) return 'not-found';
  const next = current.replace(MARKER_RE, '').replace(/^\n+/, '').trimEnd() + '\n';
  if (deleteIfEmpty && next.trim() === '') {
    unlinkSync(filePath);
    return 'file-deleted';
  }
  writeFileSync(filePath, next);
  return 'removed';
}

// ─── Symlink helpers (GEMINI.md → canonical, etc.) ──────────────────────────

/**
 * Create a relative symlink `linkPath → targetPath` only if `linkPath`
 * doesn't already exist (or is already the same symlink). Falls back to
 * `inline` if the link can't be created (Windows w/o privilege, target on
 * different volume).
 *
 * @returns 'created' | 'already-correct' | 'fell-back-to-copy' | 'preserved-existing'
 */
export function symlinkOrFallback({ linkPath, targetPath, fallbackInject }) {
  const relTarget = relative(dirname(linkPath), targetPath);
  if (existsSync(linkPath) || lstatExists(linkPath)) {
    let stat;
    try { stat = lstatSync(linkPath); } catch { stat = null; }
    if (stat && stat.isSymbolicLink()) {
      const current = readlinkSync(linkPath);
      if (current === relTarget) return 'already-correct';
      // Different symlink target — leave it alone, user may have customised.
      return 'preserved-existing';
    }
    // Regular file already exists — never overwrite. Inject marker into the
    // existing file so the policy still flows through.
    fallbackInject();
    return 'fell-back-to-copy';
  }
  try {
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(relTarget, linkPath);
    return 'created';
  } catch {
    fallbackInject();
    return 'fell-back-to-copy';
  }
}

function lstatExists(p) {
  try { lstatSync(p); return true; } catch { return false; }
}

/**
 * Remove a symlink only if it points at the expected sweet-search target.
 * @returns 'removed' | 'not-our-symlink' | 'not-found'
 */
export function removeSymlinkIfOurs({ linkPath, expectedTargets }) {
  if (!lstatExists(linkPath)) return 'not-found';
  let stat;
  try { stat = lstatSync(linkPath); } catch { return 'not-found'; }
  if (!stat.isSymbolicLink()) return 'not-our-symlink';
  let target;
  try { target = readlinkSync(linkPath); } catch { return 'not-our-symlink'; }
  const expected = Array.isArray(expectedTargets) ? expectedTargets : [expectedTargets];
  if (!expected.includes(target)) return 'not-our-symlink';
  unlinkSync(linkPath);
  return 'removed';
}

// ─── Public API: install + uninstall ────────────────────────────────────────

/**
 * Install the canonical policy file plus per-harness shims/symlinks.
 * Idempotent. Returns a per-file status report.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string[]} [args.harnesses]   defaults to ALL_HARNESSES
 * @param {boolean}  [args.useSymlinks] default true; only governs GEMINI.md
 *
 * Canonical resolution:
 *   - claude-code enabled → CLAUDE.md is canonical (body inside marker)
 *   - claude-code disabled → AGENTS.md is canonical
 * Other harnesses always import / symlink to whichever file is canonical.
 */
export function injectAgentInstructions({
  projectRoot,
  harnesses = ALL_HARNESSES,
  useSymlinks = true,
  variant = 'cli',
} = {}) {
  if (!projectRoot) throw new TypeError('inject-agent-instructions: projectRoot is required');
  const enabled = new Set(harnesses);
  const report = { harnesses: {}, canonical: null, variant };

  if (enabled.size === 0) return report;

  // Variant selects the policy body. The MCP variant retargets every ss-* CLI
  // reference onto the sweet-search MCP tool surface; it also drops the Claude
  // `@.claude/rules/sweet-search.md` import because that supplement is written
  // in ss-* CLI terms and would contradict the MCP body (the CLI rules file is
  // skipped under --no-cli in init too).
  const policyBody = getPolicyBody(variant);
  const claudeExtraImports = variant === 'mcp' ? [] : ['.claude/rules/sweet-search.md'];

  // 1. Canonical file: CLAUDE.md when Claude Code is enabled, else AGENTS.md.
  //    Body is the full policy plus (Claude-only, CLI variant) the @.claude/rules import.
  let canonicalFile;
  let canonicalBlock;
  if (enabled.has('claude-code')) {
    canonicalFile = CLAUDE_FILE;
    canonicalBlock = buildCanonicalBlock({
      extraImports: claudeExtraImports,
      policyBody,
    });
    report.canonical = 'claude-code';
  } else if (enabled.has('agents') || enabled.has('gemini') || enabled.has('cursor')) {
    canonicalFile = AGENTS_FILE;
    canonicalBlock = buildCanonicalBlock({ policyBody });
    report.canonical = 'agents'; // AGENTS.md is the multi-harness convention (Codex, OpenCode, …)
  } else {
    return report; // no canonical, nothing to write
  }

  if (enabled.has('claude-code')) {
    const claudePath = join(projectRoot, CLAUDE_FILE);
    report.harnesses['claude-code'] = injectMarkerBlock({
      filePath: claudePath,
      block: canonicalBlock,
    });
  }

  // 2. AGENTS.md — canonical when Claude Code is disabled, otherwise a
  //    @CLAUDE.md import shim for Codex / OpenCode.
  if (enabled.has('agents')) {
    const agentsPath = join(projectRoot, AGENTS_FILE);
    if (canonicalFile === AGENTS_FILE) {
      report.harnesses.agents = injectMarkerBlock({
        filePath: agentsPath,
        block: canonicalBlock,
      });
    } else {
      report.harnesses.agents = injectMarkerBlock({
        filePath: agentsPath,
        block: buildImportBlock({ importTargets: [canonicalFile] }),
      });
    }
  }

  // 3. GEMINI.md — symlink → canonical when possible, else marker block with @import.
  if (enabled.has('gemini')) {
    const geminiPath = join(projectRoot, GEMINI_FILE);
    if (useSymlinks) {
      report.harnesses.gemini = symlinkOrFallback({
        linkPath: geminiPath,
        targetPath: join(projectRoot, canonicalFile),
        fallbackInject: () => injectMarkerBlock({
          filePath: geminiPath,
          block: buildImportBlock({ importTargets: [canonicalFile] }),
        }),
      });
    } else {
      report.harnesses.gemini = injectMarkerBlock({
        filePath: geminiPath,
        block: buildImportBlock({ importTargets: [canonicalFile] }),
      });
    }
  }

  // 4. .cursor/rules/sweet-search.mdc — frontmatter + inlined body (no symlink).
  if (enabled.has('cursor')) {
    const cursorPath = join(projectRoot, CURSOR_FILE);
    if (existsSync(cursorPath)) {
      // Existing file — replace marker block in-place; preserve frontmatter
      // and any user notes outside the markers.
      report.harnesses.cursor = injectMarkerBlock({
        filePath: cursorPath,
        block: buildCanonicalBlock({ policyBody }),
      });
    } else {
      // Fresh file — write frontmatter + canonical body in marker block.
      mkdirSync(dirname(cursorPath), { recursive: true });
      writeFileSync(cursorPath, buildCursorFile(policyBody));
      report.harnesses.cursor = 'created';
    }
  }

  return report;
}

/**
 * Reverse `injectAgentInstructions`. Strips marker blocks (preserving user
 * content) and removes our symlinks. Per §4A: never modify content outside
 * the marker; never delete a file the user created.
 */
export function removeAgentInstructions({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) throw new TypeError('remove-agent-instructions: projectRoot is required');
  const report = { harnesses: {} };
  const claudePath = join(projectRoot, CLAUDE_FILE);
  const agentsPath = join(projectRoot, AGENTS_FILE);
  const geminiPath = join(projectRoot, GEMINI_FILE);
  const cursorPath = join(projectRoot, CURSOR_FILE);

  if (dryRun) {
    report.harnesses['claude-code'] = previewMarkerStrip(claudePath);
    report.harnesses.agents = previewMarkerStrip(agentsPath);
    report.harnesses.gemini = previewSymlinkRemoval(geminiPath, [CLAUDE_FILE, AGENTS_FILE])
      || previewMarkerStrip(geminiPath);
    report.harnesses.cursor = previewWholeFileRemoval(cursorPath);
    return report;
  }

  report.harnesses['claude-code'] = stripMarkerBlock({ filePath: claudePath });
  report.harnesses.agents = stripMarkerBlock({ filePath: agentsPath });
  // GEMINI.md: try symlink removal first (accept either canonical target),
  // then fall back to marker strip if it was a copy.
  const geminiSymlink = removeSymlinkIfOurs({
    linkPath: geminiPath,
    expectedTargets: [CLAUDE_FILE, AGENTS_FILE],
  });
  report.harnesses.gemini = geminiSymlink !== 'not-our-symlink'
    ? geminiSymlink
    : stripMarkerBlock({ filePath: geminiPath });
  // Cursor file: we always wholly own it (frontmatter is ours), so safe to remove
  // when our marker is present. Preserve user-customised cursor files.
  report.harnesses.cursor = removeWholeFileIfOurs(cursorPath);

  return report;
}

function previewMarkerStrip(filePath) {
  if (!existsSync(filePath)) return 'not-found';
  let stat;
  try { stat = lstatSync(filePath); } catch { return 'not-found'; }
  if (stat.isSymbolicLink()) return 'not-found';
  const text = readFileSync(filePath, 'utf8');
  return MARKER_RE.test(text) ? 'dry-run' : 'not-found';
}

function previewSymlinkRemoval(linkPath, expectedTargets) {
  if (!lstatExists(linkPath)) return null;
  let stat;
  try { stat = lstatSync(linkPath); } catch { return null; }
  if (!stat.isSymbolicLink()) return null;
  let target;
  try { target = readlinkSync(linkPath); } catch { return null; }
  const expected = Array.isArray(expectedTargets) ? expectedTargets : [expectedTargets];
  return expected.includes(target) ? 'dry-run' : null;
}

function previewWholeFileRemoval(filePath) {
  if (!existsSync(filePath)) return 'not-found';
  const text = readFileSync(filePath, 'utf8');
  return MARKER_RE.test(text) ? 'dry-run' : 'not-found';
}

function removeWholeFileIfOurs(filePath) {
  if (!existsSync(filePath)) return 'not-found';
  const text = readFileSync(filePath, 'utf8');
  if (!MARKER_RE.test(text)) return 'not-our-symlink'; // user-owned cursor file
  unlinkSync(filePath);
  return 'file-deleted';
}
