/**
 * Mutation sequencer for the soak harness.
 *
 * Builds a deterministic stream of file mutations against the fixture and
 * keeps the ground-truth model in sync. Each mutation is applied to disk +
 * the dirty queue so the production reconciler picks it up.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  rebuild,
  rebuildWithSentinel,
  helperNameFor,
  fnNameFor,
  classNameFor,
  makeSentinel,
} from './fixture.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MUTATION_KINDS = [
  'add_file',
  'update_body',
  'update_body',         // weight body edits higher
  'update_body',
  'update_symbol',
  'update_call',
  'replace_sentinel',
  'delete_file',
  'rename_file',
  'delete_symbol',
];

export class Mutator {
  constructor({ projectRoot, ground, seed, queuePath, log }) {
    this.projectRoot = projectRoot;
    this.ground = ground;
    this.rng = mulberry32(seed);
    this.queuePath = queuePath;
    this.log = log || (() => {});
    this.uid = 1;
  }

  pick(arr) {
    if (arr.length === 0) return null;
    return arr[Math.floor(this.rng() * arr.length)];
  }

  enqueue(rel) {
    fs.mkdirSync(path.dirname(this.queuePath), { recursive: true });
    fs.appendFileSync(this.queuePath, JSON.stringify({ file_path: rel, timestamp: Date.now(), source: 'soak' }) + '\n');
  }

  applyOne() {
    // Choose a mutation kind. If we have very few files left, force add_file.
    const files = [...this.ground.files.values()];
    let kind = MUTATION_KINDS[Math.floor(this.rng() * MUTATION_KINDS.length)];
    if (files.length < 8 && (kind === 'delete_file' || kind === 'rename_file')) {
      kind = 'add_file';
    }
    if (files.length === 0) kind = 'add_file';

    switch (kind) {
      case 'add_file':         return this._addFile();
      case 'update_body':      return this._updateBody(files);
      case 'update_symbol':    return this._updateSymbol(files);
      case 'update_call':      return this._updateCall(files);
      case 'replace_sentinel': return this._replaceSentinel(files);
      case 'delete_file':      return this._deleteFile(files);
      case 'rename_file':      return this._renameFile(files);
      case 'delete_symbol':    return this._deleteSymbol(files);
      default: throw new Error(`unknown kind ${kind}`);
    }
  }

  _addFile() {
    const langs = ['js', 'ts', 'py', 'go', 'rs'];
    const lang = langs[Math.floor(this.rng() * langs.length)];
    const id = `soak${String(this.uid++).padStart(4, '0')}_${lang}`;
    const slug = id;
    const sentinel = makeSentinel(slug);
    const ext = lang === 'js' ? '.js' : lang === 'ts' ? '.ts' : lang === 'py' ? '.py' : lang === 'go' ? '.go' : '.rs';
    const rel = path.posix.join('src', lang, `${slug}${ext}`);
    const descriptor = {
      rel, lang, slug, sentinel, callees: [], bodyVersion: 0,
      symbols: {
        helper: helperNameFor(lang, slug),
        fn: fnNameFor(lang, slug),
        class: classNameFor(lang, slug),
      },
    };
    const content = rebuild(descriptor);
    fs.mkdirSync(path.dirname(path.join(this.projectRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(this.projectRoot, rel), content);
    const record = this.ground.apply({ kind: 'add_file', rel, descriptor });
    this.enqueue(rel);
    return { kind: 'add_file', rel, record, writtenAt: Date.now() };
  }

  _updateBody(files) {
    const desc = this.pick(files);
    if (!desc) return this._addFile();
    const record = this.ground.apply({ kind: 'update_body', rel: desc.rel });
    const after = this.ground.get(desc.rel);
    // Add a comment line that perturbs body hash but keeps symbol shapes.
    const content = rebuild(after) + `\n// body_version=${after.bodyVersion}\n`;
    fs.writeFileSync(path.join(this.projectRoot, desc.rel), content);
    this.enqueue(desc.rel);
    return { kind: 'update_body', rel: desc.rel, record, writtenAt: Date.now() };
  }

  _updateSymbol(files) {
    const desc = this.pick(files);
    if (!desc) return this._addFile();
    const record = this.ground.apply({ kind: 'update_symbol', rel: desc.rel });
    const after = this.ground.get(desc.rel);
    const content = rebuild(after);
    fs.writeFileSync(path.join(this.projectRoot, desc.rel), content);
    this.enqueue(desc.rel);
    return { kind: 'update_symbol', rel: desc.rel, record, droppedSymbols: record.before?.symbols, writtenAt: Date.now() };
  }

  _updateCall(files) {
    if (files.length < 2) return this._addFile();
    const desc = this.pick(files);
    const callees = [];
    for (let i = 0; i < 2; i++) {
      const target = this.pick(files);
      if (!target || target.rel === desc.rel) continue;
      // Use a name appropriate for *desc.lang* — cross-language symbol calls
      // won't compile but we're just exercising graph relationships.
      callees.push(target.symbols.fn);
    }
    const record = this.ground.apply({ kind: 'update_call', rel: desc.rel, callees });
    const after = this.ground.get(desc.rel);
    const content = rebuild(after);
    fs.writeFileSync(path.join(this.projectRoot, desc.rel), content);
    this.enqueue(desc.rel);
    return { kind: 'update_call', rel: desc.rel, record, writtenAt: Date.now() };
  }

  _replaceSentinel(files) {
    const desc = this.pick(files);
    if (!desc) return this._addFile();
    const newSentinel = `SENTINEL_RPL_${String(this.uid++).padStart(4, '0')}`;
    const record = this.ground.apply({ kind: 'replace_sentinel', rel: desc.rel, newSentinel });
    const after = this.ground.get(desc.rel);
    const content = rebuildWithSentinel(after, after.sentinel);
    fs.writeFileSync(path.join(this.projectRoot, desc.rel), content);
    this.enqueue(desc.rel);
    return { kind: 'replace_sentinel', rel: desc.rel, record, oldSentinel: record.before?.sentinel, newSentinel: after.sentinel, writtenAt: Date.now() };
  }

  _deleteFile(files) {
    const desc = this.pick(files);
    if (!desc) return this._addFile();
    const record = this.ground.apply({ kind: 'delete_file', rel: desc.rel });
    try { fs.unlinkSync(path.join(this.projectRoot, desc.rel)); } catch {}
    this.enqueue(desc.rel);
    return { kind: 'delete_file', rel: desc.rel, record, writtenAt: Date.now() };
  }

  _renameFile(files) {
    const desc = this.pick(files);
    if (!desc) return this._addFile();
    const fromRel = desc.rel;
    const newSlug = `${desc.slug}_renamed${this.uid++}`;
    const ext = path.extname(fromRel);
    const newRel = path.posix.join(path.dirname(fromRel), `${newSlug}${ext}`);
    const oldAbs = path.join(this.projectRoot, fromRel);
    const newAbs = path.join(this.projectRoot, newRel);
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    try { fs.renameSync(oldAbs, newAbs); } catch {
      // Source missing — write fresh content
      // (we'll re-derive after ground.apply mutates the descriptor)
      fs.writeFileSync(newAbs, rebuild(desc));
    }
    // Ground truth rename — note this mutates desc.rel in-place to newRel.
    const record = this.ground.apply({ kind: 'rename_file', fromRel, toRel: newRel });
    this.enqueue(fromRel);
    this.enqueue(newRel);
    return { kind: 'rename_file', fromRel, toRel: newRel, record, writtenAt: Date.now() };
  }

  _deleteSymbol(files) {
    // Delete the helper symbol from the file so it disappears from graph/FTS
    // but the file itself stays.
    const desc = this.pick(files);
    if (!desc || !desc.symbols.helper) return this._addFile();
    const record = this.ground.apply({ kind: 'delete_symbol', rel: desc.rel, symbol: 'helper' });
    const after = this.ground.get(desc.rel);
    // Strip the helper from the file by writing a minimal version without the helper.
    // Simplest: write the standard module but with no helper line — fall back to
    // rebuild that excludes the symbol by emitting a comment placeholder.
    const content = stripHelper(rebuild(after), after.lang);
    fs.writeFileSync(path.join(this.projectRoot, desc.rel), content);
    this.enqueue(desc.rel);
    return { kind: 'delete_symbol', rel: desc.rel, record, droppedSymbol: record.before?.symbols?.helper, writtenAt: Date.now() };
  }
}

function stripHelper(content, lang) {
  // Best-effort drop the helper function block, leaving callers to fail.
  // Implementation is conservative: replace the helper definition line with a
  // comment so the symbol no longer appears as a top-level definition.
  switch (lang) {
    case 'js':
    case 'ts':
      return content.replace(/export\s+function\s+(?:helper|tsHelper)_[A-Za-z0-9_]+\(\)[\s\S]*?\n}\n/, '// helper removed\n');
    case 'py':
      return content.replace(/^def\s+py_helper_[A-Za-z0-9_]+\(\):[\s\S]*?(?=\n\n|$)/m, '# helper removed');
    case 'go':
      return content.replace(/func\s+goHelper_[A-Za-z0-9_]+\(\)\s+string\s+\{[\s\S]*?\n\}\n/, '// helper removed\n');
    case 'rs':
      return content.replace(/pub\s+fn\s+rs_helper_[A-Za-z0-9_]+\(\)\s+->\s+&'static\s+str\s+\{[\s\S]*?\n\}\n/, '// helper removed\n');
    default:
      return content;
  }
}
