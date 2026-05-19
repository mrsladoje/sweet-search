/**
 * Multi-language fixture generator for the incremental-indexing soak harness.
 *
 * Generates a deterministic source tree containing JS, TS, Python, Go, and
 * Rust files. Each file is keyed off a slug + sentinel token so the harness
 * ground truth can assert which symbols, calls, and unique substrings should
 * be visible at any epoch.
 *
 * Design choices:
 *   - All files compile or parse-clean enough for tree-sitter; runtime
 *     correctness is not tested.
 *   - Every public symbol embeds a sentinel string ("SENTINEL_<id>") so the
 *     harness can probe "is this sentinel visible" through the FTS5,
 *     sparse-gram, and vector tiers without needing real encoders.
 *   - Function bodies reference other functions in the same module — those
 *     references become call-graph edges that the harness can verify.
 *
 * The generator is intentionally simple and self-contained: it takes a
 * config object and emits files via the supplied fs-like writer.
 */

import fs from 'node:fs';
import path from 'node:path';

const LANGUAGES = ['js', 'ts', 'py', 'go', 'rs'];

function makeSentinel(slug) {
  return `SENTINEL_${slug.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`;
}

function jsModule(slug, sentinel, callees = []) {
  const fnName = `fn_${slug}`;
  const helperName = `helper_${slug}`;
  const classs = `Class_${slug}`;
  const callBody = callees
    .map((c) => `  ${c}();`)
    .join('\n');
  return [
    `// Module ${slug} — sentinel ${sentinel}`,
    `// Touch token: ${sentinel}`,
    `import { strict as assert } from 'node:assert';`,
    ``,
    `export function ${helperName}() {`,
    `  return '${sentinel}';`,
    `}`,
    ``,
    `export function ${fnName}() {`,
    `  const id = ${helperName}();`,
    `${callBody}`,
    `  return id + '_${slug}';`,
    `}`,
    ``,
    `export class ${classs} {`,
    `  greet() {`,
    `    return ${fnName}() + '/${sentinel}';`,
    `  }`,
    `}`,
    ``,
  ].join('\n');
}

function tsModule(slug, sentinel, callees = []) {
  const fnName = `tsFn_${slug}`;
  const helperName = `tsHelper_${slug}`;
  const ifaceName = `ITs_${slug}`;
  const classs = `TsClass_${slug}`;
  const callBody = callees
    .map((c) => `  ${c}();`)
    .join('\n');
  return [
    `// TS Module ${slug} — sentinel ${sentinel}`,
    `// Touch token: ${sentinel}`,
    `export interface ${ifaceName} {`,
    `  id: string;`,
    `  sentinel: '${sentinel}';`,
    `}`,
    ``,
    `export function ${helperName}(): string {`,
    `  return '${sentinel}';`,
    `}`,
    ``,
    `export function ${fnName}(): ${ifaceName} {`,
    `  const id = ${helperName}();`,
    `${callBody}`,
    `  return { id: id + '_${slug}', sentinel: '${sentinel}' };`,
    `}`,
    ``,
    `export class ${classs} {`,
    `  emit(): ${ifaceName} { return ${fnName}(); }`,
    `}`,
    ``,
  ].join('\n');
}

function pyModule(slug, sentinel, callees = []) {
  const fnName = `py_fn_${slug}`;
  const helperName = `py_helper_${slug}`;
  const classs = `PyClass_${slug}`;
  const callBody = callees
    .map((c) => `    ${c}()`)
    .join('\n');
  return [
    `"""Module ${slug} — sentinel ${sentinel}"""`,
    `# Touch token: ${sentinel}`,
    ``,
    `def ${helperName}():`,
    `    return '${sentinel}'`,
    ``,
    `def ${fnName}():`,
    `    id = ${helperName}()`,
    callBody.length > 0 ? callBody : '    pass',
    `    return id + '_${slug}'`,
    ``,
    `class ${classs}:`,
    `    def greet(self):`,
    `        return ${fnName}() + '/${sentinel}'`,
    ``,
  ].join('\n');
}

function goModule(slug, sentinel, callees = []) {
  const fnName = `GoFn${slug.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`;
  const helperName = `goHelper_${slug}`;
  const callBody = callees
    .map((c) => `\t${c}()`)
    .join('\n');
  return [
    `// Module ${slug} — sentinel ${sentinel}`,
    `// Touch token: ${sentinel}`,
    `package fixture`,
    ``,
    `func ${helperName}() string {`,
    `\treturn "${sentinel}"`,
    `}`,
    ``,
    `func ${fnName}() string {`,
    `\tid := ${helperName}()`,
    `${callBody}`,
    `\treturn id + "_${slug}"`,
    `}`,
    ``,
  ].join('\n');
}

function rsModule(slug, sentinel, callees = []) {
  const fnName = `rs_fn_${slug}`;
  const helperName = `rs_helper_${slug}`;
  const structName = `RsStruct_${slug}`;
  const callBody = callees
    .map((c) => `    ${c}();`)
    .join('\n');
  return [
    `// Module ${slug} — sentinel ${sentinel}`,
    `// Touch token: ${sentinel}`,
    ``,
    `pub fn ${helperName}() -> &'static str {`,
    `    "${sentinel}"`,
    `}`,
    ``,
    `pub fn ${fnName}() -> String {`,
    `    let id = ${helperName}();`,
    `${callBody}`,
    `    format!("{}_${slug}", id)`,
    `}`,
    ``,
    `pub struct ${structName};`,
    ``,
    `impl ${structName} {`,
    `    pub fn greet(&self) -> String {`,
    `        ${fnName}()`,
    `    }`,
    `}`,
    ``,
  ].join('\n');
}

function buildersFor(lang) {
  switch (lang) {
    case 'js': return { ext: '.js', build: jsModule };
    case 'ts': return { ext: '.ts', build: tsModule };
    case 'py': return { ext: '.py', build: pyModule };
    case 'go': return { ext: '.go', build: goModule };
    case 'rs': return { ext: '.rs', build: rsModule };
    default: throw new Error(`unknown lang ${lang}`);
  }
}

/**
 * Build the initial fixture tree under projectRoot.
 *
 *   filesPerLang × |LANGUAGES| files total.
 *
 * Returns the file descriptors as { rel, lang, slug, sentinel, symbols, callees }.
 */
export function generateInitialFixture({ projectRoot, filesPerLang = 6 }) {
  fs.mkdirSync(projectRoot, { recursive: true });
  const descriptors = [];
  let counter = 0;
  for (const lang of LANGUAGES) {
    const { ext, build } = buildersFor(lang);
    const dir = path.join(projectRoot, 'src', lang);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < filesPerLang; i++) {
      const slug = `mod${String(counter).padStart(3, '0')}_${lang}`;
      const sentinel = makeSentinel(slug);
      const rel = path.posix.join('src', lang, `${slug}${ext}`);
      const helperName = helperNameFor(lang, slug);
      const fnName = fnNameFor(lang, slug);
      const classs = classNameFor(lang, slug);
      const content = build(slug, sentinel, []);
      fs.writeFileSync(path.join(projectRoot, rel), content);
      descriptors.push({
        rel,
        lang,
        slug,
        sentinel,
        symbols: { helper: helperName, fn: fnName, class: classs },
        callees: [],
        content,
      });
      counter++;
    }
  }
  return descriptors;
}

export function helperNameFor(lang, slug) {
  if (lang === 'js') return `helper_${slug}`;
  if (lang === 'ts') return `tsHelper_${slug}`;
  if (lang === 'py') return `py_helper_${slug}`;
  if (lang === 'go') return `goHelper_${slug}`;
  if (lang === 'rs') return `rs_helper_${slug}`;
  throw new Error(`unknown lang ${lang}`);
}

export function fnNameFor(lang, slug) {
  if (lang === 'js') return `fn_${slug}`;
  if (lang === 'ts') return `tsFn_${slug}`;
  if (lang === 'py') return `py_fn_${slug}`;
  if (lang === 'go') return `GoFn${slug.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`;
  if (lang === 'rs') return `rs_fn_${slug}`;
  throw new Error(`unknown lang ${lang}`);
}

export function classNameFor(lang, slug) {
  if (lang === 'js') return `Class_${slug}`;
  if (lang === 'ts') return `TsClass_${slug}`;
  if (lang === 'py') return `PyClass_${slug}`;
  if (lang === 'go') return null;
  if (lang === 'rs') return `RsStruct_${slug}`;
  throw new Error(`unknown lang ${lang}`);
}

export function rebuild(desc) {
  const { build } = buildersFor(desc.lang);
  return build(desc.slug, desc.sentinel, desc.callees);
}

export function rebuildWithSentinel(desc, sentinel) {
  const { build } = buildersFor(desc.lang);
  return build(desc.slug, sentinel, desc.callees);
}

export const FIXTURE_LANGUAGES = LANGUAGES;
export { makeSentinel };
