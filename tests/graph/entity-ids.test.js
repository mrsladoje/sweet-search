// Entity ids are unique per definition (GraphExtractor.entityId): definitions
// that used to share an id — and lose all but one at insert — stay separate.
import { describe, expect, it } from 'vitest';
import { GraphExtractor } from '../../core/graph/graph-extractor.js';
import { resolveLanguage } from '../../core/infrastructure/language-patterns.js';

const uniqueIds = (entities) => new Set(entities.map((e) => e.id)).size === entities.length;

describe('entity ids: one entity per definition', () => {
  it('C# (regex path): same field and method in nested classes, each under its own class', () => {
    const ex = new GraphExtractor();
    const lines = [
      'public class Tests',
      '{',
      '    public class OcelotJ : UnitTest',
      '    {',
      '        private readonly ConfigurationBuilder _builder = new();',
      '        private void GivenJObject(JObject jobj) => _builder.Properties[Key] = jobj;',
      '',
      '        [Fact]',
      '        public void ReturnsJson()',
      '        {',
      '            GivenJObject(null);',
      '        }',
      '    }',
      '    public class OcelotJRoute : UnitTest',
      '    {',
      '        private readonly ConfigurationBuilder _builder = new();',
      '        private void GivenJObject(JObject jobj) => _builder.Properties[Key] = jobj;',
      '    }',
      '}',
    ];
    const langInfo = resolveLanguage('Tests.cs', lines.join('\n'));
    const { entities } = ex.extractGeneric(lines.join('\n'), lines, 'Tests.cs', langInfo);
    expect(uniqueIds(entities)).toBe(true);
    const members = entities
      .filter((e) => e.name === '_builder' || e.name === 'GivenJObject')
      .map((e) => `${e.parent_class}.${e.name}@${e.start_line}-${e.end_line}`);
    expect(members).toEqual([
      'OcelotJ._builder@5-5',
      'OcelotJ.GivenJObject@6-6',
      'OcelotJRoute._builder@16-16',
      'OcelotJRoute.GivenJObject@17-17',
    ]);
    // The method after the field keeps its class (the field no longer spans it).
    expect(entities.find((e) => e.name === 'ReturnsJson').parent_class).toBe('OcelotJ');
  });

  it('overloads whose first 120 characters match are separate entities', async () => {
    const ex = new GraphExtractor();
    const head = 'public int GivenOcelotIsRunning(Action<WebHostBuilderContext, IConfigurationBuilder> configureDelegate, Action<IServiceCollection> configureServices';
    const lines = [
      'public class Steps',
      '{',
      `    ${head})`,
      '        => Run(configureDelegate, configureServices, null);',
      `    ${head}, Action<IApplicationBuilder> configureApp)`,
      '        => Run(configureDelegate, configureServices, configureApp);',
      '}',
    ];
    const langInfo = resolveLanguage('Steps.cs', lines.join('\n'));
    const { entities } = ex.extractGeneric(lines.join('\n'), lines, 'Steps.cs', langInfo);
    const runs = entities.filter((e) => e.name === 'GivenOcelotIsRunning');
    expect(runs.map((e) => e.start_line)).toEqual([3, 5]);
    expect(new Set(runs.map((e) => e.id)).size).toBe(2);
  });

  it('Makefile: a variable set in two branches is two entities', async () => {
    const ex = new GraphExtractor();
    const content = ['ifeq ($(CI),1)', 'MODE = fast', 'else', 'MODE = fast', 'endif'].join('\n');
    const { entities } = await ex.extractFromFile('Makefile', content);
    expect(uniqueIds(entities)).toBe(true);
    expect(entities.filter((e) => e.name === 'MODE').map((e) => e.start_line)).toEqual([2, 4]);
  });

  it('CSS: a custom property repeated in two selectors is two entities', async () => {
    const ex = new GraphExtractor();
    const content = [':root {', '  --color-text: #222;', '}', '.dark {', '  --color-text: #222;', '}'].join('\n');
    const { entities } = await ex.extractFromFile('style.css', content);
    expect(uniqueIds(entities)).toBe(true);
    const vars = entities.filter((e) => /color-text/.test(e.name));
    expect(vars.map((e) => `${e.start_line}-${e.end_line}`)).toEqual(['2-2', '5-5']);
  });

  it('YAML: an exact repeat of a key line is one key; a different value is another', async () => {
    const ex = new GraphExtractor();
    const content = ['jobs:', '  a:', '    run: make', '  b:', '    run: make', '  c:', '    run: make test'].join('\n');
    const { entities } = await ex.extractFromFile('ci.yml', content);
    expect(uniqueIds(entities)).toBe(true);
    expect(entities.filter((e) => e.name === 'run').map((e) => e.start_line)).toEqual([3, 7]);
  });

  it('proto: an rpc declared in two services is two entities, each under its service', async () => {
    const ex = new GraphExtractor();
    const lines = [
      'service Zero {',
      '  rpc DeleteNamespace(DeleteNsRequest) returns (Status) {}',
      '}',
      'service Worker {',
      '  rpc DeleteNamespace(DeleteNsRequest) returns (Status) {}',
      '}',
    ];
    const { entities } = ex.extractProto(lines.join('\n'), lines, 'pb.proto');
    expect(uniqueIds(entities)).toBe(true);
    expect(entities.filter((e) => e.type === 'rpc').map((e) => `${e.parent_class}.${e.name}`))
      .toEqual(['Zero.DeleteNamespace', 'Worker.DeleteNamespace']);
  });

  it('ids do not depend on line numbers: code moved down keeps its id', async () => {
    const a = new GraphExtractor();
    const b = new GraphExtractor();
    const src = ['export class Alpha {', '  run(): number { return 1; }', '}'];
    const first = await a.extractFromFile('src/a.ts', src.join('\n'));
    const moved = await b.extractFromFile('src/a.ts', ['// header', '', ...src].join('\n'));
    const ids = (r) => r.entities.map((e) => `${e.name}:${e.id}`).sort();
    expect(ids(moved)).toEqual(ids(first));
    expect(moved.entities.find((e) => e.name === 'run').start_line).toBe(4);
  });

  it('findEndLine: a declaration ending in `;` before any block is one line', () => {
    const ex = new GraphExtractor();
    const lines = ['private int _x = 1;', 'void F() {', '  g();', '}'];
    expect(ex.findEndLine(lines, 0)).toBe(1);
    expect(ex.findEndLine(lines, 1)).toBe(4);
    expect(ex.findEndLine(['int f(int a,', '      int b) {', '}'], 0)).toBe(3);
  });

  it('findEndLine: `//` inside a string is not a comment; a `;` only in a comment ends nothing', () => {
    const ex = new GraphExtractor();
    const body = ['void F() {', '  g();', '}'];
    // A URL field: the old `//.*$` cut left `"http:` and the field ran on to F's `}`.
    expect(ex.findEndLine(['private const string Url = "http://localhost:5000";', ...body], 0)).toBe(1);
    expect(ex.findEndLine(["const u = 'https://x.org/a';", ...body], 0)).toBe(1);
    expect(ex.findEndLine(['private string P = @"C:\\dir\\";', ...body], 0)).toBe(1);
    expect(ex.findEndLine(['int x = 1; // trailing note', ...body], 0)).toBe(1);
    expect(ex.findEndLine(['int x = 1; /* note */', ...body], 0)).toBe(1);
    expect(ex.findEndLine(['private readonly Dictionary<string, List<int>> _m = new();', ...body], 0)).toBe(1);
    // Multi-line expression-bodied member: ends on the line with the `;`.
    expect(ex.findEndLine(['public int F(int a)', '    => a + 1;', ...body], 0)).toBe(2);
    // A `;` that only appears in a comment does not end the declaration.
    expect(ex.findEndLine(['void G() // calls g();', '{', '  g();', '}'], 0)).toBe(4);
    expect(ex.findEndLine(['void G() /* g(); */', '{', '  g();', '}'], 0)).toBe(4);
  });

  it('C# (regex path): a method whose parameters continue on the next lines is a definition', () => {
    const ex = new GraphExtractor();
    const lines = [
      'public class AcceptanceSteps',
      '{',
      '    public int GivenOcelotIsRunning() => GivenOcelotIsRunning(null, null);',
      '    protected int GivenOcelotIsRunning(',
      '        Action<IServiceCollection>? configureServices,',
      '        Action<HttpClient>? configureClient)',
      '    {',
      '        return Run(configureServices, configureClient);',
      '    }',
      '    private static void SetBaseUrl(FileConfiguration configuration, string baseUrl)',
      '    {',
      '    }',
      '}',
    ];
    const langInfo = resolveLanguage('AcceptanceSteps.cs', lines.join('\n'));
    const { entities } = ex.extractGeneric(lines.join('\n'), lines, 'AcceptanceSteps.cs', langInfo);
    expect(uniqueIds(entities)).toBe(true);
    expect(entities.filter((e) => e.type === 'method').map((e) => `${e.parent_class}.${e.name}@${e.start_line}-${e.end_line}`)).toEqual([
      'AcceptanceSteps.GivenOcelotIsRunning@3-3',
      'AcceptanceSteps.GivenOcelotIsRunning@4-9',
      'AcceptanceSteps.SetBaseUrl@10-12',
    ]);
  });
});

describe('entity ids: collision guard', () => {
  const content = ['export class A {', '  run() { return 1; }', '}', 'export class B {', '  run() { return 2; }', '}'].join('\n');

  // An extractor whose id rule is broken on purpose: every entity of a type gets one id.
  const brokenExtractor = () => {
    const ex = new GraphExtractor();
    ex.entityId = (filePath, type) => ({ id: `fixed-${type}`, duplicate: false });
    return ex;
  };

  it('throws under tests when two entities of one file share an id', async () => {
    await expect(brokenExtractor().extractFromFile('src/x.ts', content)).rejects.toThrow(/duplicate entity id/);
  });

  it('outside tests, keeps every entity under a derived id and moves its edges and call sites', async () => {
    const saved = process.env.VITEST;
    const warn = console.warn;
    console.warn = () => {};
    delete process.env.VITEST;
    let result;
    try {
      result = await brokenExtractor().extractFromFile('src/x.ts', content);
    } finally {
      process.env.VITEST = saved;
      console.warn = warn;
    }
    const ids = result.entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const runs = result.entities.filter((e) => e.name === 'run');
    expect(runs).toHaveLength(2);
    // Every edge or call site from inside the second `run` moved to its new id.
    for (const r of [...result.relationships, ...(result.callSites || [])]) {
      if (r.context_line === 5) expect(r.source_id).not.toBe('fixed-method');
    }
    // Deterministic: the same input gives the same derived ids.
    delete process.env.VITEST;
    console.warn = () => {};
    let again;
    try {
      again = await brokenExtractor().extractFromFile('src/x.ts', content);
    } finally {
      process.env.VITEST = saved;
      console.warn = warn;
    }
    expect(again.entities.map((e) => e.id)).toEqual(ids);
  });

  it('property: generated files with repeated names, nesting and overloads always get unique ids', async () => {
    let seed = 20261002;
    const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    const names = ['run', 'Given', 'build', '_builder', 'Value', 'helper'];
    const makers = {
      'gen.cs': () => {
        const out = ['namespace N;', 'public class Root', '{'];
        for (let c = 0; c < 4; c++) {
          out.push(`    public class C${rnd(3)}`, '    {');
          for (let m = 0; m < 5; m++) {
            const n = names[rnd(names.length)];
            out.push(rnd(2)
              ? `        private readonly Builder ${n} = new();`
              : `        public void ${n}(int a${rnd(2) ? ', string s' : ''}) => Do(a);`);
          }
          out.push('    }');
        }
        out.push('}');
        return out;
      },
      'gen.ts': () => {
        const out = [];
        for (let c = 0; c < 4; c++) {
          out.push(`export class K${rnd(3)} {`);
          for (let m = 0; m < 5; m++) out.push(`  ${names[rnd(names.length)]}(a${rnd(2) ? ', b' : ''}) { return a; }`);
          out.push('}');
        }
        for (let f = 0; f < 4; f++) out.push(`export function ${names[rnd(names.length)]}() { return ${rnd(3)}; }`);
        return out;
      },
      'Gen.java': () => {
        const out = ['package p;', 'public class Gen {'];
        for (let m = 0; m < 8; m++) out.push(`  public int ${names[rnd(names.length)]}(int a) { return a; }`);
        out.push('}');
        return out;
      },
      'gen.py': () => {
        const out = [];
        for (let c = 0; c < 3; c++) {
          out.push(`class P${rnd(2)}:`);
          for (let m = 0; m < 4; m++) out.push(`    def ${names[rnd(names.length)]}(self):`, `        return ${rnd(3)}`);
        }
        return out;
      },
      'gen.go': () => {
        const out = ['package g', ''];
        for (let m = 0; m < 6; m++) out.push(`func (r *R${rnd(2)}) ${names[rnd(names.length)]}() int { return ${rnd(3)} }`);
        return out;
      },
      Makefile: () => Array.from({ length: 10 }, () => `${['MODE', 'CC', 'OUT'][rnd(3)]} = ${['fast', 'gcc'][rnd(2)]}`),
      'gen.yml': () => Array.from({ length: 6 }, (_, i) => [`- name: t${rnd(3)}`, `  run: ${['make', 'make test'][rnd(2)]}`][i % 2]),
    };
    for (let round = 0; round < 40; round++) {
      for (const [file, make] of Object.entries(makers)) {
        const ex = new GraphExtractor();
        // Under VITEST the guard throws on any duplicate, so a pass here means unique ids.
        const { entities } = await ex.extractFromFile(file, make().join('\n'));
        expect(uniqueIds(entities)).toBe(true);
      }
    }
  });
});
