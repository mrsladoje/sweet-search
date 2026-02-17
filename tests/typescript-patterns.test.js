/**
 * TypeScript-Specific Pattern Tests
 *
 * Validates that .ts/.tsx files use the dedicated TypeScript language config
 * with interface, type alias, enum, namespace, abstract class, and decorator
 * patterns, while .js files remain on the javascript config.
 */

import { describe, it, expect } from 'vitest';
import { EXTENSION_MAP } from '../core/language-patterns/maps.js';
import { LANGUAGES } from '../core/language-patterns/registry.js';
import { getLanguageByExtension, getLanguageByPath } from '../core/language-patterns.js';
import GraphExtractor from '../core/graph-extractor.js';

const tsConfig = LANGUAGES.typescript;
const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// EXTENSION MAP
// =============================================================================

describe('TypeScript extension mapping', () => {
  it('.ts maps to typescript', () => {
    expect(EXTENSION_MAP['.ts']).toBe('typescript');
  });

  it('.tsx maps to typescript', () => {
    expect(EXTENSION_MAP['.tsx']).toBe('typescript');
  });

  it('.js still maps to javascript', () => {
    expect(EXTENSION_MAP['.js']).toBe('javascript');
  });

  it('.jsx still maps to javascript', () => {
    expect(EXTENSION_MAP['.jsx']).toBe('javascript');
  });

  it('.mjs still maps to javascript', () => {
    expect(EXTENSION_MAP['.mjs']).toBe('javascript');
  });

  it('.cjs still maps to javascript', () => {
    expect(EXTENSION_MAP['.cjs']).toBe('javascript');
  });

  it('getLanguageByExtension returns typescript for .ts', () => {
    const lang = getLanguageByExtension('.ts');
    expect(lang.id).toBe('typescript');
  });

  it('getLanguageByPath returns typescript for a .ts file', () => {
    const lang = getLanguageByPath('/project/src/app.ts');
    expect(lang.id).toBe('typescript');
  });

  it('getLanguageByPath returns typescript for a .tsx file', () => {
    const lang = getLanguageByPath('/project/src/App.tsx');
    expect(lang.id).toBe('typescript');
  });

  it('getLanguageByPath returns javascript for a .js file', () => {
    const lang = getLanguageByPath('/project/src/app.js');
    expect(lang.id).toBe('javascript');
  });
});

// =============================================================================
// REGISTRY CONFIG
// =============================================================================

describe('TypeScript registry config', () => {
  it('typescript config exists in LANGUAGES', () => {
    expect(tsConfig).toBeDefined();
  });

  it('is brace-based (not indent)', () => {
    expect(tsConfig.indentBased).toBe(false);
  });

  it('has no end keyword', () => {
    expect(tsConfig.endKeyword).toBeNull();
  });

  it('has line and block comment markers', () => {
    expect(tsConfig.comment.line).toBe('//');
    expect(tsConfig.comment.block).toEqual(['/*', '*/']);
  });
});

// =============================================================================
// CHUNKER PATTERNS
// =============================================================================

describe('TypeScript chunker patterns', () => {
  const { chunker } = tsConfig;

  it('matches regular class', () => {
    expect('class UserService {'.match(chunker.class)?.[1]).toBe('UserService');
  });

  it('matches export class', () => {
    expect('export class UserService {'.match(chunker.class)?.[1]).toBe('UserService');
  });

  it('matches abstract class', () => {
    expect('export abstract class BaseEntity {'.match(chunker.class)?.[1]).toBe('BaseEntity');
  });

  it('matches function declaration', () => {
    expect('export function handleRequest(req: Request) {'.match(chunker.function)?.[1]).toBe('handleRequest');
  });

  it('matches const function', () => {
    expect('const processItem = async ('.match(chunker.function)?.[1]).toBe('processItem');
  });

  it('matches component', () => {
    expect('export const MyComponent ='.match(chunker.component)?.[1]).toBe('MyComponent');
  });

  it('matches arrow function', () => {
    expect('const fetchData = async ('.match(chunker.arrow)?.[1]).toBe('fetchData');
  });

  it('matches interface', () => {
    expect('export interface UserConfig {'.match(chunker.interface)?.[1]).toBe('UserConfig');
  });

  it('matches interface without export', () => {
    expect('interface InternalState {'.match(chunker.interface)?.[1]).toBe('InternalState');
  });

  it('matches type alias with =', () => {
    expect('export type UserId = string;'.match(chunker.typeAlias)?.[1]).toBe('UserId');
  });

  it('matches generic type alias', () => {
    expect('type Result<T> = Promise<T>;'.match(chunker.typeAlias)?.[1]).toBe('Result');
  });

  it('matches enum', () => {
    expect('export enum Status {'.match(chunker.enum)?.[1]).toBe('Status');
  });

  it('matches const enum', () => {
    expect('export const enum Direction {'.match(chunker.enum)?.[1]).toBe('Direction');
  });

  it('matches namespace', () => {
    expect('export namespace Api {'.match(chunker.namespace)?.[1]).toBe('Api');
  });

  it('matches declare namespace', () => {
    expect('export declare namespace Express {'.match(chunker.namespace)?.[1]).toBe('Express');
  });
});

// =============================================================================
// GRAPH ENTITY PATTERNS
// =============================================================================

describe('TypeScript graph entity patterns', () => {
  const { entities } = tsConfig.graph;

  it('matches class with extends and implements', () => {
    const m = 'export class UserService extends BaseService implements IService {'.match(entities.class);
    expect(m?.[1]).toBe('UserService');
    expect(m?.[2]).toBe('BaseService');
    expect(m?.[3]).toContain('IService');
  });

  it('matches abstract class', () => {
    const m = 'export abstract class Repository {'.match(entities.class);
    expect(m?.[1]).toBe('Repository');
  });

  it('matches function', () => {
    expect('export async function fetchUsers('.match(entities.function)?.[1]).toBe('fetchUsers');
  });

  it('matches arrow function entity', () => {
    expect('export const processItem = async (item: Item) => {'.match(entities.arrowFunction)?.[1]).toBe('processItem');
  });

  it('matches component entity', () => {
    expect('export const Dashboard ='.match(entities.component)?.[1]).toBe('Dashboard');
  });

  it('matches interface with extends', () => {
    const m = 'export interface UserConfig extends BaseConfig {'.match(entities.interface);
    expect(m?.[1]).toBe('UserConfig');
    expect(m?.[2]).toContain('BaseConfig');
  });

  it('matches interface without extends', () => {
    expect('interface Options {'.match(entities.interface)?.[1]).toBe('Options');
  });

  it('matches type alias', () => {
    expect('export type UserId = string;'.match(entities.typeAlias)?.[1]).toBe('UserId');
  });

  it('matches generic type alias', () => {
    expect('type AsyncResult<T> = Promise<T>;'.match(entities.typeAlias)?.[1]).toBe('AsyncResult');
  });

  it('matches enum', () => {
    expect('export enum Direction {'.match(entities.enum)?.[1]).toBe('Direction');
  });

  it('matches const enum', () => {
    expect('const enum InternalFlag {'.match(entities.enum)?.[1]).toBe('InternalFlag');
  });

  it('matches namespace', () => {
    expect('export namespace Api {'.match(entities.namespace)?.[1]).toBe('Api');
  });

  it('matches declare namespace', () => {
    expect('declare namespace Express {'.match(entities.namespace)?.[1]).toBe('Express');
  });
});

// =============================================================================
// GRAPH RELATIONSHIP PATTERNS
// =============================================================================

describe('TypeScript graph relationship patterns', () => {
  const { relationships } = tsConfig.graph;

  it('matches extends', () => {
    expect('class Foo extends Bar {'.match(relationships.extends)?.[1]).toBe('Bar');
  });

  it('matches implements after extends', () => {
    const m = 'class Foo extends Bar implements IBaz, IQux {'.match(relationships.implements);
    expect(m[1]).toContain('IBaz');
    expect(m[1]).toContain('IQux');
  });

  it('matches implements without extends', () => {
    const m = 'class Foo implements IBaz {'.match(relationships.implements);
    expect(m[1]).toContain('IBaz');
  });

  it('matches named import', () => {
    const m = "import { Router } from 'express';".match(relationships.import);
    expect(m?.[1]).toContain('Router');
    expect(m?.[3]).toBe('express');
  });

  it('matches default import', () => {
    const m = "import React from 'react';".match(relationships.import);
    expect(m?.[2]).toBe('React');
    expect(m?.[3]).toBe('react');
  });

  it('matches method call', () => {
    const m = 'service.processRequest('.match(relationships.methodCall);
    expect(m?.[1]).toBe('service');
    expect(m?.[2]).toBe('processRequest');
  });

  it('matches decorator', () => {
    expect('@Injectable'.match(relationships.decorator)?.[1]).toBe('Injectable');
  });

  it('matches dotted decorator', () => {
    expect('@Module.Config'.match(relationships.decorator)?.[1]).toBe('Module.Config');
  });
});

// =============================================================================
// GRAPH EXTRACTOR INTEGRATION
// =============================================================================

describe('TypeScript graph extractor integration', () => {
  it('extracts interface entity from .ts file', async () => {
    const result = await extractor.extractFromFile('/test/types.ts', `
export interface UserConfig {
  name: string;
  email: string;
}
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'UserConfig')).toBe(true);
  });

  it('extracts type alias entity', async () => {
    const result = await extractor.extractFromFile('/test/types.ts', `
export type UserId = string;
type Callback<T> = (data: T) => void;
`);
    expect(result.entities.some(e => e.type === 'typeAlias' && e.name === 'UserId')).toBe(true);
    expect(result.entities.some(e => e.type === 'typeAlias' && e.name === 'Callback')).toBe(true);
  });

  it('extracts enum entity', async () => {
    const result = await extractor.extractFromFile('/test/enums.ts', `
export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}
export const enum Direction {
  Up,
  Down,
}
`);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Direction')).toBe(true);
  });

  it('extracts namespace entity', async () => {
    const result = await extractor.extractFromFile('/test/ns.ts', `
export namespace Api {
  export function getUser() {}
}
`);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'Api')).toBe(true);
  });

  it('extracts abstract class entity', async () => {
    const result = await extractor.extractFromFile('/test/base.ts', `
export abstract class BaseEntity {
  abstract getId(): string;
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'BaseEntity')).toBe(true);
  });

  it('extracts class with extends and implements relationships', async () => {
    const result = await extractor.extractFromFile('/test/service.ts', `
import { Injectable } from '@nestjs/common';
export class UserService extends BaseService implements IService {
  process() {}
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'BaseService')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports')).toBe(true);
  });

  it('extracts decorator relationship (mapped to uses)', async () => {
    const result = await extractor.extractFromFile('/test/controller.ts', `
@Controller
export class AppController {
  @Get
  index() {}
}
`);
    // decorator type maps to 'uses' in GENERIC_RELATIONSHIP_MAPPING
    expect(result.relationships.some(r => r.type === 'uses' && r.target_name === 'Controller')).toBe(true);
    expect(result.relationships.some(r => r.type === 'uses' && r.target_name === 'Get')).toBe(true);
  });

  it('extracts function and arrow function entities', async () => {
    const result = await extractor.extractFromFile('/test/utils.ts', `
export function parseInput(raw: string): Input {
  return JSON.parse(raw);
}
export const transform = async (data: Data) => {
  return data;
};
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'parseInput')).toBe(true);
    expect(result.entities.some(e => e.type === 'arrowFunction' && e.name === 'transform')).toBe(true);
  });

  it('filters skipCallObjects from method calls', async () => {
    const result = await extractor.extractFromFile('/test/logger.ts', `
export function run() {
  console.log('start');
  service.process();
}
`);
    const calls = result.relationships.filter(r => r.type === 'calls');
    expect(calls.some(r => r.target_name === 'console.log')).toBe(false);
    expect(calls.some(r => r.target_name === 'service.process')).toBe(true);
  });

  it('produces mixed entities for a realistic TS file', async () => {
    const result = await extractor.extractFromFile('/test/app.ts', `
import { Router } from 'express';

export interface AppConfig {
  port: number;
  host: string;
}

export type Handler = (req: Request) => Response;

export enum LogLevel {
  Debug,
  Info,
  Error,
}

export abstract class BaseApp {
  abstract start(): void;
}

export class App extends BaseApp {
  start() {
    router.listen(3000);
  }
}

export const createApp = (config: AppConfig) => {
  return new App();
};
`);
    const types = result.entities.map(e => e.type);
    expect(types).toContain('interface');
    expect(types).toContain('typeAlias');
    expect(types).toContain('enum');
    expect(types).toContain('class');
    expect(types).toContain('arrowFunction');
    expect(result.relationships.some(r => r.type === 'imports')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends')).toBe(true);
  });
});
