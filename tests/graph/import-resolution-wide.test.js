/**
 * Wider import coverage: scanners and resolvers for C#, Swift, Elixir, Lua,
 * Zig, Haskell, Clojure, Solidity, shell, stylesheets, protobuf, Terraform,
 * Julia, Elm, Perl, R, PowerShell, Erlang, Crystal and single-file
 * components; tsconfig rootDirs, SvelteKit `$lib`, Rust `#[path]`; and the
 * implicit (namespace / package / module) references of
 * core/graph/import-symbol-index.js.
 *
 * Fixture trees are written to a temp dir so config and declaration reads
 * exercise the real loader.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanImports, importLanguageFor } from '../../core/graph/import-scanner.js';
import { createImportResolver, UNRESOLVED_IMPORT_PREFIX } from '../../core/graph/import-resolver.js';
import {
  stripNoise, csharpDeclarations, braceDeclarations, referencedNames, elixirModules,
} from '../../core/graph/import-symbol-index.js';
import { GraphExtractor } from '../../core/graph/graph-extractor.js';

const specs = (content, lang) => scanImports(content, lang).map((i) => i.spec);

function writeTree(root, tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return Object.keys(tree);
}

// =============================================================================
// SCANNERS
// =============================================================================

describe('scanImports — wider languages', () => {
  it('single-file components: <script> blocks and Astro frontmatter, with file lines', () => {
    expect(importLanguageFor('src/App.vue', 'html')).toBe('sfc');
    expect(importLanguageFor('src/Page.astro', 'html')).toBe('sfc');
    expect(importLanguageFor('index.html', 'html')).toBe('html');
    const vue = '<template>\n  <div/>\n</template>\n<script setup lang="ts">\nimport Foo from "./Foo.vue";\nimport { x } from "@/lib/x";\n</script>';
    const imps = scanImports(vue, 'sfc');
    expect(imps.map((i) => [i.spec, i.line])).toEqual([['./Foo.vue', 5], ['@/lib/x', 6]]);
    const astro = '---\nimport Layout from "../layouts/Layout.astro";\nconst t = 1;\n---\n<Layout/>';
    expect(scanImports(astro, 'sfc').map((i) => [i.spec, i.line])).toEqual([['../layouts/Layout.astro', 2]]);
  });

  it('stylesheets: @use / @forward / @import lists / url(), builtins and comments skipped', () => {
    const scss = '@use "sass:math";\n@use "../utilities/mixins" as mx;\n@forward "form";\n// @use "commented";\n/* @import "block"; */\n@import "a", "b";\n@import url("theme.css");';
    expect(scanImports(scss, 'scss').map((i) => [i.spec, i.kind])).toEqual([
      ['../utilities/mixins', 'style-sass'], ['form', 'style-sass'], ['a', 'style-sass'], ['b', 'style-sass'], ['theme.css', 'style-url'],
    ]);
    expect(scanImports('@import (reference) "vars";', 'less').map((i) => [i.spec, i.kind])).toEqual([['vars', 'style-less']]);
    expect(specs('@import "https://fonts.googleapis.com/x";\n@import "base.css" screen;', 'css')).toEqual(['base.css']);
  });

  it('C#: using kinds; using statements and declarations are not imports', () => {
    const src = 'global using Ocelot.Errors;\nusing System.Text;\nusing static Ocelot.Util.Helpers;\nusing Json = Newtonsoft.Json.Linq.JObject;\nusing global::Foo.Bar;\nclass X { void M() { using var s = Open(); using (var t = Open()) { } } }';
    expect(scanImports(src, 'csharp').map((i) => [i.spec, i.kind])).toEqual([
      ['Ocelot.Errors', 'cs-global'], ['System.Text', 'cs-namespace'], ['Ocelot.Util.Helpers', 'cs-static'],
      ['Newtonsoft.Json.Linq.JObject', 'cs-alias'], ['Foo.Bar', 'cs-namespace'],
    ]);
    expect(scanImports(src, 'csharp')[3].names).toEqual(['Json']);
  });

  it('Swift: plain, @testable and kind-qualified imports name the module', () => {
    expect(specs('import Foundation\n@testable import GRDB\nimport struct Core.Point\n// import Nope', 'swift'))
      .toEqual(['Foundation', 'GRDB', 'Core']);
  });

  it('Elixir: alias / multi-alias / as: / import / require / use', () => {
    const src = 'defmodule A do\n  alias Jason.{Codegen,\n    Fragment}\n  alias MyApp.Repo, as: R\n  import Ecto.Query\n  use GenServer\n  require Logger\nend';
    const imps = scanImports(src, 'elixir');
    expect(imps.map((i) => i.spec)).toEqual(['Jason.Codegen', 'Jason.Fragment', 'MyApp.Repo', 'Ecto.Query', 'GenServer', 'Logger']);
    expect(imps[2].names).toEqual(['R']);
    expect(imps[1].names).toEqual(['Fragment']);
  });

  it('Lua, Zig, Haskell, Clojure', () => {
    expect(specs('local a = require "pl.utils"\nlocal b = require("x.y") -- require "no"\n--[[\nrequire "dead"\n]]\nrequire(\'z\')', 'lua'))
      .toEqual(['pl.utils', 'x.y', 'z']);
    expect(specs('const std = @import("std");\nconst p = @import("params.zig").Params;\n// @import("no.zig")', 'zig'))
      .toEqual(['std', 'params.zig']);
    expect(specs('{- import Not.This -}\nimport qualified Data.Map as M\nimport {-# SOURCE #-} A.B\nimport "pkg" C.D (x)\nimport E.F qualified as G', 'haskell'))
      .toEqual(['Data.Map', 'A.B', 'C.D', 'E.F']);
    const clj = '(ns app.core\n  "doc"\n  (:require [clojure.string :as str]\n            app.util\n            (app.db [query :as q] conn))\n  (:import [java.util Date]))\n(require \'[app.late :as late])';
    expect(specs(clj, 'clojure')).toEqual(['clojure.string', 'app.util', 'app.db.query', 'app.db.conn', 'app.late']);
  });

  it('Solidity, shell, proto, Terraform', () => {
    expect(specs('import "./A.sol";\nimport {B,\n  C as D} from "../B.sol";\nimport * as E from "forge-std/Test.sol";\nimport "x.sol" as X;', 'solidity'))
      .toEqual(['./A.sol', '../B.sol', 'forge-std/Test.sol', 'x.sol']);
    const sh = [
      'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'source "$DIR/lib/common.sh"',
      '. "$(dirname "$0")/env.sh"',
      'source ./local.sh',
      'source "$HOME/.bashrc"',
      'source "$BATS_ROOT/x.bash"',
      '# source ./commented.sh',
      'if true; then . ./cond.sh; fi',
    ].join('\n');
    expect(scanImports(sh, 'shell').map((i) => [i.spec, i.kind])).toEqual([
      ['lib/common.sh', 'sh-scriptdir'], ['env.sh', 'sh-scriptdir'], ['./local.sh', 'sh-literal'], ['./cond.sh', 'sh-literal'],
    ]);
    expect(specs('syntax = "proto3";\nimport "google/api/http.proto";\nimport public "a/b.proto";', 'proto'))
      .toEqual(['google/api/http.proto', 'a/b.proto']);
    const tf = 'module "vpc" {\n  source = "../../modules/vpc"\n  name = "x"\n}\nmodule "reg" {\n  source  = "terraform-aws-modules/vpc/aws"\n}';
    expect(scanImports(tf, 'hcl').map((i) => [i.spec, i.line])).toEqual([['../../modules/vpc', 2]]);
  });

  it('Julia, Elm, Perl, R, PowerShell, Erlang, Crystal, Rust #[path]', () => {
    expect(specs('include("tables.jl")  # x', 'julia')).toEqual(['tables.jl']);
    expect(specs('module Page exposing (..)\nimport Api.Endpoint as Endpoint\nimport Html', 'elm')).toEqual(['Api.Endpoint', 'Html']);
    expect(specs('use strict;\nuse PPI::Token ();\nuse parent qw(Base::One Base::Two);\nrequire "helper.pl";\n=pod\nuse Not::This;\n=cut\n', 'perl'))
      .toEqual(['PPI::Token', 'Base::One', 'Base::Two', 'helper.pl']);
    expect(specs('source("R/utils.R")\nlibrary(dplyr)', 'r')).toEqual(['R/utils.R']);
    expect(specs('. $PSScriptRoot\\Private\\Helpers.ps1\nImport-Module "$PSScriptRoot/Mod.psm1"\nusing module .\\Types.psm1', 'powershell'))
      .toEqual(['Private/Helpers.ps1', 'Mod.psm1', './Types.psm1']);
    expect(scanImports('-include("cowboy.hrl").\n-include_lib("kernel/include/file.hrl").', 'erlang').map((i) => i.kind))
      .toEqual(['erl-include', 'erl-include-lib']);
    expect(specs('require "./kemal/*"\nrequire "./config"\nrequire "http"', 'crystal')).toEqual(['./kemal/*', './config', 'http']);
    const rs = '#[path = "platform/unix.rs"]\n#[cfg(unix)]\nmod platform;\nmod plain;';
    expect(scanImports(rs, 'rust').map((i) => [i.spec, i.kind])).toEqual([['platform/unix.rs', 'mod-path'], ['plain', 'mod']]);
  });
});

// =============================================================================
// DECLARATION / REFERENCE EXTRACTION
// =============================================================================

describe('import-symbol-index', () => {
  it('C#: block and file-scoped namespaces, top-level types only, delegates, global usings', () => {
    const src = 'global using My.Shared;\nnamespace A.B {\n  public partial class Foo<T> where T : class {\n    class Nested {}\n  }\n  public delegate void Handler(object s);\n  namespace C { internal record struct Pt(int X); }\n}\n';
    const d = csharpDeclarations(stripNoise(src, 'csharp'));
    expect(d.namespaces).toEqual(['A.B', 'A.B.C']);
    expect(d.types).toEqual([{ ns: 'A.B', name: 'Foo' }, { ns: 'A.B', name: 'Handler' }, { ns: 'A.B.C', name: 'Pt' }]);
    expect(d.globalUsings).toEqual(['My.Shared']);
    const fileScoped = csharpDeclarations(stripNoise('namespace X.Y;\n// class Commented {}\nvar s = "class InString {}";\npublic sealed class Real {}', 'csharp'));
    expect(fileScoped.types).toEqual([{ ns: 'X.Y', name: 'Real' }]);
  });

  it('brace languages: column-0 top-level declarations, packages, Kotlin funs, constants', () => {
    const kt = 'package okhttp3.internal\n\nimport okhttp3.Headers\n\n@JvmName("x")\ninternal fun Headers.commonEquals(other: Any?): Boolean = true\nfun <T> readFieldOrNull(o: Any): T? = null\nconst val MAX_SIZE = 10\nval lowerProp = 1\nenum class Mode { A }\nclass Box {\n  fun inner() {}\n  class Deep\n}\n';
    const d = braceDeclarations(stripNoise(kt, 'kotlin'));
    expect(d.packages).toEqual(['okhttp3.internal']);
    expect(d.decls).toEqual([
      { name: 'commonEquals', kind: 'func' }, { name: 'readFieldOrNull', kind: 'func' },
      { name: 'MAX_SIZE', kind: 'type' }, { name: 'Mode', kind: 'type' }, { name: 'Box', kind: 'type' },
    ]);
    const scala = 'package a\npackage b\n\ncase class P(x: Int)\nobject Util {\n  def f = 1\n}\ndef top(): Int = 1\n';
    expect(braceDeclarations(stripNoise(scala, 'scala'))).toEqual({
      packages: ['a', 'b'],
      decls: [{ name: 'P', kind: 'type' }, { name: 'Util', kind: 'type' }, { name: 'top', kind: 'func' }],
    });
    const swift = '#if os(iOS)\nimport UIKit\n#endif\n@MainActor public final class View {}\nextension View {}\nfunc helper() {}\nprotocol P {}\n';
    expect(braceDeclarations(stripNoise(swift, 'swift')).decls.map((x) => x.name)).toEqual(['View', 'helper', 'P']);
  });

  it('references: member accesses, comments, strings, directives and own declarations excluded', () => {
    const src = 'using A.Thing;\nclass Mine : Base {\n  // Commented ref\n  string s = "Quoted";\n  Helper h = x.Member;\n  void M() { call(); this.other(); }\n}';
    const { types, calls } = referencedNames(stripNoise(src, 'csharp'), { calls: true, capitalizedMethods: true });
    expect([...types.keys()].sort()).toEqual(['Base', 'Helper']);
    expect([...calls.keys()]).toEqual(['call']);
    // C# method names are not type references; constructors and attributes are.
    const cs = 'class A {\n  void Run() { Process(); var o = new Order(1); }\n  [Audited(1)] int x;\n}';
    expect([...referencedNames(stripNoise(cs, 'csharp'), { capitalizedMethods: true }).types.keys()].sort()).toEqual(['Audited', 'Order']);
  });

  it('Elixir: nested defmodule names by indentation', () => {
    const src = 'defmodule Jason.Encode do\n  defmodule Inner do\n  end\nend\ndefprotocol Jason.Encoder do\nend\n';
    expect(elixirModules(stripNoise(src, 'elixir'))).toEqual(['Jason.Encode', 'Jason.Encode.Inner', 'Jason.Encoder']);
  });
});

// =============================================================================
// RESOLVER — path-based languages
// =============================================================================

describe('createImportResolver — wider languages', () => {
  let root;
  let r;
  const res = (from, spec, lang, kind = 'import', names) => r.resolve(from, { spec, kind, names }, lang);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-imports-wide-'));
    const files = writeTree(root, {
      // stylesheets
      'styles/main.scss': '',
      'styles/_vars.scss': '',
      'styles/form/_index.scss': '',
      'styles/theme.css': '',
      'styles/base.less': '',
      // Lua: conventional root, lua/ root, init.lua, rockspec map
      'lua/pl/utils.lua': '',
      'lua/pl/init.lua': '',
      'src/net/core.lua': '',
      'mylib-1.0-1.rockspec': 'build = { type = "builtin", modules = { ["mylib.net"] = "src/net/core.lua" } }',
      'game/main.lua': '',
      'game/player.lua': '',
      // Zig
      'zig/build.zig': 'const mod = b.addModule("httpz", .{ .root_source_file = b.path("src/httpz.zig") });\nconst m2 = b.createModule(.{ .root_source_file = b.path("src/metrics.zig") });\nexe.root_module.addImport("metrics", m2);',
      'zig/src/httpz.zig': '',
      'zig/src/metrics.zig': '',
      'zig/src/params.zig': '',
      'zig/src/main.zig': '',
      // Haskell
      'hs/package.yaml': 'name: x\nlibrary:\n  source-dirs: src\ntests:\n  spec:\n    source-dirs: test\n',
      'hs/src/Text/Doc.hs': 'module Text.Doc where',
      'hs/src/Text/Doc/Parser.hs': 'module Text.Doc.Parser (parse) where',
      'hs/test/Spec.hs': '',
      // Clojure
      'clj/deps.edn': '{:paths ["src" "resources"] :aliases {:test {:extra-paths ["test"]}}}',
      'clj/src/app/core.clj': '(ns app.core)',
      'clj/src/app/db_util.cljc': '(ns ^:no-doc app.db-util)',
      'clj/test/app/core_test.clj': '',
      // Solidity
      'sol/foundry.toml': '[profile.default]\nremappings = [\n  "@oz/=lib/openzeppelin-contracts/contracts/",\n]\n',
      'sol/src/tokens/ERC20.sol': '',
      'sol/src/test/T.t.sol': '',
      'sol/lib/openzeppelin-contracts/contracts/access/Ownable.sol': '',
      'sol/lib/forge-std/src/Test.sol': '',
      // proto
      'proto/google/api/http.proto': '',
      'proto/google/api/annotations.proto': '',
      // Terraform
      'tf/modules/vpc/main.tf': '',
      'tf/examples/complete/main.tf': '',
      // shell
      'scripts/run.sh': '',
      'scripts/lib/common.sh': '',
      'tools/setup.sh': '',
      // Elm / Perl / Erlang / Crystal / Julia / PowerShell / R
      'elm/elm.json': '{ "source-directories": ["src"] }',
      'elm/src/Api/Endpoint.elm': '',
      'elm/src/Main.elm': '',
      'perl/lib/PPI/Token.pm': 'package PPI::Token;\n1;',
      'perl/lib/PPI.pm': 'package PPI;\n1;',
      'erl/src/cowboy_http.erl': '',
      'erl/src/cowboy.hrl': '',
      'erl/include/shared.hrl': '',
      'cr/src/kemal.cr': '',
      'cr/src/kemal/config.cr': '',
      'cr/src/kemal/router/router.cr': '',
      'jl/src/CSV.jl': '',
      'jl/src/tables.jl': '',
      'ps/Mod.psm1': '',
      'ps/Private/Helpers.ps1': '',
      'r/analysis.R': '',
      'r/R/utils.R': '',
      // Rust #[path]
      'rs/src/lib.rs': '',
      'rs/src/platform/unix.rs': '',
      // tsconfig rootDirs + SvelteKit $lib
      'ts/tsconfig.json': '{ "compilerOptions": { "rootDirs": ["src", "generated"] } }',
      'ts/package.json': '{ "name": "ts" }',
      'ts/src/views/page.ts': '',
      'ts/generated/views/page.schema.ts': '',
      'kit/package.json': '{ "name": "kit" }',
      'kit/svelte.config.js': 'export default {};',
      'kit/src/lib/api.js': '',
      'kit/src/routes/+page.svelte': '',
    });
    r = createImportResolver({ projectRoot: root, files });
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('Sass: partials, folder _index, plain css; Less adds .less; url() is literal', () => {
    expect(res('styles/main.scss', 'vars', 'scss', 'style-sass')).toBe('styles/_vars.scss');
    expect(res('styles/main.scss', 'form', 'scss', 'style-sass')).toBe('styles/form/_index.scss');
    expect(res('styles/main.scss', 'theme', 'scss', 'style-sass')).toBe('styles/theme.css');
    expect(res('styles/main.scss', 'missing', 'scss', 'style-sass')).toBeNull();
    expect(res('styles/x.less', 'base', 'less', 'style-less')).toBe('styles/base.less');
    expect(res('styles/x.css', 'theme.css', 'css', 'style-url')).toBe('styles/theme.css');
  });

  it('Lua: conventional roots, init.lua, rockspec modules, a nested project dir; stdlib stays unresolved', () => {
    expect(res('lua/pl/data.lua', 'pl.utils', 'lua')).toBe('lua/pl/utils.lua');
    expect(res('tests/t.lua', 'pl', 'lua')).toBe('lua/pl/init.lua');
    expect(res('x.lua', 'mylib.net', 'lua')).toBe('src/net/core.lua');
    expect(res('game/main.lua', 'player', 'lua')).toBe('game/player.lua');
    expect(res('game/main.lua', 'string', 'lua')).toBeNull();
  });

  it('Zig: relative files and build.zig modules; std is a builtin', () => {
    expect(res('zig/src/main.zig', 'params.zig', 'zig')).toBe('zig/src/params.zig');
    expect(res('zig/src/main.zig', 'httpz', 'zig')).toBe('zig/src/httpz.zig');
    expect(res('zig/src/main.zig', 'metrics', 'zig')).toBe('zig/src/metrics.zig');
    expect(res('zig/src/main.zig', 'std', 'zig')).toBeNull();
  });

  it('Haskell: package source-dirs; base modules stay unresolved', () => {
    expect(res('hs/src/Text/Doc.hs', 'Text.Doc.Parser', 'haskell')).toBe('hs/src/Text/Doc/Parser.hs');
    expect(res('hs/test/Spec.hs', 'Text.Doc', 'haskell')).toBe('hs/src/Text/Doc.hs');
    expect(res('hs/test/Spec.hs', 'Data.Map', 'haskell')).toBeNull();
  });

  it('Clojure: deps.edn paths, dash to underscore, .cljc; clojure.* stays unresolved', () => {
    expect(res('clj/test/app/core_test.clj', 'app.core', 'clojure')).toBe('clj/src/app/core.clj');
    expect(res('clj/src/app/core.clj', 'app.db-util', 'clojure')).toBe('clj/src/app/db_util.cljc');
    expect(res('clj/src/app/core.clj', 'clojure.string', 'clojure')).toBeNull();
  });

  it('Solidity: relative, foundry remappings, lib/<dep>/src auto-remap', () => {
    expect(res('sol/src/test/T.t.sol', '../tokens/ERC20.sol', 'solidity')).toBe('sol/src/tokens/ERC20.sol');
    expect(res('sol/src/test/T.t.sol', '@oz/access/Ownable.sol', 'solidity')).toBe('sol/lib/openzeppelin-contracts/contracts/access/Ownable.sol');
    expect(res('sol/src/test/T.t.sol', 'forge-std/Test.sol', 'solidity')).toBe('sol/lib/forge-std/src/Test.sol');
    expect(res('sol/src/test/T.t.sol', 'solady/Missing.sol', 'solidity')).toBeNull();
  });

  it('proto roots; Terraform module dirs; shell script-dir and literal paths', () => {
    expect(res('proto/google/api/annotations.proto', 'google/api/http.proto', 'proto')).toBe('proto/google/api/http.proto');
    expect(res('proto/google/api/annotations.proto', 'google/protobuf/descriptor.proto', 'proto')).toBeNull();
    expect(res('tf/examples/complete/main.tf', '../../modules/vpc', 'hcl')).toBe('tf/modules/vpc/');
    expect(res('scripts/run.sh', 'lib/common.sh', 'shell', 'sh-scriptdir')).toBe('scripts/lib/common.sh');
    expect(res('scripts/run.sh', 'tools/setup.sh', 'shell', 'sh-literal')).toBe('tools/setup.sh');
    expect(res('scripts/run.sh', '/etc/profile', 'shell', 'sh-literal')).toBeNull();
  });

  it('Elm, Perl, Erlang, Crystal, Julia, PowerShell, R', () => {
    expect(res('elm/src/Main.elm', 'Api.Endpoint', 'elm')).toBe('elm/src/Api/Endpoint.elm');
    expect(res('elm/src/Main.elm', 'Html', 'elm')).toBeNull();
    expect(res('perl/lib/PPI.pm', 'PPI::Token', 'perl', 'perl-module')).toBe('perl/lib/PPI/Token.pm');
    expect(res('perl/lib/PPI.pm', 'Carp', 'perl', 'perl-module')).toBeNull();
    expect(res('erl/src/cowboy_http.erl', 'cowboy.hrl', 'erlang', 'erl-include')).toBe('erl/src/cowboy.hrl');
    expect(res('erl/src/cowboy_http.erl', 'shared.hrl', 'erlang', 'erl-include')).toBe('erl/include/shared.hrl');
    expect(res('cr/src/kemal.cr', './kemal/config', 'crystal')).toBe('cr/src/kemal/config.cr');
    expect(res('cr/src/kemal.cr', './kemal/*', 'crystal')).toBeNull();
    expect(res('jl/src/CSV.jl', 'tables.jl', 'julia')).toBe('jl/src/tables.jl');
    expect(res('ps/Mod.psm1', 'Private/Helpers.ps1', 'powershell', 'ps-scriptdir')).toBe('ps/Private/Helpers.ps1');
    expect(res('r/analysis.R', 'R/utils.R', 'r')).toBe('r/R/utils.R');
  });

  it('Rust #[path] is relative to the file directory; tsconfig rootDirs; SvelteKit $lib', () => {
    expect(res('rs/src/lib.rs', 'platform/unix.rs', 'rust', 'mod-path')).toBe('rs/src/platform/unix.rs');
    expect(res('ts/src/views/page.ts', './page.schema', 'typescript')).toBe('ts/generated/views/page.schema.ts');
    expect(res('kit/src/routes/+page.svelte', '$lib/api.js', 'sfc')).toBe('kit/src/lib/api.js');
    expect(res('ts/src/views/page.ts', '$lib/api.js', 'typescript')).toBeNull();
  });
});

// =============================================================================
// RESOLVER — implicit namespace / package / module references
// =============================================================================

describe('implicitImports', () => {
  let root;
  let r;
  let tree;
  const implicit = (file) => r.implicitImports(file, tree[file], languageOf(file), scanImports(tree[file], languageOf(file)))
    .map((e) => [e.target, e.spec]);
  const languageOf = (f) => ({ '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin', '.scala': 'scala', '.swift': 'swift', '.ex': 'elixir', '.exs': 'elixir' })[path.extname(f)];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-imports-implicit-'));
    tree = {
      // ---- C# ----
      'cs/App/App.csproj': '<Project/>',
      'cs/App/GlobalUsings.cs': 'global using Shop.Common;\n',
      'cs/App/Orders/OrderService.cs': [
        'using Shop.Payments;',
        'using Shop.Shipping;',
        'using Pay = Shop.Payments.Gateway;',
        'namespace Shop.Orders.Services;',
        '// Invoice in a comment, "Invoice" in a string',
        'public class OrderService : BaseService {',
        '  private Order _order; private Money _money; private Guard _g;',
        '  private Clock _clock; private Pay _pay; private Address _a;',
        '  [Audited] public void Run() { var s = _order.Status; Ambiguous a = null; }',
        '}',
      ].join('\n'),
      'cs/App/Orders/Order.cs': 'namespace Shop.Orders.Services { public class Order { public class Status {} } }',
      'cs/App/Orders/BaseService.cs': 'namespace Shop.Orders { public abstract class BaseService {} }',
      'cs/App/Payments/Money.cs': 'namespace Shop.Payments;\npublic readonly record struct Money(decimal V);\npublic class Ambiguous {}',
      'cs/App/Payments/Gateway.cs': 'namespace Shop.Payments;\npublic class Gateway {}',
      'cs/App/Shipping/Address.cs': 'namespace Shop.Shipping;\npublic class Address {}\npublic class Ambiguous {}',
      'cs/App/Common/Guard.cs': 'namespace Shop.Common;\npublic static class Guard {}',
      'cs/App/Common/Clock.Part1.cs': 'namespace Shop.Common;\npublic partial class Clock {}',
      'cs/App/Common/Clock.Part2.cs': 'namespace Shop.Common;\npublic partial class Clock {}',
      'cs/App/Common/AuditedAttribute.cs': 'namespace Shop.Common;\npublic class AuditedAttribute : System.Attribute {}',
      'cs/App/Nested.cs': 'namespace Shop {\n  namespace Orders.Services { class N1 { Order o; } }\n  class N2 { Configuration.Setting s; Shop.Payments.Gateway g; }\n}\n',
      'cs/App/Config/Setting.cs': 'namespace Shop.Configuration;\npublic class Setting {}\n',
      'cs/Other/Other.csproj': '<Project/>',
      'cs/Other/Uses.cs': 'namespace Elsewhere;\npublic class Uses { Guard g; }',
      // ---- Java / Kotlin / Scala ----
      'jvm/src/zipkin2/Span.java': 'package zipkin2;\n\npublic final class Span {}\n',
      'jvm/src/zipkin2/internal/WriteBuffer.java': 'package zipkin2.internal;\n\npublic final class WriteBuffer {}\nfinal class Hidden {}\n',
      'jvm/src/zipkin2/other/Span.java': 'package zipkin2.other;\n\npublic class Span {}\n',
      'jvm/src/zipkin2/internal/Codec.java': [
        'package zipkin2.internal;',
        '',
        'import zipkin2.other.Span;',
        'import zipkin2.*;',
        '',
        'final class Codec {',
        '  WriteBuffer buf; Span span; Hidden h; String s; java.util.List<Object> l;',
        '}',
      ].join('\n'),
      'jvm/src/zipkin2/storage/StorageComponent.java': 'package zipkin2.storage;\n\npublic abstract class StorageComponent {}\n',
      'jvm/src/zipkin2/es/EsStorage.java': 'package zipkin2.es;\n\npublic class EsStorage extends zipkin2.storage.StorageComponent {\n  java.util.List<String> l;\n  zipkin2.internal.WriteBuffer.Writer w;\n}\n',
      'jvm/kt/okhttp3/Aliased.kt': 'package okhttp3\n\nimport okhttp3.internal.Holder as H\n\nclass Aliased { val h: H? = null; val x: Headers? = null }\n',
      'jvm/kt/okhttp3/internal/Util.kt': 'package okhttp3.internal\n\nfun readFieldOrNull(o: Any): Any? = null\ninternal fun Headers.commonEquals(o: Any?) = true\nclass Holder\n',
      'jvm/kt/okhttp3/Headers.kt': 'package okhttp3\n\nimport okhttp3.internal.commonEquals\n\nclass Headers {\n  fun eq(o: Any?) = commonEquals(o)\n}\n',
      'jvm/kt/okhttp3/internal/Platform.kt': 'package okhttp3.internal\n\nclass Platform {\n  fun get() = readFieldOrNull(this)\n  fun local() = localHelper()\n  private fun localHelper() = Holder()\n}\n',
      'jvm/scala/requests/Model.scala': 'package requests\n\ncase class MultiPart(x: Int)\ntrait RequestAuth\n',
      'jvm/scala/requests/sub/Use.scala': 'package requests\npackage sub\n\nobject Use { val m = MultiPart(1); def a: RequestAuth = null }\n',
      // ---- Swift ----
      'swift/Package.swift': [
        'let package = Package(name: "Lib", targets: [',
        '  .target(name: "Lib", dependencies: [.target(name: "CSQLite")], path: "Lib"),',
        '  // .target(name: "Gone", path: "Gone"),',
        '  .testTarget(name: "LibTests", dependencies: ["Lib"], path: "Tests"),',
        '])',
      ].join('\n'),
      'swift/Lib/Database.swift': 'public final class Database {}\nfunc cast(_ x: Int) -> Int { x }\n',
      'swift/Lib/Row.swift': 'public struct Row { let db: Database; func f() -> Int { cast(1) } }\n',
      'swift/Tests/RowTests.swift': 'import XCTest\n@testable import Lib\nclass RowTests: XCTestCase { var r: Row? }\n',
      // ---- Elixir ----
      'ex/lib/jason.ex': 'defmodule Jason do\n  alias Jason.{Encode, Decoder}\n  def x, do: Encode.encode(1) && Decoder.parse(1)\nend\n',
      'ex/lib/encode.ex': 'defmodule Jason.Encode do\n  defmodule Inner do\n  end\n  def encode(x), do: Inner.go(x)\nend\n',
      'ex/lib/decoder.ex': 'defmodule Jason.Decoder do\n  def parse(x), do: Jason.Encode.Inner.go(x)\nend\n',
      'ex/lib/dup_a.ex': 'defmodule Dup do\nend\n',
      'ex/lib/dup_b.ex': 'defmodule Dup do\nend\n',
      'ex/test/use_test.exs': 'defmodule UseTest do\n  test "x", do: Dup.x() && Ecto.Changeset.y()\nend\n',
    };
    const files = writeTree(root, tree);
    r = createImportResolver({ projectRoot: root, files });
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('C#: own namespace, usings, outer namespaces, project global usings, partials, attributes; ambiguity and aliases give no edge', () => {
    const edges = implicit('cs/App/Orders/OrderService.cs');
    expect(edges).toEqual(expect.arrayContaining([
      ['cs/App/Orders/BaseService.cs', 'Shop.Orders.BaseService'],
      ['cs/App/Orders/Order.cs', 'Shop.Orders.Services.Order'],
      ['cs/App/Payments/Money.cs', 'Shop.Payments.Money'],
      ['cs/App/Common/Guard.cs', 'Shop.Common.Guard'],
      ['cs/App/Common/Clock.Part1.cs', 'Shop.Common.Clock'],
      ['cs/App/Common/Clock.Part2.cs', 'Shop.Common.Clock'],
      ['cs/App/Common/AuditedAttribute.cs', 'Shop.Common.AuditedAttribute'],
      ['cs/App/Shipping/Address.cs', 'Shop.Shipping.Address'],
    ]));
    const targets = edges.map((e) => e[0]);
    // `Ambiguous` is declared in two imported namespaces; `Pay` is an alias
    // (resolved by the explicit pass); `Status` is a member access.
    expect(targets).not.toContain('cs/App/Payments/Gateway.cs');
    expect(edges.some((e) => e[1].endsWith('.Ambiguous'))).toBe(false);
    expect(edges).toHaveLength(8);
    // A global using of another project does not leak.
    expect(implicit('cs/Other/Uses.cs')).toEqual([]);
    // The explicit pass resolves alias / static usings to the type file.
    expect(r.resolve('cs/App/Orders/OrderService.cs', { spec: 'Shop.Payments.Gateway', kind: 'cs-alias' }, 'csharp')).toBe('cs/App/Payments/Gateway.cs');
    expect(r.isLocalNamespace('x.cs', { spec: 'Shop.Payments', kind: 'cs-namespace' }, 'csharp')).toBe(true);
    expect(r.isLocalNamespace('x.cs', { spec: 'System.Text', kind: 'cs-namespace' }, 'csharp')).toBe(false);
  });

  it('C#: each reference uses its enclosing namespace; qualified names, absolute and relative', () => {
    expect(implicit('cs/App/Nested.cs')).toEqual([
      ['cs/App/Orders/Order.cs', 'Shop.Orders.Services.Order'],
      ['cs/App/Config/Setting.cs', 'Shop.Configuration.Setting'],
      ['cs/App/Payments/Gateway.cs', 'Shop.Payments.Gateway'],
    ]);
  });

  it('Java: fully qualified references (nested type through its outer class); JDK names stay unresolved', () => {
    expect(implicit('jvm/src/zipkin2/es/EsStorage.java')).toEqual([
      ['jvm/src/zipkin2/storage/StorageComponent.java', 'zipkin2.storage.StorageComponent'],
      ['jvm/src/zipkin2/internal/WriteBuffer.java', 'zipkin2.internal.WriteBuffer'],
    ]);
  });

  it('Kotlin: `import a.B as C` binds C, not B', () => {
    expect(scanImports(tree['jvm/kt/okhttp3/Aliased.kt'], 'kotlin')[0].names).toEqual(['H']);
    expect(implicit('jvm/kt/okhttp3/Aliased.kt')).toEqual([['jvm/kt/okhttp3/Headers.kt', 'okhttp3.Headers']]);
  });

  it('Java: same package and on-demand imports; a single-type import shadows both', () => {
    const edges = implicit('jvm/src/zipkin2/internal/Codec.java');
    expect(edges).toEqual([
      ['jvm/src/zipkin2/internal/WriteBuffer.java', 'zipkin2.internal.WriteBuffer'],
      ['jvm/src/zipkin2/internal/WriteBuffer.java', 'zipkin2.internal.Hidden'],
    ].slice(0, 1));
    // `Span` is bound by `import zipkin2.other.Span` (explicit pass), not by `zipkin2.*`.
    expect(edges.map((e) => e[0])).not.toContain('jvm/src/zipkin2/Span.java');
  });

  it('Kotlin: top-level function calls in the package; explicit import of a top-level function', () => {
    expect(implicit('jvm/kt/okhttp3/internal/Platform.kt')).toEqual([
      ['jvm/kt/okhttp3/internal/Util.kt', 'okhttp3.internal.Holder'],
    ]);
    expect(r.resolve('jvm/kt/okhttp3/Headers.kt', { spec: 'okhttp3.internal.commonEquals', kind: 'jvm' }, 'kotlin'))
      .toBe('jvm/kt/okhttp3/internal/Util.kt');
  });

  it('Scala: chained package clauses keep the outer package visible', () => {
    expect(implicit('jvm/scala/requests/sub/Use.scala')).toEqual([
      ['jvm/scala/requests/Model.scala', 'requests.MultiPart'],
    ]);
  });

  it('Swift: SwiftPM targets (dependency references are not declarations), own module and imported modules', () => {
    expect(r.resolve('swift/Tests/RowTests.swift', { spec: 'Lib', kind: 'swift-module' }, 'swift')).toBe('swift/Lib/');
    expect(r.resolve('swift/Tests/RowTests.swift', { spec: 'CSQLite', kind: 'swift-module' }, 'swift')).toBeNull();
    expect(r.resolve('swift/Tests/RowTests.swift', { spec: 'XCTest', kind: 'swift-module' }, 'swift')).toBeNull();
    expect(implicit('swift/Lib/Row.swift')).toEqual([
      ['swift/Lib/Database.swift', 'Lib.Database'],
    ]);
    expect(implicit('swift/Tests/RowTests.swift')).toEqual([['swift/Lib/Row.swift', 'Lib.Row']]);
  });

  it('Elixir: alias expansion and full names; own and duplicate modules give no edge', () => {
    expect(implicit('ex/lib/jason.ex')).toEqual([
      ['ex/lib/encode.ex', 'Jason.Encode'],
      ['ex/lib/decoder.ex', 'Jason.Decoder'],
    ]);
    expect(implicit('ex/lib/decoder.ex')).toEqual([['ex/lib/encode.ex', 'Jason.Encode.Inner']]);
    expect(implicit('ex/lib/encode.ex')).toEqual([]);
    expect(implicit('ex/test/use_test.exs')).toEqual([]);
    expect(r.resolve('ex/lib/x.ex', { spec: 'Jason.Decoder', kind: 'ex-alias' }, 'elixir')).toBe('ex/lib/decoder.ex');
    expect(r.resolve('ex/lib/x.ex', { spec: 'Ecto.Query', kind: 'ex-import' }, 'elixir')).toBeNull();
  });
});

// =============================================================================
// EXTRACTOR WIRING
// =============================================================================

describe('GraphExtractor — wider import edges', () => {
  it('adds explicit + implicit importsFile edges; a C# namespace using binds no entity', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-imports-wire-'));
    try {
      const tree = {
        'src/Api/Controller.cs': 'using Shop.Models;\nusing System.Text;\nnamespace Shop.Api;\npublic class Controller { Order o; }\n',
        'src/Models/Order.cs': 'namespace Shop.Models;\npublic class Order {}\n',
        'web/App.vue': '<template><div/></template>\n<script>\nimport Foo from "./Foo.vue";\n</script>\n',
        'web/Foo.vue': '<template><span/></template>\n',
        'styles/main.scss': '@use "vars";\n',
        'styles/_vars.scss': '$x: 1;\n',
      };
      const files = writeTree(root, tree);
      const extractor = new GraphExtractor({ useTreeSitter: false, importResolver: createImportResolver({ projectRoot: root, files }) });
      const edgesOf = async (f) => (await extractor.extractFromFile(f, tree[f])).relationships;

      const cs = await edgesOf('src/Api/Controller.cs');
      expect(cs.filter((x) => x.type === 'importsFile').map((x) => [x.target_name, x.full_import_path]))
        .toEqual([['src/Models/Order.cs', 'Shop.Models.Order']]);
      const legacy = cs.filter((x) => x.type === 'imports');
      const local = legacy.find((x) => x.target_name === 'Shop.Models');
      const external = legacy.find((x) => x.target_name === 'System.Text');
      // A namespace is never one entity (`using Ocelot.Configuration.File;`
      // bound a class named Ocelot by name); the file-level edge above
      // carries the dependency.
      if (local) expect(local.full_import_path).toBe(`${UNRESOLVED_IMPORT_PREFIX}Shop.Models`);
      if (external) expect(external.full_import_path).toBe(`${UNRESOLVED_IMPORT_PREFIX}System.Text`);

      const vue = await edgesOf('web/App.vue');
      expect(vue.filter((x) => x.type === 'importsFile').map((x) => [x.target_name, x.context_line])).toEqual([['web/Foo.vue', 3]]);
      const scss = await edgesOf('styles/main.scss');
      expect(scss.filter((x) => x.type === 'importsFile').map((x) => x.target_name)).toEqual(['styles/_vars.scss']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
