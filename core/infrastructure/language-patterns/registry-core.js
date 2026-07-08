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
    multiLinePatterns: true,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:export\s+(?:default\s+)?)?class\s+(\w+)/,
      function: /(?:export\s+(?:default\s+)?)?(?:const|function\s*\*?\s*|async\s+function\s*\*?\s*)\s*(\w+)\s*[=:(]/,
      component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      arrow: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
      arrowNoParen: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\w+\s*=>/,
      accessor: /(?:get|set)\s+(\w+)\s*\(/,
      objectMethod: /^\s+(\w+)\s*\([^)]*\)\s*\{/,
      moduleExportObj: /\b(module\.exports)\s*=\s*\{/,
      moduleExport: /module\.exports\s*=\s*(?:class|function\s*\*?\s*|async\s+function\s*\*?\s*)\s*(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        function: /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)\s*\(/,
        arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
        objectArrow: /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/,
        objectMethod: /^\s+(\w+)\s*\([^)]*\)\s*\{/,
      },
      relationships: {
        extends: /class\s+\w+\s+extends\s+(\w+)/,
        import: /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
        require: /(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        reexport: /export\s+(?:\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"]/,
        dynamicImport: /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["console", "Math", "JSON", "Object", "Array", "Promise", "process", "Buffer", "Date"],
    },
  },
  // ─── TypeScript ────────────────────────────────────────────────────────────
  typescript: {
    indentBased: false,
    endKeyword: null,
    multiLinePatterns: true,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/,
      function: /(?:export\s+(?:default\s+)?)?(?:const|function\s*\*?\s*|async\s+function\s*\*?\s*)\s*(\w+)\s*[=:(]/,
      component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
      arrow: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
      arrowNoParen: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\w+\s*=>/,
      accessor: /(?:get|set)\s+(\w+)\s*\(/,
      objectMethod: /^\s+(\w+)\s*\([^)]*\)\s*\{/,
      interface: /^(?:export\s+)?interface\s+(\w+)/,
      typeAlias: /^(?:export\s+)?type\s+(\w+)\s*[=<]/,
      enum: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,
      namespace: /^(?:export\s+)?(?:declare\s+)?namespace\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/,
        function: /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s+(\w+)\s*\(/,
        arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
        component: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:]/,
        objectArrow: /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/,
        objectMethod: /^\s+(\w+)\s*\([^)]*\)\s*\{/,
        interface: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/,
        typeAlias: /(?:export\s+)?type\s+(\w+)\s*[=<]/,
        enum: /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,
        namespace: /(?:export\s+)?(?:declare\s+)?namespace\s+(\w+)/,
      },
      relationships: {
        extends: /class\s+\w+\s+extends\s+(\w+)/,
        implements: /class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([\w,\s]+)/,
        // TS-specific: interface extends interface(s). Captures the
        // comma-separated list (with optional generics) — splitting is
        // handled by expandRelationshipTargets() via MULTI_TARGET_TYPES.
        // Capture is lazy and bounded by either the opening `{` of the
        // body or end-of-line, which covers both `extends X {`,
        // `extends X {}` (empty body) and continuation-line `extends X`.
        interfaceExtends: /^(?:export\s+)?interface\s+\w+(?:<[^>]*>)?\s+extends\s+([\w,\s<>.]+?)\s*(?:\{|$)/,
        // TS-specific: explicit type-only imports/re-exports.
        // The body of `import { type Foo, Bar }` (mixed inline-type
        // imports) is still picked up by the regular `import` pattern
        // for module-level dependency tracking; we don't try to split
        // type/value at member level in regex.
        typeImport: /^import\s+type\s+(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/,
        typeReexport: /^export\s+type\s+(?:\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"]/,
        import: /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
        require: /(?:const|let|var)\s+(?:\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        reexport: /export\s+(?:\{[^}]+\}|\*)\s+from\s+['"]([^'"]+)['"]/,
        dynamicImport: /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
        decorator: /^@(\w+(?:\.\w+)*)/,
        // TS-specific: generic constraints `<T extends Bar>`. JSX is
        // safe because `<Component prop=...>` has no `extends` keyword;
        // matching is conservative on the literal `extends` token.
        genericConstraint: /<\s*\w+\s+extends\s+(\w+)/,
      },
      skipCallObjects: ["console", "Math", "JSON", "Object", "Array", "Promise", "process", "Buffer", "Date"],
    },
  },
  // ─── Java ──────────────────────────────────────────────────────────────────
  java: {
    indentBased: false,
    endKeyword: null,
    multiLinePatterns: true,
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
        // Capture qualified targets; generic suffixes are normalized downstream.
        extends: /(?:class|interface)\s+\w+(?:<[^>]*>)?\s+extends\s+([A-Za-z_][\w$.]*)/,
        implements: /implements\s+([A-Za-z_][\w$.,\s<>?]+)\s*\{/,
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
    multiLinePatterns: true,
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
      macro: /^macro_rules!\s+(\w+)/,
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
        macro: /^macro_rules!\s+(\w+)/,
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
      // Skip attribute-like prefixes between `struct` and the type name:
      //   - function-like attrs: __attribute__((...)), __declspec(...), _Alignas(N), __forceinline(...), __inline__(...)
      //     Paren matcher allows up to 3 nesting levels — __attribute__ standardly takes
      //     a doubly-parenthesized arg, optionally containing call-form attrs like aligned(8).
      //   - C++11 attribute syntax: [[ ... ]]
      //   - ALL_CAPS user macros (≥3 chars): PACKED_API, HWY_DLLEXPORT, EIGEN_API, etc.
      // Without this, `struct __attribute__((packed)) Foo` captured `__attribute__` as the name.
      // Backtracking handles ALL_CAPS-named forward decls (`struct WHEEL;`).
      struct: /^(?:typedef\s+)?struct(?:\s+(?:__attribute__|__declspec|_Alignas|__forceinline|__inline__)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\s+\[\[[^\]]*\]\]|\s+[A-Z][A-Z0-9_]{2,})*\s+(\w+)/,
      enum: /^(?:typedef\s+)?enum\s+(\w+)/,
    },
    graph: {
      entities: {
        function: /^(?:static\s+)?(?:inline\s+)?(?:[\w*]+\s+)+(\w+)\s*\([^)]*\)\s*\{/,
        struct: /^(?:typedef\s+)?struct(?:\s+(?:__attribute__|__declspec|_Alignas|__forceinline|__inline__)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\s+\[\[[^\]]*\]\]|\s+[A-Z][A-Z0-9_]{2,})*\s+(\w+)/,
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
      // Skip attribute-like prefixes between `class`/`struct` and the type name.
      // Closed list of standard attributes:
      //   - function-like: alignas(N), __attribute__((...)), __declspec(...),
      //     __forceinline(...). Paren matcher allows up to 3 nesting levels —
      //     __attribute__ standardly takes a doubly-parenthesized arg, optionally
      //     containing call-form attrs like aligned(8).
      //   - C++11 attribute syntax: [[ ... ]]
      //   - ALL_CAPS user macros (≥3 chars): HWY_DLLEXPORT, EIGEN_API, FMT_API, etc.
      //     Common in dllexport/visibility shims across header-only C++ libraries.
      // Without this, `struct alignas(16) uint128_t` captured `alignas` as the
      // struct name (CPP-005 failure root cause). Backtracking preserves capture of
      // ALL_CAPS forward decls like `class WHEEL;`.
      class: /^(?:class|struct)(?:\s+(?:alignas|__attribute__|__declspec|__forceinline)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\s+\[\[[^\]]*\]\]|\s+[A-Z][A-Z0-9_]{2,})*\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?/,
      function: /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
      namespace: /^namespace\s+(\w+)/,
      template: /^template\s*(<[^>]+>)/,
    },
    graph: {
      entities: {
        class: /^(?:class|struct)(?:\s+(?:alignas|__attribute__|__declspec|__forceinline)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\s+\[\[[^\]]*\]\]|\s+[A-Z][A-Z0-9_]{2,})*\s+(\w+)/,
        namespace: /^namespace\s+(\w+)/,
        function: /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
        typedef: /^(?:typedef|using)\s+.+\s+(\w+)/,
        enum: /^enum\s+(?:class\s+)?(\w+)/,
        // Out-of-line qualified member definitions — `Type Class::method(...)`
        // — the dominant C++ idiom for .cpp files, previously invisible to the
        // graph (botan's GeneralName::matches_dns / Name_Constraints::validate,
        // E2 in the 2026-07-07 trace audit). Additive only: existing patterns
        // above win first (one entity per line), so no current entity changes.
        // Requires a return-type token before the qualified name (rules out
        // statement-position calls `Foo::bar(x);`) and rejects `;` after `(`
        // (rules out prototypes and single-line calls); tolerates params
        // continuing on the next line and `{` on its own line (Allman style).
        method: /^(?:template\s*<[^<>]*>\s*)?(?!(?:return|if|while|for|switch|case|throw|delete|new|else|do|goto|using|typedef|catch)\b)[\w:*&<>~,\[\]\s]*?[\w>&*]\s+[*&]?(?:\w+(?:<[^<>]*>)?::)+(~?\w+)\s*\([^;]*(?:\)\s*(?:const)?\s*(?:noexcept(?:\([^()]*\))?)?\s*(?:override|final)?\s*(?:\{.*)?)?$/,
        // Out-of-line constructors/destructors: `Class::Class(...)` /
        // `Class::~Class(...)` — the backreference makes the class≡member
        // equality the discriminator, so `std::sort(...)` never matches.
        constructor: /^(?:template\s*<[^<>]*>\s*)?(?:\w+(?:<[^<>]*>)?::)*(\w+)(?:<[^<>]*>)?::~?\1\s*\([^;]*(?:\)\s*(?:noexcept(?:\([^()]*\))?)?\s*(?::\s*[\w({].*)?(?:\{.*)?)?$/,
      },
      relationships: {
        include: /^#include\s+[<"]([^>"]+)[>"]/,
        inherit: /(?:class|struct)\s+\w+\s*:\s*([^{]+)/,
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
      class: /^\s*(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)/,
      interface: /^\s*(?:public|internal)?\s*interface\s+(\w+)/,
      // Two alternation branches:
      //   (a) visibility-prefixed: loose return type — covers `public Task<int> Foo(...)`
      //       and `internal override void Bar(...)`.
      //   (b) visibility-less: STRICT return type (C# primitives + Task/ValueTask/
      //       IEnumerable/IAsyncEnumerable + capitalized identifiers) — covers
      //       default-private `void Foo<T>(...)` / `async Task Bar<T>(...)` patterns
      //       shipped widely in real codebases (e.g. Garnet's AsyncProcessor.cs
      //       partial-class shard). Strict return-type list prevents false positives
      //       like `return Foo()` and `if (cond)` (those starting tokens not in list).
      // Also adds `(?:<...>)?` between method name and `(` so generic-method declarations
      // `void Foo<T>(...)` get matched (previously rejected the `<T>` between name and `(`).
      method: /^\s*(?:(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?(?:[\w<>\[\]?]+)|(?:(?:static|async|override|virtual|sealed|new)\s+)*(?:void|bool|byte|sbyte|short|ushort|int|uint|long|ulong|float|double|decimal|char|string|object|Task(?:<[^>]+>)?|ValueTask(?:<[^>]+>)?|IEnumerable(?:<[^>]+>)?|IAsyncEnumerable(?:<[^>]+>)?|[A-Z][\w<>?\[\],]*))\s+(\w+)(?:<[\w\s,?<>]+>)?\s*\(/,
      property: /^\s*(?:public|private|protected|internal)\s+(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
      enum: /^\s*(?:public|internal)?\s*enum\s+(\w+)/,
      struct: /^\s*(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /^\s*(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        interface: /^\s*(?:public|internal)?\s*interface\s+(\w+)(?:\s*:\s*([\w,\s<>]+))?/,
        enum: /^\s*(?:public|internal)?\s*enum\s+(\w+)/,
        struct: /^\s*(?:public|internal)?\s*(?:readonly\s+)?struct\s+(\w+)/,
        method: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:override\s+)?(?:virtual\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(([^)]*)\)/,
        property: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/,
        field: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:readonly\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*[;=]/,
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

// .tsx files share TypeScript chunker/graph regex; only the
// tree-sitter WASM grammar differs (see GRAMMAR_MAP in tree-sitter-provider.js).
// Aliasing the same object means chunker patterns, graph patterns, and
// skipCallObjects stay byte-identical to typescript without duplication.
CORE_LANGUAGES.tsx = CORE_LANGUAGES.typescript;

export default CORE_LANGUAGES;
