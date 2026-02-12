/**
 * Shared Language Pattern Registry
 *
 * Single source of truth for language detection, chunker boundary patterns,
 * and graph extraction patterns across all supported languages/formats.
 *
 * Used by:
 * - ast-chunker.js        → chunk boundary detection via getChunkerPatterns()
 * - core/graph-extractor.js → entity/relationship extraction via getGraphPatterns()
 *
 * Design:
 * - EXTENSION_MAP: complete for all 35+ languages (always resolves)
 * - FILENAME_MAP: for extensionless files (Dockerfile, Makefile)
 * - LANGUAGES: patterns added per-language as implemented
 * - API functions handle missing LANGUAGES entries gracefully (return null → caller falls back)
 */

import path from 'path';

// =============================================================================
// EXTENSION → LANGUAGE ID MAPPING (complete for all supported languages)
// =============================================================================

export const EXTENSION_MAP = {
  // JavaScript / TypeScript (TS treated as JS — same patterns suffice for entity extraction)
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'javascript', '.tsx': 'javascript',

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
  '.vb': 'vb',
};

// Files detected by exact filename (no extension or special names)
export const FILENAME_MAP = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'GNUmakefile': 'makefile',
};

// =============================================================================
// LANGUAGE CONFIGURATIONS
//
// Each language entry:
//   indentBased   — true for Python, Ruby, YAML, Sass, Nim, Elixir, F#
//   endKeyword    — block terminator for keyword-based langs (Ruby 'end', Elixir 'end')
//   comment       — { line, block: [start, end] | null }
//   chunker       — { type: /regex/ } patterns for chunk boundary detection
//                    regex must capture symbol name in group $1
//   graph         — { entities: {...}, relationships: {...}, skipCallObjects: [...] }
//                    for entity/relationship extraction in graph-extractor.js
// =============================================================================

export const LANGUAGES = {

  // ─── JavaScript / TypeScript ───────────────────────────────────────────────

  javascript: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /(?:export\s+)?class\s+(\w+)/,
      function:  /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/,
      component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      arrow:     /const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    },

    graph: {
      entities: {
        class:         /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        function:      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        component:     /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      },
      relationships: {
        extends:    /class\s+\w+\s+extends\s+(\w+)/,
        import:     /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'process', 'Buffer', 'Date'],
    },
  },

  // ─── Java ──────────────────────────────────────────────────────────────────

  java: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*class\s+(\w+)/,
      method:    /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*[\w<>\[\]]+\s+(\w+)\s*\(/,
      interface: /(?:public)?\s*interface\s+(\w+)/,
      enum:      /(?:public)?\s*enum\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /(?:public|private|protected)?\s*(?:static)?\s*(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/,
        interface: /(?:public)?\s*interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/,
        enum:      /(?:public)?\s*enum\s+(\w+)/,
        method:    /(?:@\w+\s*(?:\([^)]*\))?\s*)*(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*(?:synchronized)?\s*(?:<[\w\s,<>?]+>\s*)?(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/,
        field:     /(?:public|private|protected)\s+(?:static)?\s*(?:final)?\s*(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*[;=]/,
      },
      relationships: {
        import:     /import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/,
        package:    /package\s+([\w.]+)\s*;/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
        throw:      /throw\s+new\s+(\w+)/,
      },
      skipCallObjects: ['System', 'log', 'LOG', 'logger', 'String', 'Integer', 'Long', 'Boolean', 'Double', 'Float'],
    },
  },

  // ─── Protobuf ──────────────────────────────────────────────────────────────

  proto: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      message: /message\s+(\w+)/,
      service: /service\s+(\w+)/,
      enum:    /enum\s+(\w+)/,
      rpc:     /rpc\s+(\w+)/,
    },

    graph: {
      entities: {
        message: /message\s+(\w+)\s*\{/,
        service: /service\s+(\w+)\s*\{/,
        rpc:     /rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s+returns\s+\(\s*(\w+)\s*\)/,
        enum:    /enum\s+(\w+)\s*\{/,
      },
      relationships: {
        import: /import\s+"([^"]+)"/,
      },
      skipCallObjects: [],
    },
  },

  // ─── Python ────────────────────────────────────────────────────────────────

  python: {
    indentBased: true,
    endKeyword: null,
    comment: { line: '#', block: ['"""', '"""'] },

    chunker: {
      class:     /^class\s+(\w+)(?:\(([^)]*)\))?:/,
      function:  /^(?:async\s+)?def\s+(\w+)\s*\(/,
      decorator: /^@(\w+(?:\.\w+)*)/,
    },

    graph: {
      entities: {
        class:    /^class\s+(\w+)(?:\(([^)]*)\))?:/,
        function: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/,
        field:    /^(\w+)\s*(?::\s*([\w\[\],\s|]+))?\s*=/,
      },
      relationships: {
        import:       /^(?:from\s+([\w.]+)\s+)?import\s+(.+)/,
        extends:      /^class\s+\w+\(([^)]+)\)/,
        methodCall:   /(\w+)\s*\.\s*(\w+)\s*\(/,
        decorator:    /^@(\w+(?:\.\w+)*)/,
      },
      skipCallObjects: ['self', 'cls', 'super', 'print', 'len', 'range', 'str', 'int', 'list', 'dict', 'set', 'type'],
    },
  },

  // ─── Go ────────────────────────────────────────────────────────────────────

  go: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      function:  /^func\s+(\w+)\s*\(/,
      method:    /^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/,
      struct:    /^type\s+(\w+)\s+struct\s*\{/,
      interface: /^type\s+(\w+)\s+interface\s*\{/,
    },

    graph: {
      entities: {
        function:  /^func\s+(\w+)\s*\(([^)]*)\)/,
        method:    /^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(([^)]*)\)/,
        struct:    /^type\s+(\w+)\s+struct/,
        interface: /^type\s+(\w+)\s+interface/,
        typeAlias: /^type\s+(\w+)\s+(?!struct|interface)\w/,
        const:     /^const\s+(\w+)\s/,
      },
      relationships: {
        import:    /^\s*"([^"]+)"/,
        embed:     /^\s+(\w+)\s*$/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      // Go: exported = starts with uppercase
      isExported: (name) => /^[A-Z]/.test(name),
      skipCallObjects: ['fmt', 'log', 'os', 'io', 'strings', 'strconv', 'math', 'time', 'sort', 'sync'],
    },
  },

  // ─── Rust ──────────────────────────────────────────────────────────────────

  rust: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      function: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      struct:   /^(?:pub\s+)?struct\s+(\w+)/,
      enum:     /^(?:pub\s+)?enum\s+(\w+)/,
      trait:    /^(?:pub\s+)?trait\s+(\w+)/,
      impl:     /^impl(?:<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)/,
    },

    graph: {
      entities: {
        function: /^(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/,
        struct:   /^(?:pub\s+)?struct\s+(\w+)/,
        enum:     /^(?:pub\s+)?enum\s+(\w+)/,
        trait:    /^(?:pub\s+)?trait\s+(\w+)/,
        impl:     /^impl(?:<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)/,
        type:     /^(?:pub\s+)?type\s+(\w+)/,
        const:    /^(?:pub\s+)?const\s+(\w+)\s*:/,
        static:   /^(?:pub\s+)?static\s+(\w+)\s*:/,
      },
      relationships: {
        use:        /^use\s+([\w:]+)(?:::\{([^}]+)\})?/,
        implFor:    /^impl\s+(\w+)\s+for\s+(\w+)/,
        derive:     /#\[derive\(([^)]+)\)\]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['self', 'Self', 'super', 'crate', 'std', 'println', 'eprintln', 'format', 'vec', 'String'],
    },
  },

  // ─── C ─────────────────────────────────────────────────────────────────────

  c: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      function:  /^(?:[\w*\s]+)\s+(\w+)\s*\([^)]*\)\s*\{/,
      struct:    /^(?:typedef\s+)?struct\s+(\w+)/,
      enum:      /^(?:typedef\s+)?enum\s+(\w+)/,
    },

    graph: {
      entities: {
        function: /^(?:static\s+)?(?:inline\s+)?(?:[\w*]+\s+)+(\w+)\s*\([^)]*\)\s*\{/,
        struct:   /^(?:typedef\s+)?struct\s+(\w+)/,
        enum:     /^(?:typedef\s+)?enum\s+(\w+)/,
        typedef:  /^typedef\s+.+\s+(\w+)\s*;/,
        macro:    /^#define\s+(\w+)/,
      },
      relationships: {
        include:    /^#include\s+[<"]([^>"]+)[>"]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['printf', 'fprintf', 'sprintf', 'malloc', 'free', 'sizeof', 'memcpy', 'memset', 'strlen'],
    },
  },

  // ─── C++ ───────────────────────────────────────────────────────────────────

  cpp: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /^(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?/,
      function:  /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
      namespace: /^namespace\s+(\w+)/,
      template:  /^template\s*<[^>]+>/,
    },

    graph: {
      entities: {
        class:     /^(?:class|struct)\s+(\w+)/,
        namespace: /^namespace\s+(\w+)/,
        function:  /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
        typedef:   /^(?:typedef|using)\s+.+\s+(\w+)/,
        enum:      /^enum\s+(?:class\s+)?(\w+)/,
      },
      relationships: {
        include:    /^#include\s+[<"]([^>"]+)[>"]/,
        inherit:    /:\s*(?:public|protected|private)\s+(\w+)/,
        methodOf:   /(\w+)\s*::\s*(\w+)\s*\(/,
        methodCall: /(\w+)\s*(?:\.|->)\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['std', 'cout', 'cerr', 'endl', 'printf', 'fprintf', 'malloc', 'free'],
    },
  },

  // ─── C# ────────────────────────────────────────────────────────────────────

  csharp: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)/,
      interface: /(?:public|internal)?\s*interface\s+(\w+)/,
      method:    /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/,
      property:  /(?:public|private|protected|internal)\s+(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
      enum:      /(?:public|internal)?\s*enum\s+(\w+)/,
      struct:    /(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        interface: /(?:public|internal)?\s*interface\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        enum:      /(?:public|internal)?\s*enum\s+(\w+)/,
        struct:    /(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
        method:    /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(([^)]*)\)/,
        property:  /(?:public|private|protected|internal)\s+(?:static\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
        field:     /(?:public|private|protected|internal)\s+(?:static\s+)?(?:readonly\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*[;=]/,
      },
      relationships: {
        using:      /^using\s+([\w.]+)\s*;/,
        namespace:  /^namespace\s+([\w.]+)/,
        inherit:    /class\s+\w+\s*:\s*([\w,\s<>]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['Console', 'Debug', 'Trace', 'String', 'Int32', 'Math', 'Convert', 'Task'],
    },
  },

  // ─── PHP ───────────────────────────────────────────────────────────────────

  php: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /^(?:abstract\s+|final\s+)?class\s+(\w+)/,
      function:  /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(/,
      interface: /^interface\s+(\w+)/,
      trait:     /^trait\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /^(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s\\]+))?/,
        interface: /^interface\s+(\w+)(?:\s+extends\s+([\w,\s\\]+))?/,
        trait:     /^trait\s+(\w+)/,
        function:  /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      },
      relationships: {
        use:        /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?/,
        namespace:  /^namespace\s+([\w\\]+)/,
        methodCall: /(\w+)\s*(?:->|::)\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['$this', 'self', 'parent', 'static', 'echo', 'print', 'var_dump'],
    },
  },

  // ─── Ruby ──────────────────────────────────────────────────────────────────

  ruby: {
    indentBased: false,
    endKeyword: 'end',
    comment: { line: '#', block: ['=begin', '=end'] },

    chunker: {
      class:  /^class\s+(\w+)(?:\s*<\s*(\w+))?/,
      module: /^module\s+(\w+)/,
      method: /^\s*def\s+(\w+[?!=]?)/,
    },

    graph: {
      entities: {
        class:  /^class\s+(\w+)(?:\s*<\s*(\w+))?/,
        module: /^module\s+(\w+)/,
        method: /^\s*def\s+(\w+[?!=]?)\s*(?:\(([^)]*)\))?/,
      },
      relationships: {
        require:  /^require(?:_relative)?\s+['"]([^'"]+)['"]/,
        include:  /^\s*include\s+(\w+)/,
        extend:   /^\s*extend\s+(\w+)/,
        prepend:  /^\s*prepend\s+(\w+)/,
        inherit:  /^class\s+\w+\s*<\s*(\w+)/,
      },
      skipCallObjects: ['puts', 'print', 'p', 'raise', 'require', 'attr_accessor', 'attr_reader'],
    },
  },

  // ─── Kotlin ────────────────────────────────────────────────────────────────

  kotlin: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/,
      interface: /interface\s+(\w+)/,
      function:  /(?:fun|suspend\s+fun)\s+(\w+)/,
      object:    /(?:companion\s+)?object\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)(?:\s*(?:\(|:)\s*)?/,
        interface: /interface\s+(\w+)/,
        function:  /(?:override\s+)?(?:suspend\s+)?fun\s+(\w+)\s*\(([^)]*)\)/,
        object:    /(?:companion\s+)?object\s+(\w+)/,
        enum:      /enum\s+class\s+(\w+)/,
        typealias: /typealias\s+(\w+)/,
      },
      relationships: {
        import:     /^import\s+([\w.]+)/,
        inherit:    /class\s+\w+(?:\s*\([^)]*\))?\s*:\s*([\w,\s<>]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['println', 'print', 'require', 'check', 'assert', 'listOf', 'mapOf', 'setOf'],
    },
  },

  // ─── Swift ─────────────────────────────────────────────────────────────────

  swift: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:    /(?:public|open|internal|private|fileprivate)?\s*(?:final\s+)?class\s+(\w+)/,
      struct:   /(?:public|internal|private|fileprivate)?\s*struct\s+(\w+)/,
      protocol: /(?:public|internal)?\s*protocol\s+(\w+)/,
      func:     /(?:public|open|internal|private|fileprivate)?\s*(?:static\s+|class\s+)?(?:override\s+)?func\s+(\w+)/,
      enum:     /(?:public|internal|private|fileprivate)?\s*enum\s+(\w+)/,
      extension: /extension\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /(?:public|open|internal|private|fileprivate)?\s*(?:final\s+)?class\s+(\w+)/,
        struct:    /(?:public|internal|private|fileprivate)?\s*struct\s+(\w+)/,
        protocol:  /(?:public|internal)?\s*protocol\s+(\w+)/,
        func:      /(?:public|open|internal|private|fileprivate)?\s*(?:static\s+|class\s+)?(?:override\s+)?func\s+(\w+)\s*\(([^)]*)\)/,
        enum:      /(?:public|internal|private|fileprivate)?\s*enum\s+(\w+)/,
        extension: /extension\s+(\w+)/,
      },
      relationships: {
        import:     /^import\s+(\w+)/,
        inherit:    /(?:class|struct|enum)\s+\w+\s*:\s*([\w,\s]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['print', 'fatalError', 'precondition', 'assert', 'String', 'Int', 'Double'],
    },
  },

  // ─── Scala ─────────────────────────────────────────────────────────────────

  scala: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:  /(?:case\s+)?class\s+(\w+)/,
      object: /object\s+(\w+)/,
      trait:  /trait\s+(\w+)/,
      def:    /def\s+(\w+)/,
    },

    graph: {
      entities: {
        class:  /(?:case\s+)?class\s+(\w+)(?:\s*\([^)]*\))?(?:\s+extends\s+(\w+))?/,
        object: /object\s+(\w+)/,
        trait:  /trait\s+(\w+)/,
        def:    /def\s+(\w+)\s*(?:\[([^\]]*)\])?\s*\(([^)]*)\)/,
      },
      relationships: {
        import:     /^import\s+([\w._{}]+)/,
        extends:    /(?:class|object|trait)\s+\w+(?:\s*\([^)]*\))?\s+extends\s+(\w+)/,
        with:       /\bwith\s+(\w+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['println', 'print', 'require', 'assert', 'Seq', 'List', 'Map', 'Set', 'Option'],
    },
  },

  // ─── Dart ──────────────────────────────────────────────────────────────────

  dart: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class: /(?:abstract\s+)?class\s+(\w+)/,
      mixin: /mixin\s+(\w+)/,
      function: /(?:[\w<>?]+)\s+(\w+)\s*\(/,
      enum: /enum\s+(\w+)/,
    },

    graph: {
      entities: {
        class:    /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        mixin:    /mixin\s+(\w+)/,
        function: /(?:static\s+)?(?:[\w<>?]+)\s+(\w+)\s*\(([^)]*)\)/,
        enum:     /enum\s+(\w+)/,
      },
      relationships: {
        import:     /^import\s+['"]([^'"]+)['"]/,
        extends:    /class\s+\w+\s+extends\s+(\w+)/,
        implements: /(?:class|mixin)\s+\w+(?:\s+extends\s+\w+)?\s+(?:with\s+[\w,\s]+\s+)?implements\s+([\w,\s]+)/,
        with:       /\bwith\s+([\w,\s]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['print', 'debugPrint', 'setState', 'Navigator', 'MediaQuery'],
    },
  },

  // ─── Groovy ────────────────────────────────────────────────────────────────

  groovy: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      class:     /(?:abstract\s+)?class\s+(\w+)/,
      interface: /interface\s+(\w+)/,
      method:    /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\(/,
      trait:     /trait\s+(\w+)/,
    },

    graph: {
      entities: {
        class:     /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        interface: /interface\s+(\w+)/,
        trait:     /trait\s+(\w+)/,
        method:    /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/,
      },
      relationships: {
        import:     /^import\s+([\w.]+)/,
        extends:    /class\s+\w+\s+extends\s+(\w+)/,
        implements: /class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([\w,\s]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ['println', 'print', 'assert', 'def'],
    },
  },

  // ─── Objective-C ───────────────────────────────────────────────────────────

  objc: {
    indentBased: false,
    endKeyword: '@end',
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      interface: /^@interface\s+(\w+)\s*(?::\s*(\w+))?/,
      impl:      /^@implementation\s+(\w+)/,
      protocol:  /^@protocol\s+(\w+)/,
      method:    /^[+-]\s*\([^)]*\)\s*(\w+)/,
    },

    graph: {
      entities: {
        interface: /^@interface\s+(\w+)\s*(?::\s*(\w+))?/,
        impl:      /^@implementation\s+(\w+)/,
        protocol:  /^@protocol\s+(\w+)/,
        method:    /^[+-]\s*\([^)]*\)\s*(\w+)/,
        property:  /^@property\s*\([^)]*\)\s*\w+\s+\*?(\w+)/,
      },
      relationships: {
        import:    /^#import\s+[<"]([^>"]+)[>"]/,
        inherit:   /^@interface\s+\w+\s*:\s*(\w+)/,
        protocol:  /^@interface\s+\w+\s*:\s*\w+\s*<([^>]+)>/,
        category:  /^@interface\s+(\w+)\s*\((\w*)\)/,
      },
      skipCallObjects: ['NSLog', 'NSString', 'NSArray', 'NSDictionary', 'NSNumber'],
    },
  },

  // ─── HTML / Templating ─────────────────────────────────────────────────────

  html: {
    indentBased: false,
    endKeyword: null,
    comment: { line: null, block: ['<!--', '-->'] },

    chunker: {
      section:   /<(section|article|nav|header|footer|main|aside|template|form)\b[^>]*>/i,
      component: /<([A-Z]\w+)\b/,
      script:    /<script\b[^>]*>/i,
      style:     /<style\b[^>]*>/i,
    },

    graph: {
      entities: {
        section:   /<(section|article|nav|header|footer|main|aside|template|form)\b[^>]*(?:\bid=["']([^"']+)["'])?/i,
        component: /<([A-Z]\w+)\b/,
        id:        /<\w+[^>]+\bid=["']([^"']+)["']/,
      },
      relationships: {
        link:   /<link[^>]+href=["']([^"']+)["']/i,
        script: /<script[^>]+src=["']([^"']+)["']/i,
        img:    /<img[^>]+src=["']([^"']+)["']/i,
        form:   /<form[^>]+action=["']([^"']+)["']/i,
      },
      skipCallObjects: [],
    },
  },

  // ─── CSS ───────────────────────────────────────────────────────────────────

  css: {
    indentBased: false,
    endKeyword: null,
    comment: { line: null, block: ['/*', '*/'] },

    chunker: {
      rule:       /^[.#\w\[\*:][^{]*\{/,
      media:      /^@media\s+[^{]+\{/,
      keyframes:  /^@keyframes\s+([\w-]+)\s*\{/,
      fontface:   /^@font-face\s*\{/,
      layer:      /^@layer\s+([\w-]+)/,
      container:  /^@container\s+([\w-]+)/,
    },

    graph: {
      entities: {
        keyframes: /^@keyframes\s+([\w-]+)/,
        selector:  /^([.#][\w-]+)/,
        variable:  /^--([^:]+)\s*:/,
      },
      relationships: {
        import: /^@import\s+['"]([^'"]+)['"]/,
      },
      skipCallObjects: [],
    },
  },

  // ─── SCSS ──────────────────────────────────────────────────────────────────

  scss: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      mixin:    /^@mixin\s+([\w-]+)/,
      function: /^@function\s+([\w-]+)/,
      rule:     /^[.#\w\[\*:&][^{]*\{/,
      media:    /^@media\s+[^{]+\{/,
    },

    graph: {
      entities: {
        mixin:    /^@mixin\s+([\w-]+)/,
        function: /^@function\s+([\w-]+)/,
        variable: /^\$([\w-]+)\s*:/,
      },
      relationships: {
        use:     /^@use\s+['"]([^'"]+)['"]/,
        forward: /^@forward\s+['"]([^'"]+)['"]/,
        import:  /^@import\s+['"]([^'"]+)['"]/,
        include: /^@include\s+([\w-]+)/,
        extend:  /^@extend\s+([.%][\w-]+)/,
      },
      skipCallObjects: [],
    },
  },

  // ─── Sass (indent-based) ──────────────────────────────────────────────────

  sass: {
    indentBased: true,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      mixin: /^[=+]([\w-]+)/,
      rule:  /^[.#\w\[\*:&]/,
    },

    graph: {
      entities: {
        mixin:    /^=([\w-]+)/,
        variable: /^\$([\w-]+)\s*:/,
      },
      relationships: {
        import:  /^@import\s+['"]([^'"]+)['"]/,
        include: /^\+([\w-]+)/,
      },
      skipCallObjects: [],
    },
  },

  // ─── LESS ──────────────────────────────────────────────────────────────────

  less: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: ['/*', '*/'] },

    chunker: {
      mixin: /^\.([\w-]+)\s*\(/,
      rule:  /^[.#\w\[\*:&][^{]*\{/,
    },

    graph: {
      entities: {
        mixin:    /^\.([\w-]+)\s*\(/,
        variable: /^@([\w-]+)\s*:/,
      },
      relationships: {
        import: /^@import\s+['"]([^'"]+)['"]/,
      },
      skipCallObjects: [],
    },
  },

  // ─── Shell / Bash ──────────────────────────────────────────────────────────

  shell: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      function: /^(?:function\s+)?(\w+)\s*\(\)\s*\{/,
    },

    graph: {
      entities: {
        function: /^(?:function\s+)?(\w+)\s*\(\)\s*\{/,
      },
      relationships: {
        source: /^(?:source|\.)?\s+(.+)/,
      },
      skipCallObjects: ['echo', 'printf', 'cd', 'export', 'local', 'readonly'],
    },
  },

  // ─── PowerShell ────────────────────────────────────────────────────────────

  powershell: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: ['<#', '#>'] },

    chunker: {
      function: /^function\s+([\w-]+)/,
      class:    /^class\s+(\w+)/,
    },

    graph: {
      entities: {
        function: /^function\s+([\w-]+)/,
        class:    /^class\s+(\w+)/,
      },
      relationships: {
        import: /^(?:Import-Module|using\s+module)\s+(\S+)/,
      },
      skipCallObjects: ['Write-Host', 'Write-Output', 'Write-Error', 'Write-Warning'],
    },
  },

  // ─── SQL ───────────────────────────────────────────────────────────────────

  sql: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '--', block: ['/*', '*/'] },

    chunker: {
      create: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)/i,
      alter:  /ALTER\s+TABLE\s+(?:[\w.]+\.)?(\w+)/i,
    },

    graph: {
      entities: {
        table:     /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)/i,
        view:      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:[\w.]+\.)?(\w+)/i,
        function:  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[\w.]+\.)?(\w+)/i,
        procedure: /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(?:[\w.]+\.)?(\w+)/i,
        trigger:   /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(?:[\w.]+\.)?(\w+)/i,
        index:     /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },

  // ─── GraphQL ───────────────────────────────────────────────────────────────

  graphql: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      type:         /type\s+(\w+)/,
      input:        /input\s+(\w+)/,
      query:        /(?:query|mutation|subscription)\s+(\w+)/,
      interface:    /interface\s+(\w+)/,
      enum:         /enum\s+(\w+)/,
    },

    graph: {
      entities: {
        type:         /type\s+(\w+)/,
        input:        /input\s+(\w+)/,
        interface:    /interface\s+(\w+)/,
        enum:         /enum\s+(\w+)/,
        scalar:       /scalar\s+(\w+)/,
        query:        /(?:query|mutation|subscription)\s+(\w+)/,
      },
      relationships: {
        implements: /type\s+\w+\s+implements\s+([\w&\s]+)/,
        fieldType:  /:\s*\[?(\w+)\]?/,
      },
      skipCallObjects: [],
    },
  },

  // ─── Lua ───────────────────────────────────────────────────────────────────

  lua: {
    indentBased: false,
    endKeyword: 'end',
    comment: { line: '--', block: ['--[[', ']]'] },

    chunker: {
      function:      /^(?:local\s+)?function\s+(\w+)/,
      assignedFunc:  /^(?:local\s+)?(\w+)\s*=\s*function/,
    },

    graph: {
      entities: {
        function:     /^(?:local\s+)?function\s+([\w.]+)/,
        assignedFunc: /^(?:local\s+)?(\w+)\s*=\s*function/,
      },
      relationships: {
        require: /(?:local\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      },
      skipCallObjects: ['print', 'io', 'os', 'string', 'table', 'math', 'error', 'assert', 'type', 'pairs', 'ipairs'],
    },
  },

  // ─── Zig ───────────────────────────────────────────────────────────────────

  zig: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '//', block: null },

    chunker: {
      function: /^(?:pub\s+)?fn\s+(\w+)/,
      struct:   /^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?struct/,
      enum:     /^(?:pub\s+)?const\s+(\w+)\s*=\s*enum/,
    },

    graph: {
      entities: {
        function: /^(?:pub\s+)?fn\s+(\w+)/,
        struct:   /^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?struct/,
        enum:     /^(?:pub\s+)?const\s+(\w+)\s*=\s*enum/,
        const:    /^(?:pub\s+)?const\s+(\w+)/,
      },
      relationships: {
        import: /^const\s+\w+\s*=\s*@import\s*\("([^"]+)"\)/,
      },
      skipCallObjects: ['std', '@import'],
    },
  },

  // ─── Elixir ────────────────────────────────────────────────────────────────

  elixir: {
    indentBased: false,
    endKeyword: 'end',
    comment: { line: '#', block: null },

    chunker: {
      module:   /defmodule\s+([\w.]+)/,
      function: /def\s+(\w+[?!]?)/,
      private:  /defp\s+(\w+[?!]?)/,
      macro:    /defmacro\s+(\w+)/,
    },

    graph: {
      entities: {
        module:   /defmodule\s+([\w.]+)/,
        function: /def\s+(\w+[?!]?)\s*(?:\(([^)]*)\))?/,
        private:  /defp\s+(\w+[?!]?)/,
        macro:    /defmacro\s+(\w+)/,
      },
      relationships: {
        use:     /^\s*use\s+([\w.]+)/,
        import:  /^\s*import\s+([\w.]+)/,
        alias:   /^\s*alias\s+([\w.]+)/,
        require: /^\s*require\s+([\w.]+)/,
      },
      skipCallObjects: ['IO', 'Logger', 'Kernel', 'Enum', 'Map', 'List', 'String'],
    },
  },

  // ─── Nim ───────────────────────────────────────────────────────────────────

  nim: {
    indentBased: true,
    endKeyword: null,
    comment: { line: '#', block: ['#[', ']#'] },

    chunker: {
      proc:   /^proc\s+(\w+)/,
      func:   /^func\s+(\w+)/,
      type:   /^type\s+(\w+)/,
      method: /^method\s+(\w+)/,
    },

    graph: {
      entities: {
        proc:   /^proc\s+(\w+)/,
        func:   /^func\s+(\w+)/,
        type:   /^type\s+(\w+)/,
        method: /^method\s+(\w+)/,
      },
      relationships: {
        import: /^import\s+([\w\/]+)/,
        from:   /^from\s+([\w\/]+)\s+import/,
      },
      skipCallObjects: ['echo', 'debugEcho', 'assert', 'quit'],
    },
  },

  // ─── F# ────────────────────────────────────────────────────────────────────

  fsharp: {
    indentBased: true,
    endKeyword: null,
    comment: { line: '//', block: ['(*', '*)'] },

    chunker: {
      let:    /^let\s+(\w+)/,
      type:   /^type\s+(\w+)/,
      module: /^module\s+(\w+)/,
      member: /member\s+(?:this|_|x)\.(\w+)/,
    },

    graph: {
      entities: {
        let:    /^let\s+(?:rec\s+)?(?:inline\s+)?(\w+)/,
        type:   /^type\s+(\w+)/,
        module: /^module\s+(\w+)/,
        member: /member\s+(?:this|_|x)\.(\w+)/,
      },
      relationships: {
        open:   /^open\s+([\w.]+)/,
      },
      skipCallObjects: ['printfn', 'printf', 'failwith', 'raise', 'ignore'],
    },
  },

  // ─── JSON ──────────────────────────────────────────────────────────────────

  json: {
    indentBased: false,
    endKeyword: null,
    comment: { line: null, block: null },

    chunker: {
      key: /^\s{2}"([\w-]+)"\s*:/,
    },

    graph: {
      entities: {
        topKey: /^\s{2}"([\w-]+)"\s*:/,
      },
      relationships: {
        ref:  /"\$ref"\s*:\s*"([^"]+)"/,
        dep:  /"(dependencies|devDependencies|peerDependencies)"/,
      },
      skipCallObjects: [],
    },
  },

  // ─── YAML ──────────────────────────────────────────────────────────────────

  yaml: {
    indentBased: true,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      key: /^(\w[\w-]*)\s*:/,
      doc: /^---/,
    },

    graph: {
      entities: {
        topKey: /^(\w[\w-]*)\s*:/,
      },
      relationships: {
        anchor:  /&(\w+)/,
        alias:   /\*(\w+)/,
        ref:     /\$ref:\s*['"]?([^'"#\s]+)/,
      },
      skipCallObjects: [],
    },
  },

  // ─── TOML ──────────────────────────────────────────────────────────────────

  toml: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      section: /^\[([^\]]+)\]/,
      array:   /^\[\[([^\]]+)\]\]/,
    },

    graph: {
      entities: {
        section: /^\[([^\]]+)\]/,
        array:   /^\[\[([^\]]+)\]\]/,
        keyVal:  /^(\w[\w-]*)\s*=/,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },

  // ─── XML ───────────────────────────────────────────────────────────────────

  xml: {
    indentBased: false,
    endKeyword: null,
    comment: { line: null, block: ['<!--', '-->'] },

    chunker: {
      element: /<(\w+:?\w+)\b[^>]*(?:>|$)/,
    },

    graph: {
      entities: {
        element: /<(\w+:?\w+)\b[^>]*(?:>|$)/,
      },
      relationships: {
        namespace: /xmlns(?::(\w+))?=["']([^"']+)["']/,
        import:    /<(?:xs:)?(?:import|include)\s[^>]*(?:schemaLocation|href)=["']([^"']+)["']/,
        ref:       /ref=["']([^"']+)["']/,
      },
      skipCallObjects: [],
    },
  },

  // ─── Dockerfile ────────────────────────────────────────────────────────────

  dockerfile: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      from: /^FROM\s+(\S+)(?:\s+AS\s+(\w+))?/i,
      run:  /^RUN\s+/i,
      copy: /^COPY\s+/i,
    },

    graph: {
      entities: {
        stage:      /^FROM\s+\S+\s+AS\s+(\w+)/i,
        expose:     /^EXPOSE\s+(\d+)/i,
        entrypoint: /^(?:ENTRYPOINT|CMD)\s+/i,
        arg:        /^ARG\s+(\w+)/i,
        env:        /^ENV\s+(\w+)/i,
      },
      relationships: {
        from:     /^FROM\s+(\S+?)(?::(\S+))?\s*/i,
        copyFrom: /^COPY\s+--from=(\w+)/i,
      },
      skipCallObjects: [],
    },
  },

  // ─── Makefile ──────────────────────────────────────────────────────────────

  makefile: {
    indentBased: false,
    endKeyword: null,
    comment: { line: '#', block: null },

    chunker: {
      target:   /^([\w.-]+)\s*:/,
      variable: /^(\w+)\s*[:?+]?=/,
    },

    graph: {
      entities: {
        target:   /^([\w.-]+)\s*:/,
        variable: /^(\w+)\s*[:?+]?=/,
      },
      relationships: {
        include: /^-?include\s+(\S+)/,
      },
      skipCallObjects: [],
    },
  },
};

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Get language config by file extension.
 * @param {string} ext - File extension including dot (e.g. '.py')
 * @returns {{ id: string, ...config } | null}
 */
export function getLanguageByExtension(ext) {
  const id = EXTENSION_MAP[ext.toLowerCase()];
  if (!id) return null;
  const lang = LANGUAGES[id];
  if (!lang) return { id, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
  return { id, ...lang };
}

/**
 * Get language config by file path (handles both extension and filename).
 * @param {string} filePath - File path
 * @returns {{ id: string, ...config } | null}
 */
export function getLanguageByPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext) {
    const result = getLanguageByExtension(ext);
    if (result) return result;
  }
  // No extension — check filename
  const basename = path.basename(filePath);
  // Check exact match
  const id = FILENAME_MAP[basename];
  if (id) {
    const lang = LANGUAGES[id];
    if (!lang) return { id, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
    return { id, ...lang };
  }
  // Check prefix match (e.g. "Dockerfile.prod" → dockerfile)
  for (const [name, langId] of Object.entries(FILENAME_MAP)) {
    if (basename.startsWith(name + '.') || basename.startsWith(name + '-')) {
      const lang = LANGUAGES[langId];
      if (!lang) return { id: langId, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
      return { id: langId, ...lang };
    }
  }
  return null;
}

/**
 * Get chunker patterns for a language.
 * @param {string} languageId - Language identifier (e.g. 'python')
 * @returns {Object<string, RegExp> | null}
 */
export function getChunkerPatterns(languageId) {
  return LANGUAGES[languageId]?.chunker || null;
}

/**
 * Get graph extraction patterns for a language.
 * @param {string} languageId
 * @returns {{ entities: Object, relationships: Object, skipCallObjects: string[] } | null}
 */
export function getGraphPatterns(languageId) {
  return LANGUAGES[languageId]?.graph || null;
}

/**
 * Get language metadata (indent style, comments).
 * @param {string} languageId
 * @returns {{ indentBased: boolean, endKeyword: string|null, comment: Object } | null}
 */
export function getLanguageMeta(languageId) {
  const lang = LANGUAGES[languageId];
  if (!lang) return null;
  return {
    indentBased: lang.indentBased,
    endKeyword: lang.endKeyword,
    comment: lang.comment,
  };
}

/**
 * Get all supported file extensions.
 * @returns {string[]}
 */
export function getSupportedExtensions() {
  return Object.keys(EXTENSION_MAP);
}

/**
 * Check if a language uses indentation for scoping.
 * @param {string} languageId
 * @returns {boolean}
 */
export function isIndentBased(languageId) {
  return LANGUAGES[languageId]?.indentBased || false;
}

/**
 * Get all registered language IDs.
 * @returns {string[]}
 */
export function getRegisteredLanguages() {
  return Object.keys(LANGUAGES);
}

export default {
  EXTENSION_MAP,
  FILENAME_MAP,
  LANGUAGES,
  getLanguageByExtension,
  getLanguageByPath,
  getChunkerPatterns,
  getGraphPatterns,
  getLanguageMeta,
  getSupportedExtensions,
  isIndentBased,
  getRegisteredLanguages,
};
