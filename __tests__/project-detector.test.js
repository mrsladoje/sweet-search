import { describe, it, expect, afterEach } from 'vitest';
import { detectProjectBoundary, clearBoundaryCache } from '../core/project-detector.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('project-detector', () => {
  let tempDir;

  afterEach(() => {
    clearBoundaryCache();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns root project when no sub-project markers exist', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'project-'));
    const subDir = join(tempDir, 'src', 'modules');
    mkdirSync(subDir, { recursive: true });
    const filePath = join(subDir, 'file.js');
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.path).toBe(tempDir);
    expect(result.name).toBeTruthy();
  });

  it('detects sub-project boundary via package.json', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'monorepo-'));
    const subProject = join(tempDir, 'packages', 'auth-service');
    mkdirSync(subProject, { recursive: true });
    writeFileSync(join(subProject, 'package.json'), '{}');
    const filePath = join(subProject, 'src', 'index.js');
    mkdirSync(join(subProject, 'src'));
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.path).toBe(subProject);
    expect(result.name).toBe('auth-service');
  });

  it('detects sub-project boundary via go.mod', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'go-mono-'));
    const goProject = join(tempDir, 'services', 'api-gateway');
    mkdirSync(goProject, { recursive: true });
    writeFileSync(join(goProject, 'go.mod'), 'module example.com/api-gateway');
    const filePath = join(goProject, 'main.go');
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.path).toBe(goProject);
    expect(result.name).toBe('api-gateway');
  });

  it('detects sub-project boundary via Cargo.toml', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rust-'));
    const rustProject = join(tempDir, 'crates', 'parser-lib');
    mkdirSync(rustProject, { recursive: true });
    writeFileSync(join(rustProject, 'Cargo.toml'), '[package]');
    const filePath = join(rustProject, 'src', 'lib.rs');
    mkdirSync(join(rustProject, 'src'));
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.path).toBe(rustProject);
    expect(result.name).toBe('parser-lib');
  });

  it('converts directory names to kebab-case', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'test-'));
    const camelCaseDir = join(tempDir, 'MyAuthService');
    mkdirSync(camelCaseDir, { recursive: true });
    writeFileSync(join(camelCaseDir, 'package.json'), '{}');
    const filePath = join(camelCaseDir, 'index.js');
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.name).toBe('my-auth-service');
  });

  it('converts spaces and underscores to hyphens', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'test-'));
    const spacedDir = join(tempDir, 'My Cool_App');
    mkdirSync(spacedDir, { recursive: true });
    writeFileSync(join(spacedDir, 'package.json'), '{}');
    const filePath = join(spacedDir, 'app.js');
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.name).toBe('my-cool-app');
  });

  it('caches boundary lookups for performance', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cache-'));
    const subProject = join(tempDir, 'packages', 'cache-test');
    mkdirSync(subProject, { recursive: true });
    writeFileSync(join(subProject, 'package.json'), '{}');
    const filePath = join(subProject, 'index.js');
    writeFileSync(filePath, '');

    const result1 = detectProjectBoundary(filePath, tempDir);
    const result2 = detectProjectBoundary(filePath, tempDir);

    expect(result1).toBe(result2); // Same object reference = cached
    expect(result1.name).toBe('cache-test');
  });

  it('cache clears after clearBoundaryCache call', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clear-'));
    const filePath = join(tempDir, 'test.js');
    writeFileSync(filePath, '');

    const result1 = detectProjectBoundary(filePath, tempDir);
    clearBoundaryCache();
    const result2 = detectProjectBoundary(filePath, tempDir);

    expect(result1).not.toBe(result2); // Different object = cache cleared
    expect(result1).toEqual(result2); // But same values
  });

  it('does not walk past projectRoot', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'boundary-'));
    const deepDir = join(tempDir, 'a', 'b', 'c');
    mkdirSync(deepDir, { recursive: true });
    const filePath = join(deepDir, 'file.js');
    writeFileSync(filePath, '');

    const result = detectProjectBoundary(filePath, tempDir);

    expect(result.path).toBe(tempDir);
  });
});
