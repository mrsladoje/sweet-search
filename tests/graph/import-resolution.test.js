/**
 * File-level import resolution: statement scanner and specifier → repo file
 * resolver (core/graph/import-scanner.js, core/graph/import-resolver.js).
 *
 * Fixture trees are written to a temp dir so tsconfig/go.mod/Cargo.toml
 * reads exercise the real config loader.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanImports, expandRustUseTree } from '../../core/graph/import-scanner.js';
import { createImportResolver, parseJsonc } from '../../core/graph/import-resolver.js';

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
// SCANNER
// =============================================================================

describe('scanImports — JavaScript / TypeScript', () => {
  it('finds forms the per-line registry regexes miss', () => {
    const src = [
      "import React, { useState } from 'react';",
      "import * as path from 'node:path';",
      "import './styles.css';",
      'import {',
      '  Button,',
      '  Card,',
      "} from '@/components/ui';",
      "export * as utils from './utils';",
      "export {\n  a,\n  b,\n} from '../shared/ab';",
      "import fs = require('fs');",
      "import type { Foo } from './types.js';",
      "const lazy = () => import('./lazy');",
      "const { readFile: read, join } = require('./helpers');",
    ].join('\n');
    expect(specs(src, 'typescript')).toEqual([
      'react', 'node:path', './styles.css', '@/components/ui', './utils',
      '../shared/ab', 'fs', './types.js', './lazy', './helpers',
    ]);
    const req = scanImports(src, 'typescript').find((i) => i.spec === './helpers');
    expect(req.names).toEqual(['read', 'join']);
  });

  it('ignores imports inside comments', () => {
    const src = "// import x from './a';\n/*\nimport y from './b';\n*/\n * import z from './c';\nimport w from './d';";
    expect(specs(src, 'javascript')).toEqual(['./d']);
  });

  it('reports the 1-based line of the statement start', () => {
    const imps = scanImports("\n\nimport {\n a\n} from './x';", 'typescript');
    expect(imps[0].line).toBe(3);
  });
});

describe('scanImports — other languages', () => {
  it('Python: relative, multi-line parens, aliases, docstrings skipped', () => {
    const src = [
      '"""Docs.',
      'import not_this',
      '"""',
      'import os, numpy as np',
      'from ..models import (',
      '    User,',
      '    Group as G,',
      ')',
      'from . import views',
    ].join('\n');
    const imps = scanImports(src, 'python');
    expect(imps.map((i) => i.spec)).toEqual(['os', 'numpy', '..models', '.']);
    expect(imps[2].names).toEqual(['User', 'Group']);
    expect(imps[3].names).toEqual(['views']);
  });

  it('Rust: use trees, pub use, aliases, mod declarations', () => {
    const src = [
      'use std::collections::HashMap;',
      'pub use crate::a::{b, c::{D, E as F}, self};',
      'pub(crate) mod inner;',
      'use super::sibling::Thing as Other;',
    ].join('\n');
    expect(specs(src, 'rust')).toEqual([
      'std::collections::HashMap', 'crate::a::b', 'crate::a::c::D', 'crate::a::c::E', 'crate::a',
      'inner', 'super::sibling::Thing',
    ]);
    expect(expandRustUseTree('x::{y,z::*}')).toEqual(['x::y', 'x::z']);
  });

  it('Go: single and block imports with aliases', () => {
    const src = 'import "fmt"\nimport (\n\t"os"\n\tpb "example.com/m/protos/pb"\n\t_ "example.com/m/side"\n)\nvar m = map[string]int{\n\t"name": 1,\n}';
    expect(specs(src, 'go')).toEqual(['fmt', 'os', 'example.com/m/protos/pb', 'example.com/m/side']);
  });

  it('C, JVM, Ruby, PHP, Dart', () => {
    expect(scanImports('#include "a/b.h"\n#include <vector>', 'cpp').map((i) => [i.spec, i.kind]))
      .toEqual([['a/b.h', 'quote'], ['vector', 'angle']]);
    expect(specs('import com.x.Foo;\nimport static com.x.Util.go;\nimport com.y.*;', 'java'))
      .toEqual(['com.x.Foo', 'com.x.Util.go', 'com.y']);
    expect(specs('import a.b.{C, D => E}', 'scala')).toEqual(['a.b.C', 'a.b.D']);
    expect(specs("require_relative 'helper'\nrequire 'sequel/model'", 'ruby')).toEqual(['helper', 'sequel/model']);
    expect(specs('use App\\Models\\{User, Post as P};\nclass X {\n    use SomeTrait;\n}', 'php'))
      .toEqual(['App\\Models\\User', 'App\\Models\\Post']);
    expect(specs("import 'dart:io';\nimport 'package:app/x.dart';\nimport 'y.dart';", 'dart'))
      .toEqual(['package:app/x.dart', 'y.dart']);
  });
});

// =============================================================================
// RESOLVER
// =============================================================================

describe('createImportResolver', () => {
  let root;
  let files;
  let r;
  const res = (from, spec, lang, extra = {}) => r.resolve(from, { spec, kind: extra.kind || 'import', names: extra.names }, lang);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-imports-'));
    files = writeTree(root, {
      // --- TS app with extends + JSONC + paths + baseUrl ---
      'tsconfig.base.json': '{\n  "$schema": "https://json.schemastore.org/tsconfig",\n  // shared\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@components/*": ["src/components/*"], "@lib": ["src/lib/index.ts"], },\n  },\n}',
      'tsconfig.json': '{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true } }',
      'package.json': '{ "name": "app", "imports": { "#internal/*": "./src/internal/*.ts" } }',
      'src/components/Button.tsx': 'export const Button = 1;',
      'src/components/index.ts': "export * from './Button';",
      'src/lib/index.ts': 'export const lib = 1;',
      'src/lib/util.ts': 'export const u = 1;',
      'src/lib/esm.ts': 'export const e = 1;',
      'src/internal/secret.ts': 'export const s = 1;',
      'src/pages/home.tsx': '',
      'src/legacy/plain.js': '',
      // --- Vite app (solution-style tsconfig + alias) ---
      'web/package.json': '{ "name": "web" }',
      'web/tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
      'web/tsconfig.app.json': '{ "compilerOptions": { "paths": { "~app/*": ["./src/*"] } } }',
      'web/vite.config.ts': "export default { resolve: { alias: { '@': path.resolve(__dirname, './src') } } };",
      'web/src/store.ts': '',
      'web/src/main.ts': '',
      // --- workspace package pointing at dist ---
      'packages/core/package.json': '{ "name": "@acme/core", "main": "./dist/index.js", "exports": { ".": "./dist/index.js", "./feature": "./dist/feature.js" } }',
      'packages/core/src/index.ts': '',
      'packages/core/src/feature.ts': '',
      // --- Python ---
      'pyproj/src/pkg/__init__.py': '',
      'pyproj/src/pkg/models.py': '',
      'pyproj/src/pkg/typing.py': '',
      'pyproj/src/pkg/sub/__init__.py': '',
      'pyproj/src/pkg/sub/views.py': '',
      'pyproj/scripts/run.py': '',
      'pyproj/scripts/helper.py': '',
      // --- Rust workspace ---
      'rs/Cargo.toml': '[workspace]\nmembers = ["core", "cli"]',
      'rs/core/Cargo.toml': '[package]\nname = "acme-core"\nversion = "0.1.0"',
      'rs/core/src/lib.rs': 'pub mod net;',
      'rs/core/src/net.rs': 'mod tcp;',
      'rs/core/src/net/tcp.rs': '',
      'rs/core/src/config/mod.rs': '',
      'rs/cli/Cargo.toml': '[package]\nname = "acme-cli"',
      'rs/cli/src/main.rs': '',
      // --- Go ---
      'go/go.mod': 'module example.com/m\n\ngo 1.22\n\nreplace example.com/forked => ./third_party/forked\n',
      'go/protos/pb/pb.go': '',
      'go/cmd/main.go': '',
      'go/third_party/forked/go.mod': 'module example.com/forked',
      'go/third_party/forked/f.go': '',
      // --- C++ / JVM / Ruby / PHP ---
      'cpp/lib/inc/drogon/HttpTypes.h': '',
      'cpp/lib/src/Impl.cc': '',
      'cpp/lib/src/Impl.h': '',
      'jvm/core/src/main/java/com/acme/Foo.java': 'package com.acme;\npublic class Foo {}',
      'jvm/app/src/main/kotlin/com/acme/app/App.kt': '',
      'rb/lib/acme/model.rb': '',
      'rb/spec/spec_helper.rb': '',
      'rb/spec/model_spec.rb': '',
      'composer.json': '{ "autoload": { "psr-4": { "Acme\\\\": "php/src/" } } }',
      'php/src/Models/User.php': '',
      'php/src/Http/Controller.php': '',
    });
    r = createImportResolver({ projectRoot: root, files });
  });

  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('parses JSONC without touching strings', () => {
    expect(parseJsonc('{ "u": "https://x//y", /* c */ "a": [1,], }')).toEqual({ u: 'https://x//y', a: [1] });
  });

  it('JS/TS: relative, index, .js → .ts, extends + paths + baseUrl, #imports', () => {
    expect(res('src/pages/home.tsx', '../components', 'tsx')).toBe('src/components/index.ts');
    expect(res('src/pages/home.tsx', '../components/Button', 'tsx')).toBe('src/components/Button.tsx');
    expect(res('src/pages/home.tsx', '../lib/esm.js', 'tsx')).toBe('src/lib/esm.ts');
    expect(res('src/pages/home.tsx', '@components/Button', 'tsx')).toBe('src/components/Button.tsx');
    expect(res('src/pages/home.tsx', '@lib', 'tsx')).toBe('src/lib/index.ts');
    expect(res('src/pages/home.tsx', 'src/lib/util', 'tsx')).toBe('src/lib/util.ts'); // baseUrl
    expect(res('src/pages/home.tsx', '#internal/secret', 'tsx')).toBe('src/internal/secret.ts');
    expect(res('src/legacy/plain.js', '../lib/util', 'javascript')).toBe('src/lib/util.ts');
  });

  it('JS/TS: solution-style references, Vite alias, workspace package dist → src', () => {
    expect(res('web/src/main.ts', '~app/store', 'typescript')).toBe('web/src/store.ts');
    expect(res('web/src/main.ts', '@/store', 'typescript')).toBe('web/src/store.ts');
    expect(res('src/pages/home.tsx', '@acme/core', 'tsx')).toBe('packages/core/src/index.ts');
    expect(res('src/pages/home.tsx', '@acme/core/feature', 'tsx')).toBe('packages/core/src/feature.ts');
  });

  it('JS/TS: externals and escapes stay unresolved', () => {
    expect(res('src/pages/home.tsx', 'react', 'tsx')).toBeNull();
    expect(res('src/pages/home.tsx', 'node:fs', 'tsx')).toBeNull();
    expect(res('src/pages/home.tsx', '@components/Missing', 'tsx')).toBeNull();
    expect(res('src/pages/home.tsx', '../../../outside', 'tsx')).toBeNull();
  });

  it('Python: relative, from-import submodule, src layout, script dir, stdlib shadow', () => {
    expect(res('pyproj/src/pkg/sub/views.py', '..models', 'python', { kind: 'from', names: ['User'] })).toBe('pyproj/src/pkg/models.py');
    expect(res('pyproj/src/pkg/models.py', '.', 'python', { kind: 'from', names: ['sub'] })).toBe('pyproj/src/pkg/sub/__init__.py');
    expect(res('pyproj/src/pkg/models.py', 'pkg.sub', 'python', { kind: 'from', names: ['views'] })).toBe('pyproj/src/pkg/sub/views.py');
    expect(res('pyproj/scripts/run.py', 'pkg.models', 'python')).toBe('pyproj/src/pkg/models.py');
    expect(res('pyproj/scripts/run.py', 'helper', 'python')).toBe('pyproj/scripts/helper.py');
    // Inside a package, `import typing` is the stdlib, not the sibling typing.py.
    expect(res('pyproj/src/pkg/models.py', 'typing', 'python')).toBeNull();
    expect(res('pyproj/src/pkg/models.py', 'os', 'python')).toBeNull();
  });

  it('Rust: crate/self/super paths, mod declarations, workspace crates', () => {
    expect(res('rs/core/src/lib.rs', 'net', 'rust', { kind: 'mod' })).toBe('rs/core/src/net.rs');
    expect(res('rs/core/src/net.rs', 'tcp', 'rust', { kind: 'mod' })).toBe('rs/core/src/net/tcp.rs');
    expect(res('rs/core/src/net/tcp.rs', 'crate::config::Settings', 'rust', { kind: 'use' })).toBe('rs/core/src/config/mod.rs');
    expect(res('rs/core/src/net/tcp.rs', 'super::Thing', 'rust', { kind: 'use' })).toBe('rs/core/src/net.rs');
    expect(res('rs/cli/src/main.rs', 'acme_core::net::Conn', 'rust', { kind: 'use' })).toBe('rs/core/src/net.rs');
    expect(res('rs/cli/src/main.rs', 'acme_core::Thing', 'rust', { kind: 'use' })).toBe('rs/core/src/lib.rs');
    expect(res('rs/cli/src/main.rs', 'acme_core::missing::Deep', 'rust', { kind: 'use' })).toBeNull();
    expect(res('rs/cli/src/main.rs', 'std::collections::HashMap', 'rust', { kind: 'use' })).toBeNull();
  });

  it('Go: module prefix → package dir, local replace', () => {
    expect(res('go/cmd/main.go', 'example.com/m/protos/pb', 'go')).toBe('go/protos/pb/');
    expect(res('go/cmd/main.go', 'example.com/forked', 'go')).toBe('go/third_party/forked/');
    expect(res('go/cmd/main.go', 'fmt', 'go')).toBeNull();
    expect(res('go/cmd/main.go', 'example.com/m/nope', 'go')).toBeNull();
  });

  it('C++, JVM, Ruby, PHP', () => {
    expect(res('cpp/lib/src/Impl.cc', 'Impl.h', 'cpp', { kind: 'quote' })).toBe('cpp/lib/src/Impl.h');
    expect(res('cpp/lib/src/Impl.cc', 'drogon/HttpTypes.h', 'cpp', { kind: 'angle' })).toBe('cpp/lib/inc/drogon/HttpTypes.h');
    expect(res('cpp/lib/src/Impl.cc', 'vector', 'cpp', { kind: 'angle' })).toBeNull();
    expect(res('jvm/app/src/main/kotlin/com/acme/app/App.kt', 'com.acme.Foo', 'kotlin', { kind: 'jvm' })).toBe('jvm/core/src/main/java/com/acme/Foo.java');
    expect(res('jvm/app/src/main/kotlin/com/acme/app/App.kt', 'com.acme.Foo.bar', 'kotlin', { kind: 'jvm' })).toBe('jvm/core/src/main/java/com/acme/Foo.java');
    expect(res('jvm/app/src/main/kotlin/com/acme/app/App.kt', 'org.junit.Test', 'kotlin', { kind: 'jvm' })).toBeNull();
    expect(res('rb/spec/model_spec.rb', 'spec_helper', 'ruby', { kind: 'relative' })).toBe('rb/spec/spec_helper.rb');
    expect(res('rb/spec/model_spec.rb', 'acme/model', 'ruby', { kind: 'load-path' })).toBe('rb/lib/acme/model.rb');
    expect(res('php/src/Http/Controller.php', 'Acme\\Models\\User', 'php', { kind: 'use' })).toBe('php/src/Models/User.php');
  });

  it('probe mode (no file list) resolves relative paths from disk', () => {
    const probe = createImportResolver({ projectRoot: root });
    expect(probe.resolve('src/pages/home.tsx', { spec: '../lib/util', kind: 'import' }, 'tsx')).toBe('src/lib/util.ts');
    expect(probe.resolve('src/pages/home.tsx', { spec: '@components/Button', kind: 'import' }, 'tsx')).toBe('src/components/Button.tsx');
  });
});

