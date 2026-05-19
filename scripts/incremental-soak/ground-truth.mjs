/**
 * Ground truth model for the soak harness.
 *
 * Tracks the expected visible state of the fixture: which files exist, which
 * symbols they export, which sentinels they contain. The reconciler is then
 * probed and its observed state is compared against this model.
 *
 * The model is intentionally per-mutation: applyMutation() returns a record
 * with the pre-state and post-state so the harness can compute staleness for
 * the *specific* delta induced by the mutation.
 */

import { helperNameFor, fnNameFor, classNameFor, makeSentinel } from './fixture.mjs';

export class GroundTruth {
  constructor(initialDescriptors) {
    this.files = new Map();
    for (const d of initialDescriptors) {
      this.files.set(d.rel, { ...d });
    }
    this.history = [];
  }

  snapshot() {
    return [...this.files.values()].map((d) => ({ ...d }));
  }

  expectedSentinels() {
    const set = new Set();
    for (const d of this.files.values()) set.add(d.sentinel);
    return set;
  }

  expectedSymbolNames() {
    const set = new Set();
    for (const d of this.files.values()) {
      for (const sym of Object.values(d.symbols)) {
        if (sym) set.add(sym);
      }
    }
    return set;
  }

  expectedFiles() {
    return new Set(this.files.keys());
  }

  get(rel) {
    return this.files.get(rel);
  }

  apply(mutation) {
    const id = this.history.length + 1;
    const record = { id, mutation: { ...mutation }, ts: Date.now() };
    switch (mutation.kind) {
      case 'update_body':       record.before = clone(this.files.get(mutation.rel)); this._updateBody(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      case 'update_symbol':     record.before = clone(this.files.get(mutation.rel)); this._updateSymbol(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      case 'update_call':       record.before = clone(this.files.get(mutation.rel)); this._updateCall(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      case 'replace_sentinel':  record.before = clone(this.files.get(mutation.rel)); this._replaceSentinel(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      case 'delete_file':       record.before = clone(this.files.get(mutation.rel)); this._deleteFile(mutation); record.after = null; break;
      case 'rename_file':       record.before = clone(this.files.get(mutation.fromRel)); this._renameFile(mutation); record.after = clone(this.files.get(mutation.toRel)); break;
      case 'add_file':          record.before = null; this._addFile(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      case 'delete_symbol':     record.before = clone(this.files.get(mutation.rel)); this._deleteSymbol(mutation); record.after = clone(this.files.get(mutation.rel)); break;
      default: throw new Error(`unknown mutation kind ${mutation.kind}`);
    }
    this.history.push(record);
    return record;
  }

  _updateBody(m) {
    const d = this.files.get(m.rel);
    if (!d) throw new Error(`update_body: missing ${m.rel}`);
    // Body changes don't alter sentinel/symbols, only function body source.
    d.bodyVersion = (d.bodyVersion || 0) + 1;
  }

  _updateSymbol(m) {
    const d = this.files.get(m.rel);
    if (!d) throw new Error(`update_symbol: missing ${m.rel}`);
    // Slug change forces all symbol names + sentinel to rotate.
    const oldSlug = d.slug;
    d.slug = `${oldSlug}_v${(d.bodyVersion || 0) + 1}`;
    d.bodyVersion = (d.bodyVersion || 0) + 1;
    d.sentinel = makeSentinel(d.slug);
    d.symbols = {
      helper: helperNameFor(d.lang, d.slug),
      fn: fnNameFor(d.lang, d.slug),
      class: classNameFor(d.lang, d.slug),
    };
  }

  _updateCall(m) {
    const d = this.files.get(m.rel);
    if (!d) throw new Error(`update_call: missing ${m.rel}`);
    d.callees = m.callees;
  }

  _replaceSentinel(m) {
    const d = this.files.get(m.rel);
    if (!d) throw new Error(`replace_sentinel: missing ${m.rel}`);
    d.sentinel = m.newSentinel;
    d.bodyVersion = (d.bodyVersion || 0) + 1;
  }

  _deleteFile(m) {
    if (!this.files.has(m.rel)) throw new Error(`delete_file: missing ${m.rel}`);
    this.files.delete(m.rel);
  }

  _renameFile(m) {
    const d = this.files.get(m.fromRel);
    if (!d) throw new Error(`rename_file: missing ${m.fromRel}`);
    this.files.delete(m.fromRel);
    d.rel = m.toRel;
    this.files.set(m.toRel, d);
  }

  _addFile(m) {
    if (this.files.has(m.rel)) throw new Error(`add_file: already present ${m.rel}`);
    this.files.set(m.rel, { ...m.descriptor });
  }

  _deleteSymbol(m) {
    const d = this.files.get(m.rel);
    if (!d) throw new Error(`delete_symbol: missing ${m.rel}`);
    // Mark as having one fewer top-level symbol; harness will rewrite content
    // such that the named symbol is removed. We capture the dropped name so
    // tests can assert it is no longer visible.
    const droppedName = d.symbols[m.symbol];
    delete d.symbols[m.symbol];
    d.droppedSymbols = [...(d.droppedSymbols || []), droppedName].filter(Boolean);
    d.bodyVersion = (d.bodyVersion || 0) + 1;
  }
}

function clone(o) {
  return o ? JSON.parse(JSON.stringify(o)) : o;
}
