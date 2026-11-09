export const EXTENSION_MAP = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',

  // .tsx is routed to its own grammar so JSX bodies are parsed correctly;
  // the LANGUAGES.tsx entry is an alias of LANGUAGES.typescript (registry-core.js)
  // so chunker/graph regex patterns are byte-identical to .ts.
  '.ts': 'typescript', '.tsx': 'tsx',

  '.java': 'java',

  '.py': 'python', '.pyi': 'python',

  '.go': 'go',

  '.rs': 'rust',

  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
  '.inl': 'cpp',   // inline implementation included from a header — ordinary C++ source

  '.cs': 'csharp',

  // ASP.NET views: Razor, and pages with <% %> code (core/indexing/chunking/view-chunker.js)
  '.cshtml': 'razor', '.razor': 'razor',
  '.aspx': 'aspnet', '.ascx': 'aspnet', '.master': 'aspnet', '.asax': 'aspnet',
  '.ashx': 'aspnet', '.asmx': 'aspnet', '.svc': 'aspnet',

  '.php': 'php',

  '.rb': 'ruby', '.erb': 'ruby',

  '.kt': 'kotlin', '.kts': 'kotlin',

  '.swift': 'swift',

  '.scala': 'scala',

  // Clojure / ClojureScript / EDN
  // No tree-sitter-clojure grammar ships in the bundle and the brace-based
  // regex chunker would fragment paren-delimited Lisp forms (and drop sub-30-char
  // defns via MIN_CONTENT_LENGTH), so there is intentionally no LANGUAGES.clojure
  // entry — getLanguageByExtension returns the chunker-less fallback and
  // ast-chunker routes these through parseGenericFile (lossless 50-line windows),
  // tagged with this 'clojure' language id rather than generic 'text'.
  '.clj': 'clojure', '.cljc': 'clojure', '.cljs': 'clojure', '.edn': 'clojure',

  '.dart': 'dart',

  '.groovy': 'groovy',

  '.m': 'objc', '.mm': 'objc',

  '.html': 'html', '.htm': 'html', '.xhtml': 'html',
  '.vue': 'html', '.svelte': 'html',

  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',

  '.lua': 'lua',

  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',

  '.ps1': 'powershell',

  '.sql': 'sql',

  '.graphql': 'graphql', '.gql': 'graphql',

  '.proto': 'proto',

  '.zig': 'zig',

  '.ex': 'elixir', '.exs': 'elixir',

  '.nim': 'nim',

  '.fs': 'fsharp', '.fsx': 'fsharp',

  '.json': 'json', '.jsonc': 'json', '.json5': 'json',

  '.yaml': 'yaml', '.yml': 'yaml',

  '.toml': 'toml',

  '.xml': 'xml', '.xsl': 'xml', '.xsd': 'xml', '.wsdl': 'xml',
  '.pom': 'xml', '.csproj': 'xml',

  '.dockerfile': 'dockerfile',

  '.mk': 'makefile',

  // '.vb' omitted — no LANGUAGES.vb entry exists

  '.jl': 'julia',

  // R — the lookup lowercases the key, so '.r'/'.rd'/'.rmd' also resolve the
  // canonical uppercase on-disk forms (.R/.Rd/.Rmd). Keep keys lowercase only.
  '.r': 'r', '.rd': 'r', '.rmd': 'r',

  // OCaml (tree-sitter-ocaml ships in the bundle but is unwired → generic chunking)
  '.ml': 'ocaml', '.mli': 'ocaml', '.mll': 'ocaml', '.mly': 'ocaml',

  // TypeScript modules (CommonJS / ESM) — reuse the wired typescript grammar.
  // Map to 'typescript' not 'tsx': .cts/.mts cannot contain JSX.
  '.cts': 'typescript', '.mts': 'typescript',

  // Other bundled-grammar languages (unwired → lossless generic chunking)
  '.elm': 'elm',
  '.sol': 'solidity',
  '.res': 'rescript', '.resi': 'rescript',
  '.ql': 'ql', '.qll': 'ql',
  '.tla': 'tlaplus',
  '.rdl': 'systemrdl',
  '.el': 'elisp',
  '.ejs': 'embedded_template',

  // Functional / systems / scripting
  '.hs': 'haskell', '.lhs': 'haskell',
  '.erl': 'erlang', '.hrl': 'erlang',
  '.cr': 'crystal',
  '.vala': 'vala',
  '.hx': 'haxe',
  '.pas': 'pascal',
  '.nix': 'nix',
  '.pl': 'perl', '.pm': 'perl', '.pod': 'perl',
  '.vim': 'vim',
  '.tcl': 'tcl', '.tk': 'tcl',
  '.zeek': 'zeek', '.bro': 'zeek',
  // Zeek build-time DSLs: BiF declarations, BinPAC + Spicy parser sources (generic chunking)
  '.bif': 'zeek', '.pac': 'zeek', '.pac2': 'zeek',
  '.spicy': 'spicy', '.evt': 'spicy', '.hlt': 'spicy',

  // Scientific / legacy (lowercase keys cover the uppercase .F/.F90/.S forms)
  '.f': 'fortran', '.for': 'fortran', '.f90': 'fortran', '.f95': 'fortran',
  '.f03': 'fortran', '.f08': 'fortran',
  '.cob': 'cobol', '.cbl': 'cobol',
  '.asm': 'assembly', '.s': 'assembly',

  '.glsl': 'glsl', '.vert': 'glsl', '.frag': 'glsl', '.comp': 'glsl',
  '.geom': 'glsl', '.tesc': 'glsl', '.tese': 'glsl',
  '.hlsl': 'hlsl', '.hlsli': 'hlsl',
  '.metal': 'metal',
  '.wgsl': 'wgsl',
  '.shader': 'shaderlab',
  '.cg': 'cg', '.cginc': 'cg',

  // Web framework SFC — reuse the html SFC path (like .vue/.svelte)
  '.astro': 'html',

  // Infra / build / config DSLs
  '.tf': 'hcl', '.tfvars': 'hcl', '.hcl': 'hcl',
  '.ini': 'ini', '.cfg': 'ini',
  '.properties': 'properties',
  '.cmake': 'cmake',
  '.gradle': 'gradle',
  '.ninja': 'ninja',
  '.jam': 'jam',                    // Boost.Build / Perforce Jam (generic chunking; grep-indexable)
  '.bzl': 'starlark', '.star': 'starlark',

  // Cython (Python-like syntax → reuse the wired python chunker)
  '.pyx': 'python', '.pxd': 'python', '.pxi': 'python',
  // Scala build definitions / worksheets (→ scala grammar)
  '.sbt': 'scala', '.sc': 'scala',
  // Ruby build & manifest DSLs (→ ruby grammar)
  '.rake': 'ruby', '.gemspec': 'ruby', '.podspec': 'ruby', '.ru': 'ruby',
  // CoffeeScript (no bundled grammar → generic chunking)
  '.coffee': 'coffeescript', '.litcoffee': 'coffeescript',
  // Style preprocessors
  '.pcss': 'css', '.styl': 'stylus',
  // HTML-based templating (reuse the html SFC path, like .vue/.svelte)
  '.twig': 'html', '.liquid': 'html', '.njk': 'html', '.hbs': 'html',
  '.handlebars': 'html', '.mustache': 'html', '.gohtml': 'html',
  '.eex': 'html', '.heex': 'html', '.leex': 'html',
  // Indentation-based templating (generic chunking; not HTML syntax)
  '.pug': 'pug', '.jade': 'pug', '.haml': 'haml', '.slim': 'slim',
  // Polymorphic text templating (any target text → generic chunking)
  '.jinja': 'jinja', '.jinja2': 'jinja', '.j2': 'jinja',
  '.tera': 'jinja', '.tmpl': 'jinja', '.tpl': 'jinja', '.gotmpl': 'jinja',
  // .NET / MSBuild project & resource files (XML dialects → xml grammar)
  '.props': 'xml', '.targets': 'xml', '.proj': 'xml',
  '.vbproj': 'xml', '.fsproj': 'xml', '.resx': 'xml', '.nuspec': 'xml',
  // Autotools / text-processing script sources (generic chunking)
  '.m4': 'm4', '.ac': 'm4', '.am': 'makefile',
  '.awk': 'awk', '.sed': 'sed',
  // Jupyter notebooks — chunker-less id → parseGenericFile (fixed-window, lossless)
  // over the raw JSON. Not JSON-AST-chunked (that would emit one giant cells chunk).
  // Image-heavy notebooks self-filter via the admission maxFileSize (1MB) gate.
  '.ipynb': 'jupyter',

  // Document formats (dispatched to DocumentChunker in ast-chunker.js)
  '.md': 'markdown', '.mdx': 'markdown', '.markdown': 'markdown',
  '.rst': 'rst',
  '.txt': 'plaintext',
};

export const FILENAME_MAP = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  // Extensionless build / project files (mirrors the Dockerfile/Makefile pattern)
  BUILD: 'starlark',
  WORKSPACE: 'starlark',
  // Boost.Build extensionless project files (→ jam, generic chunking)
  Jamfile: 'jam',
  Jamroot: 'jam',
  Jamrules: 'jam',
  'meson.build': 'meson',
  Earthfile: 'earthfile',
  justfile: 'just',
  Justfile: 'just',
  // Ruby extensionless build files (→ ruby grammar)
  Rakefile: 'ruby',
  Gemfile: 'ruby',
};
