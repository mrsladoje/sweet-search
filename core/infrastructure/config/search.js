/**
 * Search Configuration — file patterns, routing, performance targets.
 * Split from core/config.js during DDD migration.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';

// =============================================================================
// QUERY ROUTING CONFIGURATION
// =============================================================================

export const ROUTING_CONFIG = {
  lexicalPatterns: [
    /^[A-Z][a-zA-Z0-9]*$/,           // CamelCase (starts with capital)
    /^[a-z]+[A-Z][a-zA-Z0-9]*$/,     // camelCase (has capital in middle) - Fix #3
    /^[a-z][a-z0-9_]*_[a-z0-9_]+$/,  // snake_case (must have underscore) - Fix #3
    /^[A-Z_][A-Z0-9_]*$/,            // SCREAMING_SNAKE
    /\.(java|js|jsx|ts|tsx|proto)$/, // File extensions
    /\/|\\/,                          // Paths
    /"[^"]*"/,                        // Quoted strings
    /\bclass\s+\w+/,
    /\bfunction\s+\w+/,
    /\binterface\s+\w+/,
    // Fix #5: Code Structural Keywords
    /\b(method|constructor|field|property|annotation|decorator|enum|abstract|static|final|private|public|protected)\b/i,
    /^@\w+/,  // Annotations: @Override, @Test
    /\b(extends|implements)\s+\w+/i,
  ],
  semanticPatterns: [
    /how\s+(does|do|to|can)/i,
    /what\s+(is|are|does)/i,
    /why\s+(does|is|are)/i,
    /where\s+(is|are|does)/i,
    /find\s+.*\s+(that|which)/i,
    /\s+(related|similar)\s+to/i,
    /implement/i,
    /handle|handling/i,
    /work(s|ing)?/i,
    // Fix #4: Imperative Command Detection
    /^(list|show|find|get|fetch|retrieve|search|locate)\s+(all|any)/i,
    /^(list|show|display)\s+/i,
  ],
  defaultMode: 'hybrid',
};

// =============================================================================
// FILE PATTERNS
// =============================================================================

export const FILE_PATTERNS = {
  include: [
    // Source code (all major languages)
    '**/*.{js,jsx,ts,tsx,mjs,cjs,cts,mts}', // JavaScript/TypeScript (incl. CommonJS/ESM TS)
    '**/*.{java,kt,kts,scala,groovy}',    // JVM
    '**/*.{clj,cljc,cljs,edn}',           // Clojure / ClojureScript / EDN
    '**/*.jl',                             // Julia
    '**/*.{R,r,Rd,rd,Rmd,rmd}',            // R (case-sensitive matcher: list both cases)
    '**/*.{ml,mli,mll,mly}',               // OCaml
    '**/*.{res,resi}',                     // ReScript
    '**/*.{hs,lhs}',                       // Haskell
    '**/*.{erl,hrl}',                      // Erlang
    '**/*.{pl,pm,pod}',                    // Perl
    '**/*.{f,for,f90,f95,f03,f08,F,F90,F95}', // Fortran (case-sensitive)
    '**/*.{cob,cbl}',                      // COBOL
    '**/*.{asm,s,S}',                      // Assembly (case-sensitive)
    '**/*.{cr,vala,hx,pas,nix,vim}',       // Crystal / Vala / Haxe / Pascal / Nix / Vim
    '**/*.{elm,sol,tla,rdl,el,ejs}',       // Elm / Solidity / TLA+ / SystemRDL / Emacs Lisp / EJS
    '**/*.{ql,qll}',                       // CodeQL
    '**/*.{zeek,bro}',                     // Zeek
    '**/*.{tcl,tk}',                       // Tcl
    '**/*.astro',                          // Astro (SFC)
    // GPU shaders
    '**/*.{glsl,vert,frag,comp,geom,tesc,tese}', // GLSL
    '**/*.{hlsl,hlsli}',                   // HLSL
    '**/*.{metal,wgsl,shader,cg,cginc}',   // Metal / WGSL / ShaderLab / Cg
    '**/*.{py,pyi}',                       // Python
    '**/*.go',                              // Go
    '**/*.rs',                              // Rust
    '**/*.{c,cpp,cc,cxx,h,hpp,hxx}',      // C/C++
    '**/*.{cs,fs,vb}',                     // .NET
    '**/*.{rb,erb}',                       // Ruby
    '**/*.php',                             // PHP
    '**/*.{swift,m,mm}',                   // Apple
    '**/*.{lua,zig,nim,ex,exs,dart}',      // Other
    '**/*.{sh,bash,zsh,fish,ps1}',         // Shell
    '**/*.sql',                             // SQL
    '**/*.proto',                           // Protobuf
    '**/*.{graphql,gql}',                  // GraphQL
    // Config & docs
    '**/*.{json,jsonc,json5}',              // JSON
    '**/*.{yaml,yml}',                      // YAML
    '**/*.toml',                             // TOML
    '**/*.{xml,xsl,xsd,wsdl,pom,csproj}',  // XML
    '**/*.{tf,tfvars,hcl}',                // Terraform / HCL
    '**/*.{ini,cfg}',                      // INI / config
    '**/*.properties',                     // Java properties
    '**/*.{md,mdx,mdc,rst,txt,markdown}',  // Documentation + Cursor rules
    '**/*.{html,htm,xhtml,vue,svelte}',    // Web markup/SFC
    '**/*.{css,scss,sass,less}',           // Stylesheets
    '**/*.svg',                             // SVG
    // Build & deploy
    '**/Dockerfile',                       // Dockerfile
    '**/Dockerfile.*',                     // Dockerfile variants
    '**/*.dockerfile',                     // Dockerfile alt extension
    '**/Makefile',                         // Makefile
    '**/*.mk',                            // Makefile includes
    '**/*.cmake',                          // CMake modules
    '**/*.gradle',                         // Gradle (Groovy DSL)
    '**/*.ninja',                          // Ninja
    '**/*.{bzl,star}',                     // Bazel / Starlark
    '**/BUILD', '**/BUILD.bazel',          // Bazel BUILD
    '**/WORKSPACE', '**/WORKSPACE.bazel',  // Bazel WORKSPACE
    '**/meson.build',                      // Meson
    '**/Earthfile',                        // Earthly
    '**/justfile', '**/Justfile',          // Just
    // Project markers
    '**/CLAUDE.md',
    '**/AGENTS.md',
    '**/README.md',
    '**/.cursorrules',
    '**/.clinerules',
    '**/.roorules',
    '**/.roorules-*',
    '**/.windsurfrules',
    '**/.aider.conf.yml',
  ],
  exclude: [
    // ── Package manager dependencies ──────────────────────────────────────
    '**/node_modules/**',
    '**/bower_components/**',
    '**/jspm_packages/**',
    '**/.yarn/**',
    '**/.pnp.*',
    '**/vendor/**',
    '**/vendors/**',
    '**/third_party/**',
    '**/thirdparty/**',
    '**/.cargo/**',
    '**/Godeps/**',
    '**/Pods/**',
    '**/Carthage/**',
    '**/.gradle/**',
    '**/.mvn/**',
    '**/venv/**',
    '**/.venv/**',
    '**/site-packages/**',
    '**/_esy/**',

    // ── Build outputs & generated code ────────────────────────────────────
    '**/target/**',
    '**/build/**',
    '**/dist/**',
    '**/out/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.output/**',
    '**/.svelte-kit/**',
    '**/.turbo/**',
    '**/.angular/**',
    '**/.parcel-cache/**',
    '**/storybook-static/**',
    '**/__generated__/**',
    '**/generated/**',
    '**/.vercel/**',
    '**/.netlify/**',
    '**/.serverless/**',
    '**/.aws-sam/**',
    '**/.terraform/**',

    // ── VCS & IDE ─────────────────────────────────────────────────────────
    '**/.git/**',
    '**/.idea/**',
    '**/.vscode/**',
    '**/.vs/**',
    '**/.eclipse/**',
    '**/.settings/**',

    // ── Caches & temp ─────────────────────────────────────────────────────
    '**/.vite/**',
    '**/coverage/**',
    '**/.coverage/**',
    '**/__pycache__/**',
    '**/.mypy_cache/**',
    '**/.pytest_cache/**',
    '**/.ruff_cache/**',
    '**/.tox/**',
    '**/.eggs/**',
    '**/*.egg-info/**',
    '**/.pytype/**',
    '**/htmlcov/**',
    '**/.cache/**',
    '**/.nx/**',
    '**/.eslintcache',
    '**/.stylelintcache',
    '**/tmp/**',
    '**/.tmp/**',
    '**/.temp/**',

    // ── Lock files (all ecosystems) ───────────────────────────────────────
    '**/package-lock.json',
    '**/bun.lock',
    '**/bun.lockb',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/composer.lock',
    '**/Cargo.lock',
    '**/Gemfile.lock',
    '**/poetry.lock',
    '**/pdm.lock',
    '**/uv.lock',
    '**/Pipfile.lock',
    '**/npm-shrinkwrap.json',
    '**/deno.lock',
    '**/pixi.lock',
    '**/flake.lock',
    '**/gradle.lockfile',
    '**/.terraform.lock.hcl',
    '**/go.sum',
    '**/Package.resolved',

    // ── Minified / bundled / sourcemaps ───────────────────────────────────
    '**/*.min.js',
    '**/*.min.mjs',
    '**/*.min.cjs',
    '**/*.min.css',
    '**/*.bundle.js',
    '**/*.bundle.css',
    '**/*.umd.js',
    '**/*.iife.js',
    '**/*.chunk.js',
    '**/*.map',

    // ── Test snapshots ────────────────────────────────────────────────────
    '**/*.snap',

    // ── Binary & compiled artifacts ───────────────────────────────────────
    '**/*.class',
    '**/*.pyc',
    '**/*.pyo',
    '**/*.o',
    '**/*.so',
    '**/*.dylib',
    '**/*.dll',
    '**/*.exe',
    '**/*.wasm',

    // ── OS metadata & misc ────────────────────────────────────────────────
    '**/*.log',
    '**/.DS_Store',
    '**/Thumbs.db',
    '**/*.swp',
    '**/*.swo',

    // ── Secrets & environment files (all stacks) ────────────────────────
    '**/.env',
    '**/.env.*',

    // ── .NET secrets & env-specific config ────────────────────────────────
    '**/appsettings.Development.json',
    '**/appsettings.Local.json',
    '**/appsettings.Staging.json',
    '**/appsettings.Production.json',
    '**/secrets.json',
    '**/*.user',

    // ── Python (Django, FastAPI, Flask) secrets ───────────────────────────
    '**/local_settings.py',
    '**/settings/local.py',
    '**/settings/dev.py',
    '**/secrets.py',
    '**/config/local.py',

    // ── Java/Kotlin (Spring) env-specific config ─────────────────────────
    '**/application-dev.properties',
    '**/application-local.properties',
    '**/application-test.properties',
    '**/application-*-local.yml',
    '**/application-*-local.yaml',

    // ── Node/JS/TS secrets ────────────────────────────────────────────────
    '**/config/secrets.js',
    '**/config/secrets.ts',
    '**/config/local.js',
    '**/config/local.ts',
    '**/config.local.js',
    '**/config.local.ts',
    '**/.firebaserc',

    // ── Ruby (Rails) ──────────────────────────────────────────────────────
    '**/config/credentials.yml.enc',

    // ── PHP (Laravel) ─────────────────────────────────────────────────────
    '**/config/local.php',

    // ── Go / Rust / generic local config ──────────────────────────────────
    '**/config.local.*',
    '**/config/local.*',

    // ── Mobile: iOS ───────────────────────────────────────────────────────
    '**/Secrets.plist',
    '**/GoogleService-Info.plist',
    '**/*-Credentials.plist',
    '**/Config/Secrets.swift',

    // ── Mobile: Android ───────────────────────────────────────────────────
    '**/local.properties',
    '**/google-services.json',
    '**/keystore.properties',
    '**/secrets.properties',

    // ── Embedded (Arduino, ESP-IDF, PlatformIO) ──────────────────────────
    '**/credentials.h',
    '**/secrets.h',
    '**/config_private.h',
    '**/sdkconfig.local',
    '**/platformio.ini.local',
    '**/*_credentials.*',

    // ── Sweet Search data ─────────────────────────────────────────────────
    '**/.sweet-search/**',
  ],

  // Default max file size for indexing (1 MB). Files larger than this are
  // almost always generated data, minified bundles, or binary blobs that
  // add noise without meaningful search value.  Override per-project via
  // "maxFileSize" in .sweet-search.config.json (value in bytes).
  maxFileSize: 1 * 1024 * 1024,

  // Align indexing with .gitignore by default. Agentic paths are allowlisted
  // in AGENTIC_GITIGNORE_ALLOWLIST so local AI setup remains searchable.
  respectGitignore: true,
};

// Agentic tooling paths that should stay indexable even when listed in
// .gitignore. This supports local AI workflow files without requiring users
// to maintain extra include rules.
export const AGENTIC_GITIGNORE_ALLOWLIST = {
  directories: [
    '.claude/',
    '.agents/',
    '.cursor/',
    '.codex/',
    '.cline/',
    '.clinerules/',
    '.roo/',
    '.continue/',
    '.windsurf/',
  ],
  files: [
    '.cursorrules',
    '.clinerules',
    '.roorules',
    '.windsurfrules',
    '.aider.conf.yml',
    '.aider.conf.yaml',
  ],
  filePrefixes: [
    '.roorules-',
    '.aider.',
  ],
};

/**
 * Load per-project configuration from .sweet-search.config.json
 * Precedence: config file > defaults. Environment variables > config file.
 *
 * @param {string} [projectRoot] - Project root to search for config file
 * @returns {{ include: string[], exclude: string[], maxFileSize: number, respectGitignore: boolean, projectRoot?: string }}
 */
export function loadProjectConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, '.sweet-search.config.json');

  if (!existsSync(configPath)) {
    return {
      include: FILE_PATTERNS.include,
      exclude: FILE_PATTERNS.exclude,
      maxFileSize: FILE_PATTERNS.maxFileSize,
      respectGitignore: FILE_PATTERNS.respectGitignore,
    };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Validate known keys, warn on unknown
    const knownKeys = new Set(['include', 'exclude', 'projectRoot', 'indexDocs', 'maxFileSize', 'respectGitignore', 'lateInteractionModel', 'cascade']);
    for (const key of Object.keys(config)) {
      if (!knownKeys.has(key)) {
        console.error(`[sweet-search] Warning: unknown key "${key}" in .sweet-search.config.json`);
      }
    }

    return {
      include: Array.isArray(config.include) ? config.include : FILE_PATTERNS.include,
      exclude: Array.isArray(config.exclude) ? [...FILE_PATTERNS.exclude, ...config.exclude] : FILE_PATTERNS.exclude,
      maxFileSize: typeof config.maxFileSize === 'number' ? config.maxFileSize : FILE_PATTERNS.maxFileSize,
      respectGitignore: typeof config.respectGitignore === 'boolean' ? config.respectGitignore : FILE_PATTERNS.respectGitignore,
      ...(config.projectRoot ? { projectRoot: config.projectRoot } : {}),
      ...(config.lateInteractionModel !== undefined ? { lateInteractionModel: config.lateInteractionModel } : {}),
      ...(config.cascade ? { cascade: config.cascade } : {}),
    };
  } catch (err) {
    console.error(`[sweet-search] Error loading .sweet-search.config.json: ${err.message}`);
    return {
      include: FILE_PATTERNS.include,
      exclude: FILE_PATTERNS.exclude,
      maxFileSize: FILE_PATTERNS.maxFileSize,
      respectGitignore: FILE_PATTERNS.respectGitignore,
    };
  }
}

// =============================================================================
// PERFORMANCE TARGETS
// =============================================================================

export const PERFORMANCE_TARGETS = {
  latency: {
    lexicalP50: 10,
    hnswLookupP50: 1,
    semanticP50: 150,
    rerankP50: 100,
  },
  accuracy: {
    topKRecall: 0.85,
  },
};
