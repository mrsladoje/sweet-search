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
    {
      id: 'gin:html-templates',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'How does Gin load HTML templates? Which methods on Engine accept a glob, an explicit list of files, or an http.FileSystem, and where are they defined?',
      expectedFiles: ['gin.go'],
      expectedSymbols: ['LoadHTMLGlob', 'LoadHTMLFiles', 'LoadHTMLFS'],
      expectedFacts: ['gin.go', 'LoadHTMLGlob', 'LoadHTMLFiles'],
      expectedLineRanges: { 'gin.go': [[272, 312]] },
    },
    {
      id: 'gin:tls-server',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'Which Gin method starts an HTTPS server given a cert and key file, and which standard library function does it ultimately call?',
      expectedFiles: ['gin.go'],
      expectedSymbols: ['RunTLS'],
      expectedFacts: ['gin.go', 'RunTLS', 'ListenAndServeTLS'],
      expectedLineRanges: { 'gin.go': [[559, 577]] },
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
    {
      id: 'flask:stream-with-context',
      taskType: 'function_behavior',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'Which Flask helper wraps a generator so that flask.request, flask.session, and flask.g are still accessible inside the generator after the request context normally ends? Identify the file and the function.',
      expectedFiles: ['src/flask/helpers.py'],
      expectedSymbols: ['stream_with_context'],
      expectedFacts: ['helpers.py', 'stream_with_context'],
      expectedLineRanges: { 'src/flask/helpers.py': [[63, 149]] },
    },
    {
      id: 'flask:url-for',
      taskType: 'function_behavior',
      difficulty: 'easy',
      maxTurns: 8,
      question: 'Where is the top-level Flask url_for helper defined that delegates to current_app.url_for? Cite the file and the function signature.',
      expectedFiles: ['src/flask/helpers.py'],
      expectedSymbols: ['url_for'],
      expectedFacts: ['helpers.py', 'url_for', 'current_app'],
      expectedLineRanges: { 'src/flask/helpers.py': [[200, 254]] },
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
    {
      id: 'ripgrep:printer-path',
      taskType: 'config_lookup',
      difficulty: 'medium',
      maxTurns: 10,
      question: 'In ripgrep\'s printer crate, which struct wraps a Path so the printer can render it (with hyperlinks and an optional separator override)? Cite the file and the struct name.',
      expectedFiles: ['crates/printer/src/util.rs'],
      expectedSymbols: ['PrinterPath'],
      expectedFacts: ['util.rs', 'PrinterPath', 'hyperlink'],
      expectedLineRanges: { 'crates/printer/src/util.rs': [[283, 310]] },
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
