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
export const ALL_HARNESSES = ['claude-code', 'codex', 'gemini', 'cursor'];

const MARKER_RE = new RegExp(
  `${escapeRegex(MARKER_BEGIN)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Canonical policy body (Part 5 of the plan) ─────────────────────────────
//
// Verbatim per §5 / §13.4. Per-harness shims (XML wrap, frontmatter, etc.) are
// applied at write-time, not embedded here, so cross-model robustness measured
// in the GEPA campaign translates directly to the policy that ships.

export const CANONICAL_POLICY_BODY = `## sweet-search Tool Routing

Use sweet-search for code discovery and code reading. Pick the narrowest tool that can answer the question.

1. Exact symbol, constant, error code, log string, config key, or literal:
   - Use indexed grep.
   - CLI: \`sweet-search grep "<regex>" --agent\`
   - Agent wrapper: \`ss-grep "<regex>" -k 5\`
   - Query shape: short, literal-heavy regex. Escape punctuation. Prefer the rarest identifier.

2. Behavioral or semantic question where a literal exists but intent matters:
   - Use ColGrep / patternSearch: regex candidate pool + semantic re-rank.
   - Agent wrapper: \`ss-find "<natural-language question>" --regex "<broad-but-relevant-regex>" -k 5\`
   - Query shape: natural-language intent + a broad regex anchor.

3. General conceptual search with no obvious literal:
   - Use \`sweet-search "<short intent query>" --agent\` in hybrid/auto mode.
   - Query shape: one concise sentence naming the concept and likely domain words.

4. Callers, callees, implementations, impact, inheritance, or dependency questions:
   - Use structural search.
   - CLI: \`sweet-search "who calls <symbol>" --mode structural --agent\`
   - Query shape: include the exact symbol plus relationship word.

5. Path/name discovery:
   - Use path search once implemented.
   - CLI: \`sweet-search files "<glob-or-path-pattern>"\`

6. Exact file/range already known:
   - Use exact read.
   - CLI: \`sweet-search read <file> --lines <start-end>\`
   - Agent wrapper: \`ss-read <file> <start> <end>\`

7. File is known but relevant span is unclear:
   - Use semantic read once for that file.
   - CLI: \`sweet-search read-semantic <file> "<question>" --max-tokens 800\`
   - Agent wrapper: \`ss-semantic <file> "<question>" --max-tokens 800\`
   - Do not call semantic read on multiple files unless the task is explicitly multi-file.

## Stopping Rules

- Inspect only the top 3-5 discovery results.
- If a discovery result already returns a tight chunk/range that answers the question, cite it and stop.
- If the first discovery call returns nothing, broaden once. If still empty, report no match.
- Do not re-search merely to double-check.
- Do not read broad files after a tight chunk already answers the task.
- Prefer 1-3 high-confidence citations over long citation lists.

## STOP rules — read these before EVERY follow-up call

The sweet-search response trailer carries explicit stop signals.
**Honour them.** A second call costs more tokens than it saves.

Stop after one search and answer immediately when ALL of:
- the response says \`sufficient=YES\`
- the top-1 result is \`presentation=full\` with \`expansionKind\` in
  \`{full, sandwich, chunk}\` and the gold symbol/file is named
- the response includes a \`### related (1-hop graph, ...)\` block
  OR a \`### imports\` block that resolves the body's referenced names
- you can defend the answer by pointing at the visible code

Do NOT call a second time merely because:
- you want to "double-check" the line range
- the first answer was unexpectedly short → it is short BECAUSE the
  pack is tight, not because evidence is missing
- you noticed a helper function named in the chunk that is also in
  the pack as a \`summary\` row → its file:line in the rank list
  is sufficient citation; do not read it

Single counter-rule: the question explicitly asks for multi-file
flow ("how does X flow from A to B", "trace from entry to exit",
"all places that ..."). In that case, take ONE follow-up reading
or sub-search to fill the gap, then stop.

## Choosing the search budget

Default to \`ss-search "<q>"\` (4k). Switch tiers only when the question
shape demands it:

- Use \`--full\` (8k) when the question:
  - mentions multiple steps / phases / stages explicitly
  - asks for a "pipeline", "flow", "lifecycle", "dispatch", "sequence"
  - asks "how does X handle ..." where X involves several cooperating
    functions
  - asks "what calls/where is X used" AND you expect ≥2 callers

- Use \`--xl\` (12k) ONLY when:
  - the question is explicitly multi-file / cross-cutting
  - one strong dominant answer is plausible (the gate will fall back
    to \`--full\` if not)

NEVER chain searches at increasing budgets. If the default 4k pack
already says \`sufficient=YES\`, do not "re-run with --full to be sure"
— that just wastes budget.

## Citation Rules

- Every distinct source file that supports the answer must appear as its own citation.
- If the prose names a file, imports from it, relies on a function in it, or cites behavior from it,
  that file must be cited with a line range.
- For multi-file flows, cite one range per required file.
- Do not mention supporting files only in prose or notes.
`;

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
export function buildCanonicalBlock({ extraImports = [] } = {}) {
  if (extraImports.length === 0) {
    return wrapMarker(CANONICAL_POLICY_BODY);
  }
  const importLines = extraImports.map(t => `@${t}`).join('\n');
  return wrapMarker(`${CANONICAL_POLICY_BODY}\n${importLines}\n`);
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
export function buildCursorFile() {
  return CURSOR_FRONTMATTER + wrapMarker(CANONICAL_POLICY_BODY);
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
} = {}) {
  if (!projectRoot) throw new TypeError('inject-agent-instructions: projectRoot is required');
  const enabled = new Set(harnesses);
  const report = { harnesses: {}, canonical: null };

  if (enabled.size === 0) return report;

  // 1. Canonical file: CLAUDE.md when Claude Code is enabled, else AGENTS.md.
  //    Body is the full policy plus (Claude-only) the @.claude/rules import.
  let canonicalFile;
  let canonicalBlock;
  if (enabled.has('claude-code')) {
    canonicalFile = CLAUDE_FILE;
    canonicalBlock = buildCanonicalBlock({
      extraImports: ['.claude/rules/sweet-search.md'],
    });
    report.canonical = 'claude-code';
  } else if (enabled.has('codex') || enabled.has('gemini') || enabled.has('cursor')) {
    canonicalFile = AGENTS_FILE;
    canonicalBlock = buildCanonicalBlock();
    report.canonical = 'codex'; // AGENTS.md primarily targets Codex CLI
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
  if (enabled.has('codex')) {
    const agentsPath = join(projectRoot, AGENTS_FILE);
    if (canonicalFile === AGENTS_FILE) {
      report.harnesses.codex = injectMarkerBlock({
        filePath: agentsPath,
        block: canonicalBlock,
      });
    } else {
      report.harnesses.codex = injectMarkerBlock({
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
        block: buildCanonicalBlock(),
      });
    } else {
      // Fresh file — write frontmatter + canonical body in marker block.
      mkdirSync(dirname(cursorPath), { recursive: true });
      writeFileSync(cursorPath, buildCursorFile());
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
    report.harnesses.codex = previewMarkerStrip(agentsPath);
    report.harnesses.gemini = previewSymlinkRemoval(geminiPath, [CLAUDE_FILE, AGENTS_FILE])
      || previewMarkerStrip(geminiPath);
    report.harnesses.cursor = previewWholeFileRemoval(cursorPath);
    return report;
  }

  report.harnesses['claude-code'] = stripMarkerBlock({ filePath: claudePath });
  report.harnesses.codex = stripMarkerBlock({ filePath: agentsPath });
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
