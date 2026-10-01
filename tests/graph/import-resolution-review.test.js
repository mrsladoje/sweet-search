/**
 * Review cases for file-level import resolution (core/graph/import-resolver.js):
 * the hard rules per language, and the negative cases where a wrong edge is
 * worse than no edge (external modules whose path suffix matches a local file
 * of a different module, stdlib shadowing, test crates, ...).
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanImports, importLanguageFor } from '../../core/graph/import-scanner.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';

const roots = [];
afterAll(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-imp-review-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return { root, files: Object.keys(files) };
}

/** Targets of every import statement of `fromFile` (in scan order). */
function targets(files, fromFile, language, { probe = false } = {}) {
  const t = tree(files);
  const r = createImportResolver({ projectRoot: t.root, files: probe ? null : t.files });
  const lang = importLanguageFor(fromFile, language);
  return scanImports(files[fromFile], lang).map((imp) => r.resolve(fromFile, imp, lang));
}

function implicit(files, fromFile, language) {
  const t = tree(files);
  const r = createImportResolver({ projectRoot: t.root, files: t.files });
  const scanned = scanImports(files[fromFile], language);
  return r.implicitImports(fromFile, files[fromFile], language, scanned).map((e) => e.target).sort();
}

// =============================================================================
// TypeScript / JavaScript
// =============================================================================

describe('review — TS/JS resolution', () => {
  it('paths: the longest matching prefix wins', () => {
    expect(targets({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/app/*'], '@app/core/*': ['libs/core/*'] } } }),
      'src/main.ts': "import { a } from '@app/core/x';\nimport { b } from '@app/y';",
      'libs/core/x.ts': '', 'src/app/core/x.ts': '', 'src/app/y.ts': '',
    }, 'src/main.ts', 'typescript')).toEqual(['libs/core/x.ts', 'src/app/y.ts']);
  });

  it('extends: an inherited baseUrl is relative to the config that sets it', () => {
    expect(targets({
      'configs/tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '~lib/*': ['lib/*'] } } }),
      'packages/a/tsconfig.json': JSON.stringify({ extends: '../../configs/tsconfig.base.json' }),
      'packages/a/src/f.ts': "import z from '~lib/z';",
      'lib/z.ts': '',
    }, 'packages/a/src/f.ts', 'typescript')).toEqual(['lib/z.ts']);
  });

  it('${configDir} in a shared base config means the directory of the leaf config', () => {
    expect(targets({
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '#src/*': ['${configDir}/src/*'] } } }),
      'packages/a/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json' }),
      'packages/a/src/x.ts': "import u from '#src/util';",
      'packages/a/src/util.ts': '',
      'src/util.ts': '',
    }, 'packages/a/src/x.ts', 'typescript')).toEqual(['packages/a/src/util.ts']);
  });

  it('solution-style root config borrows paths from a referenced project', () => {
    expect(targets({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.node.json' }, { path: './tsconfig.app.json' }] }),
      'tsconfig.node.json': JSON.stringify({ compilerOptions: { types: ['node'] } }),
      'tsconfig.app.json': '{\n  // JSONC\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },\n}',
      'src/App.tsx': "import Btn from '@/components/Btn';",
      'src/components/Btn.tsx': '',
    }, 'src/App.tsx', 'tsx')).toEqual(['src/components/Btn.tsx']);
  });

  it('ESM .js specifiers load .ts sources; directories load index files', () => {
    expect(targets({
      'src/a.ts': "import { b } from './b.js';\nimport { c } from './c';\nimport d from './dir';\nexport * as ns from './e.mjs';",
      'src/b.ts': '', 'src/c.tsx': '', 'src/dir/index.ts': '', 'src/e.mts': '',
    }, 'src/a.ts', 'typescript')).toEqual(['src/b.ts', 'src/c.tsx', 'src/dir/index.ts', 'src/e.mts']);
  });

  it('workspace package exports map dist/ back to src/ (types and subpaths)', () => {
    expect(targets({
      'packages/core/package.json': JSON.stringify({
        name: '@acme/core',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './utils': './dist/utils.js' },
      }),
      'packages/core/src/index.ts': '', 'packages/core/src/utils.ts': '',
      'apps/web/package.json': JSON.stringify({ name: 'web' }),
      'apps/web/main.ts': "import { x } from '@acme/core';\nimport { u } from '@acme/core/utils';\nimport React from 'react';",
    }, 'apps/web/main.ts', 'typescript')).toEqual(['packages/core/src/index.ts', 'packages/core/src/utils.ts', null]);
  });

  it('externals and node builtins get no target', () => {
    expect(targets({
      'src/a.ts': "import fs from 'node:fs';\nimport path from 'path';\nimport { z } from 'zod';\nimport x from '@scope/pkg/sub';",
      'src/path.ts': '', 'src/zod.ts': '',
    }, 'src/a.ts', 'typescript')).toEqual([null, null, null, null]);
  });

  it('`import.meta` lines (no semicolons) do not swallow the following lines', () => {
    const code = "import.meta.hot?.accept()\nconst x = 1\nexport { y } from './y'\nconst z = require('./z')";
    expect(scanImports(code, 'typescript').map((i) => i.spec)).toEqual(['./y', './z']);
  });

  it('vite alias with path.resolve(__dirname, "src", "components")', () => {
    expect(targets({
      'package.json': '{"name":"app"}',
      'vite.config.ts': "export default { resolve: { alias: { '@components': path.resolve(__dirname, 'src', 'components'), '@': path.resolve(__dirname, './src') } } }",
      'src/main.ts': "import Btn from '@components/Btn';\nimport u from '@/util';",
      'src/components/Btn.ts': '', 'src/Btn.ts': '', 'src/util.ts': '',
    }, 'src/main.ts', 'typescript')).toEqual(['src/components/Btn.ts', 'src/util.ts']);
  });
});

// =============================================================================
// Python
// =============================================================================

describe('review — Python resolution', () => {
  it('relative levels and submodule names', () => {
    expect(targets({
      'pkg/__init__.py': '', 'pkg/a/__init__.py': '', 'pkg/a/b.py': "from ..c import d\nfrom . import e\nfrom .sub import thing\nfrom ...outside import x",
      'pkg/c.py': '', 'pkg/a/e.py': '', 'pkg/a/sub/__init__.py': '', 'pkg/a/sub/thing.py': '',
    }, 'pkg/a/b.py', 'python')).toEqual(['pkg/c.py', 'pkg/a/e.py', 'pkg/a/sub/thing.py', null]);
  });

  it('src layout from tests; stdlib names never bind to a same-named package module', () => {
    expect(targets({
      'src/mypkg/__init__.py': '', 'src/mypkg/util.py': '', 'src/mypkg/typing.py': '', 'src/mypkg/json/__init__.py': '',
      'tests/test_a.py': 'import mypkg.util\nimport typing\nimport json\nimport os.path',
    }, 'tests/test_a.py', 'python')).toEqual(['src/mypkg/util.py', null, null, null]);
    expect(targets({
      'src/mypkg/__init__.py': '', 'src/mypkg/typing.py': '', 'src/mypkg/app.py': 'import typing\nfrom typing import Any',
    }, 'src/mypkg/app.py', 'python')).toEqual([null, null]);
  });

  it('namespace packages (no __init__.py) at the root', () => {
    expect(targets({ 'ns/mod.py': '', 'main.py': 'import ns.mod' }, 'main.py', 'python')).toEqual(['ns/mod.py']);
  });
});

// =============================================================================
// Rust
// =============================================================================

describe('review — Rust resolution', () => {
  const crate = {
    'Cargo.toml': '[package]\nname = "app"\n',
    'src/lib.rs': 'mod a;\nmod c;\npub mod common;',
    'src/a.rs': 'mod inner;\nuse crate::c::D;\nuse super::common::H;',
    'src/a/inner.rs': 'use super::super::c::D;',
    'src/c.rs': '', 'src/common.rs': '',
    'src/x/mod.rs': 'mod y;\n#[path = "gen/z.rs"]\nmod z;',
    'src/x/y.rs': '', 'src/x/gen/z.rs': '',
    'tests/it.rs': 'mod common;\nuse crate::common::helper;',
    'tests/common/mod.rs': '',
    'crates/foo-bar/Cargo.toml': '[package]\nname = "foo-bar"\n',
    'crates/foo-bar/src/lib.rs': '', 'crates/foo-bar/src/x.rs': '',
    'src/main.rs': 'use foo_bar::x::Y;\nuse std::io;\nuse serde::Serialize;',
  };

  it('mod / crate:: / super:: / #[path]', () => {
    expect(targets(crate, 'src/a.rs', 'rust')).toEqual(['src/a/inner.rs', 'src/c.rs', 'src/common.rs']);
    expect(targets(crate, 'src/a/inner.rs', 'rust')).toEqual(['src/c.rs']);
    expect(targets(crate, 'src/x/mod.rs', 'rust')).toEqual(['src/x/y.rs', 'src/x/gen/z.rs']);
  });

  it('`crate::` inside an integration-test crate is that test crate, never src/', () => {
    const got = targets(crate, 'tests/it.rs', 'rust');
    expect(got[0]).toBe('tests/common/mod.rs');
    expect(got[1]).not.toBe('src/common.rs');
  });

  it('workspace crates by name; std and externals get no target', () => {
    expect(targets(crate, 'src/main.rs', 'rust')).toEqual(['crates/foo-bar/src/x.rs', null, null]);
  });
});

// =============================================================================
// Go
// =============================================================================

describe('review — Go resolution', () => {
  it('module prefix, local replace, go.work; stdlib and externals none', () => {
    const files = {
      'go.mod': 'module example.com/m\n\ngo 1.22\n\nreplace example.com/other => ./other\n',
      'go.work': 'go 1.22\n\nuse (\n\t.\n\t./mod2\n)\n',
      'mod2/go.mod': 'module example.com/mod2\n',
      'mod2/q/q.go': 'package q',
      'other/go.mod': 'module example.com/other\n',
      'other/x/x.go': 'package x',
      'pkg/a/a.go': 'package a',
      'internal/z/z.go': 'package z',
      'cmd/main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/m/pkg/a"\n\t"example.com/other/x"\n\t"example.com/mod2/q"\n\tz "example.com/m/internal/z"\n\t"github.com/x/y"\n)\n',
    };
    expect(targets(files, 'cmd/main.go', 'go')).toEqual([null, 'pkg/a/', 'other/x/', 'mod2/q/', 'internal/z/', null]);
  });
});

// =============================================================================
// Suffix fallbacks must not bind an external module to a local namesake
// =============================================================================

describe('review — suffix fallbacks check the declared module', () => {
  it('Java: `import foo.Bar` (external) does not bind com/x/foo/Bar.java', () => {
    expect(targets({
      'src/main/java/com/x/foo/Bar.java': 'package com.x.foo;\npublic class Bar {}',
      'src/main/java/com/x/App.java': 'package com.x;\nimport foo.Bar;\nimport com.x.foo.Bar;\npublic class App {}',
    }, 'src/main/java/com/x/App.java', 'java')).toEqual([null, 'src/main/java/com/x/foo/Bar.java']);
  });

  it('Haskell: `import Data.Map` does not bind src/MyLib/Data/Map.hs', () => {
    expect(targets({
      'mylib.cabal': 'library\n  hs-source-dirs: src\n',
      'src/MyLib/Data/Map.hs': 'module MyLib.Data.Map where\n',
      'src/MyLib/App.hs': 'module MyLib.App where\nimport Data.Map\nimport MyLib.Data.Map\n',
    }, 'src/MyLib/App.hs', 'haskell')).toEqual([null, 'src/MyLib/Data/Map.hs']);
  });

  it('Perl: `use Foo::Bar` (CPAN) does not bind lib/My/Foo/Bar.pm', () => {
    expect(targets({
      'lib/My/Foo/Bar.pm': 'package My::Foo::Bar;\n1;',
      'lib/My/App.pm': 'package My::App;\nuse Foo::Bar;\nuse My::Foo::Bar;\n1;',
    }, 'lib/My/App.pm', 'perl')).toEqual([null, 'lib/My/Foo/Bar.pm']);
  });

  it('PHP: `use Illuminate\\Support\\Str` does not bind app/Support/Str.php (namespace App\\Support)', () => {
    expect(targets({
      'composer.json': JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/' } } }),
      'app/Support/Str.php': '<?php\nnamespace App\\Support;\nclass Str {}',
      'app/Http/Kernel.php': '<?php\nnamespace App\\Http;\nuse Illuminate\\Support\\Str;\nuse App\\Support\\Str as S;\n',
    }, 'app/Http/Kernel.php', 'php')).toEqual([null, 'app/Support/Str.php']);
  });

  it('Clojure: `clojure.string` does not bind src/x/clojure/string.clj', () => {
    expect(targets({
      'deps.edn': '{:paths ["src"]}',
      'src/x/clojure/string.clj': '(ns x.clojure.string)',
      'src/x/core.clj': '(ns x.core\n  (:require [clojure.string :as str]\n            [x.clojure.string :as xs]))',
    }, 'src/x/core.clj', 'clojure')).toEqual([null, 'src/x/clojure/string.clj']);
  });
});

// =============================================================================
// Namespace languages
// =============================================================================

describe('review — C# namespace lookup', () => {
  const base = {
    'A/B/Foo.cs': 'namespace A.B { public class Foo {} }',
    'C/Foo.cs': 'namespace C { public class Foo {} public class Bar {} }',
    'D/Bar.cs': 'namespace D { public class Bar {} }',
    'P/Part1.cs': 'namespace P { public partial class Widget {} }',
    'P/Part2.cs': 'namespace P { public partial class Widget {} }',
  };

  it('the enclosing namespace shadows using directives', () => {
    expect(implicit({ ...base, 'A/B/Use.cs': 'using C;\nnamespace A.B { class Use { Foo f; } }' }, 'A/B/Use.cs', 'csharp'))
      .toEqual(['A/B/Foo.cs']);
  });

  it('two using namespaces declaring the name is ambiguous: no edge', () => {
    expect(implicit({ ...base, 'X/Use.cs': 'using C;\nusing D;\nnamespace X { class Use { Bar b; } }' }, 'X/Use.cs', 'csharp'))
      .toEqual([]);
  });

  it('partial classes link every declaring file', () => {
    expect(implicit({ ...base, 'X/Use.cs': 'using P;\nnamespace X { class Use { Widget w; } }' }, 'X/Use.cs', 'csharp'))
      .toEqual(['P/Part1.cs', 'P/Part2.cs']);
  });

  it('a byte-order mark does not turn the namespace line into references', () => {
    // ocelot: 498 of 757 .cs files start with U+FEFF; `namespace Ocelot.Testing;`
    // on that line read as a reference to class Ocelot.Testing.Ocelot.
    expect(implicit({
      'testing/Ocelot.cs': '﻿namespace Ocelot.Testing;\ninternal class Ocelot {}',
      'testing/StreamExtensions.cs': '﻿namespace Ocelot.Testing;\n\npublic static class StreamExtensions\n{\n}\n',
    }, 'testing/StreamExtensions.cs', 'csharp')).toEqual([]);
    // …and a BOM'd Java file keeps its package for same-package lookups.
    expect(implicit({
      'src/p/Foo.java': '﻿package p;\npublic class Foo {}',
      'src/p/Use.java': '﻿package p;\nclass Use { Foo f; }',
    }, 'src/p/Use.java', 'java')).toEqual(['src/p/Foo.java']);
  });

  it('external usings give nothing', () => {
    expect(implicit({ ...base, 'X/Use.cs': 'using System;\nnamespace X { class Use { void M() { Console.WriteLine(); } } }' }, 'X/Use.cs', 'csharp'))
      .toEqual([]);
  });

  it('a using inside one namespace block does not apply to another block', () => {
    const files = { ...base, 'G/Foo.cs': 'public class Foo {}' };
    // Y has no using: its Foo is the global one, not C.Foo from X's using.
    expect(implicit({
      ...files,
      'X/Two.cs': 'namespace Y\n{\n    class B { Foo g; }\n}\nnamespace X\n{\n    using C;\n    class A { Foo f; }\n}\n',
    }, 'X/Two.cs', 'csharp')).toEqual(['G/Foo.cs']);
    expect(implicit({
      ...files,
      'X/Two.cs': 'namespace X\n{\n    using C;\n    class A { Foo f; }\n}\n',
    }, 'X/Two.cs', 'csharp')).toEqual(['C/Foo.cs']);
  });
});

describe('review — declaration cache across resolvers (maintainer ticks)', () => {
  it('a later resolver sees an edited declaration file, and reuses unchanged ones', () => {
    const t = tree({
      'P/Widget.cs': 'namespace P { public class Widget {} }',
      'X/Use.cs': 'using P;\nnamespace X { class Use { Widget w; } }',
    });
    const content = fs.readFileSync(path.join(t.root, 'X/Use.cs'), 'utf8');
    const edgesNow = () => {
      const r = createImportResolver({ projectRoot: t.root, files: t.files, probeFs: true });
      return r.implicitImports('X/Use.cs', content, 'csharp', scanImports(content, 'csharp')).map((e) => e.target);
    };
    expect(edgesNow()).toEqual(['P/Widget.cs']);
    // Rename the class (new size and mtime): the next tick must not link it.
    const abs = path.join(t.root, 'P/Widget.cs');
    fs.writeFileSync(abs, 'namespace P { public class Gadget {} }   ');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(abs, later, later);
    expect(edgesNow()).toEqual([]);
  });
});

describe('review — JVM implicit references', () => {
  it('an explicit import shadows the same-package type', () => {
    expect(implicit({
      'src/p/Foo.java': 'package p;\npublic class Foo {}',
      'src/q/Foo.java': 'package q;\npublic class Foo {}',
      'src/p/Use.java': 'package p;\nimport q.Foo;\nclass Use { Foo f; }',
    }, 'src/p/Use.java', 'java')).toEqual([]);
  });

  it('Kotlin Multiplatform: a reference links the expect declaration, not every platform actual', () => {
    expect(implicit({
      'core/common/src/Dispatchers.common.kt': 'package kotlinx.coroutines\n\npublic expect object Dispatchers {\n}\n',
      'core/jvm/src/Dispatchers.kt': 'package kotlinx.coroutines\n\npublic actual object Dispatchers {\n}\n',
      'core/js/src/Dispatchers.kt': 'package kotlinx.coroutines\n\n@Suppress("X")\npublic actual object Dispatchers {\n}\n',
      'core/jvm/test/UseTest.kt': 'package kotlinx.coroutines\n\nclass UseTest { val d = Dispatchers }\n',
    }, 'core/jvm/test/UseTest.kt', 'kotlin')).toEqual(['core/common/src/Dispatchers.common.kt']);
  });

  it('the same name declared in several files (not partial parts) is ambiguous: no edge', () => {
    // Same class in two Gradle modules of one package.
    expect(implicit({
      'a/src/main/java/p/Util.java': 'package p;\npublic class Util {}',
      'b/src/main/java/p/Util.java': 'package p;\npublic class Util {}',
      'a/src/main/java/p/Use.java': 'package p;\nclass Use { Util u; }',
    }, 'a/src/main/java/p/Use.java', 'java')).toEqual([]);
    // Swift free-function overloads in different files of one target.
    expect(implicit({
      'Package.swift': 'let package = Package(name: "G", targets: [ .target(name: "G", path: "Sources/G") ])',
      'Sources/G/A.swift': 'public func cast(_ x: Int) -> Int { x }\n',
      'Sources/G/B.swift': 'public func cast(_ x: String) -> String { x }\n',
      'Sources/G/Use.swift': 'func run() { _ = cast(1) }\n',
    }, 'Sources/G/Use.swift', 'swift')).toEqual([]);
  });

  it('Swift: paths in a target\'s `exclude:` are not part of the module', () => {
    const files = {
      'Package.swift': 'let package = Package(name: "G", targets: [\n  .target(name: "G", path: "Sources/G", exclude: ["Legacy", "Notes.md"]),\n])',
      'Sources/G/A.swift': 'public struct Gadget {}\n',
      'Sources/G/Legacy/Old.swift': 'struct Widget {}\nlet g = Gadget()\n',
      'Sources/G/Use.swift': 'func run() { _ = Widget(); _ = Gadget() }\n',
    };
    expect(implicit(files, 'Sources/G/Use.swift', 'swift')).toEqual(['Sources/G/A.swift']);
    expect(implicit(files, 'Sources/G/Legacy/Old.swift', 'swift')).toEqual([]);
  });

  it('Kotlin top-level function in a differently named file', () => {
    expect(targets({
      'src/a/b/Utils.kt': 'package a.b\n\nfun doThing() {}\n',
      'src/a/c/Use.kt': 'package a.c\n\nimport a.b.doThing\n\nfun main() { doThing() }\n',
    }, 'src/a/c/Use.kt', 'kotlin')).toEqual(['src/a/b/Utils.kt']);
  });
});

// =============================================================================
// Small languages
// =============================================================================

describe('review — Lua / Zig / Shell / Sass', () => {
  it('Lua: dotted module under lua/; externals none', () => {
    expect(targets({ 'lua/foo/bar.lua': '', 'lua/foo/init.lua': 'local b = require("foo.bar")\nlocal j = require "cjson"' }, 'lua/foo/init.lua', 'lua'))
      .toEqual(['lua/foo/bar.lua', null]);
  });

  it('Zig: std none, sibling file', () => {
    expect(targets({ 'src/main.zig': 'const std = @import("std");\nconst u = @import("util.zig");', 'src/util.zig': '' }, 'src/main.zig', 'zig'))
      .toEqual([null, 'src/util.zig']);
  });

  it('Shell: script-dir idiom; unknown variables none', () => {
    const got = targets({
      'scripts/run.sh': 'source "$(dirname "$0")/lib.sh"\nsource "$HOME/.bashrc"\n. "${CONFIG_DIR}/env.sh"',
      'scripts/lib.sh': '', 'scripts/env.sh': '',
    }, 'scripts/run.sh', 'shell');
    expect(got.filter(Boolean)).toEqual(['scripts/lib.sh']);
  });

  it('Sass: partials and folder index', () => {
    expect(targets({
      'styles/main.scss': '@use "base";\n@use "theme";\n@import "vars";',
      'styles/_base.scss': '', 'styles/theme/_index.scss': '', 'styles/_vars.scss': '',
    }, 'styles/main.scss', 'scss')).toEqual(['styles/_base.scss', 'styles/theme/_index.scss', 'styles/_vars.scss']);
  });
});
