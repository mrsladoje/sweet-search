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
});
