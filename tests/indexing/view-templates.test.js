/**
 * ASP.NET view scanning and the C# projection (core/infrastructure/view-templates.js): the
 * Razor and <% %> transitions, and a projection that keeps every line and parses as C#.
 */
import { describe, it, expect } from 'vitest';
import { projectToCSharp, scanAspNet, scanRazor, viewClassName, viewTemplateKind } from '../../core/infrastructure/view-templates.js';
import { getTreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';

const kinds = (scan) => scan.children.map((c) => c.kind);
const codeOf = (text, node) => text.slice(node.code[0], node.code[1]);

async function parsesClean(csharp) {
  const tree = await getTreeSitterProvider().parse(csharp, 'csharp');
  try { return !tree.rootNode.hasError; } finally { tree.delete(); }
}

const VIEW = `\uFEFF@model OrderListModel
@inject IStoreService storeService
@using Nop.Services.Stores
@{
    var title = $"Orders {Model.Count}"; // "{" in a string
    var path = @"C:\\x}";
    if (title.Length > 2) { <p class="x">@title</p> }
    @Html.Raw(path)
}
<a href="mailto:me@example.com">@@nop</a>
@* @Model.Hidden *@
<h1>@Model.Title.</h1>
@if (Model.Items.Any())
{
    // a comment line
    <ul>
        @foreach (var item in Model.Items)
        {
            <li id="row-@item.Id">@item.Name <text>-</text> @(item.Price * 2)</li>
            @:raw @item.Sku
        }
    </ul>
}
else if (Model.Empty)
{
    <p>@T("Empty")</p>
}
else
{
    @string.Format(T("None").Text, 1)
}
@using (Html.BeginForm()) { <input name="q" /> }
@section Scripts {
    <style> .a { color: red } </style>
    <script>if (a < b) { go('@Model.Id'); }</script>
}
@functions {
    public string Label(int n) => n.ToString();
    void Write() { var o = new { @class = "x" }; }
}
`;

describe('scanRazor', () => {
  it('splits a view into the Razor nodes', () => {
    const scan = scanRazor(VIEW);
    expect(kinds(scan)).toEqual([
      'directive', 'directive', 'directive', 'block', 'escape', 'comment', 'expr', 'control', 'control', 'section', 'members',
    ]);
    const [model, inject, using] = scan.children;
    expect([model.name, model.value]).toEqual(['model', 'OrderListModel']);
    expect([inject.name, inject.value]).toEqual(['inject', 'IStoreService storeService']);
    expect(using.name).toBe('using');
  });

  it('reads C# strings, comments and markup in code blocks', () => {
    const block = scanRazor(VIEW).children[3];
    // The `{` inside the strings and the comment do not end the block early.
    expect(VIEW.slice(block.s, block.e).trim().endsWith('@Html.Raw(path)\n}')).toBe(true);
    const holes = block.holes.map((h) => h.kind);
    expect(holes).toContain('markup'); // <p class="x">@title</p>
    expect(holes).toContain('expr'); // @Html.Raw(path) at a statement start
  });

  it('keeps e-mail addresses and the end of a sentence as text', () => {
    const scan = scanRazor(VIEW);
    const title = scan.children[6];
    expect(codeOf(VIEW, title)).toBe('Model.Title');
    expect(scan.children.some((c) => c.kind === 'expr' && codeOf(VIEW, c).startsWith('example'))).toBe(false);
  });

  it('follows if / else if / else, and markup, @: lines and <text> inside', () => {
    const control = scanRazor(VIEW).children[7];
    expect(control.name).toBe('if');
    expect(VIEW.slice(control.s, control.e)).toMatch(/^@if[\s\S]*@string\.Format\(T\("None"\)\.Text, 1\)\n}$/);
  });

  it('reads @section markup and @functions members', () => {
    const scan = scanRazor(VIEW);
    const section = scan.children.find((c) => c.kind === 'section');
    expect(section.name).toBe('Scripts');
    // The braces in <style> and <script> do not close the section.
    expect(VIEW.slice(section.s, section.e).trim().endsWith('</script>\n}')).toBe(true);
    expect(section.children.some((c) => c.kind === 'expr' && codeOf(VIEW, c) === 'Model.Id')).toBe(true);
    const members = scan.children.find((c) => c.kind === 'members');
    expect(codeOf(VIEW, members)).toContain('public string Label(int n)');
  });

  it('reads Blazor directive attributes and Razor templates', () => {
    const text = '<button @onclick="@(() => Go("x"))" @bind-Value="model.Name" @bind-Value:event="oninput">Go</button>\n'
      + '@code {\n    RenderFragment Row => @<tr><td>@Format(1)</td></tr>;\n}\n';
    const scan = scanRazor(text);
    expect(kinds(scan)).toEqual(['handler', 'expr', 'comment', 'members']);
    expect(codeOf(text, scan.children[0])).toBe('(() => Go("x"))');
    expect(codeOf(text, scan.children[1])).toBe('model.Name');
    expect(scan.children[3].holes[0].template).toBe(true);
  });
});

describe('projectToCSharp (Razor)', () => {
  it('keeps every line and parses as C#', async () => {
    const cs = projectToCSharp(VIEW, 'Views/Order/List.cshtml');
    expect(cs.split('\n').length).toBe(VIEW.split('\n').length);
    expect(await parsesClean(cs)).toBe(true);
  });

  it('gives the view class its directives and writes expressions as statements', () => {
    const cs = projectToCSharp(VIEW, 'Views/Order/List.cshtml');
    const lines = cs.split('\n');
    // One using per line, then the class at a line start (the extractor reads them so).
    expect(lines[0]).toBe('using Nop.Services.Stores;');
    expect(lines[1]).toMatch(/^public partial class Order_List_cshtml \{ public OrderListModel Model; public IStoreService storeService;/);
    expect(lines[11]).toContain('_ = (Model.Title);');
    expect(lines.some((l) => l.includes('<h1>') || l.includes('mailto'))).toBe(false);
    expect(cs).toContain('__ViewSection("Scripts", async () => {');
    expect(cs).toContain('public string Label(int n) => n.ToString();');
  });

  it('projects a Blazor component with @inherits, @typeparam and templates', async () => {
    const text = '@inherits MudComponentBase;\n@typeparam T\n<div @onclick="Toggle">@ChildContent</div>\n'
      + '@code {\n    RenderFragment Row => @<tr><td>@Format(1)</td></tr>;\n    void Toggle() { }\n}\n';
    const cs = projectToCSharp(text, 'Components/MudCard.razor');
    expect(cs).toContain('public partial class MudCard<T> : MudComponentBase {');
    expect(cs).toContain('Toggle(default, default);');
    expect(cs).toContain('RenderFragment Row => (__builder) => {');
    expect(cs).toContain('_ = (Format(1));');
    expect(await parsesClean(cs)).toBe(true);
  });
});

describe('ASP.NET pages', () => {
  const PAGE = `<%@ Page Language="C#" Inherits="Shop._Default" CodeBehind="Default.aspx.cs" %>
<%@ Import Namespace="Shop.Models" %>
<%-- a server comment <% x %> --%>
<asp:Repeater ID="r" runat="server">
  <ItemTemplate><img src='<%#: Item.Picture %>' /></ItemTemplate>
</asp:Repeater>
<asp:Button ID="b" Text='<%$ Resources:Save %>' OnClick="Save_Click" runat="server" />
<% if (User.IsAdmin) { %>
  <p><%= Html.Encode(User.Name) %> <%: DateTime.Now %></p>
<% } %>
<script runat="server">
  protected void Page_Load(object sender, EventArgs e) { Bind(); }
</script>
`;

  it('splits a page into directives, nuggets, expressions, handlers and server script', () => {
    const scan = scanAspNet(PAGE, 'Default.aspx');
    expect(kinds(scan)).toEqual(['directive', 'directive', 'comment', 'expr', 'comment', 'handler', 'nugget', 'expr', 'expr', 'nugget', 'members']);
    expect(scan.children[0].attrs).toMatchObject({ language: 'C#', inherits: 'Shop._Default' });
    expect(codeOf(PAGE, scan.children[3])).toBe(' Item.Picture ');
    expect(codeOf(PAGE, scan.children[5])).toBe('Save_Click');
  });

  it('projects the page class, its code across nuggets and its handlers', async () => {
    const cs = projectToCSharp(PAGE, 'Default.aspx');
    expect(cs.split('\n').length).toBe(PAGE.split('\n').length);
    expect(cs.split('\n')[0]).toBe('using Shop.Models;');
    expect(cs.split('\n')[1]).toMatch(/^public partial class Default_aspx : Shop\._Default \{/);
    expect(cs).toContain('Save_Click(default, default);');
    expect(cs).toMatch(/if \(User\.IsAdmin\) \{[\s\S]*_ = \( Html\.Encode\(User\.Name\) \);[\s\S]*\}/);
    expect(cs).toContain('protected void Page_Load(object sender, EventArgs e) { Bind(); }');
    expect(await parsesClean(cs)).toBe(true);
  });

  it('reads a .ashx body as C#, and leaves a VB page without a projection', async () => {
    const handler = '<%@ WebHandler Language="C#" Class="Ping" %>\nusing System.Web;\npublic class Ping : IHttpHandler { public void ProcessRequest(HttpContext c) { } public bool IsReusable => true; }\n';
    const cs = projectToCSharp(handler, 'Ping.ashx');
    expect(cs.split('\n')[1]).toBe('using System.Web;');
    expect(await parsesClean(cs)).toBe(true);
    expect(projectToCSharp('<%@ Page Language="VB" %>\n<% Dim x = 1 %>\n', 'Old.aspx')).toBeNull();
  });
});

describe('review fixes', () => {
  const lines = (s) => s.split('\n').length;

  it('reads comments after directives, newlines in handler values, and verbatim quotes', async () => {
    const a = '@inherits OwningComponentBase // scoped\n@using System.Text /* why */\n<p>@Name</p>\n';
    const cs = projectToCSharp(a, 'C/A.razor');
    expect(cs).toContain('public partial class A : OwningComponentBase {');
    expect(await parsesClean(cs)).toBe(true);
    const b = '<button @onclick="\n    Toggle\n">x</button>\n<p>@Name</p>\n';
    expect(lines(projectToCSharp(b, 'C/B.razor'))).toBe(lines(b));
    const c = '@{ var q = @"""" ; }\n<p>@Name</p>\n';
    expect(projectToCSharp(c, 'V/C.cshtml').split('\n')[1]).toContain('_ = (Name);');
  });

  it('follows Razor on e-mail text, @model in components, and @x- in a value', () => {
    expect(scanRazor('<i id="item_@Model.Id">').children.map((n) => n.kind)).toEqual(['expr']);
    expect(scanRazor('a@b.com').children).toEqual([]);
    expect(scanRazor('@model.Name\n').children[0].kind).toBe('expr');
    const t = '<label for="@id-input" title="@storeName: News">';
    expect(scanRazor(t).children.map((n) => codeOf(t, n))).toEqual(['id', 'storeName']);
  });

  it('reads @bind modifiers, component event parameters and asp-items as C#', () => {
    const t = '<input @bind="v" @bind:event="oninput" @bind:after="Save" />\n<MudButton OnClick="Submit" Label="Go" />\n<select asp-items="Model.Stores"></select>\n';
    const kinds = scanRazor(t).children.map((n) => `${n.kind}:${n.code ? codeOf(t, n) : ''}`);
    expect(kinds).toEqual(expect.arrayContaining(['handler:Save', 'handler:Submit', 'expr:Model.Stores']));
    expect(kinds.some((k) => k.endsWith(':oninput'))).toBe(false);
  });

  it('reads @await foreach, and ends a file whose last line is a comment', async () => {
    const t = '@await foreach (var x in Items) { <p>@x</p> }\n<% // last';
    expect(scanRazor(t).children[0]).toMatchObject({ kind: 'control', name: 'foreach' });
    const cs = projectToCSharp('<% Bind(); // last', 'P/Last.aspx');
    expect(await parsesClean(cs)).toBe(true);
  });

  it('reads lowercase and data-method handlers on server controls, not client ones', () => {
    const t = '<asp:Button onclick="Go" OnClientClick="check()" runat="server" />\n<asp:GridView SelectMethod="GetItems" runat="server" />\n';
    expect(scanAspNet(t, 'P/x.aspx').children.filter((n) => n.kind === 'handler').map((n) => codeOf(t, n))).toEqual(['Go', 'GetItems']);
    expect(projectToCSharp('<%@ Language="VB" %>\n<% Dim x = 1 %>\n', 'P/Old.aspx')).toBeNull();
  });

  it('keeps verbatim identifiers in code and exact raw-text end tags', async () => {
    const a = '@{\n    int @class = 0;\n    @class++;\n}\n<p>x</p>\n';
    const cs = projectToCSharp(a, 'V/A.cshtml');
    expect(cs).toContain('@class++;');
    expect(await parsesClean(cs)).toBe(true);
    const b = '@section Scripts {\n<script>\nconst t = "</scripture>}";\nGo();\n</script>\n}\n<p>@After</p>\n';
    const section = scanRazor(b).children.find((n) => n.kind === 'section');
    expect(b.slice(section.s, section.e).trim().endsWith('</script>\n}')).toBe(true);
  });

  it('projects @namespace, @attribute and typeparam constraints', async () => {
    const t = '@namespace Shop.Admin\n@attribute [Authorize]\n@typeparam T where T : IEntity\n<p>@Item</p>\n';
    const cs = projectToCSharp(t, 'C/Grid.razor');
    expect(cs).toContain('namespace Shop.Admin;');
    expect(cs).toMatch(/\[Authorize\] public partial class Grid<T> where T : IEntity \{/);
    expect(await parsesClean(cs)).toBe(true);
  });

  it('stays fast on unclosed constructs', () => {
    const t0 = performance.now();
    scanRazor('@if (\n'.repeat(20000));
    scanRazor(`<!-- ${'@{ x '.repeat(5000)} -->`);
    scanAspNet(`<%@ ${'w'.repeat(100000)}`, 'P/x.aspx');
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('names', () => {
  it('maps the view extensions and class names', () => {
    expect(['a.cshtml', 'B.razor', 'c.aspx', 'Site.Master', 'x.ashx'].map(viewTemplateKind)).toEqual(['razor', 'razor', 'aspnet', 'aspnet', 'aspnet']);
    expect(viewTemplateKind('x.cs')).toBeNull();
    // By folder (two Default.aspx stay apart); a Blazor component by its file name.
    expect([viewClassName('Views/_Layout.cshtml'), viewClassName('Components/Counter.razor'), viewClassName('Shop/Site.Master'), viewClassName('Admin/Default.aspx')])
      .toEqual(['Views__Layout_cshtml', 'Counter', 'Shop_Site_Master', 'Admin_Default_aspx']);
  });
});
