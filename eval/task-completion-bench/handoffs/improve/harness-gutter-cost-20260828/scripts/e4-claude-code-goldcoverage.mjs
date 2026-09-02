// e4-claude-code-goldcoverage.mjs — for each of the 22 fresh-pool tasks, list the gold-patch
// files and flag the ones sweet-search cannot index (extension not in FILE_PATTERNS.include,
// or path matched by an exclude glob such as **/build/**).
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json', 'utf8'));
const specs = Array.isArray(T) ? T : (T.tasks || Object.values(T));
const pool = fs.readFileSync('/root/fresh-run/pool.txt', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
// Extensions FILE_PATTERNS.include covers (transcribed from core/infrastructure/config/search.js).
const INC = new Set(`js jsx ts tsx mjs cjs cts mts java kt kts scala groovy clj cljc cljs edn jl R r Rd rd Rmd rmd
ml mli mll mly res resi hs lhs erl hrl pl pm pod f for f90 f95 f03 f08 F F90 F95 cob cbl asm s S cr vala hx pas nix vim
elm sol tla rdl el ejs ql qll zeek bro bif pac pac2 spicy evt hlt tcl tk astro glsl vert frag comp geom tesc tese hlsl hlsli
metal wgsl shader cg cginc py pyi go rs c cpp cc cxx h hpp hxx inl cs fs vb rb erb php swift m mm lua zig nim ex exs dart
pyx pxd pxi sbt sc rake gemspec podspec ru coffee litcoffee razor jj bnf yy y scm jq pkl gleam hylo snap stderr conf config
adoc scd vtt test txtar bsh inc fixed pcss styl twig liquid njk hbs handlebars mustache gohtml eex heex leex pug jade haml
slim jinja jinja2 j2 tera tmpl tpl gotmpl props targets proj vbproj fsproj resx nuspec m4 ac am awk sed ipynb in sln
sh bash zsh fish ps1 sql proto graphql gql json jsonc json5 yaml yml toml xml xsl xsd wsdl pom csproj tf tfvars hcl ini cfg
properties md mdx mdc rst txt markdown html htm xhtml vue svelte css scss sass less svg mk cmake gradle ninja bzl star`.split(/\s+/).filter(Boolean));
const BASENAME_INC = new Set(['go.mod', 'go.work', 'Rakefile', 'Gemfile', 'Dockerfile', 'Makefile', 'BUILD', 'BUILD.bazel', 'WORKSPACE', 'WORKSPACE.bazel', 'meson.build', 'Earthfile', 'justfile', 'Justfile', 'CLAUDE.md', 'AGENTS.md', 'README.md']);
const EXCLUDE_DIR = /(^|\/)(node_modules|bower_components|jspm_packages|vendor|vendors|third_party|thirdparty|Godeps|Pods|Carthage|venv|site-packages|target|build|dist|out)(\/|$)/;
const rows = [];
for (const id of pool) {
  const s = specs.find(x => x.instance_id === id);
  if (!s) { rows.push({ id, err: 'no spec' }); continue; }
  const files = [...String(s.patch).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
  const flags = files.map(f => {
    const base = f.split('/').pop();
    const i = base.lastIndexOf('.');
    const e = i > 0 ? base.slice(i + 1) : '';
    const extOk = BASENAME_INC.has(base) || (e && INC.has(e));
    const excluded = EXCLUDE_DIR.test(f);
    return { f, ext: e || '(none)', extOk, excluded, indexable: extOk && !excluded };
  });
  rows.push({ id, lang: s.language, files: flags, anyBlind: flags.some(x => !x.indexable), allBlind: flags.length > 0 && flags.every(x => !x.indexable) });
}
for (const r of rows) {
  if (r.err) { console.log(r.id, r.err); continue; }
  const mark = r.allBlind ? 'ALL-BLIND' : r.anyBlind ? 'part-blind' : 'ok';
  console.log(`${mark.padEnd(10)} ${r.id.padEnd(42)} ${r.files.map(x => `${x.f}${x.indexable ? '' : x.excluded ? ' [EXCLUDED-DIR]' : ' [EXT-NOT-INDEXED:.' + x.ext + ']'}`).join(' | ')}`);
}
console.log('\nALL-BLIND tasks:', rows.filter(r => r.allBlind).map(r => r.id).join(', '));
console.log('part-blind tasks:', rows.filter(r => r.anyBlind && !r.allBlind).map(r => r.id).join(', '));
