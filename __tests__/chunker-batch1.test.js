/**
 * Batch 1: Brace-based chunker + entity tests
 * Languages: C, C++, Swift, Scala, Dart
 */

import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../ast-chunker.js';
import GraphExtractor from '../core/graph-extractor.js';

const chunker = new ASTChunker({ projectRoot: '/test' });
const extractor = new GraphExtractor({ projectRoot: '/test' });

function chunkSummary(chunks) {
  return chunks.map(c => ({
    type: c.metadata.chunk_type,
    name: c.metadata.symbol,
    lang: c.metadata.language,
  }));
}

// =============================================================================
// C
// =============================================================================

describe('C chunker', () => {
  it('chunks C functions and structs', async () => {
    const chunks = await chunker.parseFile('/test/server.c', [
      'typedef struct ServerConfig {',
      '    int port;',
      '    char* host;',
      '} ServerConfig;',
      '',
      'int start_server(ServerConfig* config) {',
      '    printf("Starting on %d\\n", config->port);',
      '    return 0;',
      '}',
      '',
      'void stop_server() {',
      '    printf("Stopping\\n");',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'struct' && s.name === 'ServerConfig')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'start_server')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'stop_server')).toBe(true);
    expect(chunks[0].metadata.language).toBe('c');
  });

  it('chunks C enum declarations', async () => {
    const chunks = await chunker.parseFile('/test/types.c', [
      'enum Color {',
      '    RED,',
      '    GREEN,',
      '    BLUE',
      '};',
      '',
      'int main() {',
      '    enum Color c = RED;',
      '    return 0;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'enum' && s.name === 'Color')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'main')).toBe(true);
  });
});

describe('C entity extraction', () => {
  it('extracts functions, structs, macros, typedefs', async () => {
    const result = await extractor.extractFromFile('/test/util.c', [
      '#include <stdio.h>',
      '#include "util.h"',
      '#define MAX_SIZE 1024',
      '',
      'typedef unsigned long ulong;',
      '',
      'struct Buffer {',
      '    char data[MAX_SIZE];',
      '    int len;',
      '};',
      '',
      'static inline int buffer_init(struct Buffer* buf) {',
      '    buf->len = 0;',
      '    return 0;',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(4);
    expect(result.relationships.length).toBe(2);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Buffer')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'buffer_init')).toBe(true);
    expect(result.entities.some(e => e.type === 'macro' && e.name === 'MAX_SIZE')).toBe(true);
    expect(result.entities.some(e => e.type === 'typedef' && e.name === 'ulong')).toBe(true);
    // relationships
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'stdio.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'util.h')).toBe(true);
  });
});

// =============================================================================
// C++
// =============================================================================

describe('C++ chunker', () => {
  it('chunks C++ classes, namespaces, functions', async () => {
    const chunks = await chunker.parseFile('/test/app.cpp', [
      'namespace server {',
      '',
      'class HttpServer {',
      'public:',
      '    void start(int port) {',
      '        listen(port);',
      '    }',
      '};',
      '',
      'void run() {',
      '    HttpServer s;',
      '    s.start(8080);',
      '}',
      '',
      '} // namespace server',
    ].join('\n'));
    expect(chunks.length).toBe(4);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'namespace' && s.name === 'server')).toBe(true);
    expect(summary.some(s => s.type === 'class' && s.name === 'HttpServer')).toBe(true);
    expect(chunks[0].metadata.language).toBe('cpp');
  });

  it('chunks C++ enum class', async () => {
    const chunks = await chunker.parseFile('/test/types.hpp', [
      'class Widget {',
      'public:',
      '    void render() const {',
      '        draw();',
      '    }',
      '};',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'class' && s.name === 'Widget')).toBe(true);
  });
});

describe('C++ entity extraction', () => {
  it('extracts classes, enums, namespaces with relationships', async () => {
    const result = await extractor.extractFromFile('/test/engine.cpp', [
      '#include <vector>',
      '#include "engine.h"',
      '',
      'namespace game {',
      '',
      'enum class State { RUNNING, PAUSED, STOPPED };',
      '',
      'class Engine : public Base {',
      'public:',
      '    void update() {',
      '        renderer.draw();',
      '    }',
      '};',
      '',
      '} // namespace game',
    ].join('\n'));
    expect(result.entities.length).toBe(4);
    expect(result.relationships.length).toBe(4);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Engine')).toBe(true);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'game')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'State')).toBe(true);
    // relationships
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'vector')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'engine.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Base')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'renderer.draw')).toBe(true);
  });
});

// =============================================================================
// SWIFT
// =============================================================================

describe('Swift chunker', () => {
  it('chunks Swift class, struct, protocol, func, enum', async () => {
    const chunks = await chunker.parseFile('/test/App.swift', [
      'protocol Drawable {',
      '    func draw()',
      '}',
      '',
      'public class Canvas {',
      '    func render() {',
      '        print("rendering")',
      '    }',
      '}',
      '',
      'struct Point {',
      '    var x: Double',
      '    var y: Double',
      '}',
      '',
      'enum Shape {',
      '    case circle',
      '    case square',
      '}',
      '',
      'extension Canvas {',
      '    func clear() {',
      '        print("clearing")',
      '    }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(7);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'protocol' && s.name === 'Drawable')).toBe(true);
    expect(summary.some(s => s.type === 'class' && s.name === 'Canvas')).toBe(true);
    expect(summary.some(s => s.type === 'struct' && s.name === 'Point')).toBe(true);
    expect(summary.some(s => s.type === 'enum' && s.name === 'Shape')).toBe(true);
    expect(summary.some(s => s.type === 'extension' && s.name === 'Canvas')).toBe(true);
    expect(chunks[0].metadata.language).toBe('swift');
  });
});

describe('Swift entity extraction', () => {
  it('extracts entities and relationships', async () => {
    const result = await extractor.extractFromFile('/test/VC.swift', [
      'import UIKit',
      '',
      'public final class ViewController: UIViewController {',
      '    override func viewDidLoad() {',
      '        view.addSubview(label)',
      '    }',
      '',
      '    private func setupUI() {',
      '        label.configure()',
      '    }',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(3);
    expect(result.relationships.length).toBe(4);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'ViewController')).toBe(true);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'viewDidLoad')).toBe(true);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'setupUI')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'UIKit')).toBe(true);
  });
});

// =============================================================================
// SCALA
// =============================================================================

describe('Scala chunker', () => {
  it('chunks Scala class, object, trait, def', async () => {
    const chunks = await chunker.parseFile('/test/App.scala', [
      'trait Serializable {',
      '  def serialize(): String',
      '}',
      '',
      'case class User(name: String, age: Int) {',
      '  def greet(): String = {',
      '    s"Hello, $name"',
      '  }',
      '}',
      '',
      'object UserService {',
      '  def findAll(): List[User] = {',
      '    List.empty',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(5);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'trait' && s.name === 'Serializable')).toBe(true);
    expect(summary.some(s => s.type === 'class' && s.name === 'User')).toBe(true);
    expect(summary.some(s => s.type === 'object' && s.name === 'UserService')).toBe(true);
    expect(chunks[0].metadata.language).toBe('scala');
  });
});

describe('Scala entity extraction', () => {
  it('extracts entities and relationships', async () => {
    const result = await extractor.extractFromFile('/test/Service.scala', [
      'import scala.collection.mutable',
      '',
      'trait Repository {',
      '  def findById(id: Int): Option[User]',
      '}',
      '',
      'class UserService(repo: Repository) extends Base with Logging {',
      '  def find(id: Int): Option[User] = {',
      '    repo.findById(id)',
      '  }',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(4);
    expect(result.relationships.length).toBe(4);
    expect(result.entities.some(e => e.type === 'trait' && e.name === 'Repository')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'def' && e.name === 'find')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'scala.collection.mutable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Base')).toBe(true);
  });
});

// =============================================================================
// DART
// =============================================================================

describe('Dart chunker', () => {
  it('chunks Dart class, mixin, enum', async () => {
    const chunks = await chunker.parseFile('/test/app.dart', [
      'abstract class Animal {',
      '  String name;',
      '  int age;',
      '  void speak();',
      '}',
      '',
      'mixin Flyable {',
      '  double altitude = 0.0;',
      '  double speed = 0.0;',
      '  bool isFlying = false;',
      '}',
      '',
      'enum Status {',
      '  active,',
      '  inactive,',
      '  pending,',
      '}',
      '',
      'class Bird extends Animal with Flyable {',
      '  String color;',
      '  String species;',
      '  Bird(this.color, this.species);',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(4);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'class' && s.name === 'Animal')).toBe(true);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'Flyable')).toBe(true);
    expect(summary.some(s => s.type === 'enum' && s.name === 'Status')).toBe(true);
    expect(summary.some(s => s.type === 'class' && s.name === 'Bird')).toBe(true);
    expect(chunks[0].metadata.language).toBe('dart');
  });

  it('does NOT false-positive on return/if/new as function names', async () => {
    const chunks = await chunker.parseFile('/test/logic.dart', [
      'class Logic {',
      '  Widget build() {',
      '    return Container(',
      '      child: Text("hello"),',
      '    );',
      '  }',
      '}',
    ].join('\n'));
    const summary = chunkSummary(chunks);
    // "return" should NOT be matched as function
    expect(summary.some(s => s.type === 'function' && s.name === 'Container')).toBe(false);
    expect(summary.some(s => s.type === 'class' && s.name === 'Logic')).toBe(true);
  });
});

describe('Dart entity extraction', () => {
  it('extracts entities and relationships', async () => {
    const result = await extractor.extractFromFile('/test/widget.dart', [
      "import 'package:flutter/material.dart';",
      '',
      'class MyWidget extends StatelessWidget {',
      '  Widget build(BuildContext context) {',
      '    return Container();',
      '  }',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(2);
    expect(result.relationships.length).toBe(2);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'MyWidget')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'package:flutter/material.dart')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'StatelessWidget')).toBe(true);
  });
});
