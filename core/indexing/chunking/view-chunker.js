/**
 * Chunks of an ASP.NET view (.cshtml, .razor, .aspx, .ascx, .master, ...), by its structure,
 * the way the code chunker treats code (cAST): neighbours merge while they fit in one chunk,
 * and a unit too large for one chunk splits into its parts. The units:
 *
 *   directive  `@model`, `@inject`, `<%@ Page %>`, ...
 *   code       `@{ }` blocks and `@if`/`@foreach`/... statements: their parts are the C#
 *              statements (C# grammar, on the view's C# projection) and the markup in them
 *   functions  `@functions { }`, `@code { }`, `<script runat="server">`, a .ashx/.asmx body:
 *              C# members, chunked by the C# chunker (methods, properties, nested classes)
 *   section    `@section Name { }`: its markup
 *   markup     an HTML element (HTML grammar): its parts are its child elements and blocks
 *   script     a client `<script>`: JavaScript, chunked by the JavaScript chunker
 *   style      a `<style>`: its CSS rules
 *
 * Chunks hold whole lines and cover every line of the file. A unit with no parts that is
 * still too large (one long text block) splits at blank lines, else at line ends.
 */

import { getTreeSitterProvider } from '../../infrastructure/tree-sitter-provider.js';
import { projectToCSharp, scanViewTemplate, viewClassName, viewTemplateKind } from '../../infrastructure/view-templates.js';

const MAX_CHUNK_SIZE = 2000;
const CODE_KINDS = new Set(['block', 'control', 'nugget', 'expr', 'handler', 'template', 'directive', 'comment', 'escape', 'members', 'csharp']);
const ELEMENT_TYPES = new Set(['element', 'script_element', 'style_element']);

/** Chunks: { text, type, name, startLine, endLine (0-based rows), chunkId, parentChunkId, parentSymbol, parentType, signature, additionalSymbols }. */
export async function chunkViewTemplate(filePath, content, { maxChunkSize = MAX_CHUNK_SIZE } = {}) {
  const provider = getTreeSitterProvider();
  if (!viewTemplateKind(filePath) || !await provider.isAvailable()) return null;
  return new ViewChunker(provider, filePath, String(content), maxChunkSize).run();
}

class ViewChunker {
  constructor(provider, filePath, content, max) {
    this.provider = provider;
    this.filePath = filePath;
    this.text = content;
    this.max = max;
    this.lines = content.split('\n');
    this.lineStart = [0];
    for (let i = 0; i < content.length; i++) if (content[i] === '\n') this.lineStart.push(i + 1);
    // size[r]: characters of rows < r (newlines included).
    this.size = [0];
    for (const l of this.lines) this.size.push(this.size[this.size.length - 1] + l.length + 1);
    this.chunks = [];
    this.counter = 0;
    this.lineSplits = 0; // units split at line ends (no structure left): a statistic
    this.className = viewClassName(filePath);
  }

  rowOf(i) {
    let lo = 0;
    let hi = this.lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStart[mid] <= i) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  rows(r0, r1) {
    return this.size[r1 + 1] - this.size[r0];
  }

  async run() {
    this.scan = scanViewTemplate(this.text, this.filePath);
    const units = [];
    this.razorUnits(this.scan, units);
    await this.markupUnits(units);
    const root = { s: 0, e: this.text.length, type: 'view', name: null, children: [] };
    nest(root, units);
    toRows(this, root);
    try {
      await this.emit(root, null);
    } finally {
      this._tree?.delete();
    }
    return this.mergeSmall();
  }

  // -- units ------------------------------------------------------------------------------------

  razorUnits(node, out) {
    for (const c of node.children || []) {
      if (c.kind === 'directive') out.push({ s: c.s, e: c.e, type: 'directive', name: directiveName(c), children: [] });
      else if (c.kind === 'block' || c.kind === 'control') {
        out.push({ s: c.s, e: c.e, type: 'code', name: null, children: [], razor: c });
        for (const h of c.holes || []) this.razorUnits(h, out);
      } else if (c.kind === 'members' || c.kind === 'csharp') {
        const type = c.kind === 'csharp' || c.name === 'script' || c.name === 'code' ? 'code' : 'functions';
        out.push({ s: c.s, e: c.e, type, name: null, children: [], members: c });
      } else if (c.kind === 'section') {
        out.push({ s: c.s, e: c.e, type: 'section', name: c.name, children: [] });
        this.razorUnits(c, out);
      }
    }
  }

  /** HTML elements of the markup (the text with every C# span blanked, offsets kept). */
  async markupUnits(out) {
    const chars = this.text.split('');
    const blankRange = (s, e) => { for (let i = s; i < e; i++) if (chars[i] !== '\n') chars[i] = ' '; };
    const restore = (s, e) => { for (let i = s; i < e; i++) chars[i] = this.text[i]; };
    const blankNode = (n) => {
      if (n.kind === 'section') {
        blankRange(n.s, n.bodyS);
        blankRange(n.bodyE, n.e);
        for (const c of n.children || []) blankNode(c);
        return;
      }
      if (!CODE_KINDS.has(n.kind)) {
        for (const c of n.children || []) blankNode(c);
        return;
      }
      blankRange(n.s, n.e);
      if (n.kind === 'members' || n.kind === 'csharp') return; // markup in methods stays with them
      for (const h of n.holes || []) {
        if (h.kind !== 'markup' || h.template) continue;
        restore(h.s, h.e);
        for (const c of h.children || []) blankNode(c);
      }
    };
    blankNode(this.scan);
    this.masked = chars.join('');
    if (!this.masked.includes('<')) return;
    const tree = await this.provider.parse(this.masked, 'html');
    if (!tree) return;
    try {
      const walk = (node) => {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i);
          if (ELEMENT_TYPES.has(c.type)) {
            const type = c.type === 'script_element' ? 'script' : c.type === 'style_element' ? 'style' : 'markup';
            const unit = { s: c.startIndex, e: c.endIndex, type, name: elementName(c), children: [] };
            if (type !== 'markup') {
              const raw = c.namedChildren.find((x) => x.type === 'raw_text');
              if (raw) unit.raw = [raw.startIndex, raw.endIndex];
            }
            out.push(unit);
          }
          walk(c);
        }
      };
      walk(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  /** The parts of a unit too large for one chunk (row units, sorted). */
  async partsOf(unit) {
    if (unit.members) return this.memberParts(unit);
    if (unit.type === 'script' && unit.raw) return this.scriptParts(unit);
    if (unit.type === 'style' && unit.raw) return this.styleParts(unit);
    if (unit.razor) return this.codeParts(unit);
    return unit.children;
  }

  /** C# members, by the C# chunker, on a class holding only this block. */
  async memberParts(unit) {
    const m = unit.members;
    const proj = await this.projection();
    if (proj === null) return unit.children;
    const projLines = proj.split('\n');
    const r0 = this.rowOf(m.code[0]);
    const r1 = this.rowOf(Math.max(m.code[0], m.code[1] - 1));
    const lines = this.lines.map(() => '');
    for (let r = r0; r <= r1; r++) lines[r] = projLines[r] ?? '';
    if (m.kind === 'members') {
      // `@functions {` / `<script runat="server">` row: the class opens there; it closes on the last row.
      lines[r0] = `public partial class ${this.className} { ${r0 === this.rowOf(m.open) ? '' : lines[r0]}`;
      lines[r1] = `${lines[r1]} }`;
    }
    const chunks = await this.provider.parseFileToChunks(lines.join('\n'), 'csharp', { maxChunkSize: this.max });
    return (chunks || []).map((c) => ({
      r0: c.startLine, r1: c.endLine, type: c.type || 'code', name: c.name || null, children: [],
      parentSymbol: c.parentSymbol || null, parentType: c.parentType || null, signature: c.signature || null,
      additionalSymbols: c.additionalSymbols || null, leaf: true,
    }));
  }

  /** JavaScript of a client <script> (its @ expressions blank), by the JavaScript chunker. */
  async scriptParts(unit) {
    const [s, e] = unit.raw;
    const js = this.masked.slice(0, s).replace(/[^\n]/g, ' ') + this.masked.slice(s, e)
      + this.masked.slice(e).replace(/[^\n]/g, ' ');
    const chunks = await this.provider.parseFileToChunks(js, 'javascript', { maxChunkSize: this.max });
    return (chunks || []).map((c) => ({
      r0: c.startLine, r1: c.endLine, type: c.type || 'code', name: c.name || null, children: [],
      parentSymbol: c.parentSymbol || null, parentType: c.parentType || null, signature: c.signature || null,
      additionalSymbols: c.additionalSymbols || null, leaf: true,
    }));
  }

  /** CSS rules of a <style>: each ends where the brace depth returns to 0. */
  styleParts(unit) {
    const [s, e] = unit.raw;
    const parts = [];
    let depth = 0;
    let from = this.rowOf(s);
    for (let i = s; i < e; i++) {
      const c = this.text[i];
      if (c === '{') depth++;
      else if (c === '}' && depth > 0 && --depth === 0) {
        const r = this.rowOf(i);
        if (r >= from) parts.push({ r0: from, r1: r, type: 'style', name: null, children: [] });
        from = r + 1;
      }
    }
    return parts;
  }

  /** The C# statements of a code unit (C# grammar on the projection) and the markup in it. */
  async codeParts(unit) {
    const tree = await this.csharpTree();
    const parts = [];
    if (tree) {
      const node = statementAt(tree.rootNode, unit.cr0, unit.cr1);
      if (node) {
        const collect = (n) => {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i);
            if (isStatement(c)) parts.push({ r0: c.startPosition.row, r1: c.endPosition.row, type: 'code', name: null, children: [] });
            else collect(c);
          }
        };
        collect(node);
      }
    }
    // Markup and blocks inside, nested into the statements that hold them.
    const holder = { r0: unit.r0, r1: unit.r1, children: [] };
    nestRows(holder, [...parts, ...unit.children]);
    return holder.children;
  }

  async projection() {
    if (this._proj === undefined) this._proj = projectToCSharp(this.text, this.filePath, this.scan);
    return this._proj;
  }

  async csharpTree() {
    if (this._tree === undefined) {
      const proj = await this.projection();
      this._tree = proj === null ? null : await this.provider.parse(proj, 'csharp');
    }
    return this._tree;
  }

  // -- chunks -----------------------------------------------------------------------------------

  /** Emit `unit` (rows r0..r1): one chunk when it fits, else its parts, merged while they fit. */
  async emit(unit, parent, depth = 0) {
    if (unit.leaf || this.rows(unit.r0, unit.r1) <= this.max) {
      this.push(unit.r0, unit.r1, [unit], parent);
      return;
    }
    let parts = (await this.partsOf(unit)).filter((p) => p.r0 >= unit.r0 && p.r1 <= unit.r1);
    // One part on all of the unit's rows: its parts are the unit's.
    while (parts.length === 1 && parts[0].r0 === unit.r0 && parts[0].r1 === unit.r1 && !parts[0].leaf) {
      parts = (await this.partsOf(parts[0])).filter((p) => p.r0 >= unit.r0 && p.r1 <= unit.r1);
    }
    if (parts.length === 0 || depth > 64) {
      this.splitLines(unit.r0, unit.r1, unit, parent);
      return;
    }
    const id = this.nextId();
    const info = { chunkId: id, symbol: unit.name, type: unit.type, parent };
    // Groups: parts sharing a row are one group; the rows before a group join it, the rows
    // after the last group join the last one.
    const groups = [];
    for (const p of [...parts].sort((a, b) => a.r0 - b.r0 || b.r1 - a.r1)) {
      const g = groups[groups.length - 1];
      if (g && p.r0 <= g.r1) {
        g.r1 = Math.max(g.r1, p.r1);
        g.units.push(p);
      } else {
        groups.push({ r0: p.r0, r1: p.r1, units: [p], lead: (g ? g.r1 : unit.r0 - 1) + 1 });
      }
    }
    groups[groups.length - 1].tail = unit.r1;
    let acc = null;
    const flush = () => {
      if (acc) this.push(acc.r0, acc.r1, acc.units, info);
      acc = null;
    };
    for (const g of groups) {
      const from = g.lead;
      const to = g.tail ?? g.r1;
      if (this.rows(from, to) <= this.max) {
        if (acc && this.rows(acc.r0, to) <= this.max) {
          acc.r1 = to;
          acc.units.push(...g.units);
        } else {
          flush();
          acc = { r0: from, r1: to, units: [...g.units] };
        }
        continue;
      }
      flush();
      // Too large: the rows around the group (a comment line, a closing tag) join it when they
      // are short, else they split on their own.
      let r0 = g.r0;
      let r1 = g.r1;
      if (from < g.r0) {
        if (this.rows(from, g.r0 - 1) > this.max / 4) this.splitLines(from, g.r0 - 1, null, info);
        else r0 = from;
      }
      const tailBig = to > g.r1 && this.rows(g.r1 + 1, to) > this.max / 4;
      if (to > g.r1 && !tailBig) r1 = to;
      if (g.units.length === 1) {
        const u = g.units[0];
        await this.emit({ ...u, r0, r1 }, info, depth + 1);
      } else {
        // Parts sharing a row (`</div><div>`): each in turn, the shared row with the first.
        let next = r0;
        for (const u of g.units) {
          if (u.r1 < next) continue;
          const last = u === g.units[g.units.length - 1];
          const end = last ? r1 : u.r1;
          await this.emit({ ...u, r0: next, r1: end }, info, depth + 1);
          next = end + 1;
        }
        if (next <= r1) this.push(next, r1, [], info);
      }
      if (tailBig) this.splitLines(g.r1 + 1, to, null, info);
    }
    flush();
  }

  /** A unit with no parts, still too large: at blank lines, else at line ends. */
  splitLines(r0, r1, unit, parent) {
    let start = r0;
    let lastBlank = -1;
    for (let r = r0; r <= r1; r++) {
      if (r > start && this.rows(start, r) > this.max) {
        const cut = lastBlank > start ? lastBlank : r - 1;
        this.push(start, cut, unit ? [unit] : [], parent);
        start = cut + 1;
        lastBlank = -1;
      }
      if (this.lines[r].trim() === '') lastBlank = r;
    }
    if (start <= r1) this.push(start, r1, unit ? [unit] : [], parent);
    this.lineSplits++;
  }

  /**
   * A chunk of a few characters (the `</div>` after a split element) joins its neighbour when
   * the two fit in one chunk.
   */
  mergeSmall() {
    const SMALL = 120;
    const out = [];
    const into = new Map(); // merged chunk id -> the chunk that holds it now
    const text = (c) => this.lines.slice(c.startLine, c.endLine + 1).join('\n').trim();
    for (const c of this.chunks.sort((a, b) => a.startLine - b.startLine)) {
      const prev = out[out.length - 1];
      if (prev && c.text.length < SMALL && this.rows(prev.startLine, c.endLine) <= this.max) {
        prev.endLine = c.endLine;
        prev.text = text(prev);
        into.set(c.chunkId, prev.chunkId);
        continue;
      }
      if (prev && prev.text.length < SMALL && this.rows(prev.startLine, c.endLine) <= this.max) {
        c.startLine = prev.startLine;
        c.text = text(c);
        into.set(prev.chunkId, c.chunkId);
        out[out.length - 1] = c;
        continue;
      }
      out.push(c);
    }
    for (const c of out) if (into.has(c.parentChunkId)) c.parentChunkId = into.get(c.parentChunkId);
    return out;
  }

  push(r0, r1, units, parent) {
    const text = this.lines.slice(r0, r1 + 1).join('\n').trim();
    if (!text) return;
    // The first chunk of a split unit carries the unit's id: its other chunks point to it.
    let chunkId;
    let parentChunkId = parent?.chunkId || null;
    if (parent && !parent.taken) {
      parent.taken = true;
      chunkId = parent.chunkId;
      parentChunkId = parent.parent?.chunkId || null;
    }
    const named = units.filter((u) => u.name);
    const first = units.length === 1 ? units[0] : (named[0] || units[0] || null);
    const others = [...new Set(named.filter((u) => u !== first).map((u) => u.name))];
    const own = units.length === 1 && units[0].parentSymbol;
    this.chunks.push({
      text,
      type: first?.type || parent?.type || 'markup',
      name: first?.name || null,
      startLine: r0,
      endLine: r1,
      chunkId: chunkId || this.nextId(),
      parentChunkId,
      parentSymbol: own ? units[0].parentSymbol : (parent?.symbol || null),
      parentType: own ? units[0].parentType : (parent?.symbol ? parent.type : null),
      signature: units.length === 1 ? units[0].signature || null : null,
      additionalSymbols: others.length ? others : (units.length === 1 ? units[0].additionalSymbols || null : null),
    });
  }

  nextId() {
    return `v${++this.counter}`;
  }
}

// -- helpers ------------------------------------------------------------------------------------

function directiveName(d) {
  const v = String(d.value || '').replace(/;\s*$/, '');
  if (d.name === 'model' || d.name === 'inherits') return v || null;
  if (d.name === 'inject') return v.split(/\s+/).pop() || null;
  if (d.attrs?.inherits) return d.attrs.inherits;
  return null;
}

/** An element's id, else its name or asp-for / asp-action: what a reader calls it. */
function elementName(node) {
  const tag = node.namedChildren.find((c) => c.type === 'start_tag' || c.type === 'self_closing_tag');
  if (!tag) return null;
  const attrs = {};
  for (const a of tag.namedChildren) {
    if (a.type !== 'attribute') continue;
    const name = a.namedChildren.find((c) => c.type === 'attribute_name')?.text;
    const value = a.namedChildren.find((c) => c.type === 'quoted_attribute_value' || c.type === 'attribute_value')?.text;
    if (name && value) attrs[name.toLowerCase()] = value.replace(/^["']|["']$/g, '').trim();
  }
  const v = attrs.id || attrs.name || attrs['asp-for'] || attrs['asp-action'];
  return v && /^[\w.$:-]+$/.test(v) ? v : null;
}

/** Units into a tree by character range (a unit crossing its container is dropped). */
function nest(root, units) {
  const sorted = units.filter((u) => u.e > u.s).sort((a, b) => a.s - b.s || b.e - a.e);
  const stack = [root];
  for (const u of sorted) {
    while (stack.length > 1 && u.s >= stack[stack.length - 1].e) stack.pop();
    const top = stack[stack.length - 1];
    if (u.e > top.e) continue;
    top.children.push(u);
    stack.push(u);
  }
}

/** Row units into a tree by row range (same rule). */
function nestRows(root, units) {
  const sorted = units.filter((u) => u.r1 >= u.r0).sort((a, b) => a.r0 - b.r0 || b.r1 - a.r1);
  const stack = [root];
  for (const u of sorted) {
    while (stack.length > 1 && u.r0 > stack[stack.length - 1].r1) stack.pop();
    const top = stack[stack.length - 1];
    if (u.r1 > top.r1 || u === top) continue;
    if (!top.children) top.children = [];
    top.children.push(u);
    stack.push(u);
  }
}

function toRows(chunker, unit) {
  unit.r0 = chunker.rowOf(unit.s);
  unit.r1 = chunker.rowOf(Math.max(unit.s, unit.e - 1));
  // The unit's own rows (emit may widen r0..r1 by the rows around it).
  unit.cr0 = unit.r0;
  unit.cr1 = unit.r1;
  for (const c of unit.children) toRows(chunker, c);
}

const STATEMENT_HOLDERS = /(_statement|^block|^switch_section|^else_clause|^catch_clause|^finally_clause)$/;

function isStatement(n) {
  return /_statement$/.test(n.type) || n.type === 'switch_section' || n.type === 'local_function_statement';
}

/** The C# block or statement on rows r0..r1 (the projection keeps the view's rows). */
function statementAt(root, r0, r1) {
  let best = null;
  const walk = (n) => {
    if (n.startPosition.row > r1 || n.endPosition.row < r0) return;
    if (n.startPosition.row === r0 && n.endPosition.row === r1 && STATEMENT_HOLDERS.test(n.type)) best = n;
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i));
  };
  walk(root);
  return best;
}
