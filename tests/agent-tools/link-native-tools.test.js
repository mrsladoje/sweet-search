/**
 * The install step that makes each ss-* command the native binary itself
 * (scripts/link-native-tools.js), and init's PATH check (setUpAgentTools).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { linkNativeAgentTools } from '../../scripts/link-native-tools.js';
import { setUpAgentTools } from '../../scripts/init.js';
import { AGENT_TOOLS, AGENT_TOOLS_PROTOCOL_MARKER, subcommandFor } from '../../core/agent-tools/tools.js';

const NAMES = Object.keys(AGENT_TOOLS);

function fakeInstall() {
  const base = mkdtempSync(path.join(tmpdir(), 'ss-link-'));
  const pkg = path.join(base, 'node_modules', 'sweet-search');
  mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  for (const n of NAMES) writeFileSync(path.join(pkg, 'bin', n), '#!/usr/bin/env node\n// stub\n');
  const binary = path.join(base, 'native-bin');
  writeFileSync(binary, `\x7fELF fake ${AGENT_TOOLS_PROTOCOL_MARKER}`);
  chmodSync(binary, 0o755);
  return { base, pkg, binary };
}

describe('linkNativeAgentTools', () => {
  it('replaces every stub with the native binary, executable, leaving no temp files', () => {
    const { pkg, binary } = fakeInstall();
    const r = linkNativeAgentTools({ packageRoot: pkg, resolveBinary: () => binary, supportsAgentTools: () => true });
    expect(r.status).toBe('linked');
    expect(r.linked).toEqual(NAMES);
    for (const n of NAMES) {
      const f = path.join(pkg, 'bin', n);
      expect(readFileSync(f, 'utf8')).toContain(AGENT_TOOLS_PROTOCOL_MARKER);
      expect(statSync(f).mode & 0o111).toBeTruthy();
    }
    expect(readFileSync(path.join(pkg, 'bin', 'ss-grep'), 'utf8')).not.toContain('stub');
    // Idempotent: a second run (init after postinstall) relinks cleanly.
    expect(linkNativeAgentTools({ packageRoot: pkg, resolveBinary: () => binary, supportsAgentTools: () => true }).status).toBe('linked');
    expect(statSync(path.join(pkg, 'bin')).isDirectory()).toBe(true);
    expect(NAMES.every((n) => !existsSync(path.join(pkg, 'bin', `${n}.native-${process.pid}`)))).toBe(true);
  });

  it('never touches a development checkout, a missing binary, or a binary without ss-* support', () => {
    const { pkg, binary } = fakeInstall();
    const dev = mkdtempSync(path.join(tmpdir(), 'ss-dev-'));
    expect(linkNativeAgentTools({ packageRoot: dev, resolveBinary: () => binary, supportsAgentTools: () => true }).status).toBe('skipped');
    expect(linkNativeAgentTools({ packageRoot: pkg, resolveBinary: () => null }).status).toBe('skipped');
    expect(linkNativeAgentTools({ packageRoot: pkg, resolveBinary: () => binary, supportsAgentTools: () => false }).status).toBe('skipped');
    expect(readFileSync(path.join(pkg, 'bin', 'ss-read'), 'utf8')).toContain('stub');
  });
});

describe('setUpAgentTools (init)', () => {
  it('reports native tools on PATH', () => {
    const { pkg } = fakeInstall();
    const r = setUpAgentTools({ env: { PATH: `/nonexistent:${path.join(pkg, 'bin')}` }, link: () => ({ status: 'linked', detail: 'x' }) });
    expect(r).toMatchObject({ status: 'native', onPath: true });
  });

  it('names the missing commands and the fix when they are not on PATH', () => {
    const r = setUpAgentTools({ env: { PATH: '/nonexistent' }, link: () => ({ status: 'skipped', detail: 'x' }) });
    expect(r.onPath).toBe(false);
    expect(r.status).toBe('missing');
    expect(r.detail).toContain('ss-search');
    expect(r.detail).toContain('npm install -g sweet-search');
  });
});

describe('tool table', () => {
  it('maps names and subcommands, and nothing else', () => {
    expect(subcommandFor('ss-search')).toBe('agent-search');
    expect(subcommandFor('grep')).toBe('grep');
    expect(subcommandFor('ss-batch')).toBeNull();
  });

  it('matches the native binary table and the bin stubs', () => {
    const rs = readFileSync(path.resolve(__dirname, '../../crates/sweet-search-cli/src/agent_tools.rs'), 'utf8');
    for (const [name, sub] of Object.entries(AGENT_TOOLS)) {
      expect(rs).toContain(`("${name}", "${sub}")`);
      expect(readFileSync(path.resolve(__dirname, '../../bin', name), 'utf8')).toContain(`launchAgentTool('${name}')`);
    }
    expect(rs).toContain(`"${AGENT_TOOLS_PROTOCOL_MARKER}"`);
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    for (const name of NAMES) expect(pkg.bin[name]).toBe(`bin/${name}`);
  });
});
