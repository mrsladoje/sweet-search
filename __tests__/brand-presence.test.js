import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('Brand presence verification', () => {
  it('package.json uses sweet-search name', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('sweet-search');
  });

  it('package.json bin includes ss and sweet-search-mcp', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin.ss).toBeDefined();
    expect(pkg.bin['sweet-search-mcp']).toBeDefined();
  });

  it('NOTICE file references Sweet Search', () => {
    const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
    expect(notice).toContain('Sweet Search');
    expect(notice).toContain('panonitorg/sweet-search');
  });

  it('MCP server name is sweet-search', () => {
    const server = readFileSync(join(ROOT, 'mcp', 'server.js'), 'utf8');
    expect(server).toContain("name: 'sweet-search'");
  });

  it('core module header says Sweet Search', () => {
    const core = readFileSync(join(ROOT, 'core', 'sweet-search.js'), 'utf8');
    expect(core).toContain('Sweet Search v2.3');
  });

  it('data directory default is .sweet-search', () => {
    const config = readFileSync(join(ROOT, 'core', 'config.js'), 'utf8');
    expect(config).toContain("'.sweet-search'");
  });

  it('socket path is /tmp/sweet-search.sock', () => {
    const core = readFileSync(join(ROOT, 'core', 'sweet-search.js'), 'utf8');
    expect(core).toContain('/tmp/sweet-search.sock');
  });
});
