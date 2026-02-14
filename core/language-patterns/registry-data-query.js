// =============================================================================
// Data and Query Language Registry
// =============================================================================
// Structured data, query, and schema-oriented formats.
// Data-only module consumed by `registry.js`.
export const DATA_QUERY_LANGUAGES = {
  // ─── SQL ───────────────────────────────────────────────────────────────────
  sql: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "--",
      block: ["/*", "*/"],
    },
    chunker: {
      create: /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)/i,
      alter: /ALTER\s+TABLE\s+(?:[\w.]+\.)?(\w+)/i,
    },
    graph: {
      entities: {
        table: /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)/i,
        view: /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:[\w.]+\.)?(\w+)/i,
        function: /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[\w.]+\.)?(\w+)/i,
        procedure: /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(?:[\w.]+\.)?(\w+)/i,
        trigger: /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(?:[\w.]+\.)?(\w+)/i,
        index: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },
  // ─── GraphQL ───────────────────────────────────────────────────────────────
  graphql: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      type: /type\s+(\w+)/,
      input: /input\s+(\w+)/,
      query: /(?:query|mutation|subscription)\s+(\w+)/,
      interface: /interface\s+(\w+)/,
      enum: /enum\s+(\w+)/,
    },
    graph: {
      entities: {
        type: /type\s+(\w+)/,
        input: /input\s+(\w+)/,
        interface: /interface\s+(\w+)/,
        enum: /enum\s+(\w+)/,
        scalar: /scalar\s+(\w+)/,
        query: /(?:query|mutation|subscription)\s+(\w+)/,
      },
      relationships: {
        implements: /type\s+\w+\s+implements\s+([\w&\s]+)/,
      },
      skipCallObjects: [],
    },
  },
  // ─── JSON ──────────────────────────────────────────────────────────────────
  json: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: null,
      block: null,
    },
    chunker: {
      key: /^\s{2}"([\w-]+)"\s*:/,
    },
    graph: {
      entities: {
        topKey: /^\s{2}"([\w-]+)"\s*:/,
      },
      relationships: {
        ref: /"\$ref"\s*:\s*"([^"]+)"/,
        dep: /^"(dependencies|devDependencies|peerDependencies)"\s*:\s*\{/,
      },
      skipCallObjects: [],
    },
  },
  // ─── YAML ──────────────────────────────────────────────────────────────────
  yaml: {
    indentBased: true,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      key: /^(\w[\w-]*)\s*:\s*(?:[|>].*|#.*)?$/,
      doc: /^---/,
    },
    graph: {
      entities: {
        topKey: /^(\w[\w-]*)\s*:/,
      },
      relationships: {
        anchor: /&(\w+)/,
        alias: /\*(\w+)/,
        ref: /\$ref:\s*['"]?([^'"#\s]+)/,
      },
      skipCallObjects: [],
    },
  },
  // ─── TOML ──────────────────────────────────────────────────────────────────
  toml: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "#",
      block: null,
    },
    chunker: {
      array: /^\[\[([^\]]+)\]\]/,
      section: /^\[(?!\[)([^\]]+)\]/,
    },
    graph: {
      entities: {
        array: /^\[\[([^\]]+)\]\]/,
        section: /^\[(?!\[)([^\]]+)\]/,
        keyVal: /^(\w[\w-]*)\s*=/,
      },
      relationships: {},
      skipCallObjects: [],
    },
  },
  // ─── XML ───────────────────────────────────────────────────────────────────
  xml: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: null,
      block: ["<!--", "-->"],
    },
    chunker: {
      element: /<(\w+:?\w+)\b[^>]*(?:>|$)/,
    },
    graph: {
      entities: {
        element: /<(\w+:?\w+)\b[^>]*(?:>|$)/,
      },
      relationships: {
        namespace: /xmlns(?::\w+)?=["']([^"']+)["']/,
        import: /<(?:xs:)?(?:import|include)\s[^>]*(?:schemaLocation|href)=["']([^"']+)["']/,
        ref: /ref=["']([^"']+)["']/,
      },
      skipCallObjects: [],
    },
  },
};

export default DATA_QUERY_LANGUAGES;
