import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

describe('Brand presence verification', () => {
  it('package.json uses sweet-search name', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('sweet-search');
  });

  it('package.json bin includes sweet-search and sweet-search-mcp', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    // npm pkg fix normalizes bin paths to relative WITHOUT the './' prefix
    // (npm rejects the './' as a leading character — see commit c6efe9a).
    expect(pkg.bin['sweet-search']).toBe('core/cli.js');
    expect(pkg.bin['sweet-search-mcp']).toBeDefined();
    expect(pkg.bin.ss).toBeUndefined();
  });

  it('NOTICE file references Sweet Search', () => {
    const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
    expect(notice).toContain('Sweet Search');
    // NOTICE links the public repo under the author's account (see 72f65bc).
    expect(notice).toContain('mrsladoje/sweet-search');
  });

  // The MCP server name is checked on the wire in mcp-server.test.js (serverInfo.name).

  it('data directory default is .sweet-search', () => {
    const env = { ...process.env };
    delete env.SWEET_SEARCH_DATA_DIR;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { DB_PATHS } from './core/config.js'; import path from 'node:path'; console.log(path.basename(path.dirname(DB_PATHS.codebase)));"],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 30000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('.sweet-search');
  });
});
