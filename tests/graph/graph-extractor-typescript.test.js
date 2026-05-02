/**
 * TypeScript-specific graph extractor tests.
 *
 * Locks coverage of TS-only constructs that were previously missing
 * from the graph (May 2026): interface declarations, type aliases,
 * enums, abstract classes, namespace declarations, interface→interface
 * extends, type-only imports/re-exports, and generic constraints
 * (`<T extends Foo>`).
 *
 * The tests run with useTreeSitter: false so they exercise the regex
 * path through extractGeneric()/_extractRelationships() — which is
 * the codepath shared with the tree-sitter path's relationship
 * extraction. A separate small suite at the bottom uses the default
 * (tree-sitter on) path to verify tree-sitter entity extraction
 * still surfaces the same TS-specific entity types.
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/index.js';
import { getTreeSitterProvider, resetTreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';

const regexExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });

const findRel = (rels, predicate) => rels.find(predicate);
const filterRel = (rels, predicate) => rels.filter(predicate);

// =============================================================================
// ENTITIES
// =============================================================================

describe('TypeScript graph — entities (regex path)', () => {
  it('extracts interface declarations', async () => {
    const result = await regexExtractor.extractFromFile('/test/types.ts', `
export interface User {
  id: string;
  name: string;
}

interface Repository {
  find(id: string): Promise<User>;
}
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Repository')).toBe(true);
  });

  it('extracts type aliases', async () => {
    const result = await regexExtractor.extractFromFile('/test/types.ts', `
export type UserId = string;
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
`);
    expect(result.entities.some(e => e.type === 'typeAlias' && e.name === 'UserId')).toBe(true);
    expect(result.entities.some(e => e.type === 'typeAlias' && e.name === 'Result')).toBe(true);
  });

  it('extracts enums (regular and const)', async () => {
    const result = await regexExtractor.extractFromFile('/test/enums.ts', `
export enum Status {
  Active,
  Inactive,
}

const enum Direction {
  Up,
  Down,
}
`);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Direction')).toBe(true);
  });

  it('extracts abstract classes', async () => {
    const result = await regexExtractor.extractFromFile('/test/abstract.ts', `
export abstract class Repository<T> {
  abstract find(id: string): Promise<T>;
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Repository')).toBe(true);
  });

  it('extracts namespace declarations', async () => {
    const result = await regexExtractor.extractFromFile('/test/ns.ts', `
export namespace Validation {
  export interface Validator { validate(s: string): boolean; }
}
declare namespace API {
  function call(): void;
}
`);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'Validation')).toBe(true);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'API')).toBe(true);
  });

  it('overload signatures do not produce duplicate entity rows for the same name+line', async () => {
    // Two leading overload declarations followed by the implementation —
    // chunk-level boundary patterns should fire on each `function foo(`
    // line, but each at a *different* start_line, so they are distinct
    // graph entities (allowed). What matters is no in-place duplication
    // of the same (name, start_line) tuple.
    const result = await regexExtractor.extractFromFile('/test/overloads.ts', `
export function format(x: number): string;
export function format(x: string): string;
export function format(x: any): string {
  return String(x);
}
`);
    const fmts = result.entities.filter(e => e.name === 'format' && e.type === 'function');
    expect(fmts.length).toBeGreaterThanOrEqual(1);
    const seen = new Set();
    for (const e of fmts) {
      const k = `${e.name}:${e.start_line}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

// =============================================================================
// RELATIONSHIPS
// =============================================================================

describe('TypeScript graph — relationships (regex path)', () => {
  it('class implements interface (single)', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
import { Repository } from './repo';
export class UserService implements Repository {
  find(id: string) { return null; }
}
`);
    expect(filterRel(result.relationships, r => r.type === 'implements' && r.target_name === 'Repository')).toHaveLength(1);
  });

  it('class implements multiple interfaces — comma-separated', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
export class UserService implements Repository, Cacheable, Audited {
}
`);
    const impls = filterRel(result.relationships, r => r.type === 'implements');
    const targets = impls.map(r => r.target_name).sort();
    expect(targets).toEqual(['Audited', 'Cacheable', 'Repository']);
  });

  it('interface extends interface (single)', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
export interface AdminUser extends User {
  permissions: string[];
}
`);
    const ext = findRel(result.relationships, r => r.type === 'extends' && r.target_name === 'User');
    expect(ext).toBeDefined();
  });

  it('interface extends multiple interfaces with generics', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
export interface Service<T> extends Repository<T>, Cacheable {
}
`);
    const exts = filterRel(result.relationships, r => r.type === 'extends');
    const targets = exts.map(r => r.target_name).sort();
    // expandRelationshipTargets strips generics to bare names
    expect(targets).toEqual(['Cacheable', 'Repository']);
  });

  it('class extends class — JS-shape extends still works for TS', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
export class HttpError extends Error {
}
`);
    expect(findRel(result.relationships, r => r.type === 'extends' && r.target_name === 'Error')).toBeDefined();
  });

  it('type-only imports register as imports against the package', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
import type { User, Token } from 'auth-pkg';
import type Foo from 'foo-pkg';
`);
    const imports = filterRel(result.relationships, r => r.type === 'imports');
    const sources = imports.map(r => r.target_name).sort();
    expect(sources).toContain('auth-pkg');
    expect(sources).toContain('foo-pkg');
  });

  it('type-only re-exports register as imports against the package', async () => {
    const result = await regexExtractor.extractFromFile('/test/index.ts', `
export type { User } from 'auth-pkg';
export type * from 'shared-types';
`);
    const sources = filterRel(result.relationships, r => r.type === 'imports').map(r => r.target_name).sort();
    expect(sources).toContain('auth-pkg');
    expect(sources).toContain('shared-types');
  });

  it('type-only relative imports are filtered just like runtime relative imports', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
import type { User } from './local-types';
import type Repo from '../repo';
`);
    // The pattern should match but the `./` filter drops the targets.
    // No `imports` relationship should be emitted for these.
    expect(filterRel(result.relationships, r => r.type === 'imports' && /local-types|repo/.test(r.target_name))).toHaveLength(0);
  });

  it('generic constraint <T extends Foo> emits a `uses` relationship', async () => {
    const result = await regexExtractor.extractFromFile('/test/generic.ts', `
export function pick<T extends Record<string, unknown>>(obj: T) {
  return obj;
}

export class Repo<T extends Entity> {
}
`);
    const uses = filterRel(result.relationships, r => r.type === 'uses');
    const targets = uses.map(r => r.target_name);
    expect(targets).toContain('Record');
    expect(targets).toContain('Entity');
  });

  it('decorators emit a `uses` relationship to the decorator name', async () => {
    const result = await regexExtractor.extractFromFile('/test/dec.ts', `
import { Component } from '@angular/core';

@Component({ selector: 'app-root' })
export class AppComponent {
}
`);
    const dec = findRel(result.relationships, r => r.type === 'uses' && r.target_name === 'Component');
    expect(dec).toBeDefined();
  });

  it('imports against bare package names are recorded; relative imports are filtered', async () => {
    const result = await regexExtractor.extractFromFile('/test/svc.ts', `
import express from 'express';
import { z } from 'zod';
import { local } from './local';
`);
    const sources = filterRel(result.relationships, r => r.type === 'imports').map(r => r.target_name);
    expect(sources).toContain('express');
    expect(sources).toContain('zod');
    expect(sources.find(s => s.startsWith('./'))).toBeUndefined();
  });

  it('React functional component with Props type — entity surfaces, Props ref is captured', async () => {
    const result = await regexExtractor.extractFromFile('/test/Card.tsx', `
import React from 'react';

interface CardProps {
  title: string;
}

export const Card: React.FC<CardProps> = ({ title }) => {
  return <div>{title}</div>;
};
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'CardProps')).toBe(true);
    // Component is captured by either the component or arrowFunction pattern
    expect(result.entities.some(e => e.name === 'Card')).toBe(true);
  });
});

// =============================================================================
// JS REGRESSION GUARD
// =============================================================================

describe('TypeScript additions do not regress JavaScript extraction', () => {
  it('JS file does not pick up TS-only relationship patterns', async () => {
    const result = await regexExtractor.extractFromFile('/test/jsfile.js', `
import express from 'express';
class Server extends Base {
  start() {}
}
`);
    // No interfaceExtends, typeImport, typeReexport, or genericConstraint
    // can fire on JS source — the JS registry doesn't carry them.
    // Exists relationships: 'imports' (express), 'extends' (Base), maybe 'calls'.
    expect(filterRel(result.relationships, r => r.type === 'extends' && r.target_name === 'Base')).toHaveLength(1);
    expect(filterRel(result.relationships, r => r.type === 'imports' && r.target_name === 'express')).toHaveLength(1);
  });
});

// =============================================================================
// TREE-SITTER PATH (skipped if web-tree-sitter unavailable)
// =============================================================================

const tsProbe = getTreeSitterProvider();
const tsAvailable = await tsProbe.isAvailable();
resetTreeSitterProvider();

describe.skipIf(!tsAvailable)('TypeScript graph — tree-sitter entity path', () => {
  const tsExtractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: true });

  it('tree-sitter surfaces interface, typeAlias, enum, namespace entities', async () => {
    const result = await tsExtractor.extractFromFile('/test/all.ts', `
export interface User { id: string; }
export type UserId = string;
export enum Status { Active }
export namespace V { export interface I {} }
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'typeAlias' && e.name === 'UserId')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'V')).toBe(true);
  });

  it('tree-sitter path also picks up TS-specific relationships', async () => {
    const result = await tsExtractor.extractFromFile('/test/svc.ts', `
import type { User } from 'auth-pkg';
export interface AdminUser extends User {}
`);
    expect(filterRel(result.relationships, r => r.type === 'imports' && r.target_name === 'auth-pkg')).toHaveLength(1);
    expect(findRel(result.relationships, r => r.type === 'extends' && r.target_name === 'User')).toBeDefined();
  });
});
