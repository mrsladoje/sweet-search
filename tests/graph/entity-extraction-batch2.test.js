/**
 * Entity Extraction Tests - Batch 2
 *
 * Tests for graph-extractor.js with languages:
 * - Dart (classes, mixins, functions, enums)
 * - Groovy (classes, traits, interfaces, methods)
 * - Objective-C (interfaces, implementations, protocols, methods)
 * - Elixir (modules, functions, private functions, macros)
 * - Lua (functions, assigned functions)
 *
 * Coverage:
 * - Entity extraction with correct types and names
 * - Relationship extraction (imports, extends, calls)
 * - skipCallObjects filtering
 */

import { describe, it, expect } from 'vitest';
import GraphExtractor from '../../core/graph/graph-extractor.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// DART
// =============================================================================

describe('Dart extractor', () => {
  it('extracts classes, mixins, functions, and enums', async () => {
    const result = await extractor.extractFromFile('/test/animal.dart', `
import 'package:flutter/material.dart';
abstract class Animal {
  String name;
}
mixin Walkable {
  void walk() {}
}
class Dog extends Animal with Walkable implements Comparable {
  String breed;
  void bark(String sound) {
    print(sound);
    owner.notify();
  }
}
enum Size { small, medium, large }
`);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Animal')).toBe(true);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'Walkable')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Dog')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Size')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'walk')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'bark')).toBe(true);
  });

  it('extracts Dart relationships: imports, extends, implements, with', async () => {
    const result = await extractor.extractFromFile('/test/animal.dart', `
import 'package:flutter/material.dart';
abstract class Animal {
  String name;
}
mixin Walkable {
  void walk() {}
}
class Dog extends Animal with Walkable implements Comparable {
  String breed;
  void bark(String sound) {
    print(sound);
    owner.notify();
  }
}
enum Size { small, medium, large }
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'package:flutter/material.dart')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Animal')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name && r.target_name.includes('Walkable'))).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements' && r.target_name === 'Comparable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'owner.notify')).toBe(true);
  });

  it('filters Dart skipCallObjects (print, debugPrint, setState)', async () => {
    const result = await extractor.extractFromFile('/test/widget.dart', `
class MyWidget {
  void update() {
    print("updating");
    debugPrint("debug");
    setState(() {});
    Navigator.push();
    MediaQuery.of();
    service.process();
  }
}
`);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('print'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('debugPrint'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('setState'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('Navigator'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('MediaQuery'))).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'service.process')).toBe(true);
  });
});

// =============================================================================
// GROOVY
// =============================================================================

describe('Groovy extractor', () => {
  it('extracts classes, traits, interfaces, and methods', async () => {
    const result = await extractor.extractFromFile('/test/UserService.groovy', `
import groovy.transform.ToString
trait Auditable {
  def audit() { }
}
class UserService extends BaseService {
  void find(int id) {
    println("finding")
    repo.findById(id)
  }
}
interface Repository {
  List findAll()
}
`);
    expect(result.entities.some(e => e.type === 'trait' && e.name === 'Auditable')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Repository')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'audit')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'find')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'findAll')).toBe(true);
  });

  it('extracts Groovy relationships: imports, extends, calls', async () => {
    const result = await extractor.extractFromFile('/test/UserService.groovy', `
import groovy.transform.ToString
trait Auditable {
  def audit() { }
}
class UserService extends BaseService {
  void find(int id) {
    println("finding")
    repo.findById(id)
  }
}
interface Repository {
  List findAll()
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'groovy.transform.ToString')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'BaseService')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'repo.findById')).toBe(true);
  });

  it('filters Groovy skipCallObjects (println, print, assert)', async () => {
    const result = await extractor.extractFromFile('/test/Debug.groovy', `
class Debug {
  void test() {
    println "test"
    print "output"
    assert true
    def x = 5
    service.process()
  }
}
`);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('println'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('print'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('assert'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('def'))).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'service.process')).toBe(true);
  });
});

// =============================================================================
// OBJECTIVE-C
// =============================================================================

describe('Objective-C extractor', () => {
  it('extracts interfaces, implementations, protocols, methods, and properties', async () => {
    const result = await extractor.extractFromFile('/test/User.m', `
#import <Foundation/Foundation.h>
#import "AppDelegate.h"
@protocol Serializable
- (NSData *)serialize;
@end
@interface User : NSObject <Serializable>
@property (nonatomic, strong) NSString *name;
- (void)save;
@end
@implementation User
- (void)save {
  NSLog(@"saving");
  manager.persist();
}
@end
`);
    expect(result.entities.some(e => e.type === 'protocol' && e.name === 'Serializable')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'impl' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'serialize')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'save')).toBe(true);
    expect(result.entities.some(e => e.type === 'property' && e.name === 'name')).toBe(true);
  });

  it('extracts Objective-C relationships: imports, inherit, protocol', async () => {
    const result = await extractor.extractFromFile('/test/User.m', `
#import <Foundation/Foundation.h>
#import "AppDelegate.h"
@protocol Serializable
- (NSData *)serialize;
@end
@interface User : NSObject <Serializable>
@property (nonatomic, strong) NSString *name;
- (void)save;
@end
@implementation User
- (void)save {
  NSLog(@"saving");
  manager.persist();
}
@end
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'Foundation/Foundation.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'AppDelegate.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'NSObject')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements' && r.target_name === 'Serializable')).toBe(true);
  });

  it('filters Objective-C skipCallObjects (NSLog, NSString, NSArray)', async () => {
    const result = await extractor.extractFromFile('/test/Logger.m', `
@implementation Logger
- (void)log {
  NSLog(@"message");
  NSString *str = @"test";
  NSArray *arr = @[];
  NSDictionary *dict = @{};
  NSNumber *num = @1;
  service.execute();
}
@end
`);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('NSLog'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('NSString'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('NSArray'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('NSDictionary'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('NSNumber'))).toBe(false);
  });
});

// =============================================================================
// ELIXIR
// =============================================================================

describe('Elixir extractor', () => {
  it('extracts modules, functions, private functions', async () => {
    const result = await extractor.extractFromFile('/test/UserService.ex', `
defmodule MyApp.UserService do
  use GenServer
  import Ecto.Query
  alias MyApp.Repo
  require Logger

  def find(id) do
    Repo.get(User, id)
  end

  defp validate(user) do
    Enum.empty?(user.errors)
  end
end
`);
    expect(result.entities.some(e => e.type === 'module' && e.name === 'MyApp.UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'find')).toBe(true);
    expect(result.entities.some(e => e.type === 'private' && e.name === 'validate')).toBe(true);
  });

  it('extracts Elixir relationships: use, import, alias, require', async () => {
    const result = await extractor.extractFromFile('/test/UserService.ex', `
defmodule MyApp.UserService do
  use GenServer
  import Ecto.Query
  alias MyApp.Repo
  require Logger

  def find(id) do
    Repo.get(User, id)
  end

  defp validate(user) do
    Enum.empty?(user.errors)
  end
end
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'GenServer')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'Ecto.Query')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'MyApp.Repo')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'Logger')).toBe(true);
  });

  it('handles Elixir macros', async () => {
    const result = await extractor.extractFromFile('/test/Macros.ex', `
defmodule MyApp.Macros do
  defmacro debug(expr) do
    quote do
      IO.inspect(unquote(expr))
    end
  end

  def helper() do
    :ok
  end
end
`);
    expect(result.entities.some(e => e.type === 'macro' && e.name === 'debug')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'helper')).toBe(true);
  });
});

// =============================================================================
// LUA
// =============================================================================

describe('Lua extractor', () => {
  it('extracts functions and assigned functions', async () => {
    const result = await extractor.extractFromFile('/test/app.lua', `
local json = require("cjson")
function greet(name)
    print("Hello " .. name)
    logger.info(name)
end
local helper = function()
    return true
end
`);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'greet')).toBe(true);
    expect(result.entities.some(e => e.type === 'assignedFunc' && e.name === 'helper')).toBe(true);
  });

  it('extracts Lua require relationships', async () => {
    const result = await extractor.extractFromFile('/test/app.lua', `
local json = require("cjson")
local http = require("socket.http")
function greet(name)
    print("Hello " .. name)
    logger.info(name)
end
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'cjson')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'socket.http')).toBe(true);
  });

  it('filters Lua skipCallObjects (print, io, os, string, table)', async () => {
    const result = await extractor.extractFromFile('/test/utils.lua', `
function test()
    print("message")
    io.write("data")
    os.exit()
    string.format("%s", "test")
    table.insert(t, 1)
    math.random()
    error("fail")
    assert(true)
    local t = type(x)
    pairs({})
    ipairs({})
    service.execute()
end
`);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('print'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('io'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('os'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('string'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('table'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('math'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('error'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('assert'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('type'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('pairs'))).toBe(false);
    expect(result.relationships.some(r => r.target_name && r.target_name.includes('ipairs'))).toBe(false);
  });
});
