/**
 * Shared family-detection table for Phase 6 REDO (`ss-search`) and Phase 7
 * T_i variant bodies. Single source of truth — both the redo's scripts
 * (preprocess / author / aggregate) and the runtime agent's family lookup
 * import from here.
 *
 * Source spec: docs/PHASE6_REDO.md §5.5.7. Do not duplicate this mapping
 * anywhere else; import { extToFamily, languageToFamily, FAMILIES } from
 * './family-map.mjs' instead.
 *
 * The 5 families come from §4 of the spec — feature clusters that matter
 * for `ss-search` retrieval-shape sensitivity:
 *   - OO-monolithic        : one PascalCase class per file, verbose docs
 *   - Systems-modular-terse: many top-level fns, terse one-line docs
 *   - C-family             : header decls + impl files, namespace-heavy
 *   - JS-mobile            : modules with multiple exports, JSDoc style
 *   - Scripting-dynamic    : dynamic typing, narrative docstrings
 *
 * Unknown extensions resolve to `null`, which the agent treats as
 * `default.instruction_text` (PHASE6_REDO §5.5.7).
 */

export const FAMILIES = Object.freeze({
  'OO-monolithic': Object.freeze(['java', 'csharp', 'kotlin', 'scala']),
  'Systems-modular-terse': Object.freeze(['rust', 'go']),
  'C-family': Object.freeze(['c', 'cpp', 'zig']),
  'JS-mobile': Object.freeze(['javascript', 'typescript', 'typescript-lib', 'dart']),
  'Scripting-dynamic': Object.freeze(['python', 'ruby', 'php', 'lua', 'elixir']),
});

/**
 * Probe-pack key → canonical language id. `typescript-lib` is a probe-pack
 * name (colinhacks/zod), not a separate language; its files use `.ts` and
 * route to the JS-mobile family via `typescript`.
 */
export const PROBE_PACK_TO_LANGUAGE = Object.freeze({
  'typescript-lib': 'typescript',
});

const EXT_TO_LANGUAGE = Object.freeze({
  // OO-monolithic
  '.java': 'java',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
  // Systems-modular-terse
  '.rs': 'rust',
  '.go': 'go',
  // C-family
  '.c': 'c',
  '.h': 'c', // .h disambiguation is content-sensitive in ast-chunker; for
             //   family lookup we route to C by default. C++-only headers
             //   still land in the C-family bucket either way.
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.zig': 'zig',
  // JS-mobile
  '.js': 'javascript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.dart': 'dart',
  // Scripting-dynamic
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.ex': 'elixir',
  '.exs': 'elixir',
});

// Build language → family at module load (cheap, ~18 languages).
const LANGUAGE_TO_FAMILY = (() => {
  const out = {};
  for (const [family, langs] of Object.entries(FAMILIES)) {
    for (const lang of langs) out[lang] = family;
  }
  return Object.freeze(out);
})();

/**
 * Map a probe-pack key to the canonical language id.
 *
 * The probe-pack key matches the `language` / `repo` field in
 * eval/ast-tester-probes/gold/<lang>.json. Most are identical to the
 * canonical language id; `typescript-lib` is the documented exception.
 */
export function normalizeProbePackKey(key) {
  if (!key) return null;
  return PROBE_PACK_TO_LANGUAGE[key] ?? key;
}

/**
 * Look up family by canonical language id (e.g., "rust", "typescript").
 * Returns null for unknown languages — the agent uses the default
 * instruction_text in that case.
 */
export function languageToFamily(language) {
  if (!language) return null;
  const canonical = normalizeProbePackKey(language);
  return LANGUAGE_TO_FAMILY[canonical] ?? null;
}

/**
 * Look up family by file path. Extension lookup is lowercase; unknown
 * extensions return null (default.instruction_text path).
 */
export function extToFamily(filePath) {
  if (!filePath) return null;
  const lower = String(filePath).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  const lang = EXT_TO_LANGUAGE[ext];
  if (!lang) return null;
  return LANGUAGE_TO_FAMILY[lang] ?? null;
}

/**
 * Reverse lookup — get the canonical language id from a file path.
 * Returns null if the extension is not in the mapping.
 */
export function extToLanguage(filePath) {
  if (!filePath) return null;
  const lower = String(filePath).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_TO_LANGUAGE[lower.slice(dot)] ?? null;
}

/**
 * The ordered list of canonical languages covered by PHASE6_REDO.md §4.
 * 18 entries total; matches the 18 AST-tester probe packs minus `swift`
 * (Swift is excluded — it appears in eval/ast-tester-probes/splits/manifest.json
 * but is not enumerated in PHASE6_REDO §4 and has no assigned family).
 */
export const COVERED_LANGUAGES = Object.freeze([
  ...FAMILIES['OO-monolithic'],
  ...FAMILIES['Systems-modular-terse'],
  ...FAMILIES['C-family'],
  ...FAMILIES['JS-mobile'],
  ...FAMILIES['Scripting-dynamic'],
]);
