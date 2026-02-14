// =============================================================================
// Web and Stylesheet Language Registry
// =============================================================================
// Markup and stylesheet-centric languages.
// Data-only module consumed by `registry.js`.
export const WEB_STYLE_LANGUAGES = {
  // ─── HTML / Templating ─────────────────────────────────────────────────────
  html: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: null,
      block: ["<!--", "-->"],
    },
    chunker: {
      section: /<(section|article|nav|header|footer|main|aside|template|form)\b[^>]*>/i,
      component: /<([A-Z]\w+)\b/,
      script: /<script\b[^>]*>/i,
      style: /<style\b[^>]*>/i,
    },
    graph: {
      entities: {
        section: /<(section|article|nav|header|footer|main|aside|template|form)\b[^>]*(?:\bid=["']([^"']+)["'])?/i,
        component: /<([A-Z]\w+)\b/,
        id: /<\w+[^>]+\bid=["']([^"']+)["']/,
      },
      relationships: {
        link: /<link[^>]+href=["']([^"']+)["']/i,
        script: /<script[^>]+src=["']([^"']+)["']/i,
        img: /<img[^>]+src=["']([^"']+)["']/i,
        form: /<form[^>]+action=["']([^"']+)["']/i,
      },
      skipCallObjects: [],
    },
  },
  // ─── CSS ───────────────────────────────────────────────────────────────────
  css: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: null,
      block: ["/*", "*/"],
    },
    chunker: {
      rule: /^(?!(?:if|else|for|while|switch|return|function|var|let|const)\s)[.#\w\[\*:][^{]*\{/,
      media: /^@media\s+[^{]+\{/,
      keyframes: /^@keyframes\s+([\w-]+)\s*\{/,
      fontface: /^@font-face\s*\{/,
      layer: /^@layer\s+([\w-]+)/,
      container: /^@container\s+([\w-]+)/,
    },
    graph: {
      entities: {
        keyframes: /^@keyframes\s+([\w-]+)/,
        selector: /^([.#][\w-]+)/,
        variable: /^--([^:]+)\s*:/,
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
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      mixin: /^@mixin\s+([\w-]+)/,
      function: /^@function\s+([\w-]+)/,
      rule: /^(?!(?:if|else|for|while|switch|return|function|var|let|const)\s)[.#\w\[\*:&][^{]*\{/,
      media: /^@media\s+[^{]+\{/,
    },
    graph: {
      entities: {
        mixin: /^@mixin\s+([\w-]+)/,
        function: /^@function\s+([\w-]+)/,
        variable: /^\$([\w-]+)\s*:/,
      },
      relationships: {
        use: /^@use\s+['"]([^'"]+)['"]/,
        forward: /^@forward\s+['"]([^'"]+)['"]/,
        import: /^@import\s+['"]([^'"]+)['"]/,
        include: /^@include\s+([\w-]+)/,
        extend: /^@extend\s+([.%][\w-]+)/,
      },
      skipCallObjects: [],
    },
  },
  // ─── Sass (indent-based) ──────────────────────────────────────────────────
  sass: {
    indentBased: true,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      mixin: /^[=+]([\w-]+)/,
      rule: /^[.#\w\[\*:&]/,
    },
    graph: {
      entities: {
        mixin: /^=([\w-]+)/,
        variable: /^\$([\w-]+)\s*:/,
      },
      relationships: {
        import: /^@import\s+['"]([^'"]+)['"]/,
        include: /^\+([\w-]+)/,
      },
      skipCallObjects: [],
    },
  },
  // ─── LESS ──────────────────────────────────────────────────────────────────
  less: {
    indentBased: false,
    endKeyword: null,
    comment: {
      line: "//",
      block: ["/*", "*/"],
    },
    chunker: {
      mixin: /^\.([\w-]+)\s*\(/,
      rule: /^(?!(?:if|else|for|while|switch|return|function|var|let|const)\s)[.#\w\[\*:&][^{]*\{/,
    },
    graph: {
      entities: {
        mixin: /^\.([\w-]+)\s*\(/,
        variable: /^@([\w-]+)\s*:/,
      },
      relationships: {
        import: /^@import\s+['"]([^'"]+)['"]/,
      },
      skipCallObjects: [],
    },
  },
};

export default WEB_STYLE_LANGUAGES;
