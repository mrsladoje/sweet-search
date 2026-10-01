/**
 * Type-reference resolution (extends / implements / uses) in
 * core/graph/relationship-resolver.js.
 *
 * Every case is the shape of a wrong or missing edge found in the r3 bench
 * repos (zipkin, ocelot, drogon, flask, sequel, tortoise-orm, GRDB).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createGraphSchema, resolveRelationshipTargets } from '../../core/graph/index.js';

describe('resolveRelationshipTargets — type references', () => {
  let db;
  let originalLog;

  beforeEach(() => {
    db = new Database(':memory:');
    createGraphSchema(db);
    originalLog = console.log;
    console.log = () => {};
  });

  afterEach(() => {
    console.log = originalLog;
    db.close();
  });

  function entity(id, filePath, type, name, startLine = 1, endLine = 20) {
    db.prepare('INSERT INTO entities (id, file_path, type, name, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, filePath, type, name, startLine, endLine);
  }

  function rel(sourceId, targetName, type, line = 1) {
    db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, context_line) VALUES (?, NULL, ?, ?, ?)')
      .run(sourceId, targetName, type, line);
  }

  function target(sourceId, targetName) {
    return db.prepare('SELECT target_id FROM relationships WHERE source_id = ? AND target_name = ?')
      .get(sourceId, targetName).target_id;
  }

  it('extends links the class, not its same-named constructor in the same file (zipkin Proto3Fields)', () => {
    const f = 'zipkin/src/main/java/zipkin2/internal/Proto3Fields.java';
    entity('field-class', f, 'class', 'Field', 40, 90);
    entity('field-ctor', f, 'method', 'Field', 43, 45);
    entity('fixed64', f, 'class', 'Fixed64Field', 197, 215);
    rel('fixed64', 'Field', 'extends', 197);

    resolveRelationshipTargets(db);
    expect(target('fixed64', 'Field')).toBe('field-class');
  });

  it('extends never links a property, function or markup element (ocelot DelegatingHandler)', () => {
    entity('prop', 'src/Requester/GlobalDelegatingHandler.cs', 'property', 'DelegatingHandler', 10, 10);
    entity('xml', 'samples/ApplicationManifest.xml', 'element', 'StatelessService', 29, 29);
    entity('fake', 'unit/Requester/FakeDelegatingHandler.cs', 'class', 'FakeDelegatingHandler', 3, 30);
    rel('fake', 'DelegatingHandler', 'extends', 3);
    rel('fake', 'StatelessService', 'extends', 3);

    resolveRelationshipTargets(db);
    expect(target('fake', 'DelegatingHandler')).toBeNull();
    expect(target('fake', 'StatelessService')).toBeNull();
  });

  it('extends never links the source to itself (Python class Config(Config))', () => {
    entity('mine', 'app/config.py', 'class', 'Config', 3, 30);
    entity('base', 'lib/config.py', 'class', 'Config', 1, 80);
    rel('mine', 'Config', 'extends', 3);

    resolveRelationshipTargets(db);
    expect(target('mine', 'Config')).toBe('base');
  });

  it('qualified bases resolve by short name at the qualifier path (flask.views.View, Sequel::Dataset)', () => {
    entity('lib-view', 'src/flask/views.py', 'class', 'View', 16, 130);
    entity('test-view', 'tests/test_views.py', 'class', 'View', 247, 260);
    entity('index', 'tests/test_views.py', 'class', 'Index', 186, 200);
    rel('index', 'flask.views.View', 'extends', 186);

    entity('ds-adapter', 'lib/sequel/adapters/ado/access.rb', 'class', 'Dataset', 330, 332);
    entity('ds-core', 'lib/sequel/dataset.rb', 'class', 'Dataset', 29, 45);
    entity('ds-tiny', 'lib/sequel/adapters/tinytds.rb', 'class', 'Dataset', 191, 257);
    rel('ds-tiny', 'Sequel::Dataset', 'extends', 191);

    entity('php-iface', 'src/Composer/Plugin/Capability/Capability.php', 'interface', 'Capability', 21, 30);
    entity('php-mock', 'tests/Composer/Test/Plugin/Mock/Capability.php', 'class', 'Capability', 15, 20);
    rel('php-mock', '\\Composer\\Plugin\\Capability\\Capability', 'implements', 15);

    resolveRelationshipTargets(db);
    expect(target('index', 'flask.views.View')).toBe('lib-view');
    expect(target('ds-tiny', 'Sequel::Dataset')).toBe('ds-core');
    expect(target('php-mock', '\\Composer\\Plugin\\Capability\\Capability')).toBe('php-iface');
  });

  it('a nested base matches through its owning type (zipkin Call.Base)', () => {
    db.prepare("INSERT INTO entities (id, file_path, type, name, start_line, end_line, parent_class) VALUES ('call-base', 'zipkin/src/main/java/zipkin2/internal/Calls.java', 'class', 'Base', 360, 420, 'Call')").run();
    entity('other-base', 'zipkin/src/main/java/zipkin2/internal/Other.java', 'class', 'Base', 10, 40);
    entity('store', 'zipkin/src/main/java/zipkin2/storage/InMemoryStorage.java', 'class', 'StoreSpansCall', 212, 240);
    rel('store', 'Call.Base', 'extends', 212);

    resolveRelationshipTargets(db);
    expect(target('store', 'Call.Base')).toBe('call-base');
  });

  it('a qualified base whose qualifier is not in the repo stays unresolved (nn.Module)', () => {
    entity('local-module', 'app/module.py', 'class', 'Module', 1, 40);
    entity('net', 'app/net.py', 'class', 'Net', 1, 40);
    rel('net', 'nn.Module', 'extends', 1);

    resolveRelationshipTargets(db);
    expect(target('net', 'nn.Module')).toBeNull();
  });

  it('prefers library code over a test helper of the same name (GRDB Record)', () => {
    entity('test-record', 'Tests/GRDBTests/Record/FetchableRecord/FetchableRecordDecodableTests.swift', 'class', 'Record', 918, 930);
    entity('lib-record', 'GRDB/Record/Record.swift', 'class', 'Record', 42, 400);
    entity('item', 'Tests/GRDBTests/Record/Record/RecordPrimaryKeyNoneTests.swift', 'class', 'Item', 5, 40);
    rel('item', 'Record', 'extends', 5);

    resolveRelationshipTargets(db);
    expect(target('item', 'Record')).toBe('lib-record');
  });

  it('prefers the definition in the file named after the type over a forward declaration (drogon Cookie)', () => {
    entity('fwd', 'lib/src/impl_forwards.h', 'class', 'Cookie', 12, 12);
    entity('real', 'lib/inc/drogon/Cookie.h', 'class', 'Cookie', 30, 400);
    entity('ctor', 'lib/inc/drogon/Cookie.h', 'function', 'Cookie', 44, 50);
    entity('test', 'lib/tests/CookieSameSite.cc', 'function', 'DROGON_TEST', 10, 90);
    rel('test', 'Cookie', 'uses', 67);

    resolveRelationshipTargets(db);
    expect(target('test', 'Cookie')).toBe('real');
  });

  it('uses still resolves to a function when no type has the name (Python decorator)', () => {
    entity('deco', 'src/app/auth.py', 'function', 'login_required', 1, 10);
    entity('view', 'src/app/views.py', 'function', 'profile', 5, 20);
    rel('view', 'login_required', 'uses', 4);

    resolveRelationshipTargets(db);
    expect(target('view', 'login_required')).toBe('deco');
  });

  it('calls keep same-file resolution (unchanged)', () => {
    entity('cls', 'src/App.java', 'class', 'App');
    entity('m', 'src/App.java', 'method', 'process');
    rel('cls', 'process', 'calls');

    resolveRelationshipTargets(db);
    expect(target('cls', 'process')).toBe('m');
  });
});
