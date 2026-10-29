/**
 * Chunks of ASP.NET views (core/indexing/chunking/view-chunker.js), through ASTChunker: every
 * line in exactly one chunk, chunks at structural boundaries (elements, Razor blocks, C#
 * members and statements, script functions, CSS rules), never fixed windows.
 */
import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import { GraphExtractor } from '../../core/graph/graph-extractor.js';

const chunker = new ASTChunker({ projectRoot: '/repo' });
const chunk = (file, text) => chunker.parseFile(`/repo/${file}`, text);

function covers(text, chunks) {
  const lines = text.split('\n');
  const seen = new Array(lines.length).fill(0);
  for (const c of chunks) for (let r = c.metadata.line_start - 1; r < c.metadata.line_end; r++) seen[r]++;
  return lines.every((l, r) => (l.trim() ? seen[r] === 1 : seen[r] <= 1));
}

const card = (i) => `    <div class="card" id="card-${i}">
        <h2>@Model.Cards[${i}].Title</h2>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ${i}.</p>
        <ul>
            <li>@Model.Cards[${i}].A</li>
            <li>@Model.Cards[${i}].B</li>
        </ul>
    </div>`;

describe('view chunks', () => {
  it('a small view is one chunk', async () => {
    const text = '@model HomeModel\n<h1>@Model.Title</h1>\n<p>Welcome to the shop.</p>\n';
    const chunks = await chunk('Views/Home/Index.cshtml', text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toMatchObject({ language: 'razor', chunk_type: 'view', line_start: 1, line_end: 3 });
  });

  it('a large element splits at its child elements, every line kept', async () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(i)).join('\n');
    const text = `@model CardsModel\n<section id="cards">\n${cards}\n</section>\n`;
    const chunks = await chunk('Views/Cards.cshtml', text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(covers(text, chunks)).toBe(true);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2000);
    // Each chunk starts at a card (or the file's first line): no card is cut in two.
    for (const c of chunks.slice(1)) expect(c.content.split('\n')[0]).toMatch(/^<div class="card"|^<\/section>/);
    expect(chunks.some((c) => c.metadata.symbol === 'card-0')).toBe(true);
  });

  it('@functions methods and a client script split by the C# and JavaScript grammars', async () => {
    const methods = Array.from({ length: 12 }, (_, i) => `    public string Format${i}(decimal value)
    {
        // formats the value for column ${i}
        var s = value.ToString("N2");
        return s.PadLeft(${10 + i}) + " / " + "${'x'.repeat(40)}";
    }`).join('\n\n');
    const funcs = Array.from({ length: 10 }, (_, i) => `    function render${i}(data) {
        var html = '<span class="v">' + data.value + '</span>';
        $('#target-${i}').html(html).show();
        return '${'y'.repeat(60)}';
    }`).join('\n');
    const text = `@model GridModel\n<div id="grid"></div>\n<script>\n${funcs}\n</script>\n@functions {\n${methods}\n}\n`;
    const chunks = await chunk('Views/Grid.cshtml', text);
    expect(covers(text, chunks)).toBe(true);
    // The class header takes the first methods; the later ones are method chunks of the view class.
    expect(chunks.some((c) => c.metadata.chunk_type === 'class' && c.metadata.symbol === 'Views_Grid_cshtml')).toBe(true);
    const methodChunk = chunks.find((c) => c.metadata.chunk_type === 'method');
    expect(methodChunk.metadata.symbol).toMatch(/^Format\d+$/);
    expect(methodChunk.metadata.parent_symbol).toBe('Views_Grid_cshtml');
    expect(chunks.some((c) => c.metadata.symbol?.startsWith('render'))).toBe(true);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2200);
  });

  it('a large @foreach splits at its C# statements and markup', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `        var cell${i} = item.Cells[${i}] ?? "none-${i}";\n        <td class="c${i}">@cell${i}</td>`).join('\n');
    const text = `@model TableModel\n<table>\n@foreach (var item in Model.Rows)\n{\n    <tr>\n${rows}\n    </tr>\n}\n</table>\n`;
    const chunks = await chunk('Views/Table.cshtml', text);
    expect(covers(text, chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2000);
  });

  it('a CSS brace in a string or comment does not end a rule', async () => {
    const rules = Array.from({ length: 40 }, (_, i) => `    .r${i}::after { content: "}"; /* } */ color: #${String(i).padStart(3, '0')}; margin: ${i}px ${i}px; }`).join('\n');
    const text = `<style>\n${rules}\n</style>\n`;
    const chunks = await chunk('Views/Css.cshtml', text);
    expect(covers(text, chunks)).toBe(true);
    for (const c of chunks) for (const line of c.content.split('\n').slice(1)) expect(line).not.toMatch(/^\s*color:/);
  });

  it('an ASP.NET page chunks its markup and server script', async () => {
    const items = Array.from({ length: 25 }, (_, i) => `  <asp:Panel ID="p${i}" runat="server">\n    <asp:Label ID="l${i}" Text='<%# Eval("Name${i}") %>' runat="server" />\n    <p>Item ${i}: ${'z'.repeat(50)}</p>\n  </asp:Panel>`).join('\n');
    const text = `<%@ Page Language="C#" Inherits="Shop.Catalog" %>\n<form id="f" runat="server">\n${items}\n</form>\n<script runat="server">\n  protected void Page_Load(object s, EventArgs e) { Bind(); }\n</script>\n`;
    const chunks = await chunk('Catalog.aspx', text);
    expect(covers(text, chunks)).toBe(true);
    expect(chunks[0].metadata.language).toBe('aspnet');
    expect(chunks[0].content.startsWith('<%@ Page')).toBe(true);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('view graph', () => {
  it('gives a view its class, members and calls; the render code belongs to the view class', async () => {
    const text = '@model CartModel\n@inject ICartService cartService\n<p>@await cartService.CountAsync(Model.Id)</p>\n'
      + '@functions {\n    string Label() => Totals.Format(1);\n}\n';
    const ex = new GraphExtractor({ projectRoot: '/repo' });
    const r = await ex.extractFromFile('/repo/Views/Cart.cshtml', text);
    expect(r.entities.map((e) => `${e.type} ${e.name}`)).toEqual(['class Views_Cart_cshtml', 'method Label']);
    const count = r.relationships.find((x) => x.target_name === 'cartService.CountAsync');
    const viewClass = r.entities.find((e) => e.name === 'Views_Cart_cshtml');
    expect(viewClass).toMatchObject({ start_line: 1, end_line: 1 });
    expect(count).toMatchObject({ type: 'calls', context_line: 3, source_id: viewClass.id });
    const label = r.entities.find((e) => e.name === 'Label');
    expect(r.relationships.find((x) => x.target_name === 'Totals.Format')?.source_id).toBe(label.id);
  });

  it('keeps the base class with usings, and gives local functions the view class', async () => {
    const text = '@using System.Linq\n@using Shop.Models\n@inherits ShopPage\n@{ void Row(int i) { Format(i); } }\n<p>@Row(1)</p>\n';
    const ex = new GraphExtractor({ projectRoot: '/repo' });
    const r = await ex.extractFromFile('/repo/Pages/Cart.razor', text);
    expect(r.relationships.some((x) => x.type === 'extends' && x.target_name === 'ShopPage')).toBe(true);
    const cls = r.entities.find((e) => e.type === 'class');
    expect(cls).toMatchObject({ name: 'Cart', start_line: 3, end_line: 3 });
    expect(cls.signature).not.toContain('__ViewRender');
    expect(r.entities.find((e) => e.name === 'Row')?.parent_class).toBe('Cart');
    expect(r.relationships.filter((x) => x.type === 'imports').length + (r.relationships.filter((x) => x.full_import_path).length)).toBeGreaterThan(0);
  });

  it('keeps a real member on the header line, and the class id across edits of that line', async () => {
    const ex = new GraphExtractor({ projectRoot: '/repo' });
    const a = await ex.extractFromFile('/repo/C/Counter.razor', '@code { public int Count { get; set; } void __ViewRenderHelper() { } }\n<p>@Foo()</p>\n');
    expect(a.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['Count', '__ViewRenderHelper']));
    const b = await new GraphExtractor({ projectRoot: '/repo' }).extractFromFile('/repo/C/Counter.razor', '@code { public int Count { get; set; } void __ViewRenderHelper() { } }\n<p>@Bar()</p>\n');
    expect(a.entities.find((e) => e.name === 'Counter').id).toBe(b.entities.find((e) => e.name === 'Counter').id);
  });

  it('links a page to its code-behind class and its event handlers', async () => {
    const text = '<%@ Page Language="C#" Inherits="Shop._Default" %>\n<asp:Button ID="b" OnClick="Save_Click" runat="server" />\n';
    const ex = new GraphExtractor({ projectRoot: '/repo' });
    const r = await ex.extractFromFile('/repo/Default.aspx', text);
    expect(r.relationships.some((x) => x.type === 'extends' && x.target_name === 'Shop._Default')).toBe(true);
    const calls = [...r.relationships, ...(r.callSites || [])].filter((x) => (x.target_name || x.callee_name) === 'Save_Click');
    expect(calls.length).toBeGreaterThan(0);
  });
});
