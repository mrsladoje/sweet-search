/**
 * Multi-Language Chunker Tests
 *
 * Tests for ast-chunker.js with language-patterns.js registry:
 * - Brace-based chunking (Java, Go, Rust, C#, etc.)
 * - Indent-based chunking (Python)
 * - End-keyword chunking (Ruby, Elixir)
 * - Generic fallback for unknown extensions
 */

import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../ast-chunker.js';

const chunker = new ASTChunker({ projectRoot: '/test' });

function chunkSummary(chunks) {
  return chunks.map(c => ({
    type: c.metadata.chunk_type,
    name: c.metadata.symbol,
    lang: c.metadata.language,
    lines: `${c.metadata.line_start}-${c.metadata.line_end}`,
  }));
}

// =============================================================================
// BRACE-BASED LANGUAGES
// =============================================================================

describe('brace-based chunking', () => {
  it('chunks Java class and methods', async () => {
    const chunks = await chunker.parseFile('/test/App.java', `
public class App {
  public void run() {
    System.out.println("hello");
  }
  public int getValue() {
    return 42;
  }
}
`);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some(c => c.metadata.chunk_type === 'class')).toBe(true);
    expect(chunks[0].metadata.language).toBe('java');
  });

  it('chunks Go functions and structs', async () => {
    const chunks = await chunker.parseFile('/test/main.go', `
package main

func main() {
  fmt.Println("hello world")
}

type Config struct {
  Port int
  Host string
}

func NewConfig() *Config {
  return &Config{Port: 8080}
}
`);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'function' && s.name === 'main')).toBe(true);
    expect(summary.some(s => s.type === 'struct')).toBe(true);
    expect(chunks[0].metadata.language).toBe('go');
  });

  it('chunks Rust structs and functions', async () => {
    const chunks = await chunker.parseFile('/test/lib.rs', `
pub struct Server {
    port: u16,
}

pub fn start(port: u16) {
    println!("Starting on {}", port);
}
`);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'struct')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'start')).toBe(true);
    expect(chunks[0].metadata.language).toBe('rust');
  });

  it('chunks C# classes and methods', async () => {
    const chunks = await chunker.parseFile('/test/Program.cs', `
public class Program {
  public static void Main(string[] args) {
    Console.WriteLine("hello");
  }
}
`);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.language).toBe('csharp');
  });

  it('chunks PHP classes', async () => {
    const chunks = await chunker.parseFile('/test/App.php', [
      '',
      'class UserController extends Controller {',
      '  public function index() {',
      '    return "hello";',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.language).toBe('php');
  });
});

// =============================================================================
// INDENT-BASED LANGUAGES
// =============================================================================

describe('indent-based chunking', () => {
  it('chunks Python class methods as separate chunks', async () => {
    const chunks = await chunker.parseFile('/test/app.py', `
class MyApp:
    def __init__(self, name):
        self.name = name
        self.started = False

    def run(self):
        self.started = True
        print(self.name)

def standalone():
    return 42
`);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'function' && s.name === '__init__')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'run')).toBe(true);
    expect(chunks[0].metadata.language).toBe('python');
  });

  it('detects Python as indent-based', async () => {
    const chunks = await chunker.parseFile('/test/script.py', `
def hello():
    print("hello")
    print("world")

def goodbye():
    print("bye")
    print("farewell")
`);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].metadata.language).toBe('python');
  });
});

// =============================================================================
// END-KEYWORD LANGUAGES
// =============================================================================

describe('end-keyword chunking', () => {
  it('chunks Ruby class with methods', async () => {
    const chunks = await chunker.parseFile('/test/app.rb', `
class UserService
  def initialize(name)
    @name = name
  end

  def greet
    puts "Hello #{@name}"
  end
end

module Helpers
  def self.helper
    42
  end
end
`);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'class' && s.name === 'UserService')).toBe(true);
    expect(summary.some(s => s.type === 'module' && s.name === 'Helpers')).toBe(true);
    expect(chunks[0].metadata.language).toBe('ruby');
  });

  it('chunks Elixir modules', async () => {
    const chunks = await chunker.parseFile('/test/app.ex', `
defmodule MyApp do
  def hello do
    IO.puts("hello")
  end
end
`);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'module' && s.name === 'MyApp')).toBe(true);
    expect(chunks[0].metadata.language).toBe('elixir');
  });
});

// =============================================================================
// GENERIC FALLBACK
// =============================================================================

describe('generic fallback', () => {
  it('uses line-based chunking for unknown extensions', async () => {
    const content = Array(100).fill('some content line here for testing purposes!!!').join('\n');
    const chunks = await chunker.parseFile('/test/data.xyz', content);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].metadata.language).toBe('text');
  });

  it('returns chunks with correct metadata shape', async () => {
    const chunks = await chunker.parseFile('/test/app.go', `
func main() {
  fmt.Println("hello")
}
`);
    expect(chunks[0]).toHaveProperty('text');
    expect(chunks[0]).toHaveProperty('content');
    expect(chunks[0]).toHaveProperty('metadata');
    expect(chunks[0].metadata).toHaveProperty('type', 'codebase');
    expect(chunks[0].metadata).toHaveProperty('file');
    expect(chunks[0].metadata).toHaveProperty('path');
    expect(chunks[0].metadata).toHaveProperty('language');
    expect(chunks[0].metadata).toHaveProperty('chunk_type');
    expect(chunks[0].metadata).toHaveProperty('symbol');
    expect(chunks[0].metadata).toHaveProperty('line_start');
    expect(chunks[0].metadata).toHaveProperty('line_end');
    expect(chunks[0].metadata).toHaveProperty('hash');
    expect(chunks[0]).toHaveProperty('tags');
  });
});

// =============================================================================
// MULTI-FILE PARSING
// =============================================================================

describe('parseFiles', () => {
  it('handles missing files gracefully', async () => {
    const chunks = await chunker.parseFiles(['/nonexistent/file.js']);
    expect(chunks).toEqual([]);
  });
});
