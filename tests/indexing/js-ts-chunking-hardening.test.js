/**
 * JS/TS Chunking & Entity Extraction Hardening Tests
 *
 * Validates all new and modified patterns from the JS/TS hardening plan:
 * - Phase 1: Chunker boundary detection (regex-path)
 * - Phase 2: Graph entity & relationship extraction
 * - Phase 3: Tree-sitter queries (requires grammars)
 * - Integration: full pipeline tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LANGUAGES } from '../../core/infrastructure/language-patterns/registry.js';
import { ASTChunker } from '../../ast-chunker.js';
import GraphExtractor from '../../core/graph/graph-extractor.js';
import {
  getTreeSitterProvider,
  TAGS_QUERIES,
  CAPTURE_TO_ENTITY_TYPE,
} from '../../core/infrastructure/tree-sitter-provider.js';

const jsConfig = LANGUAGES.javascript;
const tsConfig = LANGUAGES.typescript;
const extractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });

function multiset(values) {
  const map = new Map();
  for (const value of values) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function entitySignatureSet(result) {
  return multiset(result.entities.map(e => `${e.type}:${e.name}`));
}

function relationshipSignatureSet(result) {
  return multiset(
    result.relationships
      .filter(r => r.target_name)
      .map(r => `${r.type}:${r.target_name}`)
  );
}

// =============================================================================
// PHASE 1: CHUNKER BOUNDARY DETECTION
// =============================================================================

describe('Phase 1: Chunker boundary detection', () => {
  const jsChunker = jsConfig.chunker;
  const tsChunker = tsConfig.chunker;

  // 1.1 Arrow functions without parens
  it('detects arrow function without parens (JS)', () => {
    expect('const double = x => x * 2'.match(jsChunker.arrowNoParen)?.[1]).toBe('double');
  });

  it('detects arrow function without parens (TS)', () => {
    expect('const double = x => x * 2'.match(tsChunker.arrowNoParen)?.[1]).toBe('double');
  });

  it('detects async arrow without parens', () => {
    expect('const fn = async x => x'.match(jsChunker.arrowNoParen)?.[1]).toBe('fn');
  });

  // 1.2 let/var arrow functions
  it('detects let arrow function', () => {
    expect('let handler = async ('.match(jsChunker.arrow)?.[1]).toBe('handler');
  });

  it('detects var arrow function', () => {
    expect('var callback = ('.match(jsChunker.arrow)?.[1]).toBe('callback');
  });

  it('still detects const arrow function', () => {
    expect('const fetchData = async ('.match(jsChunker.arrow)?.[1]).toBe('fetchData');
  });

  // 1.3 Generator functions
  it('detects generator function declaration', () => {
    expect('function* generateIds() {'.match(jsChunker.function)?.[1]).toBe('generateIds');
  });

  it('detects async generator function declaration', () => {
    expect('async function* streamData() {'.match(jsChunker.function)?.[1]).toBe('streamData');
  });

  it('detects export generator function', () => {
    expect('export function* iterate() {'.match(jsChunker.function)?.[1]).toBe('iterate');
  });

  it('still detects normal function declaration', () => {
    expect('function main() {'.match(jsChunker.function)?.[1]).toBe('main');
  });

  // 1.4 Getter/setter syntax
  it('detects getter accessor', () => {
    expect('get fullName() {'.match(jsChunker.accessor)?.[1]).toBe('fullName');
  });

  it('detects setter accessor', () => {
    expect('set value(v) {'.match(jsChunker.accessor)?.[1]).toBe('value');
  });

  it('detects getter accessor (TS)', () => {
    expect('get name() {'.match(tsChunker.accessor)?.[1]).toBe('name');
  });

  // 1.5 Object method shorthand
  it('detects object method shorthand inside object literal', () => {
    expect('  getUser() {'.match(jsChunker.objectMethod)?.[1]).toBe('getUser');
  });

  it('detects object method shorthand with params', () => {
    expect('  listUsers(limit) {'.match(jsChunker.objectMethod)?.[1]).toBe('listUsers');
  });

  it('does not match top-level (no indentation) as object method', () => {
    expect('getUser() {'.match(jsChunker.objectMethod)).toBeNull();
  });

  // 1.6 module.exports = { object form (JS only)
  it('detects module.exports = { object form', () => {
    expect('module.exports = {'.match(jsChunker.moduleExportObj)?.[1]).toBe('module.exports');
  });

  it('JS chunker has moduleExportObj', () => {
    expect(jsChunker.moduleExportObj).toBeDefined();
  });

  it('TS chunker does not have moduleExportObj', () => {
    expect(tsChunker.moduleExportObj).toBeUndefined();
  });

  // 1.7 export default declarations
  it('detects export default class', () => {
    expect('export default class UserService {'.match(jsChunker.class)?.[1]).toBe('UserService');
  });

  it('detects export default function', () => {
    expect('export default function main() {'.match(jsChunker.function)?.[1]).toBe('main');
  });

  it('detects export default async function', () => {
    expect('export default async function run() {'.match(jsChunker.function)?.[1]).toBe('run');
  });

  it('still detects export class (non-default)', () => {
    expect('export class Foo {'.match(jsChunker.class)?.[1]).toBe('Foo');
  });

  it('detects export default class (TS)', () => {
    expect('export default class MyClass {'.match(tsChunker.class)?.[1]).toBe('MyClass');
  });

  // 1.8 module.exports = function/class (JS only)
  it('detects module.exports = function', () => {
    expect('module.exports = function createServer() {'.match(jsChunker.moduleExport)?.[1]).toBe('createServer');
  });

  it('detects module.exports = class', () => {
    expect('module.exports = class Foo {'.match(jsChunker.moduleExport)?.[1]).toBe('Foo');
  });

  it('detects module.exports = async function', () => {
    expect('module.exports = async function handler() {'.match(jsChunker.moduleExport)?.[1]).toBe('handler');
  });

  it('detects module.exports = function*', () => {
    expect('module.exports = function* gen() {'.match(jsChunker.moduleExport)?.[1]).toBe('gen');
  });

  it('TS chunker does not have moduleExport', () => {
    expect(tsChunker.moduleExport).toBeUndefined();
  });

  // Pattern ordering: function wins over arrow
  it('function pattern fires before arrow for const function', () => {
    const line = 'const processItem = async (';
    const funcMatch = line.match(jsChunker.function);
    // const+name+= matches the function pattern first
    expect(funcMatch?.[1]).toBe('processItem');
  });
});

// =============================================================================
// PHASE 1 INTEGRATION: FULL CHUNKER PIPELINE (regex path)
// =============================================================================

describe('Phase 1 Integration: chunker produces correct chunks', () => {
  it('JS file with mixed modern patterns produces correct chunks', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    const content = `const double = x => x * 2;

let handler = async (req, res) => {
  return res.send('ok');
};

function* generateIds() {
  let id = 0;
  while (true) yield id++;
}

class UserService {
  get fullName() {
    return this.first + ' ' + this.last;
  }
  set value(v) {
    this._value = v;
  }
}

export default function main() {
  console.log('hello');
  console.log('world');
}

module.exports = function createServer() {
  return http.createServer();
  // more code here to ensure chunk size
};
`;
    const chunks = await chunker.parseFile('/test/app.js', content);
    expect(chunks.length).toBeGreaterThan(0);
    const symbols = chunks.map(c => c.metadata.symbol);
    // At least some of our new patterns should have triggered boundaries
    expect(symbols.some(s => s === 'UserService' || s === 'main' || s === 'generateIds')).toBe(true);
  });

  it('module.exports = { detected as chunker boundary', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    const content = `const helper = () => {
  return 42;
};

module.exports = {
  getUser() {
    return { id: 1 };
  },
  listUsers() {
    return [{ id: 1 }, { id: 2 }];
  },
};
`;
    const chunks = await chunker.parseFile('/test/routes.js', content);
    const symbols = chunks.map(c => c.metadata.symbol);
    expect(symbols.some(s => s === 'module.exports')).toBe(true);
  });
});

// =============================================================================
// PHASE 2: GRAPH ENTITY EXTRACTION
// =============================================================================

describe('Phase 2: Graph entity extraction', () => {
  const jsEntities = jsConfig.graph.entities;
  const tsEntities = tsConfig.graph.entities;
  const jsRels = jsConfig.graph.relationships;
  const tsRels = tsConfig.graph.relationships;

  // 2.1 Generator function entity
  it('generator function entity pattern matches', () => {
    expect('function* generateIds('.match(jsEntities.function)?.[1]).toBe('generateIds');
  });

  it('async generator function entity pattern matches', () => {
    expect('async function* streamData('.match(jsEntities.function)?.[1]).toBe('streamData');
  });

  it('export generator function entity pattern matches', () => {
    expect('export function* iterate('.match(jsEntities.function)?.[1]).toBe('iterate');
  });

  // 2.2 require() relationship (group 1 = module path)
  it('require pattern matches simple require', () => {
    const m = "const express = require('express')".match(jsRels.require);
    expect(m?.[1]).toBe('express');
  });

  it('require pattern matches in TS config', () => {
    const m = "const path = require('path')".match(tsRels.require);
    expect(m?.[1]).toBe('path');
  });

  // 2.3 Re-export relationship (group 1 = module path)
  it('reexport pattern matches named re-export', () => {
    const m = "export { UserService } from './services'".match(jsRels.reexport);
    expect(m?.[1]).toBe('./services');
  });

  it('reexport pattern matches star re-export', () => {
    const m = "export * from './utils'".match(jsRels.reexport);
    expect(m?.[1]).toBe('./utils');
  });

  it('reexport pattern exists in TS', () => {
    expect(tsRels.reexport).toBeDefined();
  });

  // 2.4 Dynamic import relationship
  it('dynamic import pattern matches await import', () => {
    const m = "const mod = await import('./module')".match(jsRels.dynamicImport);
    expect(m?.[1]).toBe('./module');
  });

  it('dynamic import pattern matches bare import()', () => {
    const m = "import('lodash')".match(jsRels.dynamicImport);
    expect(m?.[1]).toBe('lodash');
  });

  it('dynamic import pattern exists in TS', () => {
    expect(tsRels.dynamicImport).toBeDefined();
  });

  // 2.5 export default in graph entities
  it('export default class entity', () => {
    expect('export default class UserService {'.match(jsEntities.class)?.[1]).toBe('UserService');
  });

  it('export default function entity', () => {
    expect('export default function main('.match(jsEntities.function)?.[1]).toBe('main');
  });

  it('export default class entity (TS)', () => {
    expect('export default class Repo {'.match(tsEntities.class)?.[1]).toBe('Repo');
  });

  // 2.6 Destructured requires (group 1 = module path in registry pattern)
  it('destructured require pattern captures module', () => {
    const m = "const { Router, json } = require('express')".match(jsRels.require);
    // group 1 is the module path
    expect(m?.[1]).toBe('express');
  });

  // 2.7 Named arrow functions in objects
  it('named arrow in object creates entity match', () => {
    const m = 'getUser: async (req, res) => {'.match(jsEntities.objectArrow);
    expect(m?.[1]).toBe('getUser');
  });

  it('named arrow in object (TS)', () => {
    const m = 'handler: (data: Data) => {'.match(tsEntities.objectArrow);
    expect(m?.[1]).toBe('handler');
  });

  // 2.8 Object method shorthand entities
  it('object method shorthand creates entity match', () => {
    expect('  listUsers(limit) {'.match(jsEntities.objectMethod)?.[1]).toBe('listUsers');
  });

  it('object method shorthand skips reserved words', () => {
    // The reserved word guard is in extractJavaScript, not the regex.
    // The regex itself will match, but extractJavaScript skips it.
    expect('  if (condition) {'.match(jsEntities.objectMethod)?.[1]).toBe('if');
    // Integration test below verifies the guard
  });
});

// =============================================================================
// PHASE 2 INTEGRATION: GRAPH EXTRACTOR
// =============================================================================

describe('Phase 2 Integration: graph extractor', () => {
  it('generator function produces entity', async () => {
    const result = await extractor.extractFromFile('/test/gen.js', `
function* generateIds() {
  let id = 0;
  while (true) yield id++;
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'generateIds')).toBe(true);
  });

  it('require() creates imports relationship', async () => {
    const result = await extractor.extractFromFile('/test/app.js', `
const express = require('express');
const app = express();
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'express')).toBe(true);
  });

  it('destructured require creates per-name imports', async () => {
    const result = await extractor.extractFromFile('/test/routes.js', `
const { Router, json } = require('express');
`);
    const importRels = result.relationships.filter(r => r.type === 'imports');
    expect(importRels.some(r => r.target_name === 'Router')).toBe(true);
    expect(importRels.some(r => r.target_name === 'json')).toBe(true);
    // Also the module-level relationship
    expect(importRels.some(r => r.target_name === 'express')).toBe(true);
  });

  it('destructured require with alias uses alias', async () => {
    const result = await extractor.extractFromFile('/test/util.js', `
const { readFile as read } = require('fs');
`);
    const importRels = result.relationships.filter(r => r.type === 'imports');
    expect(importRels.some(r => r.target_name === 'read')).toBe(true);
  });

  it('re-export creates imports relationship', async () => {
    const result = await extractor.extractFromFile('/test/index.js', `
export { UserService } from 'services';
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'services')).toBe(true);
  });

  it('export * from creates relationship', async () => {
    const result = await extractor.extractFromFile('/test/barrel.js', `
export * from 'utils';
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'utils')).toBe(true);
  });

  it('dynamic import creates relationship', async () => {
    const result = await extractor.extractFromFile('/test/lazy.js', `
const mod = await import('lodash');
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'lodash')).toBe(true);
  });

  it('export default class entity extracted', async () => {
    const result = await extractor.extractFromFile('/test/svc.js', `
export default class UserService {
  getUser() {}
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
  });

  it('export default function entity extracted', async () => {
    const result = await extractor.extractFromFile('/test/main.js', `
export default function main() {
  console.log('start');
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'main')).toBe(true);
  });

  it('named arrow in object creates arrowFunction entity', async () => {
    const result = await extractor.extractFromFile('/test/api.js', `
const routes = {
  getUser: async (req, res) => {
    return { id: 1 };
  },
};
`);
    expect(result.entities.some(e => e.type === 'arrowFunction' && e.name === 'getUser')).toBe(true);
  });

  it('named arrow in object guarded by other patterns', async () => {
    const result = await extractor.extractFromFile('/test/top.js', `
const getUser = async (req) => {
  return { id: 1 };
};
`);
    // This should be detected as arrowFunction via the top-level pattern, not objectArrow
    const arrowEntities = result.entities.filter(e => e.name === 'getUser');
    expect(arrowEntities.length).toBe(1);
    expect(arrowEntities[0].type).toBe('arrowFunction');
  });

  it('object method shorthand creates method entity', async () => {
    const result = await extractor.extractFromFile('/test/obj.js', `
const api = {
  listUsers(limit) {
    return [];
  },
};
`);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'listUsers')).toBe(true);
  });

  it('object method shorthand skips reserved words', async () => {
    const result = await extractor.extractFromFile('/test/ctrl.js', `
function run() {
  if (condition) {
    doStuff();
  }
  for (let i = 0; i < 10; i++) {
    loop();
  }
  while (true) {
    wait();
  }
}
`);
    const methods = result.entities.filter(e => e.type === 'method');
    expect(methods.some(m => m.name === 'if')).toBe(false);
    expect(methods.some(m => m.name === 'for')).toBe(false);
    expect(methods.some(m => m.name === 'while')).toBe(false);
  });

  it('arrow function entity type is arrowFunction (not function)', async () => {
    const result = await extractor.extractFromFile('/test/arrow.js', `
const transform = async (data) => {
  return data;
};
`);
    const entity = result.entities.find(e => e.name === 'transform');
    expect(entity).toBeDefined();
    expect(entity.type).toBe('arrowFunction');
  });

  it('CJS module with require/exports produces correct graph', async () => {
    const result = await extractor.extractFromFile('/test/cjs.js', `
const express = require('express');
const { Router } = require('express');
const path = require('path');

function createApp() {
  const app = express();
  return app;
}

module.exports = createApp;
`);
    const importRels = result.relationships.filter(r => r.type === 'imports');
    expect(importRels.some(r => r.target_name === 'express')).toBe(true);
    expect(importRels.some(r => r.target_name === 'path')).toBe(true);
    expect(importRels.some(r => r.target_name === 'Router')).toBe(true);
    expect(result.entities.some(e => e.name === 'createApp')).toBe(true);
  });

  it('Express-style route object produces method entities', async () => {
    const result = await extractor.extractFromFile('/test/routes.js', `
const routes = {
  getUser(req, res) {
    res.json({ id: 1 });
  },
  listUsers(req, res) {
    res.json([]);
  },
  createUser: async (req, res) => {
    res.json({ created: true });
  },
};
`);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'getUser')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'listUsers')).toBe(true);
    expect(result.entities.some(e => e.type === 'arrowFunction' && e.name === 'createUser')).toBe(true);
  });

  it('tree-sitter and regex paths agree on broad JS entity semantics', async () => {
    const treeSitterExtractor = new GraphExtractor({ projectRoot: '/test' });
    const regexExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });
    const code = `
class Base {}
export class UserService extends Base {
  getUser() {
    return { id: 1 };
  }
}
export default function main() {
  return 42;
}
function* iterate() {
  yield 1;
}
const routes = {
  getUser: async (req, res) => {
    return { id: 1 };
  },
  listUsers(limit) {
    return [];
  },
};
const MyWidget = (props) => props.children;
`;
    const tsResult = await treeSitterExtractor.extractFromFile('/test/parity-entities.js', code);
    const rxResult = await regexExtractor.extractFromFile('/test/parity-entities.js', code);

    expect(entitySignatureSet(tsResult)).toEqual(entitySignatureSet(rxResult));
  });

  it('tree-sitter and regex paths agree on broad JS relationship semantics', async () => {
    const treeSitterExtractor = new GraphExtractor({ projectRoot: '/test' });
    const regexExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });
    const code = `
import React from 'react';
import { localThing } from './local';
const express = require('express');
const { Router, json, readFile: read } = require('express');
export { Foo } from 'barrel-lib';
export * from 'star-lib';
const mod = await import('lodash');
class Child extends Base {}
function run() {
  service.process();
  console.log('ignored');
}
`;
    const tsResult = await treeSitterExtractor.extractFromFile('/test/parity-relationships.js', code);
    const rxResult = await regexExtractor.extractFromFile('/test/parity-relationships.js', code);

    expect(relationshipSignatureSet(tsResult)).toEqual(relationshipSignatureSet(rxResult));
  });

  it('tree-sitter and regex paths agree on broad TS entity + relationship semantics', async () => {
    const treeSitterExtractor = new GraphExtractor({ projectRoot: '/test' });
    const regexExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });
    const code = `
import { Injectable } from '@nestjs/common';

export interface UserConfig {
  id: string;
}

export type UserId = string;

export enum LogLevel {
  Info,
  Warn,
}

export namespace Api {
  export const version = 'v1';
}

@Injectable
export abstract class BaseService extends RootService implements IService, IAudit {}

export default function runApp() {
  service.process();
}

const createUser = async (payload: UserConfig) => payload;
`;
    const tsResult = await treeSitterExtractor.extractFromFile('/test/parity.ts', code);
    const rxResult = await regexExtractor.extractFromFile('/test/parity.ts', code);

    expect(entitySignatureSet(tsResult)).toEqual(entitySignatureSet(rxResult));
    expect(relationshipSignatureSet(tsResult)).toEqual(relationshipSignatureSet(rxResult));
  });

  it('tree-sitter and regex paths agree on destructured require imports', async () => {
    const treeSitterExtractor = new GraphExtractor({ projectRoot: '/test' });
    const regexExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });
    const code = `
const { Router, json, readFile: read } = require('express');
`;
    const tsResult = await treeSitterExtractor.extractFromFile('/test/parity-require.js', code);
    const rxResult = await regexExtractor.extractFromFile('/test/parity-require.js', code);

    expect(relationshipSignatureSet(tsResult)).toEqual(relationshipSignatureSet(rxResult));
  });
});

// =============================================================================
// PHASE 3: TREE-SITTER QUERIES
// =============================================================================

describe('Phase 3: Tree-sitter queries', () => {
  // --- Static query shape checks (no grammars needed) ---

  it('TAGS_QUERIES include generator_function_declaration for JS', () => {
    expect(TAGS_QUERIES.javascript).toContain('generator_function_declaration');
  });

  it('TAGS_QUERIES include generator_function_declaration for TS', () => {
    expect(TAGS_QUERIES.typescript).toContain('generator_function_declaration');
  });

  it('TAGS_QUERIES include variable_declarator arrow for JS', () => {
    expect(TAGS_QUERIES.javascript).toContain('variable_declarator');
    expect(TAGS_QUERIES.javascript).toContain('arrow.definition');
  });

  it('TAGS_QUERIES include variable_declarator arrow for TS', () => {
    expect(TAGS_QUERIES.typescript).toContain('variable_declarator');
    expect(TAGS_QUERIES.typescript).toContain('arrow.definition');
  });

  it('TAGS_QUERIES include pair queries for JS', () => {
    expect(TAGS_QUERIES.javascript).toContain('pair');
  });

  it('TAGS_QUERIES include pair queries for TS', () => {
    expect(TAGS_QUERIES.typescript).toContain('pair');
  });

  it('TAGS_QUERIES include namespace query for TS', () => {
    expect(TAGS_QUERIES.typescript).toContain('namespace.definition');
  });

  it('CAPTURE_TO_ENTITY_TYPE maps namespace.definition', () => {
    expect(CAPTURE_TO_ENTITY_TYPE['namespace.definition']).toBe('namespace');
  });

  it('TAGS_QUERIES include export_statement class for JS', () => {
    expect(TAGS_QUERIES.javascript).toContain('export_statement');
  });

  it('TAGS_QUERIES include export_statement class for TS', () => {
    expect(TAGS_QUERIES.typescript).toContain('export_statement');
  });

  // --- Live tree-sitter extraction tests (hard-fail if provider/grammars unavailable) ---

  let provider;
  beforeAll(async () => {
    provider = getTreeSitterProvider();
    expect(await provider.isAvailable()).toBe(true);
  });

  async function extractSymbols(content, lang) {
    const symbols = await provider.extractSymbols(content, lang);
    expect(symbols).not.toBeNull();
    return symbols;
  }

  it('JS arrow function captures variable name', async () => {
    const symbols = await extractSymbols('const fetchData = async (url) => {\n  return fetch(url);\n};\n', 'javascript');
    expect(symbols.some(s => s.name === 'fetchData' && s.type === 'arrowFunction')).toBe(true);
  });

  it('TS arrow function captures variable name', async () => {
    const symbols = await extractSymbols('const transform = async (data: Data) => {\n  return data;\n};\n', 'typescript');
    expect(symbols.some(s => s.name === 'transform' && s.type === 'arrowFunction')).toBe(true);
  });

  it('JS generator function captured', async () => {
    const symbols = await extractSymbols('function* generateIds() {\n  let id = 0;\n  while (true) yield id++;\n}\n', 'javascript');
    expect(symbols.some(s => s.name === 'generateIds' && s.type === 'function')).toBe(true);
  });

  it('JS export default class captured', async () => {
    const symbols = await extractSymbols('export default class UserService {\n  getUser() {}\n}\n', 'javascript');
    expect(symbols.some(s => s.name === 'UserService' && s.type === 'class')).toBe(true);
  });

  it('JS export default function captured', async () => {
    const symbols = await extractSymbols('export default function main() {\n  return 1;\n}\n', 'javascript');
    expect(symbols.some(s => s.name === 'main' && s.type === 'function')).toBe(true);
  });

  it('TS export default function captured', async () => {
    const symbols = await extractSymbols('export default function boot(): void {\n  return;\n}\n', 'typescript');
    expect(symbols.some(s => s.name === 'boot' && s.type === 'function')).toBe(true);
  });

  it('JS object method shorthand captured', async () => {
    const symbols = await extractSymbols('const api = {\n  getUser() {\n    return { id: 1 };\n  },\n};\n', 'javascript');
    expect(symbols.some(s => s.name === 'getUser')).toBe(true);
  });

  it('JS object arrow method captured', async () => {
    const symbols = await extractSymbols('const api = {\n  setUser: (data) => {\n    return data;\n  },\n};\n', 'javascript');
    expect(symbols.some(s => s.name === 'setUser' && s.type === 'arrowFunction')).toBe(true);
  });

  it('TS object method shorthand captured', async () => {
    const symbols = await extractSymbols('const api = {\n  getUser() {\n    return { id: 1 };\n  },\n};\n', 'typescript');
    expect(symbols.some(s => s.name === 'getUser')).toBe(true);
  });
});

// =============================================================================
// INTEGRATION: FULL PIPELINE
// =============================================================================

describe('Integration: full pipeline', () => {
  it('TS file with mixed modern patterns produces correct chunks (regex)', async () => {
    const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
    const content = `export interface Config {
  port: number;
}

export type Handler = (req: Request) => Response;

export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

export default class App {
  get config() {
    return this._config;
  }

  set config(value) {
    this._config = value;
  }
}

let handler = async (req, res) => {
  return res.send('ok');
  // extra lines for chunk size
  // padding
  // padding
};

export default function main() {
  console.log('start');
  console.log('more');
  console.log('lines');
}
`;
    const chunks = await chunker.parseFile('/test/app.ts', content);
    expect(chunks.length).toBeGreaterThan(0);
    const symbols = chunks.map(c => c.metadata.symbol);
    expect(symbols.some(s => s === 'App' || s === 'main' || s === 'Config')).toBe(true);
  });
});
