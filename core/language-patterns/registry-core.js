// =============================================================================
// Core Language Registry
// =============================================================================
// Foundational, widely-used programming languages.
// Data-only module consumed by `registry.js`.
export const CORE_LANGUAGES = {
  // ─── JavaScript / TypeScript ───────────────────────────────────────────────
  javascript: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:export\s+)?class\s+(\w+)/,
      function: /(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:(]/,
      component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      arrow: /const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
    },
    graph: {
      entities: {
        class: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      },
      relationships: {
        extends: /class\s+\w+\s+extends\s+(\w+)/,
        import: /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["console", "Math", "JSON", "Object", "Array", "Promise", "process", "Buffer", "Date"],
    },
  },
  // ─── Java ──────────────────────────────────────────────────────────────────
  java: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*class\s+(\w+)/,
      method: /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*[\w<>\[\]]+\s+(\w+)\s*\(/,
      interface: /(?:public)?\s*interface\s+(\w+)/,
      enum: /(?:public)?\s*enum\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:public|private|protected)?\s*(?:static)?\s*(?:final|abstract)?\s*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/,
        interface: /(?:public)?\s*interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/,
        enum: /(?:public)?\s*enum\s+(\w+)/,
        method: /(?:@\w+\s*(?:\([^)]*\))?\s*)*(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*(?:synchronized)?\s*(?:<[\w\s,<>?]+>\s*)?(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)/,
        field: /(?:public|private|protected)\s+(?:static)?\s*(?:final)?\s*(\w+(?:<[\w\s,<>?]+>)?(?:\[\])?)\s+(\w+)\s*[;=]/,
      },
      relationships: {
        import: /import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/,
        package: /package\s+([\w.]+)\s*;/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
        throw: /throw\s+new\s+(\w+)/,
      },
      skipCallObjects: ["System", "log", "LOG", "logger", "String", "Integer", "Long", "Boolean", "Double", "Float"],
    },
  },
  // ─── Python ────────────────────────────────────────────────────────────────
  python: {
    indentBased: true,
    endKeyword: null,
    comment: {
      line: "#",
      block: ["\"\"\"", "\"\"\""],
    },
    chunker: {
      class: /^class\s+(\w+)(?:\(([^)]*)\))?:/,
      function: /^(?:async\s+)?def\s+(\w+)\s*\(/,
      decorator: /^@(\w+(?:\.\w+)*)/,
    },
    graph: {
      entities: {
        class: /^class\s+(\w+)(?:\(([^)]*)\))?:/,
        function: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/,
        field: /^(\w+)\s*:\s*([\w\[\],\s|]+)\s*=/,
      },
      relationships: {
        import: /^from\s+([\w.]+)\s+import/,
        plainImport: /^import\s+([\w.,\s]+)/,
        extends: /^class\s+\w+\(([^)]+)\)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
        decorator: /^@(\w+(?:\.\w+)*)/,
      },
      skipCallObjects: ["self", "cls", "super", "print", "len", "range", "str", "int", "list", "dict", "set", "type"],
    },
  },
  // ─── Go ────────────────────────────────────────────────────────────────────
  go: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      function: /^func\s+(\w+)\s*\(/,
      method: /^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(/,
      struct: /^type\s+(\w+)\s+struct\s*\{/,
      interface: /^type\s+(\w+)\s+interface\s*\{/,
    },
    graph: {
      entities: {
        function: /^func\s+(\w+)\s*\(([^)]*)\)/,
        method: /^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(([^)]*)\)/,
        struct: /^type\s+(\w+)\s+struct/,
        interface: /^type\s+(\w+)\s+interface/,
        typeAlias: /^type\s+(\w+)\s+(?!struct|interface)\w/,
        const: /^const\s+(\w+)\s/,
      },
      relationships: {
        import: /^\s*"([^"]+)"/,
        embed: /^\s+([A-Z]\w*)\s*$/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      isExported: (name) => /^[A-Z]/.test(name),
      skipCallObjects: ["fmt", "log", "os", "io", "strings", "strconv", "math", "time", "sort", "sync"],
    },
  },
  // ─── Rust ──────────────────────────────────────────────────────────────────
  rust: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      function: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      struct: /^(?:pub\s+)?struct\s+(\w+)/,
      enum: /^(?:pub\s+)?enum\s+(\w+)/,
      trait: /^(?:pub\s+)?trait\s+(\w+)/,
      impl: /^impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/,
    },
    graph: {
      entities: {
        function: /^(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/,
        struct: /^(?:pub\s+)?struct\s+(\w+)/,
        enum: /^(?:pub\s+)?enum\s+(\w+)/,
        trait: /^(?:pub\s+)?trait\s+(\w+)/,
        impl: /^impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/,
        type: /^(?:pub\s+)?type\s+(\w+)/,
        const: /^(?:pub\s+)?const\s+(\w+)\s*:/,
        static: /^(?:pub\s+)?static\s+(\w+)\s*:/,
      },
      relationships: {
        use: /^use\s+([\w:]+)(?:::\{([^}]+)\})?/,
        implFor: /^impl\s+(\w+)\s+for\s+(\w+)/,
        derive: /#\[derive\(([^)]+)\)\]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["self", "Self", "super", "crate", "std", "println", "eprintln", "format", "vec", "String"],
    },
  },
  // ─── C ─────────────────────────────────────────────────────────────────────
  c: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      function: /^(?:[\w*\s]+)\s+(\w+)\s*\([^)]*\)\s*\{/,
      struct: /^(?:typedef\s+)?struct\s+(\w+)/,
      enum: /^(?:typedef\s+)?enum\s+(\w+)/,
    },
    graph: {
      entities: {
        function: /^(?:static\s+)?(?:inline\s+)?(?:[\w*]+\s+)+(\w+)\s*\([^)]*\)\s*\{/,
        struct: /^(?:typedef\s+)?struct\s+(\w+)/,
        enum: /^(?:typedef\s+)?enum\s+(\w+)/,
        typedef: /^typedef\s+.+\s+(\w+)\s*;/,
        macro: /^#define\s+(\w+)/,
      },
      relationships: {
        include: /^#include\s+[<"]([^>"]+)[>"]/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["printf", "fprintf", "sprintf", "malloc", "free", "sizeof", "memcpy", "memset", "strlen"],
    },
  },
  // ─── C++ ───────────────────────────────────────────────────────────────────
  cpp: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /^(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?/,
      function: /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
      namespace: /^namespace\s+(\w+)/,
      template: /^template\s*(<[^>]+>)/,
    },
    graph: {
      entities: {
        class: /^(?:class|struct)\s+(\w+)/,
        namespace: /^namespace\s+(\w+)/,
        function: /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
        typedef: /^(?:typedef|using)\s+.+\s+(\w+)/,
        enum: /^enum\s+(?:class\s+)?(\w+)/,
      },
      relationships: {
        include: /^#include\s+[<"]([^>"]+)[>"]/,
        inherit: /:\s*(?:public|protected|private)\s+(\w+)/,
        methodOf: /(\w+)\s*::\s*(\w+)\s*\(/,
        methodCall: /(\w+)\s*(?:\.|->)\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["std", "cout", "cerr", "endl", "printf", "fprintf", "malloc", "free"],
    },
  },
  // ─── C# ────────────────────────────────────────────────────────────────────
  csharp: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)/,
      interface: /(?:public|internal)?\s*interface\s+(\w+)/,
      method: /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/,
      property: /(?:public|private|protected|internal)\s+(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
      enum: /(?:public|internal)?\s*enum\s+(\w+)/,
      struct: /(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        interface: /(?:public|internal)?\s*interface\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        enum: /(?:public|internal)?\s*enum\s+(\w+)/,
        struct: /(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
        method: /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(([^)]*)\)/,
        property: /(?:public|private|protected|internal)\s+(?:static\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
        field: /(?:public|private|protected|internal)\s+(?:static\s+)?(?:readonly\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*[;=]/,
      },
      relationships: {
        using: /^using\s+([\w.]+)\s*;/,
        namespace: /^namespace\s+([\w.]+)/,
        inherit: /class\s+\w+\s*:\s*([\w,\s<>]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["Console", "Debug", "Trace", "String", "Int32", "Math", "Convert", "Task"],
    },
  },
};

export default CORE_LANGUAGES;
