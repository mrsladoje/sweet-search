// Hand-curated agent-in-the-loop tasks.
//
// Each task carries a real user-facing question (not a regex), gold facts the
// answer must contain, expected files, expected symbols, and expected line
// ranges. Seed material from eval/data/pattern-benchmark-<repo>/queries.jsonl,
// reshaped so a real agent reads them as questions a developer would ask.
//
// `expectedFacts` is matched substring-against-the-answer (case-insensitive).
// Use the most distinctive identifier or short phrase — over-strict facts
// punish prose phrasing variation; over-loose facts let hallucinations pass.

const TASKS = {
  // ─── fastify (10): 3 exact + 3 behavior/error-path + 2 multi-file + 1 large-file + 1 no-match
  fastify: [
    // ── 3 exact / symbol / config ─────────────────────────────────────────
    {
      id: 'fastify:internal-symbols',
      seedQueryId: 'fy005',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'Where does Fastify define the Symbol() keys it uses for internal private state on instances? Name the file.',
      expectedFiles: ['lib/symbols.js'],
      expectedSymbols: [],
      expectedFacts: ['lib/symbols.js', 'Symbol'],
      expectedLineRanges: { 'lib/symbols.js': [[3, 69]] },
    },
    {
      id: 'fastify:error-codes',
      seedQueryId: 'fy006',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'Where in Fastify are all the FST_ERR_* error code classes defined? Identify the file and the helper function used to construct each error class.',
      expectedFiles: ['lib/errors.js'],
      expectedSymbols: ['createError'],
      expectedFacts: ['lib/errors.js', 'FST_ERR_', 'createError'],
      expectedLineRanges: { 'lib/errors.js': [[5, 100]] },
    },
    {
      id: 'fastify:validation-pipeline',
      seedQueryId: 'fy012',
      taskType: 'exact_symbol_lookup',
      difficulty: 'medium',
      maxTurns: 6,
      question: 'Which function in Fastify validates request params, body, querystring and headers using the compiled JSON Schema validators? In what order are they validated?',
      expectedFiles: ['lib/validation.js'],
      expectedSymbols: ['validate'],
      expectedFacts: ['lib/validation.js', 'params', 'body', 'querystring', 'headers'],
      expectedLineRanges: { 'lib/validation.js': [[146, 203]] },
    },

    // ── 3 behavior / error-path ───────────────────────────────────────────
    {
      id: 'fastify:server-protocol-selection',
      seedQueryId: 'fy001',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In the Fastify codebase, how does Fastify decide whether to create a plain HTTP, HTTPS, or HTTP/2 server when an instance is constructed? Identify the function that makes this decision and summarise its logic.',
      expectedFiles: ['lib/server.js'],
      expectedSymbols: ['getServerInstance'],
      expectedFacts: ['getServerInstance', 'http2', 'https'],
      expectedLineRanges: { 'lib/server.js': [[309, 348]] },
    },
    {
      id: 'fastify:reply-send-payload-detection',
      seedQueryId: 'fy009',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'When you call reply.send(payload) in Fastify, how does it decide between treating the payload as a stream, a Buffer, a string, or JSON? Cite the function and line range.',
      expectedFiles: ['lib/reply.js'],
      expectedSymbols: ['send'],
      expectedFacts: ['lib/reply.js', 'send'],
      expectedLineRanges: { 'lib/reply.js': [[139, 225]] },
    },
    {
      id: 'fastify:error-handler-chain',
      seedQueryId: 'fy015',
      taskType: 'error_handling_path',
      difficulty: 'hard',
      maxTurns: 8,
      question: 'Fastify allows nested setErrorHandler() calls to override error handling per encapsulation level. Which file/function builds the prototype chain that makes this work?',
      expectedFiles: ['lib/error-handler.js'],
      expectedSymbols: ['buildErrorHandler', 'handleError'],
      expectedFacts: ['error-handler', 'prototype'],
      expectedLineRanges: { 'lib/error-handler.js': [[30, 80]] },
    },

    // ── 2 multi-file flow ─────────────────────────────────────────────────
    {
      id: 'fastify:request-lifecycle-order',
      seedQueryId: 'fy010',
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'List the order of request lifecycle hooks Fastify runs, from when a request first enters until the route handler is invoked. Cite the file and the function that drives the sequence.',
      expectedFiles: ['lib/handle-request.js'],
      expectedSymbols: ['handleRequest'],
      expectedFacts: ['preParsing', 'preValidation', 'preHandler', 'handleRequest'],
      expectedLineRanges: { 'lib/handle-request.js': [[19, 126]] },
    },
    {
      id: 'fastify:route-handler-bridge',
      // Custom multi-file question — the answer requires citing BOTH the
      // route.js entry point that find-my-way dispatches to AND the
      // handle-request.js function that runs the lifecycle. Either alone is
      // a partial answer.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'Trace what happens immediately after find-my-way matches an incoming request to a route in Fastify. Identify (a) the function in lib/route.js that find-my-way dispatches to, and (b) the function in lib/handle-request.js that runs the request lifecycle. Cite both files.',
      expectedFiles: ['lib/route.js', 'lib/handle-request.js'],
      expectedSymbols: ['routeHandler', 'handleRequest'],
      expectedFacts: ['routeHandler', 'handleRequest', 'lib/route.js', 'lib/handle-request.js'],
      expectedLineRanges: {
        'lib/route.js': [[459, 586]],
        'lib/handle-request.js': [[19, 126]],
      },
    },

    // ── 1 large-file ──────────────────────────────────────────────────────
    {
      id: 'fastify:public-api-surface',
      seedQueryId: 'fy007',
      // fastify.js is the largest file in the repo (~1200 lines). This task
      // asks for a specific span — the public API object literal — that
      // sits buried in the middle. Whole-file dumping is expensive here.
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 6,
      question: 'In the file fastify.js, where is the public API object literal that exposes the route shorthand methods (get/post/put/delete) and lifecycle methods like register/listen/inject? Give the line range.',
      expectedFiles: ['fastify.js'],
      expectedSymbols: [],
      expectedFacts: ['fastify.js', 'get', 'post', 'register', 'listen'],
      expectedLineRanges: { 'fastify.js': [[119, 282]] },
    },

    // ── 1 no-match ────────────────────────────────────────────────────────
    {
      id: 'fastify:nonexistent-quantum-router',
      taskType: 'no_match',
      difficulty: 'easy',
      maxTurns: 4,
      question: 'Does Fastify expose a method called registerQuantumRouterChannel? If so, where is it defined; if not, say so explicitly.',
      expectedFiles: [],
      expectedSymbols: [],
      // First fact: a "no" assertion. Second fact: any reasonable phrasing
      // of the rationale ("does not exist", "no matches", "not present", …).
      // Brittle literal phrases like "not exist" caused 50% factR on a
      // perfectly correct answer ("…zero matches…") in the first 10-task run.
      expectedFacts: [
        'no',
        '/not exist|does not exist|doesn\'t exist|zero matches|no matches|no occurrences|not present|not defined|not found/',
      ],
      expectedNoMatch: true,
      expectedLineRanges: {},
    },

    // ── 2 additional structural (P6.0-extend, §7.3 stratification) ────────
    // These bring the fastify dev set to 12 (4 literal-lookup / 3 behavioral /
    // 3 structural / 2 multi-file-flow) for the query-shape sweep. Both target
    // structural definition sites — a list/table and a prototype-properties
    // block — that are distinct from the 10 originals (different files,
    // different question intents).
    {
      id: 'fastify:supported-hooks-list',
      // Structural: the canonical enumeration of valid hook names lives as
      // two top-level array literals in lib/hooks.js. This is the "table"
      // any contributor needs to find when adding/auditing a new hook type.
      taskType: 'large_file',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'Where in Fastify is the canonical list of supported lifecycle hook names (preParsing, preHandler, onResponse, onRequestAbort, etc.) defined? Identify the file and the array(s) that hold them.',
      expectedFiles: ['lib/hooks.js'],
      expectedSymbols: ['lifecycleHooks', 'applicationHooks'],
      expectedFacts: ['lib/hooks.js', 'lifecycleHooks', 'applicationHooks'],
      expectedLineRanges: { 'lib/hooks.js': [[3, 23]] },
    },
    {
      id: 'fastify:request-prototype-getters',
      // Structural: the Object.defineProperties block on Request.prototype
      // declares every standard request getter (url, originalUrl, hostname,
      // ip, protocol, headers, signal, …). The block is buried in the
      // middle of lib/request.js, so this is a structural-navigation task,
      // not a behaviour question.
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 6,
      question: 'In Fastify, where are the getters for Request.prototype properties such as url, originalUrl, hostname, ip and protocol declared? Give the file and the line range of the Object.defineProperties block.',
      expectedFiles: ['lib/request.js'],
      expectedSymbols: [],
      expectedFacts: ['lib/request.js', 'Object.defineProperties', 'Request.prototype'],
      expectedLineRanges: { 'lib/request.js': [[155, 384]] },
    },
  ],
  gin: [
    {
      id: 'gin:radix-route-insertion',
      seedQueryId: 'gin001',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'How does Gin\'s router add a new route into its internal data structure? Identify the data structure, the function that inserts a route, and the file.',
      expectedFiles: ['tree.go'],
      expectedSymbols: ['addRoute'],
      expectedFacts: ['tree.go', 'addRoute', 'radix'],
      expectedLineRanges: { 'tree.go': [[133, 249]] },
    },
    {
      id: 'gin:next-abort',
      seedQueryId: 'gin002',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'In Gin, how do middleware call Next() to advance the chain, and what does Abort() do? Cite the file and the two methods.',
      expectedFiles: ['context.go'],
      expectedSymbols: ['Next', 'Abort'],
      expectedFacts: ['context.go', 'Next', 'Abort'],
      expectedLineRanges: { 'context.go': [[185, 217]] },
    },
    {
      id: 'gin:engine-struct',
      seedQueryId: 'gin003',
      taskType: 'config_lookup',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'What is the central struct in Gin that holds the router, middleware, and global configuration? Where is it declared?',
      expectedFiles: ['gin.go'],
      expectedSymbols: ['Engine'],
      expectedFacts: ['gin.go', 'Engine', 'RouterGroup'],
      expectedLineRanges: { 'gin.go': [[90, 189]] },
    },
    {
      id: 'gin:panic-recovery',
      seedQueryId: 'gin006',
      taskType: 'error_handling_path',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'Which Gin middleware catches panics in HTTP handlers and writes a 500 response, and how does it do it (defer/recover, broken-pipe handling)? Cite the file and function.',
      expectedFiles: ['recovery.go'],
      expectedSymbols: ['CustomRecoveryWithWriter'],
      expectedFacts: ['recovery.go', 'recover', 'broken pipe'],
      expectedLineRanges: { 'recovery.go': [[53, 92]] },
    },
    {
      id: 'gin:http-dispatch',
      seedQueryId: 'gin007',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'Which Gin function takes an incoming HTTP request and dispatches it to the right handler via the per-method tree, and how does it handle 405 Method Not Allowed?',
      expectedFiles: ['gin.go'],
      expectedSymbols: ['handleHTTPRequest'],
      expectedFacts: ['gin.go', 'handleHTTPRequest', 'methodTrees'],
      expectedLineRanges: { 'gin.go': [[690, 760]] },
    },

    // ── 2 literal-lookup additions ──────────────────────────────────────────
    {
      id: 'gin:default-binding-dispatch',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'In Gin, which function in the binding package maps an HTTP method and Content-Type header to the right Binding implementation (JSON, XML, Form, ProtoBuf, MsgPack, YAML, TOML, …)? Name the file and the function.',
      expectedFiles: ['binding/binding.go'],
      expectedSymbols: ['Default'],
      expectedFacts: ['binding/binding.go', 'Default', 'Content-Type'],
      expectedLineRanges: { 'binding/binding.go': [[93, 120]] },
    },
    {
      id: 'gin:error-type-flags',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'Where does Gin define the ErrorType bitmask constants (ErrorTypeBind, ErrorTypeRender, ErrorTypePrivate, ErrorTypePublic, ErrorTypeAny)? Identify the file and the underlying integer type.',
      expectedFiles: ['errors.go'],
      expectedSymbols: ['ErrorType'],
      expectedFacts: ['errors.go', 'ErrorType', 'ErrorTypeBind', 'uint64'],
      expectedLineRanges: { 'errors.go': [[15, 29]] },
    },

    // ── 3 structural additions ──────────────────────────────────────────────
    {
      id: 'gin:router-group-struct',
      // RouterGroup is the struct embedded in Engine that holds the prefix +
      // middleware chain; it sits alongside the IRouter / IRoutes interfaces
      // it satisfies. The structural span is the type declarations.
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In Gin, where is the RouterGroup struct declared (the type that carries a path prefix and a HandlersChain), and which interfaces (IRouter, IRoutes) does it satisfy? Cite the file and the line range covering the type declarations.',
      expectedFiles: ['routergroup.go'],
      expectedSymbols: ['RouterGroup', 'IRouter', 'IRoutes'],
      expectedFacts: ['routergroup.go', 'RouterGroup', 'IRouter', 'IRoutes'],
      expectedLineRanges: { 'routergroup.go': [[26, 60]] },
    },
    {
      id: 'gin:handler-func-types',
      taskType: 'large_file',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'In Gin, where are the HandlerFunc and HandlersChain types defined, and what is each one (function signature vs slice type)? Name the file and the line range.',
      expectedFiles: ['gin.go'],
      expectedSymbols: ['HandlerFunc', 'HandlersChain'],
      expectedFacts: ['gin.go', 'HandlerFunc', 'HandlersChain', 'Context'],
      expectedLineRanges: { 'gin.go': [[50, 65]] },
    },
    {
      id: 'gin:response-writer-interface',
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In Gin, where is the ResponseWriter interface declared, and which standard net/http interfaces does it embed? Identify the file and list the embedded interfaces.',
      expectedFiles: ['response_writer.go'],
      expectedSymbols: ['ResponseWriter'],
      expectedFacts: ['response_writer.go', 'ResponseWriter', 'Hijacker', 'Flusher'],
      expectedLineRanges: { 'response_writer.go': [[22, 47]] },
    },

    // ── 2 multi-file-flow additions ─────────────────────────────────────────
    {
      id: 'gin:should-bind-pipeline',
      // Multi-file: c.ShouldBind in context.go calls binding.Default in
      // binding/binding.go to pick the binding engine, then calls Bind on it.
      // Cite both files; either alone is a partial answer.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'Trace what happens when a Gin handler calls c.ShouldBind(&obj). Identify (a) the method on Context that dispatches based on Method + Content-Type, and (b) the function in the binding package that returns the matching Binding implementation. Cite both files.',
      expectedFiles: ['context.go', 'binding/binding.go'],
      expectedSymbols: ['ShouldBind', 'Default'],
      expectedFacts: ['context.go', 'binding/binding.go', 'ShouldBind', 'Default'],
      expectedLineRanges: {
        'context.go': [[838, 841]],
        'binding/binding.go': [[93, 120]],
      },
    },
    {
      id: 'gin:render-pipeline',
      // Multi-file: c.Render in context.go writes status + delegates to a
      // render.Render implementation declared by the interface in
      // render/render.go. Methods like c.JSON / c.HTML / c.XML all funnel
      // through here.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'When you call c.JSON(200, obj) in Gin, the response goes through a generic Render method on Context that delegates to a Render interface. Identify (a) the Context.Render method and its file, and (b) the file where the Render interface is declared and its two methods.',
      expectedFiles: ['context.go', 'render/render.go'],
      expectedSymbols: ['Render'],
      expectedFacts: ['context.go', 'render/render.go', 'Render', 'WriteContentType'],
      expectedLineRanges: {
        'context.go': [[1151, 1166]],
        'render/render.go': [[9, 15]],
      },
    },
  ],
  flask: [
    {
      id: 'flask:route-decorator',
      seedQueryId: 'fl001',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'In Flask, the @app.route("/path") decorator registers view functions to URLs. Which method on the Scaffold class implements the decorator, and where does it live?',
      expectedFiles: ['src/flask/sansio/scaffold.py'],
      expectedSymbols: ['route'],
      expectedFacts: ['scaffold.py', 'route'],
      expectedLineRanges: { 'src/flask/sansio/scaffold.py': [[336, 365]] },
    },
    {
      id: 'flask:app-class',
      seedQueryId: 'fl002',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 8,
      question: 'Where is the main Flask application class defined? Name the file and the class.',
      expectedFiles: ['src/flask/app.py'],
      expectedSymbols: ['Flask'],
      expectedFacts: ['app.py', 'Flask'],
      expectedLineRanges: { 'src/flask/app.py': [[109, 238]] },
    },
    {
      id: 'flask:make-response',
      seedQueryId: 'fl006',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'When a Flask view returns a string, dict, tuple, or iterator, which function converts the return value into a proper Response object? Cite the file and explain the dispatch.',
      expectedFiles: ['src/flask/app.py'],
      expectedSymbols: ['make_response'],
      expectedFacts: ['app.py', 'make_response'],
      expectedLineRanges: { 'src/flask/app.py': [[1224, 1364]] },
    },
    {
      id: 'flask:http-error-dispatch',
      seedQueryId: 'fl008',
      taskType: 'error_handling_path',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'When an HTTPException is raised inside a Flask view, which method dispatches it to the registered error handler? Name the method and file.',
      expectedFiles: ['src/flask/app.py'],
      expectedSymbols: ['handle_http_exception', 'handle_user_exception'],
      expectedFacts: ['app.py', 'handle_http_exception'],
      expectedLineRanges: { 'src/flask/app.py': [[830, 895]] },
    },
    {
      id: 'flask:secure-cookie-session',
      seedQueryId: 'fl007',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'How does Flask sign and serialise the session cookie? Identify the class that implements open_session/save_session and the library it relies on.',
      expectedFiles: ['src/flask/sessions.py'],
      expectedSymbols: ['SecureCookieSessionInterface'],
      expectedFacts: ['sessions.py', 'SecureCookieSessionInterface', 'itsdangerous'],
      expectedLineRanges: { 'src/flask/sessions.py': [[284, 385]] },
    },

    // ── 2 literal-lookup additions ──────────────────────────────────────────
    {
      id: 'flask:jsonify-location',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'In Flask, where is the jsonify() helper function defined? Name the file and the method it ultimately delegates to on the current app.',
      expectedFiles: ['src/flask/json/__init__.py'],
      expectedSymbols: ['jsonify'],
      expectedFacts: ['json/__init__.py', 'jsonify', 'current_app.json.response'],
      expectedLineRanges: { 'src/flask/json/__init__.py': [[138, 170]] },
    },
    {
      id: 'flask:blueprint-class',
      seedQueryId: 'fl012',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 8,
      // The public flask.Blueprint in src/flask/blueprints.py is a thin
      // subclass; the substantive class lives in src/flask/sansio/blueprints.py
      // (extends Scaffold). The expected file is the substantive one.
      question: 'Where is the substantive Flask Blueprint class defined (the one that extends Scaffold and implements register)? Name the file.',
      expectedFiles: ['src/flask/sansio/blueprints.py'],
      expectedSymbols: ['Blueprint'],
      expectedFacts: ['sansio/blueprints.py', 'Blueprint', 'Scaffold'],
      expectedLineRanges: { 'src/flask/sansio/blueprints.py': [[119, 212]] },
    },

    // ── 3 structural additions ──────────────────────────────────────────────
    {
      id: 'flask:request-response-classes',
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In Flask, where are the Request and Response classes defined that wrap the Werkzeug Request/Response? Name the file and both classes.',
      expectedFiles: ['src/flask/wrappers.py'],
      expectedSymbols: ['Request', 'Response'],
      expectedFacts: ['wrappers.py', 'Request', 'Response'],
      expectedLineRanges: { 'src/flask/wrappers.py': [[18, 257]] },
    },
    {
      id: 'flask:config-class',
      seedQueryId: 'fl015',
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'Where is the Flask Config class defined that loads configuration from Python files, environment variables, and JSON/TOML files? Name the file, the base type it extends, and one of its from_* loader methods.',
      expectedFiles: ['src/flask/config.py'],
      expectedSymbols: ['Config'],
      expectedFacts: ['config.py', 'Config', 'dict', 'from_'],
      expectedLineRanges: { 'src/flask/config.py': [[50, 367]] },
    },
    {
      id: 'flask:app-context-class',
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'Where is the AppContext class defined in Flask, and which methods on it activate or release the context (managing the contextvar token)?',
      expectedFiles: ['src/flask/ctx.py'],
      expectedSymbols: ['AppContext'],
      expectedFacts: ['ctx.py', 'AppContext', 'push', 'pop'],
      expectedLineRanges: { 'src/flask/ctx.py': [[260, 504]] },
    },

    // ── 2 multi-file-flow additions ─────────────────────────────────────────
    {
      id: 'flask:wsgi-dispatch-flow',
      seedQueryId: 'fl009',
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'Trace what happens when a WSGI server invokes a Flask application for an incoming request. Identify (a) the method in app.py that builds the request context and runs full dispatch, and (b) the method on AppContext in ctx.py that activates the context (sets the contextvar and matches the URL). Cite both files.',
      expectedFiles: ['src/flask/app.py', 'src/flask/ctx.py'],
      expectedSymbols: ['wsgi_app', 'push'],
      expectedFacts: ['wsgi_app', 'app.py', 'ctx.py', 'push'],
      expectedLineRanges: {
        'src/flask/app.py': [[1566, 1617]],
        'src/flask/ctx.py': [[416, 444]],
      },
    },
    {
      id: 'flask:blueprint-registration-flow',
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'When you call app.register_blueprint(bp) in Flask, the registration crosses two files. Identify (a) App.register_blueprint in sansio/app.py that delegates to the blueprint, and (b) Blueprint.register in sansio/blueprints.py that creates a BlueprintSetupState and runs the deferred functions. Cite both files.',
      expectedFiles: ['src/flask/sansio/app.py', 'src/flask/sansio/blueprints.py'],
      expectedSymbols: ['register_blueprint', 'register'],
      expectedFacts: ['register_blueprint', 'BlueprintSetupState', 'sansio/app.py', 'sansio/blueprints.py'],
      expectedLineRanges: {
        'src/flask/sansio/app.py': [[567, 592]],
        'src/flask/sansio/blueprints.py': [[273, 377]],
      },
    },
  ],
  ripgrep: [
    {
      id: 'ripgrep:search-config-struct',
      seedQueryId: 'rg001',
      taskType: 'config_lookup',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'In ripgrep, where is the per-search-worker Config struct defined that controls preprocessor and binary-detection behaviour? File and line range.',
      expectedFiles: ['crates/core/search.rs'],
      expectedSymbols: ['Config'],
      expectedFacts: ['search.rs', 'Config'],
      expectedLineRanges: { 'crates/core/search.rs': [[19, 25]] },
    },
    {
      id: 'ripgrep:parallel-search',
      seedQueryId: 'rg002',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'Which top-level function in ripgrep orchestrates multi-threaded directory search and uses an AtomicBool to track whether any match was found?',
      expectedFiles: ['crates/core/main.rs'],
      expectedSymbols: ['search_parallel'],
      expectedFacts: ['main.rs', 'search_parallel', 'AtomicBool'],
      expectedLineRanges: { 'crates/core/main.rs': [[160, 229]] },
    },
    {
      id: 'ripgrep:sink-trait',
      seedQueryId: 'rg003',
      taskType: 'function_behavior',
      difficulty: 'hard',
      maxTurns: 12,
      question: 'ripgrep uses a push-model "Sink" trait to receive search results. Where is the Sink trait defined and what are its main callbacks?',
      expectedFiles: ['crates/searcher/src/sink.rs'],
      expectedSymbols: ['Sink'],
      expectedFacts: ['sink.rs', 'Sink', 'matched'],
      expectedLineRanges: { 'crates/searcher/src/sink.rs': [[102, 223]] },
    },
    {
      id: 'ripgrep:locate-line-bounds',
      seedQueryId: 'rg005',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'Which function in ripgrep\'s searcher locates the start/end byte offsets of the line(s) containing a match range? Cite the file and the function name.',
      expectedFiles: ['crates/searcher/src/lines.rs'],
      expectedSymbols: ['locate'],
      expectedFacts: ['lines.rs', 'locate'],
      expectedLineRanges: { 'crates/searcher/src/lines.rs': [[134, 147]] },
    },
    {
      id: 'ripgrep:regex-error-kinds',
      seedQueryId: 'rg008',
      taskType: 'error_handling_path',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'In the ripgrep regex crate, which enum lists the different kinds of regex compile errors, and what are its main variants?',
      expectedFiles: ['crates/regex/src/error.rs'],
      expectedSymbols: ['ErrorKind'],
      expectedFacts: ['error.rs', 'ErrorKind', 'NotAllowed'],
      expectedLineRanges: { 'crates/regex/src/error.rs': [[42, 65]] },
    },

    // ── 2 literal-lookup additions ────────────────────────────────────────
    {
      id: 'ripgrep:glob-struct-fields',
      taskType: 'config_lookup',
      difficulty: 'easy',
      maxTurns: 6,
      question: 'In the globset crate, where is the public Glob struct defined that represents a parsed shell glob pattern, and what fields does it carry?',
      expectedFiles: ['crates/globset/src/glob.rs'],
      expectedSymbols: ['Glob'],
      expectedFacts: ['glob.rs', 'Glob', 'tokens'],
      expectedLineRanges: { 'crates/globset/src/glob.rs': [[70, 81]] },
    },
    {
      id: 'ripgrep:override-set-type',
      taskType: 'config_lookup',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In the ignore crate, which type wraps a set of user-supplied --glob overrides, and which builder type is used to assemble it before calling build()? Cite the file.',
      expectedFiles: ['crates/ignore/src/overrides.rs'],
      expectedSymbols: ['Override', 'OverrideBuilder'],
      expectedFacts: ['overrides.rs', 'Override', 'OverrideBuilder'],
      expectedLineRanges: { 'crates/ignore/src/overrides.rs': [[45, 145]] },
    },

    // ── 3 structural (large-file navigation) ──────────────────────────────
    {
      id: 'ripgrep:searcher-internal-config',
      // searcher/src/searcher/mod.rs is 1088 lines and contains *several*
      // top-level structs (BinaryDetection, Encoding, Config, ConfigError,
      // SearcherBuilder, Searcher). The Config struct sits buried in the
      // middle and has ~14 fields that gate searcher behaviour
      // (line_term, invert_match, before/after_context, mmap, multi_line, …).
      // Locating the *right* Config (not the search.rs one) is the test.
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In the grep-searcher crate (crates/searcher/src/searcher/mod.rs), where is the private Config struct that holds settings like line_term, before_context, after_context, mmap, multi_line and max_matches? Give the line range.',
      expectedFiles: ['crates/searcher/src/searcher/mod.rs'],
      expectedSymbols: ['Config'],
      expectedFacts: ['searcher/mod.rs', 'Config', 'line_term', 'multi_line'],
      expectedLineRanges: { 'crates/searcher/src/searcher/mod.rs': [[149, 205]] },
    },
    {
      id: 'ripgrep:standard-printer-builder-config',
      // crates/printer/src/standard.rs is 3987 lines. The user-facing
      // builder/config sit in the first ~200 lines, but Standard, StandardSink
      // and StandardImpl trail across thousands of lines. Asking for the
      // builder + private Config that holds heading/colors/path/separator_*
      // tests file-shape navigation, not deep behaviour.
      taskType: 'large_file',
      difficulty: 'medium',
      maxTurns: 8,
      question: 'In ripgrep\'s printer crate, where is the StandardBuilder that configures the grep-like output printer, and where is the private Config struct it wraps (with fields like heading, colors, path, separator_*, max_columns)? Cite the file and the line ranges.',
      expectedFiles: ['crates/printer/src/standard.rs'],
      expectedSymbols: ['StandardBuilder', 'Config'],
      expectedFacts: ['standard.rs', 'StandardBuilder', 'heading', 'colors'],
      expectedLineRanges: { 'crates/printer/src/standard.rs': [[35, 107]] },
    },
    {
      id: 'ripgrep:matcher-trait-and-regex-impl',
      // Multi-file: the Matcher trait is declared in
      // crates/matcher/src/lib.rs (line ~546), but its principal in-tree
      // implementation — the one used by ripgrep when --pcre2 is off — is
      // `impl Matcher for RegexMatcher` at crates/regex/src/matcher.rs:409.
      // A correct answer must cite both files.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'In ripgrep, the Matcher trait is the abstraction every search backend implements. Identify (a) the file where the Matcher trait itself is declared, and (b) the file where its primary implementation `impl Matcher for RegexMatcher` lives (the one used by ripgrep\'s default regex backend). Cite both files.',
      expectedFiles: ['crates/matcher/src/lib.rs', 'crates/regex/src/matcher.rs'],
      expectedSymbols: ['Matcher', 'RegexMatcher'],
      expectedFacts: ['matcher/src/lib.rs', 'regex/src/matcher.rs', 'Matcher', 'RegexMatcher'],
      expectedLineRanges: {
        'crates/matcher/src/lib.rs': [[546, 600]],
        'crates/regex/src/matcher.rs': [[409, 440]],
      },
    },

    // ── 2 multi-file-flow additions ───────────────────────────────────────
    {
      id: 'ripgrep:walk-parallel-thread-spawn',
      // The parallel-walk story spans three concrete types in ignore/walk.rs:
      // WalkBuilder (configures), WalkParallel (orchestrates std::thread::scope
      // spawn), and Worker (the per-thread loop). All three live in walk.rs
      // but they're far apart in a 2494-line file (lines 483, 1314, 1590) so
      // citing the chain forces multi-span navigation. We treat this as
      // multi-file-flow per §7.3 because a correct answer must trace from
      // the public builder API into the private Worker run loop.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'Trace ripgrep\'s parallel directory walk: which builder type configures it, which type orchestrates the std::thread::scope spawning, and which private struct represents the per-thread worker loop? Cite the file and the line numbers for all three.',
      expectedFiles: ['crates/ignore/src/walk.rs'],
      expectedSymbols: ['WalkBuilder', 'WalkParallel', 'Worker'],
      expectedFacts: ['walk.rs', 'WalkBuilder', 'WalkParallel', 'Worker'],
      expectedLineRanges: {
        'crates/ignore/src/walk.rs': [[483, 507], [1314, 1440], [1590, 1635]],
      },
    },
    {
      id: 'ripgrep:run-mode-dispatch-to-worker',
      // Cross-file flow: crates/core/main.rs run() dispatches on Mode and
      // args.threads() to either search() or search_parallel(); both functions
      // construct a SearchWorker via args.search_worker(...) and call its
      // .search(haystack) method. The SearchWorker type and its search()
      // method live in crates/core/search.rs. Either citation alone is partial.
      taskType: 'multi_file_flow',
      difficulty: 'hard',
      maxTurns: 10,
      question: 'After CLI parsing in ripgrep, the run() function dispatches on the mode and the requested thread count. Identify (a) the function in crates/core/main.rs that picks between search() and search_parallel() based on threads, and (b) the SearchWorker.search() method in crates/core/search.rs that each haystack is fed through. Cite both files.',
      expectedFiles: ['crates/core/main.rs', 'crates/core/search.rs'],
      expectedSymbols: ['run', 'SearchWorker', 'search'],
      expectedFacts: ['main.rs', 'search.rs', 'SearchWorker', 'search_parallel'],
      expectedLineRanges: {
        'crates/core/main.rs': [[77, 101]],
        'crates/core/search.rs': [[230, 267]],
      },
    },
  ],
};

export function loadTasks(repo, opts = {}) {
  const all = TASKS[repo];
  if (!all) throw new Error(`unknown repo "${repo}". Choices: ${Object.keys(TASKS).join(', ')}`);
  if (opts.onlyId) {
    const t = all.find(x => x.id === opts.onlyId || x.id.endsWith(`:${opts.onlyId}`));
    if (!t) throw new Error(`task "${opts.onlyId}" not found in ${repo}`);
    return [t];
  }
  const max = opts.maxTasks ?? all.length;
  return all.slice(0, max);
}

export function listRepos() {
  return Object.keys(TASKS);
}

export function summarizeTasks(tasks) {
  const byType = {};
  const byDiff = {};
  for (const t of tasks) {
    byType[t.taskType] = (byType[t.taskType] || 0) + 1;
    byDiff[t.difficulty] = (byDiff[t.difficulty] || 0) + 1;
  }
  return { count: tasks.length, byType, byDiff };
}
