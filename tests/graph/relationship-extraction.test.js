/**
 * Comprehensive relationship extraction tests
 *
 * Covers languages with relationship patterns that have ZERO or partial
 * test coverage in other test files:
 * - PHP: use, namespace (zero coverage)
 * - Kotlin: import, inherit (zero coverage)
 * - C#: using, inherit (zero coverage)
 * - Elixir: use, import, alias, require (zero coverage)
 * - Go: embed (partial — only import tested elsewhere)
 * - Rust: derive, implFor (partial — only use tested elsewhere)
 * - Python: decorator (partial — only import tested elsewhere)
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/index.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// PHP — use, namespace
// =============================================================================

describe('PHP relationship extraction', () => {
  it('extracts use and namespace relationships', async () => {
    const result = await extractor.extractFromFile('/test/UserController.php', [
      '<?php',
      'namespace App\\Controllers;',
      '',
      'use App\\Models\\User;',
      'use App\\Services\\AuthService;',
      '',
      'class UserController {',
      '  public function index() {',
      '    return User::all();',
      '  }',
      '}',
    ].join('\n'));
    // namespace
    expect(result.relationships.some(r =>
      r.target_name === 'App\\Controllers'
    )).toBe(true);
    // use imports
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'App\\Models\\User'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'App\\Services\\AuthService'
    )).toBe(true);
  });
});

// =============================================================================
// Kotlin — import, inherit
// =============================================================================

describe('Kotlin relationship extraction', () => {
  it('extracts imports', async () => {
    const result = await extractor.extractFromFile('/test/Service.kt', [
      'import com.example.models.User',
      'import com.example.repos.UserRepository',
      '',
      'class UserService {',
      '  fun findAll(): List<User> {',
      '    return emptyList()',
      '  }',
      '}',
    ].join('\n'));
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'com.example.models.User'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'com.example.repos.UserRepository'
    )).toBe(true);
  });

  it('extracts class inheritance', async () => {
    const result = await extractor.extractFromFile('/test/ViewModel.kt', [
      'import androidx.lifecycle.ViewModel',
      '',
      'class MainViewModel(private val repo: UserRepo) : ViewModel() {',
      '  fun loadData() {',
      '    println("loading")',
      '  }',
      '}',
    ].join('\n'));
    expect(result.relationships.some(r =>
      r.type === 'extends' && r.target_name.includes('ViewModel')
    )).toBe(true);
  });
});

// =============================================================================
// C# — using, inherit
// =============================================================================

describe('C# relationship extraction', () => {
  it('extracts using and inheritance', async () => {
    const result = await extractor.extractFromFile('/test/UserService.cs', [
      'using System.Collections.Generic;',
      'using Microsoft.Extensions.Logging;',
      '',
      'namespace MyApp.Services',
      '{',
      '  public class UserService : BaseService',
      '  {',
      '    public void ProcessUsers()',
      '    {',
      '      var users = new List<User>();',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    // using imports
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'System.Collections.Generic'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'Microsoft.Extensions.Logging'
    )).toBe(true);
    // class inheritance
    expect(result.relationships.some(r =>
      r.type === 'extends' && r.target_name.includes('BaseService')
    )).toBe(true);
  });
});

// =============================================================================
// Elixir — use, import, alias, require
// =============================================================================

describe('Elixir relationship extraction', () => {
  it('extracts use, import, alias, and require', async () => {
    const result = await extractor.extractFromFile('/test/user_controller.ex', [
      'defmodule MyApp.UserController do',
      '  use MyApp.Web',
      '  import Ecto.Query',
      '  alias MyApp.Accounts.User',
      '  require Logger',
      '',
      '  def index(conn, _params) do',
      '    users = Repo.all(User)',
      '    render(conn, "index.html", users: users)',
      '  end',
      'end',
    ].join('\n'));
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'MyApp.Web'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'Ecto.Query'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.target_name === 'MyApp.Accounts.User'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'Logger'
    )).toBe(true);
  });
});

// =============================================================================
// Go — embed (only import was tested elsewhere)
// =============================================================================

describe('Go relationship extraction — embed', () => {
  // The old pattern /^\s+([A-Z]\w*)\s*$/ needed leading whitespace, but lines
  // are matched after trimStart(), so no embed was ever extracted.
  it('extracts embedded types inside struct and interface bodies only', async () => {
    const result = await extractor.extractFromFile('/test/server.go', [
      'package main',
      '',
      'import (',
      '  "net/http"',
      ')',
      '',
      'type Server struct {',
      '  Router',
      '  *sync.Mutex',
      '  io.Reader `json:"r"`',
      '  port int',
      '}',
      '',
      'type ReadCloser interface {',
      '  Reader',
      '  Close() error',
      '}',
      '',
      'const (',
      '  A = iota',
      '  Bconst',
      ')',
    ].join('\n'));
    // import works (individual lines inside import block)
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'net/http'
    )).toBe(true);
    const embeds = result.relationships.filter(r => r.type === 'uses').map(r => r.target_name);
    expect(embeds).toEqual(expect.arrayContaining(['Router', 'sync.Mutex', 'io.Reader', 'Reader']));
    // A field (`port int`), a method (`Close() error`) and a const-block
    // member are not embeds.
    expect(embeds).not.toContain('port');
    expect(embeds).not.toContain('Bconst');
    expect(embeds.some(e => e.startsWith('Close'))).toBe(false);
  });
});

// =============================================================================
// Rust — derive, implFor (only use was tested elsewhere)
// =============================================================================

describe('Rust relationship extraction — derive and impl', () => {
  it('extracts derive macros', async () => {
    const result = await extractor.extractFromFile('/test/models.rs', [
      'use serde::Serialize;',
      '',
      '#[derive(Debug, Clone, Serialize)]',
      'pub struct User {',
      '  pub name: String,',
      '  pub email: String,',
      '}',
    ].join('\n'));
    // one edge per derived trait, owned by the struct below the attribute
    const user = result.entities.find(e => e.name === 'User');
    const derives = result.relationships.filter(r => r.context_line === 3);
    expect(derives.map(r => r.target_name)).toEqual(['Debug', 'Clone', 'Serialize']);
    expect(derives.every(r => r.source_id === user.id)).toBe(true);
  });

  it('extracts impl-for with generics, paths and unsafe', async () => {
    const result = await extractor.extractFromFile('/test/impls.rs', [
      'pub struct Foo;',
      'impl<T: Clone> Validator for Wrapper<T> {}',
      'impl fmt::Display for Foo {',
      '}',
      'unsafe impl Send for Foo {}',
      "impl<'a> Iterator for Iter<'a> {}",
      '// impl Fake for Comment {}',
    ].join('\n'));
    const impls = result.relationships.filter(r => r.type === 'implements').map(r => r.target_name);
    expect(impls).toEqual(['Validator', 'fmt::Display', 'Send', 'Iterator']);
  });

  it('extracts impl-for relationships', async () => {
    const result = await extractor.extractFromFile('/test/traits.rs', [
      'pub trait Validator {',
      '  fn validate(&self) -> bool;',
      '}',
      '',
      'impl Validator for User {',
      '  fn validate(&self) -> bool {',
      '    !self.name.is_empty()',
      '  }',
      '}',
    ].join('\n'));
    // implFor: /^impl\s+(\w+)\s+for\s+(\w+)/
    // match[1] = "Validator" — this is what gets stored as target_name
    expect(result.relationships.some(r =>
      r.target_name === 'Validator'
    )).toBe(true);
  });
});

// =============================================================================
// Python — decorator (only import was tested elsewhere)
// =============================================================================

describe('Python relationship extraction — decorator', () => {
  it('extracts decorator relationships', async () => {
    const result = await extractor.extractFromFile('/test/views.py', [
      'from flask import Flask',
      '',
      '@app.route("/users")',
      'def list_users():',
      '    return get_all_users()',
      '',
      '@login_required',
      'def admin_panel():',
      '    return render_admin()',
    ].join('\n'));
    // decorator: /^@(\w+(?:\.\w+)*)/ → captures dotted name
    expect(result.relationships.some(r =>
      r.type === 'uses' && r.target_name === 'app.route'
    )).toBe(true);
    expect(result.relationships.some(r =>
      r.type === 'uses' && r.target_name === 'login_required'
    )).toBe(true);
  });
});
