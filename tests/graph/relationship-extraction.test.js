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
  // NOTE: Go embed pattern /^\s+([A-Z]\w*)\s*$/ requires leading whitespace,
  // but extractGeneric trims lines first, so embed never matches.
  // This test documents the limitation.
  it('embed pattern cannot match after trimming (known limitation)', async () => {
    const result = await extractor.extractFromFile('/test/server.go', [
      'package main',
      '',
      'import (',
      '  "net/http"',
      ')',
      '',
      'type Server struct {',
      '  Router',
      '  Logger',
      '  port int',
      '}',
    ].join('\n'));
    // import works (individual lines inside import block)
    expect(result.relationships.some(r =>
      r.type === 'imports' && r.target_name === 'net/http'
    )).toBe(true);
    // embed does NOT work due to trimming — document this
    // Pattern /^\s+([A-Z]\w*)\s*$/ requires leading whitespace, but extractGeneric
    // trims all lines before matching (graph-extractor.js:605)
    const embedRels = result.relationships.filter(r => r.target_name === 'Router');
    expect(embedRels.length).toBe(0); // limitation: embed fails after trimStart()
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
    // derive pattern extracts first capture group
    expect(result.relationships.some(r =>
      r.target_name === 'Debug, Clone, Serialize'
    )).toBe(true);
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
