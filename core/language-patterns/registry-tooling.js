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
      run: /^RUN\s+/i,
      copy: /^COPY\s+/i,
    },
    graph: {
      entities: {
        stage: /^FROM\s+(?:--platform=\S+\s+)?\S+\s+AS\s+(\w+)/i,
        expose: /^EXPOSE\s+(\d+)/i,
        entrypoint: /^(?:ENTRYPOINT|CMD)\s+/i,
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
};

export default TOOLING_LANGUAGES;
