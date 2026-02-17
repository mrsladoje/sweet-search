/**
 * Generic Graph Extractor Tests
 *
 * Tests for graph-extractor.js extractGeneric() method:
 * - Entity extraction from registry patterns
 * - Relationship extraction (imports, extends, calls)
 * - skipCallObjects filtering
 * - Backward compat with specialized Java/JS/Proto extractors
 */

import { describe, it, expect } from 'vitest';
import GraphExtractor from '../core/graph-extractor.js';

const extractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });

// =============================================================================
// SPECIALIZED EXTRACTORS (BACKWARD COMPAT)
// =============================================================================

describe('specialized extractors', () => {
  it('extracts Java classes and methods', async () => {
    const result = await extractor.extractFromFile('/test/App.java', `
package com.example;
import com.example.UserService;
public class App extends Base implements Runnable {
  public void run() {
    service.process();
  }
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'App')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'run')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Base')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports')).toBe(true);
  });

  it('extracts JavaScript functions and classes', async () => {
    const result = await extractor.extractFromFile('/test/app.js', `
import { Router } from 'express';
export class UserController {
  handleRequest() {}
}
export function helper() {
  return 42;
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserController')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'helper')).toBe(true);
  });

  it('extracts Proto messages and services', async () => {
    const result = await extractor.extractFromFile('/test/api.proto', `
message UserRequest {
  string id = 1;
}
service UserService {
  rpc GetUser (UserRequest) returns (UserResponse);
}
`);
    expect(result.entities.some(e => e.type === 'message' && e.name === 'UserRequest')).toBe(true);
    expect(result.entities.some(e => e.type === 'service' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'rpc' && e.name === 'GetUser')).toBe(true);
  });
});

// =============================================================================
// GENERIC EXTRACTOR — ENTITIES
// =============================================================================

describe('generic extractor — entities', () => {
  it('extracts Python classes and functions', async () => {
    const result = await extractor.extractFromFile('/test/app.py', `
class UserService:
    def find(self, id):
        return self.repo.get(id)

def helper():
    return 42
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'find')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'helper')).toBe(true);
  });

  it('extracts Go structs, functions, and methods', async () => {
    const result = await extractor.extractFromFile('/test/main.go', `
type Server struct {
  Port int
}

func (s *Server) Start() {
  fmt.Println(s.Port)
}

func main() {
  s := &Server{Port: 8080}
  s.Start()
}
`);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Server')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'Start')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'main')).toBe(true);
  });

  it('extracts Rust structs and functions', async () => {
    const result = await extractor.extractFromFile('/test/lib.rs', `
pub struct Config {
    pub port: u16,
}

pub fn run(config: &Config) {
    println!("Port: {}", config.port);
}
`);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Config')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'run')).toBe(true);
  });

  it('extracts C# classes, interfaces, methods', async () => {
    const result = await extractor.extractFromFile('/test/Program.cs', `
public class Program {
  public static void Main(string[] args) {
    Console.WriteLine("hello");
  }
}
public interface IService {
  void Process();
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Program')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'Main')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'IService')).toBe(true);
  });

  it('extracts SQL tables and views', async () => {
    const result = await extractor.extractFromFile('/test/schema.sql', `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE VIEW active_users AS SELECT * FROM users;
CREATE INDEX idx_name ON users(name);
`);
    expect(result.entities.some(e => e.type === 'table' && e.name === 'users')).toBe(true);
    expect(result.entities.some(e => e.type === 'view' && e.name === 'active_users')).toBe(true);
    expect(result.entities.some(e => e.type === 'index' && e.name === 'idx_name')).toBe(true);
  });

  it('extracts Ruby classes and methods', async () => {
    const result = await extractor.extractFromFile('/test/app.rb', `
class UserService
  def find(id)
    User.find(id)
  end
end
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'find')).toBe(true);
  });

  it('computes Ruby end_line correctly with nested methods', async () => {
    const source = [
      'class Account',
      '  def deposit(amount)',
      '    if amount > 0',
      '      @balance += amount',
      '    end',
      '  end',
      '',
      '  def withdraw(amount)',
      '    @balance -= amount',
      '  end',
      'end',
    ].join('\n');
    const result = await extractor.extractFromFile('/test/account.rb', source);
    const classEntity = result.entities.find(e => e.type === 'class' && e.name === 'Account');
    expect(classEntity).toBeDefined();
    expect(classEntity.end_line).toBe(source.split('\n').length);
  });

  it('extracts Kotlin classes and functions', async () => {
    const result = await extractor.extractFromFile('/test/App.kt', `
class UserService(val name: String) {
  fun find(id: Int): User {
    return repo.findById(id)
  }
}
interface Repository {
  fun findAll(): List<User>
}
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'find')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Repository')).toBe(true);
  });
});

// =============================================================================
// GENERIC EXTRACTOR — RELATIONSHIPS
// =============================================================================

describe('generic extractor — relationships', () => {
  it('extracts Python imports', async () => {
    const result = await extractor.extractFromFile('/test/app.py', `
import os, sys
from flask import Flask, jsonify
class App:
    pass
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'os')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'sys')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'flask')).toBe(true);
  });

  it('extracts Go imports', async () => {
    const result = await extractor.extractFromFile('/test/main.go', `
import (
  "net/http"
  "fmt"
)
func main() {}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'net/http')).toBe(true);
  });

  it('extracts Rust use statements', async () => {
    const result = await extractor.extractFromFile('/test/lib.rs', `
use std::io;
pub fn main() {}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'std::io')).toBe(true);
  });

  it('extracts method calls and skips builtins', async () => {
    const result = await extractor.extractFromFile('/test/main.go', `
func main() {
  server.Start()
  fmt.Println("hello")
}
`);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'server.Start')).toBe(true);
    // fmt is in skipCallObjects for Go
    expect(result.relationships.some(r => r.target_name === 'fmt.Println')).toBe(false);
  });

  it('attributes call source_id by active entity scope', async () => {
    const source = [
      'class Worker:',
      '    def work(self):',
      '        svc.run()',
      '',
      'outside.run()',
    ].join('\n');
    const result = await extractor.extractFromFile('/test/app.py', source);
    const workEntity = result.entities.find(e => e.type === 'function' && e.name === 'work');
    expect(workEntity).toBeDefined();

    const scopedCall = result.relationships.find(r => r.type === 'calls' && r.target_name === 'svc.run');
    expect(scopedCall).toBeDefined();
    expect(scopedCall.source_id).toBe(workEntity.id);

    const topLevelCall = result.relationships.find(r => r.type === 'calls' && r.target_name === 'outside.run');
    expect(topLevelCall).toBeDefined();
    expect(topLevelCall.source_id).toBeNull();
  });

  it('extracts Ruby extends', async () => {
    const result = await extractor.extractFromFile('/test/app.rb', `
class Admin < User
  def greet
    puts "hello"
  end
end
`);
    const adminEntity = result.entities.find(e => e.type === 'class' && e.name === 'Admin');
    expect(adminEntity).toBeDefined();
    const extendsRel = result.relationships.find(r => r.type === 'extends' && r.target_name === 'User');
    expect(extendsRel).toBeDefined();
    expect(extendsRel.source_id).toBe(adminEntity.id);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('edge cases', () => {
  it('returns empty for unknown extensions', async () => {
    const result = await extractor.extractFromFile('/test/data.xyz', 'hello world');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('entities have required fields', async () => {
    const result = await extractor.extractFromFile('/test/main.go', `
func main() {
  fmt.Println("hello")
}
`);
    const entity = result.entities[0];
    expect(entity).toHaveProperty('id');
    expect(entity).toHaveProperty('file_path');
    expect(entity).toHaveProperty('type');
    expect(entity).toHaveProperty('name');
    expect(entity).toHaveProperty('signature');
    expect(entity).toHaveProperty('start_line');
    expect(entity).toHaveProperty('end_line');
  });

  it('relationships have required fields', async () => {
    const result = await extractor.extractFromFile('/test/lib.rs', `
use std::io;
pub fn main() {}
`);
    const rel = result.relationships[0];
    expect(rel).toHaveProperty('target_name');
    expect(rel).toHaveProperty('type');
    expect(rel).toHaveProperty('weight');
  });

  it('handles empty file content', async () => {
    const result = await extractor.extractFromFile('/test/empty.py', '');
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });
});
