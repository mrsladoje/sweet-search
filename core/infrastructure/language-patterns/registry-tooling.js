// =============================================================================
// Tooling and Infrastructure Language Registry
// =============================================================================
// Scripting, infra, and build tooling languages.
// Data-only module consumed by `registry.js`.
export const TOOLING_LANGUAGES = {
  // ─── Shell / Bash ──────────────────────────────────────────────────────────
  shell: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      function: /^(?:function\s+)?(\w+)\s*\(\)\s*\{/,
    },
    graph: {
      entities: {
        function: /^(?:function\s+)?(\w+)\s*\(\)\s*\{/,
      },
      relationships: {
        source: /^(?:source|\.)\s+(.+)/,
      },
      skipCallObjects: ["echo", "printf", "cd", "export", "local", "readonly"],
    },
  },
  // ─── PowerShell ────────────────────────────────────────────────────────────
  powershell: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: ["<#", "#>"],
    },
    chunker: {
      function: /^function\s+([\w-]+)/,
      class: /^class\s+(\w+)/,
    },
    graph: {
      entities: {
        function: /^function\s+([\w-]+)/,
        class: /^class\s+(\w+)/,
      },
      relationships: {
        import: /^(?:Import-Module|using\s+module)\s+(\S+)/,
      },
      skipCallObjects: ["Write-Host", "Write-Output", "Write-Error", "Write-Warning"],
    },
  },
  // ─── Lua ───────────────────────────────────────────────────────────────────
  lua: {
    indentBased: false,
    endKeyword: "end",
    blockKeywords: ['function', 'if', 'while', 'for'],
    comment: {
      line: "--",
      block: ["--[[", "]]"],
    },
    chunker: {
      function: /^(?:local\s+)?function\s+(\w+)/,
      assignedFunc: /^(?:local\s+)?(\w+)\s*=\s*function/,
    },
    graph: {
      entities: {
        function: /^(?:local\s+)?function\s+([\w.]+)/,
        assignedFunc: /^(?:local\s+)?(\w+)\s*=\s*function/,
      },
      relationships: {
        require: /(?:local\s+\w+\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      },
      skipCallObjects: ["print", "io", "os", "string", "table", "math", "error", "assert", "type", "pairs", "ipairs"],
    },
  },
  // ─── Zig ───────────────────────────────────────────────────────────────────
  zig: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: null,
    },
    chunker: {
      function: /^(?:pub\s+)?fn\s+(\w+)/,
      struct: /^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?struct/,
      enum: /^(?:pub\s+)?const\s+(\w+)\s*=\s*enum/,
    },
    graph: {
      entities: {
        function: /^(?:pub\s+)?fn\s+(\w+)/,
        struct: /^(?:pub\s+)?const\s+(\w+)\s*=\s*(?:packed\s+)?struct/,
        enum: /^(?:pub\s+)?const\s+(\w+)\s*=\s*enum/,
        const: /^(?:pub\s+)?const\s+(\w+)/,
      },
      relationships: {
        import: /^const\s+\w+\s*=\s*@import\s*\("([^"]+)"\)/,
      },
      skipCallObjects: ["std", "@import"],
    },
  },
  // ─── Elixir ────────────────────────────────────────────────────────────────
  elixir: {
    indentBased: false,
    endKeyword: "end",
    blockKeywords: ['defmodule', 'defmacro', 'defp', 'def', 'fn', 'if', 'unless', 'case', 'cond', 'with', 'try', 'receive'],
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      module: /defmodule\s+([\w.]+)/,
      function: /def\s+(\w+[?!]?)/,
      private: /defp\s+(\w+[?!]?)/,
      macro: /defmacro\s+(\w+)/,
    },
    graph: {
      entities: {
        module: /defmodule\s+([\w.]+)/,
        function: /def\s+(\w+[?!]?)\s*(?:\(([^)]*)\))?/,
        private: /defp\s+(\w+[?!]?)/,
        macro: /defmacro\s+(\w+)/,
      },
      relationships: {
        use: /^\s*use\s+([\w.]+)/,
        import: /^\s*import\s+([\w.]+)/,
        alias: /^\s*alias\s+([\w.]+)/,
        require: /^\s*require\s+([\w.]+)/,
      },
      skipCallObjects: ["IO", "Logger", "Kernel", "Enum", "Map", "List", "String"],
    },
  },
  // ─── Nim ───────────────────────────────────────────────────────────────────
  nim: {
    indentBased: true,
    endKeyword: null,
    comment: {
      line: "#",
      block: ["#[", "]#"],
    },
    chunker: {
      proc: /^proc\s+(\w+)/,
      func: /^func\s+(\w+)/,
      type: /^type\s+(\w+)/,
      method: /^method\s+(\w+)/,
    },
    graph: {
      entities: {
        proc: /^proc\s+(\w+)/,
        func: /^func\s+(\w+)/,
        type: /^type\s+(\w+)/,
        method: /^method\s+(\w+)/,
      },
      relationships: {
        import: /^import\s+([\w\/]+)/,
        from: /^from\s+([\w\/]+)\s+import/,
      },
      skipCallObjects: ["echo", "debugEcho", "assert", "quit"],
    },
  },
  // ─── F# ────────────────────────────────────────────────────────────────────
  fsharp: {
    indentBased: true,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["(*", "*)"],
    },
    chunker: {
      let: /^let\s+(\w+)/,
      type: /^type\s+(\w+)/,
      module: /^module\s+(\w+)/,
      member: /member\s+(?:this|_|x)\.(\w+)/,
    },
    graph: {
      entities: {
        let: /^let\s+(?:rec\s+)?(?:inline\s+)?(\w+)/,
        type: /^type\s+(\w+)/,
        module: /^module\s+(\w+)/,
        member: /member\s+(?:this|_|x)\.(\w+)/,
      },
      relationships: {
        open: /^open\s+([\w.]+)/,
      },
      skipCallObjects: ["printfn", "printf", "failwith", "raise", "ignore"],
    },
  },
  // ─── Dockerfile ────────────────────────────────────────────────────────────
  dockerfile: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      from: /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\w+))?/i,
      run: /^RUN\s+(.+)/i,
      copy: /^COPY\s+(.+)/i,
    },
    graph: {
      entities: {
        stage: /^FROM\s+(?:--platform=\S+\s+)?\S+\s+AS\s+(\w+)/i,
        expose: /^EXPOSE\s+(\d+)/i,
        entrypoint: /^(?:ENTRYPOINT|CMD)\s+(.+)/i,
        arg: /^ARG\s+(\w+)/i,
        env: /^ENV\s+(\w+)/i,
      },
      relationships: {
        from: /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\w+)?\s*/i,
        copyFrom: /^COPY\s+--from=(\w+)/i,
      },
      skipCallObjects: [],
    },
  },
  // ─── Makefile ──────────────────────────────────────────────────────────────
  makefile: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      target: /^([\w.-]+)\s*:(?!=)/,
      variable: /^(\w+)\s*[:?+]?=/,
    },
    graph: {
      entities: {
        target: /^([\w.-]+)\s*:(?!=)/,
        variable: /^(\w+)\s*[:?+]?=/,
      },
      relationships: {
        include: /^-?include\s+(\S+)/,
      },
      skipCallObjects: [],
    },
  },
  // ─── Julia (graph-only spike) ────────────────────────────────────────────────
  // No `chunker` key → getLanguageByExtension returns chunker:null → ast-chunker
  // keeps Julia on generic windowing. The `graph` patterns alone enable
  // regex-based entity extraction so ss-trace/code-graph works.
  julia: {
    indentBased: false,
    endKeyword: null,
    comment: { line: "#", block: ["#=", "=#"] },
    graph: {
      entities: {
        function: /^\s*function\s+([A-Za-z_]\w*)/,
        shortFunction: /^\s*([A-Za-z_]\w*)\((?:[^()]*)\)\s*(?:::[\w.<>{} ]+)?\s*=(?!=)/,
        struct: /^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/,
        module: /^\s*module\s+([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*(?:using|import)\s+([\w.]+)/,
      },
      skipCallObjects: [],
    },
  },
  // ════════════════════════════════════════════════════════════════════════════
  // GRAPH-ONLY language entries (no `chunker` key → chunking stays generic via
  // parseGenericFile; the `graph` regexes enable ss-trace / code-graph symbol
  // extraction). Authored 2026-06 from each language's tree-sitter tags.scm /
  // universal-ctags conventions. Entity-type keys are free-form (the regex graph
  // path accepts any label, like Rust's existing const/static/type).
  // ════════════════════════════════════════════════════════════════════════════
  clojure: {
    indentBased: false, endKeyword: null,
    comment: { line: ";", block: null },
    graph: {
      entities: {
        function: /^\s*\(def(?:n-?|multi|method)\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([A-Za-z0-9*+!?<>=.\/'-]+)/,
        macro: /^\s*\(defmacro\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([A-Za-z0-9*+!?<>=.\/'-]+)/,
        struct: /^\s*\(def(?:record|type)\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([A-Za-z0-9*+!?<>=.\/'-]+)/,
        interface: /^\s*\(defprotocol\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([A-Za-z0-9*+!?<>=.\/'-]+)/,
        constant: /^\s*\(def\s+(?:\^(?:\{[^}]*\}|\S+)\s+)*([A-Za-z0-9*+!?<>=.\/'-]+)/,
        module: /^\s*\(ns\s+([A-Za-z0-9*+!?<>=.\/'-]+)/,
      },
      relationships: { import: /^\s*\(:?(?:require|use)\s+'?\[?([A-Za-z0-9.*_-]+)/ },
      skipCallObjects: ["let", "let*", "if", "when", "do", "fn", "map", "filter", "reduce"],
    },
  },
  elisp: {
    indentBased: false, endKeyword: null,
    comment: { line: ";", block: null },
    graph: {
      entities: {
        function: /^\s*\((?:cl-)?def(?:un|subst)\s+([A-Za-z0-9*+!?<>=\/_-]+)/,
        macro: /^\s*\((?:cl-)?defmacro\s+([A-Za-z0-9*+!?<>=\/_-]+)/,
        variable: /^\s*\(def(?:var|custom)\s+([A-Za-z0-9*+!?<>=\/_-]+)/,
        constant: /^\s*\(defconst\s+([A-Za-z0-9*+!?<>=\/_-]+)/,
        module: /^\s*\(defgroup\s+([A-Za-z0-9*+!?<>=\/_-]+)/,
      },
      relationships: { import: /^\s*\(require\s+'([A-Za-z0-9*+!?<>=\/_-]+)/ },
      skipCallObjects: ["let", "let*", "if", "when", "unless", "cond", "setq", "lambda", "progn"],
    },
  },
  haskell: {
    indentBased: false, endKeyword: null,
    comment: { line: "--", block: ["{-", "-}"] },
    graph: {
      entities: {
        function: /^\s*([a-z_][\w']*)\s*::/,
        type: /^\s*(?:data|newtype|type)\s+([A-Z]\w*)/,
        class: /^\s*class\s+(?:.*?=>\s*)?([A-Z]\w*)/,
        instance: /^\s*instance\s+(?:.*?=>\s*)?([A-Z]\w*)/,
        module: /^\s*module\s+([A-Z][\w.]*)/,
      },
      relationships: { import: /^\s*import\s+(?:qualified\s+)?([A-Z][\w.]*)/ },
      skipCallObjects: ["map", "filter", "foldr", "foldl", "return", "pure", "print", "putStrLn", "fmap", "show"],
    },
  },
  erlang: {
    indentBased: false, endKeyword: null,
    comment: { line: "%", block: null },
    graph: {
      entities: {
        module: /^\s*-module\(\s*([a-z]\w*)/,
        function: /^\s*(?!fun\b)([a-z]\w*)\s*\((?:(?!fun\b).)*\)\s*(?:when\b.*)?->/,
        struct: /^\s*-record\(\s*([a-z]\w*)/,
        macro: /^\s*-define\(\s*([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*-import\(\s*([a-z]\w*)/,
        include: /^\s*-include(?:_lib)?\(\s*"([^"]+)"/,
        inherit: /^\s*-behaviou?r\(\s*([a-z]\w*)/,
      },
      skipCallObjects: ["lists", "io", "erlang", "maps", "string", "proplists", "gen_server"],
    },
  },
  elm: {
    indentBased: false, endKeyword: null,
    comment: { line: "--", block: ["{-", "-}"] },
    graph: {
      entities: {
        function: /^\s*([a-z]\w*)\s*:/,
        type: /^\s*type\s+alias\s+([A-Z]\w*)/,
        enum: /^\s*type\s+([A-Z]\w*)/,
        port: /^\s*port\s+([a-z]\w*)\s*:/,
        module: /^\s*(?:port\s+|effect\s+)?module\s+([A-Z][\w.]*)/,
      },
      relationships: { import: /^\s*import\s+([A-Z][\w.]*)/ },
      skipCallObjects: ["List", "Maybe", "Result", "Html", "String", "Debug"],
    },
  },
  r: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*([A-Za-z.][\w.]*)\s*(?:<<?-|=)\s*function\b/,
        class: /^\s*set(?:Ref)?Class\s*\(\s*["']([A-Za-z.][\w.]*)["']/,
        method: /^\s*setMethod\s*\(\s*["']([A-Za-z.][\w.]*)["']/,
      },
      relationships: {
        import: /^\s*(?:library|require)\s*\(\s*["']?([A-Za-z.][\w.]*)["']?/,
        source: /^\s*source\s*\(\s*["']([^"']+)["']/,
      },
      skipCallObjects: ["c", "list", "print", "cat", "paste", "paste0", "return", "stop", "warning"],
    },
  },
  perl: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*sub\s+([A-Za-z_]\w*)/,
        module: /^\s*package\s+([\w:]+)/,
        constant: /^\s*use\s+constant\s+([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*(?:use|require)\s+([A-Z][\w:]*)/,
        inherit: /^\s*use\s+(?:parent|base)\s+(?:-norequire\s*,?\s*)?(?:qw[(\/{[|]\s*)?["']?([\w:]+)["']?/,
      },
      skipCallObjects: ["print", "say", "shift", "push", "pop", "return", "my", "scalar", "keys", "values"],
    },
  },
  tcl: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*proc\s+([^\s{]+)/,
        module: /^\s*namespace\s+eval\s+([^\s{]+)/,
      },
      relationships: {
        import: /^\s*package\s+require\s+([\w:]+)/,
        source: /^\s*source\s+(\S+)/,
      },
      skipCallObjects: ["set", "puts", "expr", "return", "string", "list", "lappend", "incr", "if", "foreach"],
    },
  },
  vim: {
    indentBased: false, endKeyword: null,
    comment: { line: '"', block: null },
    graph: {
      entities: {
        function: /^\s*func(?:tion)?!?\s+([A-Za-z_<][\w#:.>]*)/,
        command: /^\s*command!?\s+(?:-\S+\s+)*([A-Z]\w*)/,
        constant: /^\s*let\s+([gsb]:[A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*(?:source|runtime)!?\s+(\S+)/ },
      skipCallObjects: ["echo", "echom", "call", "let", "set", "execute", "normal"],
    },
  },
  crystal: {
    indentBased: false, endKeyword: "end",
    comment: { line: "#", block: null },
    graph: {
      entities: {
        method: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/,
        class: /^\s*(?:abstract\s+)?class\s+([A-Z]\w*)/,
        module: /^\s*module\s+([A-Z]\w*)/,
        struct: /^\s*(?:abstract\s+)?struct\s+([A-Z]\w*)/,
        enum: /^\s*enum\s+([A-Z]\w*)/,
        macro: /^\s*macro\s+([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*require\s+"([^"]+)"/,
        inherit: /^\s*(?:abstract\s+)?(?:class|struct)\s+[A-Z]\w*\s*<\s*([A-Z][\w:]*)/,
        include: /^\s*(?:include|extend)\s+([A-Z][\w:]*)/,
      },
      skipCallObjects: ["puts", "print", "p", "pp", "raise", "self"],
    },
  },
  fortran: {
    indentBased: false, endKeyword: null,
    comment: { line: "!", block: null },
    graph: {
      entities: {
        module: /^\s*(?:module(?!\s+(?:procedure|subroutine|function)\b)|program)\s+([a-z_]\w*)/i,
        function: /^\s*(?!end\b)(?:[\w()*,:=.]+\s+)*?(?:subroutine|function)\s+([a-z_]\w*)/i,
        struct: /^\s*type\b\s*(?:,[^:]*)?(?:::\s*)?(?!is\b)([a-z_]\w*)/i,
        interface: /^\s*interface\s+([a-z_]\w*)/i,
      },
      relationships: { use: /^\s*use\b\s*(?:,[^:]*::\s*)?([a-z_]\w*)/i },
      skipCallObjects: [],
    },
  },
  cobol: {
    indentBased: false, endKeyword: null,
    comment: { line: "*>", block: null },
    graph: {
      entities: {
        module: /^\s*program-id\s*\.\s*([a-z0-9][a-z0-9-]*)/i,
        class: /^\s*([a-z0-9][a-z0-9-]*)\s+section\s*\./i,
        function: /^\s*(?!(?:end-[a-z]+|exit|goback|continue|stop)\b)([a-z0-9][a-z0-9-]*)\s*\.\s*$/i,
      },
      relationships: {
        copyFrom: /^\s*copy\s+([a-z0-9][a-z0-9-]*)/i,
        call: /^\s*call\s+["']([a-z0-9][a-z0-9-]*)/i,
      },
      skipCallObjects: [],
    },
  },
  assembly: {
    indentBased: false, endKeyword: null,
    comment: { line: ";", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^([a-zA-Z_][\w$.]*)\s*:/,
        macro: /^\s*(?:\.macro\s+|%macro\s+|%define\s+)([a-zA-Z_][\w$.]*)/i,
        constant: /^\s*([a-zA-Z_][\w$.]*)\s+equ\b/i,
      },
      relationships: {
        import: /^\s*(?:\.extern|extern)\s+([a-zA-Z_][\w$.]*)/i,
        include: /^\s*(?:%include|\.include)\s+["']?([^"'\s,]+)/i,
      },
      skipCallObjects: [],
    },
  },
  pascal: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["{", "}"] },
    graph: {
      entities: {
        module: /^\s*(?:unit|program|library)\s+([a-z_]\w*)/i,
        function: /^\s*(?:procedure|function)\s+([a-z_][\w.]*)/i,
        class: /^\s*([a-z_]\w*)\s*=\s*class\b/i,
        struct: /^\s*([a-z_]\w*)\s*=\s*(?:packed\s+)?(?:record|object)\b/i,
        interface: /^\s*([a-z_]\w*)\s*=\s*interface\b/i,
        enum: /^\s*([a-z_]\w*)\s*=\s*\(\s*[a-z_]\w*(?:\s*,\s*[a-z_]\w*)*\s*\)\s*;?/i,
      },
      relationships: { plainImport: /^\s*uses\s+([a-z_][\w.,\s]*)/i },
      skipCallObjects: [],
    },
  },
  vala: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        module: /^\s*(?:public\s+)?namespace\s+([A-Za-z_][\w.]*)/,
        class: /^\s*(?:(?:public|private|protected|internal|abstract|sealed|static)\s+)*class\s+([A-Za-z_]\w*)/,
        interface: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+([A-Za-z_]\w*)/,
        struct: /^\s*(?:(?:public|private|protected|internal)\s+)*struct\s+([A-Za-z_]\w*)/,
        enum: /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+([A-Za-z_]\w*)/,
        method: /^\s*(?!return\b|if\b|else\b|while\b|for\b|foreach\b|switch\b|case\b|do\b|new\b|throw\b|yield\b)(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|extern|inline|sealed|weak|unowned|owned|const|signal|delegate)\s+)*[\w.<>?\[\]*]+\s+([a-z_]\w*)\s*\(/,
      },
      relationships: { using: /^\s*using\s+([A-Za-z_][\w.]*)/ },
      skipCallObjects: [],
    },
  },
  haxe: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        module: /^\s*package\s+([\w.]+)/,
        class: /^\s*(?:(?:public|private|extern|final)\s+)*class\s+([A-Za-z_]\w*)/,
        interface: /^\s*(?:(?:public|private|extern)\s+)*interface\s+([A-Za-z_]\w*)/,
        enum: /^\s*(?:(?:public|private|extern)\s+)*enum\s+(?!abstract\b)([A-Za-z_]\w*)/,
        type: /^\s*(?:(?:public|private)\s+)*typedef\s+([A-Za-z_]\w*)/,
        struct: /^\s*(?:(?:public|private|extern)\s+)*(?:enum\s+)?abstract\s+([A-Za-z_]\w*)/,
        method: /^\s*(?:[\w@:.]+\s+)*function\s+([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*import\s+([\w.*]+)/,
        using: /^\s*using\s+([\w.]+)/,
      },
      skipCallObjects: [],
    },
  },
  nix: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: ["/*", "*/"] },
    graph: {
      // Require BOTH a space before `=` (rejects shell `VAR=val` in build-script
      // strings) AND a trailing `;`/`{` (real Nix attrs always terminate with
      // `;`, or open a nested attrset with `{`) — this drops the actively-harmful
      // false positives from spaced `key = value` config embedded in `''…''`
      // string literals (INI/systemd/gitconfig content), at the cost of missing
      // multi-line string attrs (`x = ''`). Conservative by design.
      entities: { constant: /^\s*([\w'.-]+)\s+=\s*(?!=).*?[;{]\s*$/ },
      relationships: {},
      skipCallObjects: [],
    },
  },
  glsl: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^\s*(?!(?:if|for|while|switch|else|return|do|case|default)\b)(?:[A-Za-z_]\w*[\s*&]+){1,8}([A-Za-z_]\w*)\s*\(/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*#\s*define\s+([A-Za-z_]\w*)/,
        type: /^\s*layout\s*\([^)]*\)\s*(?:uniform|buffer)\s+([A-Za-z_]\w*)\s*\{/,
      },
      relationships: { import: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/ },
      skipCallObjects: ["gl_Position", "gl_FragCoord", "gl_FragColor", "gl_FragDepth", "gl_VertexID", "gl_InstanceID"],
    },
  },
  hlsl: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^\s*(?!(?:if|for|while|switch|else|return|do|case|default)\b)(?:[A-Za-z_]\w*[\s*&]+){1,8}([A-Za-z_]\w*)\s*\(/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*#\s*define\s+([A-Za-z_]\w*)/,
        type: /^\s*(?:cbuffer|tbuffer|ConstantBuffer)\s+([A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/ },
      skipCallObjects: ["input", "output", "SV_Target", "SV_Position", "SV_Depth"],
    },
  },
  metal: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^\s*(?!(?:if|for|while|switch|else|return|do|case|default)\b)(?:[A-Za-z_]\w*[\s*&]+){1,8}([A-Za-z_]\w*)\s*\(/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*#\s*define\s+([A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*#\s*(?:include|import)\s+[<"]([^>"]+)[>"]/ },
      skipCallObjects: ["metal", "simd", "threadgroup", "device", "constant"],
    },
  },
  wgsl: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^\s*fn\s+([A-Za-z_]\w*)/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*(?:@\w+\([^)]*\)\s*)*(?:const|override|var(?:<[^>]*>)?)\s+([A-Za-z_]\w*)/,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },
  shaderlab: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        type: /^\s*Shader\s+"([^"]+)"/,
        function: /^\s*(?!(?:if|for|while|switch|else|return|do|case|default)\b)(?:[A-Za-z_]\w*[\s*&]+){1,8}([A-Za-z_]\w*)\s*\(/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*(_[A-Za-z]\w*)\s*\(\s*"/,
      },
      relationships: { import: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/ },
      skipCallObjects: ["UNITY_MATRIX_MVP", "_Time", "_WorldSpaceCameraPos", "unity_ObjectToWorld"],
    },
  },
  cg: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        function: /^\s*(?!(?:if|for|while|switch|else|return|do|case|default)\b)(?:[A-Za-z_]\w*[\s*&]+){1,8}([A-Za-z_]\w*)\s*\(/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
        constant: /^\s*#\s*define\s+([A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*#\s*include\s+[<"]([^>"]+)[>"]/ },
      skipCallObjects: ["UNITY_MATRIX_MVP", "_Time", "_WorldSpaceCameraPos"],
    },
  },
  hcl: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: ["/*", "*/"] },
    graph: {
      entities: {
        resource: /^\s*resource\s+"[^"]+"\s+"([^"]+)"/,
        data: /^\s*data\s+"[^"]+"\s+"([^"]+)"/,
        variable: /^\s*variable\s+"([^"]+)"/,
        module: /^\s*module\s+"([^"]+)"/,
        output: /^\s*output\s+"([^"]+)"/,
        provider: /^\s*provider\s+"([^"]+)"/,
      },
      relationships: { import: /^\s*source\s*=\s*"([^"]+)"/ },
      skipCallObjects: [],
    },
  },
  cmake: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*function\s*\(\s*([A-Za-z_]\w*)/i,
        macro: /^\s*macro\s*\(\s*([A-Za-z_]\w*)/i,
        constant: /^\s*set\s*\(\s*([A-Za-z_]\w*)/i,
      },
      relationships: { import: /^\s*(?:include|add_subdirectory|find_package)\s*\(\s*([A-Za-z_0-9./${}-]+)/i },
      skipCallObjects: [],
    },
  },
  gradle: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        task: /^\s*task\s+([A-Za-z_]\w*)/,
        def: /^\s*def\s+([A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*import\s+([\w.]+)/ },
      skipCallObjects: [],
    },
  },
  starlark: {
    indentBased: true, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*def\s+([A-Za-z_]\w*)/,
        rule: /^\s*([A-Za-z_]\w*)\s*=\s*(?:rule|provider|aspect|repository_rule|tag_class|module_extension)\s*\(/,
      },
      relationships: { import: /^\s*load\s*\(\s*["']([^"']+)["']/ },
      skipCallObjects: [],
    },
  },
  ql: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        class: /^\s*(?:abstract\s+|final\s+|private\s+|library\s+|deprecated\s+|additional\s+|external\s+|extensible\s+)*class\s+([A-Za-z_]\w*)/,
        function: /^\s*(?:abstract\s+|cached\s+|private\s+|final\s+|override\s+|additional\s+|deprecated\s+|library\s+|external\s+|extensible\s+|pragma\s*\[[^\]]*\]\s+|bindingset\s*\[[^\]]*\]\s+)*(?!(?:and|or|not|if|then|else|in|exists|forall|forex|count|sum|strictsum|strictcount|any|none|select|where|from|instanceof)\b)(?:[A-Za-z_][\w.]*)\s+([a-z_]\w*)\s*\(/,
        module: /^\s*(?:private\s+|library\s+)*module\s+([A-Za-z_]\w*)/,
        type: /^\s*newtype\s+([A-Za-z_]\w*)/,
      },
      relationships: {
        import: /^\s*(?:private\s+)?import\s+([\w.]+)/,
        extends: /\bclass\s+\w+\s+extends\s+([\w.]+)/,
      },
      skipCallObjects: [],
    },
  },
  systemrdl: {
    indentBased: false, endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    graph: {
      entities: {
        addrmap: /^\s*addrmap\s+([A-Za-z_]\w*)/,
        regfile: /^\s*regfile\s+([A-Za-z_]\w*)/,
        reg: /^\s*reg\s+([A-Za-z_]\w*)/,
        field: /^\s*field\s+([A-Za-z_]\w*)/,
        mem: /^\s*mem\s+([A-Za-z_]\w*)/,
        signal: /^\s*signal\s+([A-Za-z_]\w*)/,
        enum: /^\s*enum\s+([A-Za-z_]\w*)/,
        struct: /^\s*struct\s+([A-Za-z_]\w*)/,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },
  zeek: {
    indentBased: false, endKeyword: null,
    comment: { line: "#", block: null },
    graph: {
      entities: {
        function: /^\s*function\s+([A-Za-z_][\w:]*)/,
        event: /^\s*event\s+([A-Za-z_][\w:]*)/,
        hook: /^\s*hook\s+([A-Za-z_][\w:]*)/,
        global: /^\s*global\s+(?!function\b|event\b|hook\b)([A-Za-z_]\w*)/,
        constant: /^\s*const\s+([A-Za-z_]\w*)/,
        type: /^\s*type\s+([A-Za-z_]\w*)/,
        module: /^\s*module\s+([A-Za-z_]\w*)/,
      },
      relationships: { import: /^\s*@load\s+([\w./-]+)/ },
      skipCallObjects: [],
    },
  },
  embedded_template: {
    indentBased: false, endKeyword: null,
    comment: { line: null, block: ["<%#", "%>"] },
    graph: {
      entities: {},
      relationships: { include: /<%[-=]?\s*include\s*\(\s*['"`]([^'"`]+)['"`]/ },
      skipCallObjects: [],
    },
  },
  // ─── Solidity ────────────────────────────────────────────────────────────────
  // Real chunking is done by tree-sitter-solidity (GRAMMAR_MAP); these regex
  // patterns are the fallback used only when tree-sitter is unavailable.
  solidity: {
    indentBased: false,
    endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    chunker: {
      contract: /^\s*(?:abstract\s+)?contract\s+(\w+)/,
      interface: /^\s*interface\s+(\w+)/,
      library: /^\s*library\s+(\w+)/,
      function: /^\s*function\s+(\w+)/,
      struct: /^\s*struct\s+(\w+)/,
    },
    graph: {
      entities: {
        contract: /^\s*(?:abstract\s+)?contract\s+(\w+)/,
        interface: /^\s*interface\s+(\w+)/,
        library: /^\s*library\s+(\w+)/,
        function: /^\s*function\s+(\w+)/,
      },
      relationships: {
        import: /^\s*import\s+.*["']([^"']+)["']/,
        inherit: /\bis\s+([A-Z]\w*)/,
      },
      skipCallObjects: ["require", "assert", "revert", "emit"],
    },
  },
  // ─── OCaml ───────────────────────────────────────────────────────────────────
  // tree-sitter-ocaml does the real chunking. OCaml has no line comment — only
  // `(* … *)` blocks.
  ocaml: {
    indentBased: false,
    endKeyword: null,
    comment: { line: null, block: ["(*", "*)"] },
    chunker: {
      function: /^\s*let\s+(?:rec\s+)?(\w+)/,
      type: /^\s*(?:and\s+)?type\s+(\w+)/,
      module: /^\s*module\s+(\w+)/,
    },
    graph: {
      entities: {
        function: /^\s*let\s+(?:rec\s+)?(\w+)/,
        type: /^\s*type\s+(\w+)/,
        module: /^\s*module\s+(\w+)/,
      },
      relationships: { open: /^\s*open\s+([\w.]+)/ },
      skipCallObjects: [],
    },
  },
  // ─── ReScript ────────────────────────────────────────────────────────────────
  rescript: {
    indentBased: false,
    endKeyword: null,
    comment: { line: "//", block: ["/*", "*/"] },
    chunker: {
      function: /^\s*let\s+(\w+)/,
      type: /^\s*type\s+(\w+)/,
      module: /^\s*module\s+(\w+)/,
    },
    graph: {
      entities: {
        function: /^\s*let\s+(\w+)/,
        type: /^\s*type\s+(\w+)/,
        module: /^\s*module\s+(\w+)/,
      },
      relationships: { open: /^\s*open\s+(\w+)/ },
      skipCallObjects: [],
    },
  },
  // ─── TLA+ ────────────────────────────────────────────────────────────────────
  // tree-sitter-tlaplus does the real chunking. Comments are `\* …` / `(* … *)`.
  tlaplus: {
    indentBased: false,
    endKeyword: null,
    comment: { line: "\\*", block: ["(*", "*)"] },
    chunker: {
      module: /^-{2,}\s*MODULE\s+(\w+)/,
      operator: /^(\w+)\s*==/,
    },
    graph: {
      entities: {
        module: /^-{2,}\s*MODULE\s+(\w+)/,
        operator: /^(\w+)\s*==/,
      },
      relationships: { extends: /^EXTENDS\s+([\w,\s]+)/ },
      skipCallObjects: [],
    },
  },
};

export default TOOLING_LANGUAGES;
