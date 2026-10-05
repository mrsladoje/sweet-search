import { describe, it, expect } from 'vitest';
import { scanCallSites, CallSiteScanner } from '../../core/graph/call-site-scanner.js';
import { getLanguageByPath } from '../../core/infrastructure/language-patterns.js';

function calls(file, src) {
  return scanCallSites(getLanguageByPath(file), src.split('\n')).map(c => `${c.line}:${c.targetName}`);
}

function names(file, src) {
  return scanCallSites(getLanguageByPath(file), src.split('\n')).map(c => c.targetName);
}

describe('call-site scanner — call shapes', () => {
  it('captures optional-chained and force-unwrapped member calls (GRDB repro)', () => {
    expect(names('a.swift', '        try observationBroker?.statementDidFail(statement)'))
      .toEqual(['observationBroker.statementDidFail']);
    expect(names('a.swift', 'let x = foo!.bar(1)')).toEqual(['foo.bar']);
    expect(names('a.kt', 'val y = a!!.b()')).toEqual(['a.b']);
    expect(names('a.kt', 'val r = client?.newCall(req)')).toEqual(['client.newCall']);
    expect(names('a.ts', 'paramRefl.comment?.removeModifier("@ignore");')).toEqual(['comment.removeModifier']);
    expect(names('a.cs', 'var s = _cache?.Get(key);')).toEqual(['_cache.Get']);
    expect(names('a.dart', 'widget!.build(context);')).toEqual(['widget.build']);
    expect(names('a.rb', 'x&.call(1)')).toEqual(['x.call']);
    expect(names('a.php', '$user?->save();')).toEqual(['user.save']);
  });

  it('captures chained optional access and JS/TS optional calls', () => {
    expect(names('a.swift', 'try a?.b?.c(x)')).toEqual(['b.c']);
    expect(names('a.swift', 'a!.b!.c()')).toEqual(['b.c']);
    expect(names('a.swift', 'self.observationBroker?.statementDidFail(s)')).toEqual(['observationBroker.statementDidFail']);
    expect(names('a.kt', 'a?.b?.c()')).toEqual(['b.c']);
    expect(names('a.ts', 'a?.b?.c()')).toEqual(['b.c']);
    // `?.(` calls the expression before it.
    expect(names('a.ts', 'a.b?.()')).toEqual(['a.b']);
    expect(names('a.js', 'opts?.onDone?.(err)')).toEqual(['opts.onDone']);
    expect(names('a.tsx', 'x?.y?.(1).z?.(2)')).toEqual(['x.y', 'y().z']);
    expect(calls('a.ts', 'promise\n  .then?.(cb)')).toEqual(['2:promise.then']);
    // Ternaries are not calls.
    expect(names('a.ts', 'const v = c ? (b) : d')).toEqual([]);
  });

  it('reads a JS/TS optional call of a bare name as a bare call', () => {
    const scanner = new CallSiteScanner(getLanguageByPath('a.ts'));
    const bare = [];
    scanner.scanLine('onChange?.(value)', () => {}, (n) => bare.push(n));
    scanner.scanLine('const v = c ? (b) : d', () => {}, (n) => bare.push(n));
    expect(bare).toEqual(['onChange']);
  });

  it('captures generic and turbofish calls', () => {
    expect(names('a.ts', 'repo.find<User>(id)')).toEqual(['repo.find']);
    expect(names('a.cs', 'services.GetService<IOcelotTracer>();')).toEqual(['services.GetService']);
    expect(names('a.rs', 'let v = it.collect::<Vec<_>>();')).toEqual(['it.collect']);
  });

  it('captures chained calls as prev().method', () => {
    expect(names('a.swift', 'db.makeStatement(sql: sql).execute()'))
      .toEqual(['db.makeStatement', 'makeStatement().execute']);
    expect(names('a.go', 'errs.Last().Error()')).toEqual(['errs.Last', 'Last().Error']);
    expect(names('a.ts', 'a(x).b(y).c()')).toEqual(['a().b', 'b().c']);
  });

  it('captures leading-dot continuation lines from the previous line tail', () => {
    expect(calls('a.swift', [
      'let rows = try Row',
      '    .fetchAll(db, sql: sql)',
      '    .filter { $0.ok }',
    ].join('\n'))).toEqual(['2:Row.fetchAll', '3:fetchAll().filter']);
    expect(calls('a.ts', 'foo.bar()\n  // note\n  .baz()')).toEqual(['1:foo.bar', '3:bar().baz']);
  });

  it('captures Go trailing-dot continuation lines', () => {
    expect(calls('a.go', '\tresp, err := client.\n\t\tDo(req)')).toEqual(['2:client.Do']);
  });

  it('captures Rust path calls and self calls', () => {
    expect(names('a.rs', 'let w = Foo::bar(1);')).toEqual(['Foo.bar']);
    expect(names('a.rs', 'Self::new(a);')).toEqual(['Self.new']);
    expect(names('a.rs', 'self.flush();')).toEqual(['self.flush']);
  });

  it('keeps self/cls/static receivers (intra-class calls)', () => {
    expect(names('a.py', '    self.helper(x)')).toEqual(['self.helper']);
    expect(names('a.py', '    cls.build()')).toEqual(['cls.build']);
    expect(names('a.php', '    self::boot();')).toEqual(['self.boot']);
    expect(names('a.php', '    $this->load($x);')).toEqual(['this.load']);
  });

  it('captures Swift/Kotlin trailing-closure calls but not control flow or types', () => {
    expect(names('a.swift', 'try dbQueue.write { db in')).toEqual(['dbQueue.write']);
    expect(names('a.kt', 'list.forEach { println(it) }')).toEqual(['list.forEach']);
    expect(names('a.swift', 'if items.isEmpty {')).toEqual([]);
    expect(names('a.swift', '} else if a.b {')).toEqual([]);
    expect(names('a.swift', 'for x in a.b {')).toEqual([]);
    expect(names('a.swift', 'extension Foo.Bar {')).toEqual([]);
    expect(names('a.swift', 'var x: Foo.Bar {')).toEqual([]);
    expect(names('a.swift', 'func x() -> Foo.Bar {')).toEqual([]);
    expect(names('a.kt', 'class A : B.C {')).toEqual([]);
    // Go composite literals are not calls.
    expect(names('a.go', 'x := http.Server{')).toEqual([]);
  });

  it('captures Ruby bang calls but not != comparisons', () => {
    expect(names('a.rb', 'user.save!')).toEqual(['user.save']);
    expect(names('a.rb', 'if a.b != c')).toEqual([]);
  });
});

describe('call-site scanner — false positives', () => {
  it('ignores line comments and doc comments (GRDB repro)', () => {
    expect(names('a.swift', '        // `TransactionObserver.databaseDidRollback(_:)` implementation')).toEqual([]);
    expect(names('a.swift', '///     let score = try partialPlayer.insertAndFetch(db) { statement in')).toEqual([]);
    expect(names('a.rs', '/// This is equivalent to `at_operation(repo.op_id(), self)`')).toEqual([]);
    expect(names('a.py', '    cls.build()  # trailing comment foo.bar()')).toEqual(['cls.build']);
    expect(names('a.php', '# comment $x->y()')).toEqual([]);
  });

  it('ignores block comments across lines and keeps code after them', () => {
    expect(calls('a.swift', '/* block foo.bar()\n   still comment baz.qux() */ real.call()')).toEqual(['2:real.call']);
    expect(calls('a.java', ' * List<Span> trace = getTraceCall.execute();\n')).toEqual(['1:getTraceCall.execute']);
    expect(calls('a.java', '/**\n * List<Span> trace = getTraceCall.execute();\n */\nx.y();')).toEqual(['4:x.y']);
  });

  it('ignores Python docstrings', () => {
    expect(calls('a.py', [
      '    """Docstring mentions obj.method() here."""',
      "    '''",
      '    doctest: thing.run()',
      "    '''",
      '    real.call()',
    ].join('\n'))).toEqual(['5:real.call']);
  });

  it('does not treat comment tokens inside strings, URLs or globs as comments', () => {
    expect(names('a.ts', 'const g = "src/**/*.ts"; app.listen(3000)')).toEqual(['app.listen']);
    expect(names('a.swift', 'let u = "http://x"; obj.go()')).toEqual(['obj.go']);
    expect(names('a.py', 'x = "#".join(parts).strip()')).toEqual(['join().strip']);
    // PHP heredoc text `foo/*` must not open a block comment.
    expect(calls('a.php', 'php composer.phar update vendor/package1 foo/* [...]\n$config->get(\'x\');'))
      .toEqual(['2:config.get']);
    expect(names('a.php', '#[Attr] $z->w();')).toEqual(['z.w']);
  });

  it('does not read Swift implicit-member patterns as calls on a keyword', () => {
    expect(names('a.swift', 'case let .cast(expression, _):')).toEqual([]);
    expect(names('a.swift', 'case .success(let v): return .failure(v)')).toEqual([]);
  });

  it('does not read definition lines as calls', () => {
    expect(names('a.kt', 'internal fun String.indexOfLastNonAsciiWhitespace(startIndex: Int = 0): Int {')).toEqual([]);
    expect(names('a.kt', 'fun Path.asRequestBody(contentType: MediaType? = null): RequestBody = x.y()')).toEqual(['x.y']);
    expect(names('a.scala', 'def Foo.bar(x: Int) = 1')).toEqual([]);
    expect(names('a.cpp', 'void HttpServer::start(int port) {')).toEqual([]);
    expect(names('a.cpp', 'const std::string &HttpRequest::path() const {')).toEqual([]);
    expect(names('a.cpp', 'HttpServer::HttpServer(EventLoop *loop) : loop_(loop) {')).toEqual([]);
    // Real C++ calls stay.
    expect(names('a.cpp', '  HttpServer::start(80);')).toEqual(['HttpServer.start']);
    expect(names('a.cpp', '  return Utils::trim(s);')).toEqual(['Utils.trim']);
    expect(names('a.cpp', '  auto p = Factory::make(1);')).toEqual(['Factory.make']);
    expect(names('a.kt', '  return s.indexOfLastNonAsciiWhitespace()')).toEqual(['s.indexOfLastNonAsciiWhitespace']);
  });

  it('does not use `.` as a call separator in PHP (string concatenation)', () => {
    expect(names('a.php', '$s = $a . strtolower($b);')).toEqual([]);
  });

  it('respects skipCallObjects for direct and chained receivers', () => {
    expect(names('a.py', 'super().__init__()')).toEqual([]);
    expect(names('a.ts', 'console.log(x)')).toEqual([]);
  });
});

describe('call-site scanner — string literals', () => {
  it('reads no call inside a string literal, in any language', () => {
    expect(names('a.ts', 'const m = "call obj.method(1) now"; real.call(2);')).toEqual(['real.call']);
    expect(names('a.py', 'y = "text other.call(4)"; e.f(5)')).toEqual(['e.f']);
    expect(names('a.java', 'String s = "x.y(1)"; obj.call(2);')).toEqual(['obj.call']);
    expect(names('a.go', 'w.Write("x.y(1)")')).toEqual(['w.Write']);
    expect(names('a.rs', 'println!("a.b({})", 1); c.d(2);')).toEqual(['c.d']);
    expect(names('a.rb', 'puts "a.b(1)"; e.f(2)')).toEqual(['e.f']);
    expect(names('a.cs', 'var s = "x.Y(1)"; k.L(2);')).toEqual(['k.L']);
    expect(names('a.cpp', 'auto s = "x.y(1)"; a.b(2);')).toEqual(['a.b']);
  });

  it('keeps calls inside string interpolation', () => {
    expect(names('a.ts', 'const t = `tpl ${y.compute(2)} and text.notACall(3)`;')).toEqual(['y.compute']);
    expect(names('a.kt', 'val t = "v ${k.m(4)} w.z(5)"')).toEqual(['k.m']);
    expect(names('a.swift', 'let s = "v \\(model.title(1)) w.z(2)"')).toEqual(['model.title']);
    expect(names('a.rb', 's = "v #{a.b(1)} w.z(2)"')).toEqual(['a.b']);
    expect(names('a.rb', "t = 'v #{c.d(3)}'")).toEqual([]);
    expect(names('a.py', 's = f"v {a.b(1)} w.z(2)"')).toEqual(['a.b']);
    expect(names('a.py', "t = 'q.r(3)'")).toEqual([]);
    expect(names('a.cs', 'var s = $"v {a.B(1)} w.Z(2)";')).toEqual(['a.B']);
    expect(names('a.php', '$s = "v {$o->m(1)} w->z(2)";')).toEqual(['o.m']);
  });

  it('tracks template literals, raw strings and triple quotes across lines', () => {
    expect(calls('a.ts', ['const q = `', '  SELECT x.y(1) FROM t', '  ${db.quote(v)} // text', '`; real.call(2);'].join('\n')))
      .toEqual(['3:db.quote', '4:real.call']);
    expect(calls('a.go', ['s := `raw', 'x.y(1) /* not a comment', '`', 'a.b(2)'].join('\n'))).toEqual(['4:a.b']);
    expect(calls('a.kt', ['val s = """', '   text a.b(1)', '   ${obj.real(2)}', '"""', 'x.y(3)'].join('\n')))
      .toEqual(['3:obj.real', '5:x.y']);
    expect(calls('a.java', ['String s = """', '  text a.b(1)', '  """;', 'x.y(2);'].join('\n'))).toEqual(['4:x.y']);
  });

  it('does not let a char literal holding a quote open a string', () => {
    expect(names('a.go', 'r := \'"\'; a.b(2)')).toEqual(['a.b']);
    expect(names('a.java', "char c = '\"'; x.y(2);")).toEqual(['x.y']);
    expect(names('a.cpp', "char q = '\\''; e.f(3);")).toEqual(['e.f']);
    expect(names('a.rs', "fn f<'a>(x: &'a str) { c.d(3) }")).toEqual(['c.d']);
  });

  it('keeps escapes off in raw strings', () => {
    expect(names('a.cs', 'var p = @"c:\\path\\" + q.R(3);')).toEqual(['q.R']);
    expect(names('a.rs', 'let s = r"raw x.y(1) \\"; a.b(2);')).toEqual(['a.b']);
  });
});
