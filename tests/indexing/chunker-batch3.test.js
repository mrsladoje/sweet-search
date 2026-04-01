/**
 * Batch 3: Chunker + entity tests
 * Languages: Shell, PowerShell, Nim (indent-based), F# (indent-based), Sass (indent-based)
 */

import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import GraphExtractor from '../../core/graph/graph-extractor.js';

const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
const extractor = new GraphExtractor({ projectRoot: '/test' });

function chunkSummary(chunks) {
  return chunks.map(c => ({
    type: c.metadata.chunk_type,
    name: c.metadata.symbol,
    lang: c.metadata.language,
  }));
}

// =============================================================================
// SHELL (brace-based)
// =============================================================================

describe('Shell chunker', () => {
  it('chunks shell functions (function keyword)', async () => {
    const chunks = await chunker.parseFile('/test/deploy.sh', [
      'function setup_env() {',
      '  export PATH="/usr/local/bin:$PATH"',
      '  export NODE_ENV="production"',
      '  echo "Environment configured"',
      '}',
      '',
      'function run_tests() {',
      '  npm test -- --run',
      '  echo "Tests complete"',
      '  return $?',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'function' && s.name === 'setup_env')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'run_tests')).toBe(true);
    expect(chunks[0].metadata.language).toBe('shell');
  });

  it('chunks shell functions (shorthand syntax)', async () => {
    const chunks = await chunker.parseFile('/test/util.sh', [
      'cleanup() {',
      '  rm -rf /tmp/build',
      '  echo "Cleaned up temp files"',
      '  echo "Done"',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(1);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'function' && s.name === 'cleanup')).toBe(true);
  });
});

describe('Shell entity extraction', () => {
  it('extracts functions and source relationships', async () => {
    const result = await extractor.extractFromFile('/test/init.sh', [
      'source ./config.sh',
      '. ./utils.sh',
      '',
      'function main() {',
      '  setup_env',
      '  run_tests',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(1);
    expect(result.relationships.length).toBe(2);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'main')).toBe(true);
    expect(result.relationships.some(r => r.target_name === './config.sh')).toBe(true);
    expect(result.relationships.some(r => r.target_name === './utils.sh')).toBe(true);
  });
});

// =============================================================================
// POWERSHELL (brace-based)
// =============================================================================

describe('PowerShell chunker', () => {
  it('chunks PowerShell functions and classes', async () => {
    const chunks = await chunker.parseFile('/test/Module.ps1', [
      'function Get-UserProfile {',
      '  param([string]$Name)',
      '  Write-Host "Getting profile for $Name"',
      '  return @{ Name = $Name }',
      '}',
      '',
      'class ServerConfig {',
      '  [string]$Host',
      '  [int]$Port',
      '  [bool]$Secure',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'function' && s.name === 'Get-UserProfile')).toBe(true);
    expect(summary.some(s => s.type === 'class' && s.name === 'ServerConfig')).toBe(true);
    expect(chunks[0].metadata.language).toBe('powershell');
  });
});

describe('PowerShell entity extraction', () => {
  it('extracts entities and Import-Module', async () => {
    const result = await extractor.extractFromFile('/test/Script.ps1', [
      'Import-Module ActiveDirectory',
      '',
      'function Set-Config {',
      '  param([hashtable]$Settings)',
      '  return $Settings',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(1);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'Set-Config')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'ActiveDirectory')).toBe(true);
  });
});

// =============================================================================
// NIM (indent-based)
// =============================================================================

describe('Nim chunker', () => {
  it('chunks Nim procs and types', async () => {
    // Nim type blocks use indent — but the chunker pattern /^type\s+(\w+)/
    // only matches inline: `type Server = object`. Multi-line `type\n  Server` won't match.
    const chunks = await chunker.parseFile('/test/app.nim', [
      'type ServerConfig = object',
      '  port: int',
      '  host: string',
      '',
      'proc start(s: ServerConfig) =',
      '  echo "Starting server on port ", s.port',
      '  echo "Host: ", s.host',
      '',
      'proc stop(s: ServerConfig) =',
      '  echo "Stopping server"',
      '  echo "Goodbye"',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'type' && s.name === 'ServerConfig')).toBe(true);
    expect(summary.some(s => s.type === 'proc' && s.name === 'start')).toBe(true);
    expect(summary.some(s => s.type === 'proc' && s.name === 'stop')).toBe(true);
    expect(chunks[0].metadata.language).toBe('nim');
  });
});

describe('Nim entity extraction', () => {
  it('extracts procs and imports', async () => {
    const result = await extractor.extractFromFile('/test/util.nim', [
      'import strutils',
      'import os/paths',
      '',
      'proc validate(input: string): bool =',
      '  return input.len > 0',
      '',
      'func calculate(x: int): int =',
      '  return x * 2',
    ].join('\n'));
    expect(result.entities.length).toBe(2);
    expect(result.relationships.length).toBe(2);
    expect(result.entities.some(e => e.type === 'proc' && e.name === 'validate')).toBe(true);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'calculate')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'strutils')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'os/paths')).toBe(true);
  });
});

// =============================================================================
// F# (indent-based)
// =============================================================================

describe('F# chunker', () => {
  it('chunks F# types and let bindings', async () => {
    // F# is indent-based. Module alone is too short (<30 chars) for a chunk.
    // Test type + member + let which produce larger chunks.
    const chunks = await chunker.parseFile('/test/App.fs', [
      'type UserService(name: string) =',
      '    member this.Name = name',
      '    member this.Greet() = printfn "Hello %s" name',
      '    member this.Active = true',
      '',
      'let processData items =',
      '    items |> List.map (fun x -> x * 2)',
      '    items |> List.filter (fun x -> x > 0)',
      '    items |> List.sum',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'type' && s.name === 'UserService')).toBe(true);
    expect(summary.some(s => s.type === 'let' && s.name === 'processData')).toBe(true);
    expect(chunks[0].metadata.language).toBe('fsharp');
  });
});

describe('F# entity extraction', () => {
  it('extracts entities and open relationships', async () => {
    const result = await extractor.extractFromFile('/test/Lib.fs', [
      'open System.Collections.Generic',
      '',
      'module Cache',
      '',
      'type Config = { Host: string; Port: int }',
      '',
      'let rec fibonacci n =',
      '    if n <= 1 then n',
      '    else fibonacci (n-1) + fibonacci (n-2)',
    ].join('\n'));
    expect(result.entities.length).toBe(3);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'module' && e.name === 'Cache')).toBe(true);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'Config')).toBe(true);
    expect(result.entities.some(e => e.type === 'let' && e.name === 'fibonacci')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'System.Collections.Generic')).toBe(true);
  });
});

// =============================================================================
// SASS (indent-based)
// =============================================================================

describe('Sass chunker', () => {
  it('chunks Sass mixins', async () => {
    const chunks = await chunker.parseFile('/test/styles.sass', [
      '=responsive-grid',
      '  display: grid',
      '  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))',
      '  gap: 1rem',
      '',
      '=flex-center',
      '  display: flex',
      '  justify-content: center',
      '  align-items: center',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'responsive-grid')).toBe(true);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'flex-center')).toBe(true);
    expect(chunks[0].metadata.language).toBe('sass');
  });
});

describe('Sass entity extraction', () => {
  it('extracts mixins and variables', async () => {
    const result = await extractor.extractFromFile('/test/theme.sass', [
      '@import "variables"',
      '',
      '$primary-color: #3498db',
      '$font-size: 16px',
      '',
      '=button-style',
      '  background: $primary-color',
      '  font-size: $font-size',
    ].join('\n'));
    expect(result.entities.length).toBe(3);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'button-style')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary-color')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'variables')).toBe(true);
  });
});
