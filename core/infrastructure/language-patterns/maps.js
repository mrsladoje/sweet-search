export const EXTENSION_MAP = {
  // JavaScript
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',

  // TypeScript
  // .tsx is routed to its own grammar so JSX bodies are parsed correctly;
  // the LANGUAGES.tsx entry is an alias of LANGUAGES.typescript (registry-core.js)
  // so chunker/graph regex patterns are byte-identical to .ts.
  '.ts': 'typescript', '.tsx': 'tsx',

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

  // Clojure / ClojureScript / EDN
  // No tree-sitter-clojure grammar ships in the bundle and the brace-based
  // regex chunker would fragment paren-delimited Lisp forms (and drop sub-30-char
  // defns via MIN_CONTENT_LENGTH), so there is intentionally no LANGUAGES.clojure
  // entry — getLanguageByExtension returns the chunker-less fallback and
  // ast-chunker routes these through parseGenericFile (lossless 50-line windows),
  // tagged with this 'clojure' language id rather than generic 'text'.
  '.clj': 'clojure', '.cljc': 'clojure', '.cljs': 'clojure', '.edn': 'clojure',

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
