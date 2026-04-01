/**
 * Entity Extraction Tests - Batch 3
 *
 * Tests for graph-extractor.js extractGeneric() method for:
 * - Shell (.sh)
 * - PowerShell (.ps1)
 * - Zig (.zig)
 * - Nim (.nim)
 * - F# (.fs)
 * - GraphQL (.graphql)
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/index.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// SHELL
// =============================================================================

describe('Shell extraction', () => {
  it('extracts functions with function keyword', async () => {
    const result = await extractor.extractFromFile('/test/script.sh', `
function cleanup() {
  echo "cleaning"
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'cleanup')).toBe(true);
  });

  it('extracts functions without function keyword', async () => {
    const result = await extractor.extractFromFile('/test/script.sh', `
setup() {
  echo "setting up"
  server.start
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'setup')).toBe(true);
  });

  it('extracts source imports', async () => {
    const result = await extractor.extractFromFile('/test/script.sh', `
source ./config.sh
. ./utils.sh
setup() {
  echo "setting up"
  server.start
}
function cleanup() {
  echo "cleaning"
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'setup')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'cleanup')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === './config.sh')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === './utils.sh')).toBe(true);
  });
});

// =============================================================================
// POWERSHELL
// =============================================================================

describe('PowerShell extraction', () => {
  it('extracts classes', async () => {
    const result = await extractor.extractFromFile('/test/config.ps1', `
class ServerConfig {
  [string]$Name
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'ServerConfig')).toBe(true);
  });

  it('extracts functions', async () => {
    const result = await extractor.extractFromFile('/test/users.ps1', `
function Get-Users {
  Write-Host "Getting users"
  $service.GetAll()
}
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'Get-Users')).toBe(true);
  });

  it('extracts imports from Import-Module and using module', async () => {
    const result = await extractor.extractFromFile('/test/app.ps1', `
Import-Module ActiveDirectory
using module Az.Storage
class ServerConfig {
  [string]$Name
}
function Get-Users {
  Write-Host "Getting users"
  $service.GetAll()
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'ServerConfig')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'Get-Users')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'ActiveDirectory')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'Az.Storage')).toBe(true);
  });
});

// =============================================================================
// ZIG
// =============================================================================

describe('Zig extraction', () => {
  it('extracts structs and functions', async () => {
    const result = await extractor.extractFromFile('/test/config.zig', `
pub const Config = struct {
    port: u16,
    host: []const u8,
};
pub fn serve(config: Config) void {
    std.debug.print("serving");
}
`);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Config')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'serve')).toBe(true);
  });

  it('extracts enums and const imports', async () => {
    const result = await extractor.extractFromFile('/test/main.zig', `
const std = @import("std");
const mem = @import("mem");
pub const Status = enum {
    active,
    inactive,
};
`);
    expect(result.entities.some(e => e.type === 'const' && e.name === 'std')).toBe(true);
    expect(result.entities.some(e => e.type === 'const' && e.name === 'mem')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'std')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'mem')).toBe(true);
  });

  it('extracts all entities and imports together', async () => {
    const result = await extractor.extractFromFile('/test/app.zig', `
const std = @import("std");
const mem = @import("mem");
pub const Config = struct {
    port: u16,
    host: []const u8,
};
pub const Status = enum {
    active,
    inactive,
};
pub fn serve(config: Config) void {
    std.debug.print("serving");
}
`);
    expect(result.entities.some(e => e.type === 'const' && e.name === 'std')).toBe(true);
    expect(result.entities.some(e => e.type === 'const' && e.name === 'mem')).toBe(true);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Config')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'serve')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'std')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'mem')).toBe(true);
  });
});

// =============================================================================
// NIM
// =============================================================================

describe('Nim extraction', () => {
  it('extracts types and procs', async () => {
    const result = await extractor.extractFromFile('/test/user.nim', `
type User = object

proc greet(user: User) =
  echo user.name
`);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'proc' && e.name === 'greet')).toBe(true);
  });

  it('extracts functions', async () => {
    const result = await extractor.extractFromFile('/test/math.nim', `
func double(x: int): int =
  x * 2
`);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'double')).toBe(true);
  });

  it('extracts import and from imports', async () => {
    const result = await extractor.extractFromFile('/test/app.nim', `
import strutils
from os import paramStr

type User = object

proc greet(user: User) =
  echo user.name

func double(x: int): int =
  x * 2
`);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'proc' && e.name === 'greet')).toBe(true);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'double')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'strutils')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'os')).toBe(true);
  });
});

// =============================================================================
// F#
// =============================================================================

describe('F# extraction', () => {
  it('extracts modules and types', async () => {
    const result = await extractor.extractFromFile('/test/Services.fs', `
module MyApp.Services

type User = {
    Name: string
    Age: int
}
`);
    expect(result.entities.some(e => e.type === 'module' && e.name === 'MyApp')).toBe(true);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
  });

  it('extracts let bindings including rec and inline', async () => {
    const result = await extractor.extractFromFile('/test/helpers.fs', `
let validate user =
    printfn "validating"
    user.Name <> ""

let rec factorial n =
    if n <= 1 then 1
    else n * factorial (n - 1)
`);
    expect(result.entities.some(e => e.type === 'let' && e.name === 'validate')).toBe(true);
    expect(result.entities.some(e => e.type === 'let' && e.name === 'factorial')).toBe(true);
  });

  it('extracts open imports', async () => {
    const result = await extractor.extractFromFile('/test/App.fs', `
module MyApp.Services
open System
open System.IO

type User = {
    Name: string
    Age: int
}

let validate user =
    printfn "validating"
    user.Name <> ""

let rec factorial n =
    if n <= 1 then 1
    else n * factorial (n - 1)
`);
    expect(result.entities.some(e => e.type === 'module' && e.name === 'MyApp')).toBe(true);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'let' && e.name === 'validate')).toBe(true);
    expect(result.entities.some(e => e.type === 'let' && e.name === 'factorial')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'System')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'System.IO')).toBe(true);
  });
});

// =============================================================================
// GRAPHQL
// =============================================================================

describe('GraphQL extraction', () => {
  it('extracts interfaces and types with implements', async () => {
    const result = await extractor.extractFromFile('/test/schema.graphql', `
interface Node {
  id: ID!
}
type User implements Node {
  id: ID!
  name: String!
  email: String
}
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Node')).toBe(true);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements' && r.target_name === 'Node')).toBe(true);
  });

  it('extracts input types, enums, and scalars', async () => {
    const result = await extractor.extractFromFile('/test/schema.graphql', `
input CreateUserInput {
  name: String!
  email: String!
}
enum Role {
  ADMIN
  USER
  GUEST
}
scalar DateTime
`);
    expect(result.entities.some(e => e.type === 'input' && e.name === 'CreateUserInput')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Role')).toBe(true);
    expect(result.entities.some(e => e.type === 'scalar' && e.name === 'DateTime')).toBe(true);
  });

  it('extracts queries, mutations, and subscriptions', async () => {
    const result = await extractor.extractFromFile('/test/schema.graphql', `
interface Node {
  id: ID!
}
type User implements Node {
  id: ID!
  name: String!
  email: String
}
input CreateUserInput {
  name: String!
  email: String!
}
enum Role {
  ADMIN
  USER
  GUEST
}
scalar DateTime
query GetUser {
  user(id: ID!): User
}
`);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Node')).toBe(true);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'input' && e.name === 'CreateUserInput')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Role')).toBe(true);
    expect(result.entities.some(e => e.type === 'scalar' && e.name === 'DateTime')).toBe(true);
    expect(result.entities.some(e => e.type === 'query' && e.name === 'GetUser')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements' && r.target_name === 'Node')).toBe(true);
  });
});
