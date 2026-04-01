export const EXTENSION_MAP = {
  // JavaScript
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',

  // TypeScript
  '.ts': 'typescript', '.tsx': 'typescript',

  // Java
  '.java': 'java',

  // Python
  '.py': 'python', '.pyi': 'python',

  // Go
  '.go': 'go',

  // Rust
  '.rs': 'rust',

  // C / C++
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',

  // C#
  '.cs': 'csharp',

  // PHP
  '.php': 'php',

  // Ruby
  '.rb': 'ruby', '.erb': 'ruby',

  // Kotlin
  '.kt': 'kotlin', '.kts': 'kotlin',

  // Swift
  '.swift': 'swift',

  // Scala
  '.scala': 'scala',

  // Dart
  '.dart': 'dart',

  // Groovy
  '.groovy': 'groovy',

  // Objective-C
  '.m': 'objc', '.mm': 'objc',

  // HTML / Templating
  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.vue': 'html', '.svelte': 'html',

  // CSS / Preprocessors
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',

  // Lua
  '.lua': 'lua',

  // Shell / Bash
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',

  // PowerShell
  '.ps1': 'powershell',

  // SQL
  '.sql': 'sql',

  // GraphQL
  '.graphql': 'graphql', '.gql': 'graphql',

  // Protobuf
  '.proto': 'proto',

  // Zig
  '.zig': 'zig',

  // Elixir
  '.ex': 'elixir', '.exs': 'elixir',

  // Nim
  '.nim': 'nim',

  // F#
  '.fs': 'fsharp', '.fsx': 'fsharp',

  // JSON
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',

  // YAML
  '.yaml': 'yaml', '.yml': 'yaml',

  // TOML
  '.toml': 'toml',

  // XML
  '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml', '.wsdl': 'xml',
  '.pom': 'xml', '.csproj': 'xml',

  // Dockerfile (by extension)
  '.dockerfile': 'dockerfile',

  // Makefile (by extension)
  '.mk': 'makefile',

  // F# / VB (.NET additional)
  // '.vb' omitted — no LANGUAGES.vb entry exists

  // Document formats (dispatched to DocumentChunker in ast-chunker.js)
  '.md': 'markdown', '.mdx': 'markdown',
  '.rst': 'rst',
  '.txt': 'plaintext',
};

// Files detected by exact filename (no extension or special names)
export const FILENAME_MAP = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
};
