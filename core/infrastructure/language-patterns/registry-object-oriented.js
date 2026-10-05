// =============================================================================
// Object-Oriented Language Registry
// =============================================================================
// Object-oriented and strongly-typed ecosystems.
// Data-only module consumed by `registry.js`.
export const OBJECT_ORIENTED_LANGUAGES = {
  // ─── Protobuf ──────────────────────────────────────────────────────────────
  proto: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      message: /message\s+(\w+)/,
      service: /service\s+(\w+)/,
      enum: /enum\s+(\w+)/,
      rpc: /rpc\s+(\w+)/,
    },
    graph: {
      entities: {
        message: /message\s+(\w+)\s*\{/,
        service: /service\s+(\w+)\s*\{/,
        rpc: /rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s+returns\s+\(\s*(\w+)\s*\)/,
        enum: /enum\s+(\w+)\s*\{/,
      },
      relationships: {
        import: /import\s+"([^"]+)"/,
      },
      skipCallObjects: [],
    },
  },
  // ─── PHP ───────────────────────────────────────────────────────────────────
  php: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /^(?:abstract\s+|final\s+)?class\s+(\w+)/,
      function: /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(/,
      interface: /^interface\s+(\w+)/,
      trait: /^trait\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /^(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s\\]+))?/,
        interface: /^interface\s+(\w+)(?:\s+extends\s+([\w,\s\\]+))?/,
        trait: /^trait\s+(\w+)/,
        function: /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
      },
      relationships: {
        use: /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?/,
        namespace: /^namespace\s+([\w\\]+)/,
        extends: /^(?:(?:abstract|final|readonly)\s+)*(?:class|interface)\s+\w+\s+extends\s+([\w\\]+(?:\s*,\s*[\w\\]+)*)/,
        implements: /^(?:(?:abstract|final|readonly)\s+)*(?:class|enum)\s+\w+(?:\s*:\s*\w+)?(?:\s+extends\s+[\w\\]+)?\s+implements\s+([\w\\,\s]+)/,
        methodCall: /(\w+)\s*(?:->|::)\s*(\w+)\s*\(/,
      },
      // `self::` / `static::` / `$this->` calls stay (same-class edges).
      skipCallObjects: ["parent", "echo", "print", "var_dump"],
    },
  },
  // ─── Ruby ──────────────────────────────────────────────────────────────────
  ruby: {
    indentBased: false,
    endKeyword: "end",
    blockKeywords: ['class', 'module', 'def', 'if', 'unless', 'while', 'until', 'case', 'for', 'begin', 'do'],
    comment: {
      line: "#",
      block: ["=begin", "=end"],
    },
    chunker: {
      // Allow leading whitespace so indented `class Foo` declarations
      // nested inside a module (the dominant Ruby idiom) actually match.
      // The previous `^class` anchor missed every class inside a module
      // wrapper (e.g. `class IndifferentHash < Hash` inside `module Sinatra`).
      // Superclass can be any expression (`Rack::Request`, `Struct.new(:app)`)
      // — `_matchBoundary` only consumes the first capture, so allowing any
      // tail after the class name keeps the inheritance form parsable.
      class: /^\s*class\s+(\w+)/,
      module: /^\s*module\s+(\w+)/,
      method: /^\s*def\s+(\w+[?!=]?)/,
    },
    graph: {
      entities: {
        class: /^\s*class\s+(\w+)/,
        module: /^\s*module\s+(\w+)/,
        method: /^\s*def\s+(\w+[?!=]?)\s*(?:\(([^)]*)\))?/,
      },
      relationships: {
        require: /^require(?:_relative)?\s+['"]([^'"]+)['"]/,
        include: /^\s*include\s+(\w+)/,
        extend: /^\s*extend\s+(\w+)/,
        prepend: /^\s*prepend\s+(\w+)/,
        // `class Foo::Bar < Sequel::Model` — namespaced class names too.
        inherit: /^\s*class\s+[\w:]+\s*<\s*([\w:]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*[(!]/,
      },
      skipCallObjects: ["puts", "print", "p", "raise", "require", "attr_accessor", "attr_reader", "attr_writer"],
    },
  },
  // ─── Kotlin ────────────────────────────────────────────────────────────────
  kotlin: {
    indentBased: false,
    endKeyword: null,
    multiLinePatterns: true,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/,
      interface: /interface\s+(\w+)/,
      function: /(?:fun|suspend\s+fun)\s+(\w+)/,
      object: /(?:companion\s+)?object\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)(?:\s*(?:\(|:)\s*)?/,
        interface: /interface\s+(\w+)/,
        function: /(?:override\s+)?(?:suspend\s+)?fun\s+(\w+)\s*\(([^)]*)\)/,
        object: /(?:companion\s+)?object\s+(\w+)/,
        enum: /enum\s+class\s+(\w+)/,
        typealias: /typealias\s+(\w+)/,
      },
      relationships: {
        import: /^import\s+([\w.]+)/,
        // Whole supertype list after the primary constructor:
        // `class Foo(x: Int) : Bar(x), Baz, Qux<Int>`, `object O : I`,
        // `interface I : J, K`, `class Gen<T : Any> : Base<T>()`,
        // `class Del(b: B) : B by b`. The old form stopped at the first `(`.
        // An anonymous `object : Task() {` expression is not a type
        // declaration; only named and companion objects count.
        inherit: /^(?:@?[\w.]+(?:\([^)]*\))?\s+)*?(?:companion\s+object(?:\s+\w+)?|(?:class|object|interface)\s+\w+)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*(?:(?:@?\w+\s+)*constructor\s*)?(?:\((?:[^()]|\([^()]*\))*\))?\s*:\s*([^{=]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["println", "print", "require", "check", "assert", "listOf", "mapOf", "setOf"],
    },
  },
  // ─── Swift ─────────────────────────────────────────────────────────────────
  swift: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:public|open|internal|private|fileprivate)?\s*(?:final\s+)?class\s+(\w+)/,
      struct: /(?:public|internal|private|fileprivate)?\s*struct\s+(\w+)/,
      protocol: /(?:public|internal)?\s*protocol\s+(\w+)/,
      func: /(?:public|open|internal|private|fileprivate)?\s*(?:static\s+|class\s+)?(?:override\s+)?func\s+(\w+)/,
      enum: /(?:public|internal|private|fileprivate)?\s*enum\s+(\w+)/,
      extension: /extension\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:public|open|internal|private|fileprivate)?\s*(?:final\s+)?class\s+(\w+)/,
        struct: /(?:public|internal|private|fileprivate)?\s*struct\s+(\w+)/,
        protocol: /(?:public|internal)?\s*protocol\s+(\w+)/,
        func: /(?:public|open|internal|private|fileprivate)?\s*(?:static\s+|class\s+)?(?:override\s+)?func\s+(\w+)\s*\(([^)]*)\)/,
        enum: /(?:public|internal|private|fileprivate)?\s*enum\s+(\w+)/,
        extension: /extension\s+(\w+)/,
      },
      relationships: {
        import: /^import\s+(\w+)/,
        // Generic types (`class Foo<T>: Base`), protocols refining protocols,
        // actors, `extension A.B: P`; a trailing `where` clause is cut
        // downstream. Anchored so `class var x: Int` is not inheritance.
        inherit: /^(?:@?\w+(?:\([^)]*\))?\s+)*(?:class|struct|enum|extension|protocol|actor)\s+[\w.]+\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*:\s*([^{]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["print", "fatalError", "precondition", "assert", "String", "Int", "Double"],
    },
  },
  // ─── Scala ─────────────────────────────────────────────────────────────────
  scala: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:case\s+)?class\s+(\w+)/,
      object: /object\s+(\w+)/,
      trait: /trait\s+(\w+)/,
      def: /def\s+(\w+)/,
    },
    graph: {
      // Anchored at the line start after annotations and modifiers: unanchored,
      // `"this class will be made final"` in an annotation argument was a class
      // named `will`. A def may have no parameter list (`def bytes: Array[Byte] =`)
      // and a symbolic name (`def /(chunk: PathChunk)`).
      entities: {
        class: /^(?:@[\w.]+(?:\[[^\]]*\])?(?:\((?:[^()]|\([^()]*\))*\))?\s+)*(?:(?:private|protected)(?:\[[\w.]+\])?\s+|(?:final|sealed|abstract|implicit|case|open|inline|transparent)\s+)*class\s+(\w+)(?:\s*\([^)]*\))?(?:\s+extends\s+(\w+))?/,
        object: /^(?:@[\w.]+(?:\[[^\]]*\])?(?:\((?:[^()]|\([^()]*\))*\))?\s+)*(?:(?:private|protected)(?:\[[\w.]+\])?\s+|(?:final|implicit|case|transparent|package)\s+)*object\s+(\w+)/,
        trait: /^(?:@[\w.]+(?:\[[^\]]*\])?(?:\((?:[^()]|\([^()]*\))*\))?\s+)*(?:(?:private|protected)(?:\[[\w.]+\])?\s+|(?:sealed|transparent)\s+)*trait\s+(\w+)/,
        def: /^(?:@[\w.]+(?:\[[^\]]*\])?(?:\((?:[^()]|\([^()]*\))*\))?\s+)*(?:(?:private|protected)(?:\[[\w.]+\])?\s+|(?:final|override|implicit|inline|transparent|abstract|lazy)\s+)*def\s+([A-Za-z_$][\w$]*|[!#%&*+\-/:<=>?@\\^|~]+)\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?/,
      },
      relationships: {
        import: /^import\s+([\w._{}]+)/,
        extends: /(?:class|object|trait)\s+\w+(?:\s*\([^)]*\))?\s+extends\s+(\w+)/,
        with: /\bwith\s+(\w+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["println", "print", "require", "assert", "Seq", "List", "Map", "Set", "Option"],
    },
  },
  // ─── Dart ──────────────────────────────────────────────────────────────────
  dart: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:abstract\s+)?class\s+(\w+)/,
      mixin: /mixin\s+(\w+)/,
      function: /^(?!(?:return|if|else|for|while|switch|throw|new|await|yield|assert|var|final|const)\s)(?:static\s+)?(?:[\w<>?]+)\s+(\w+)\s*\(/,
      enum: /enum\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        mixin: /mixin\s+(\w+)/,
        function: /^(?!(?:return|if|else|for|while|switch|throw|new|await|yield|assert|var|final|const)\s)(?:static\s+)?(?:[\w<>?]+)\s+(\w+)\s*\(([^)]*)\)/,
        enum: /enum\s+(\w+)/,
      },
      relationships: {
        import: /^import\s+['"]([^'"]+)['"]/,
        extends: /class\s+\w+\s+extends\s+(\w+)/,
        implements: /(?:class|mixin)\s+\w+(?:\s+extends\s+\w+)?\s+(?:with\s+[\w,\s]+\s+)?implements\s+([\w,\s]+)/,
        with: /\bwith\s+([\w,\s]+?)(?=\s+implements|\s*\{|\s*$)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["print", "debugPrint", "setState", "Navigator", "MediaQuery"],
    },
  },
  // ─── Groovy ────────────────────────────────────────────────────────────────
  groovy: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      class: /(?:abstract\s+)?class\s+(\w+)/,
      interface: /interface\s+(\w+)/,
      method: /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\(/,
      trait: /trait\s+(\w+)/,
    },
    graph: {
      entities: {
        class: /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/,
        interface: /interface\s+(\w+)/,
        trait: /trait\s+(\w+)/,
        method: /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/,
      },
      relationships: {
        import: /^import\s+([\w.]+)/,
        extends: /class\s+\w+\s+extends\s+(\w+)/,
        implements: /class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([\w,\s]+)/,
        methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/,
      },
      skipCallObjects: ["println", "print", "assert", "def"],
    },
  },
  // ─── Objective-C ───────────────────────────────────────────────────────────
  objc: {
    indentBased: false,
    endKeyword: "@end",
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      interface: /^@interface\s+(\w+)\s*(?::\s*(\w+))?/,
      impl: /^@implementation\s+(\w+)/,
      protocol: /^@protocol\s+(\w+)/,
      method: /^[+-]\s*\([^)]*\)\s*(\w+)/,
    },
    graph: {
      entities: {
        interface: /^@interface\s+(\w+)\s*(?::\s*(\w+))?/,
        impl: /^@implementation\s+(\w+)/,
        protocol: /^@protocol\s+(\w+)/,
        method: /^[+-]\s*\([^)]*\)\s*(\w+)/,
        property: /^@property\s*\([^)]*\)\s*\w+\s+\*?(\w+)/,
      },
      relationships: {
        import: /^#import\s+[<"]([^>"]+)[>"]/,
        inherit: /^@interface\s+\w+\s*:\s*(\w+)/,
        protocol: /^@interface\s+\w+\s*:\s*\w+\s*<([^>]+)>/,
        category: /^@interface\s+(\w+)\s*\((\w*)\)/,
      },
      skipCallObjects: ["NSLog", "NSString", "NSArray", "NSDictionary", "NSNumber"],
    },
  },
};

export default OBJECT_ORIENTED_LANGUAGES;
