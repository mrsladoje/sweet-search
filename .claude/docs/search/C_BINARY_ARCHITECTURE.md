# C Binary Architecture

Documentation of the ss-fast C client and its interaction with the search server.

## Source Files

- **C Client**: `./ss-fast/ss-fast.c`
- **Shell Wrapper**: `./ss.sh`
- **Node.js Server**: `core/sweet-search.js`
  - `grep -n "async function startServer" sweet-search.js` → server entry point

## Architecture Overview

```
User Command
    |
    v
[ss-fast (C binary)] or [ss.sh (bash)]
    |
    | Unix socket connection
    v
/tmp/sweet-search.sock
    |
    v
[sweet-search.js HTTP server]
    |
    v
[SweetSearch class: routing -> lexical/semantic/hybrid]
```

## Component Roles

### ss-fast (C Binary)

**Source**: `ss-fast/ss-fast.c`

**Purpose**: Ultra-fast search client (~2-5ms overhead)

**Key Points**:
- **Does NOT auto-spawn server** (`grep -n "access(SOCKET_PATH" ss-fast.c`)
- Connects directly to Unix socket `/tmp/sweet-search.sock`
- Exits with error if socket doesn't exist
- Full feature parity with Node.js CLI

```c
/* From do_request() - grep "access(SOCKET_PATH" ss-fast.c */
if (access(SOCKET_PATH, F_OK) != 0) {
    fprintf(stderr, FA "Error:" R " Socket %s not found\n", SOCKET_PATH);
    fprintf(stderr, "Start server: node sweet-search.js --serve\n");
    return 1;
}
```

**Compilation** (`grep -n "gcc" ss-fast.c` comment or Makefile):
```bash
gcc -O3 -march=native -flto -s -o ss ss-fast.c
```

### ss.sh (Shell Wrapper)

**Source**: `ss.sh`

**Purpose**: Convenience wrapper with auto-start capability

**Key Points**:
- **CAN auto-spawn server** (`grep -n "nohup node" ss.sh`)
- Uses netcat (`nc`) for socket communication
- Polls for socket availability (100ms intervals, max 5s)

```bash
# Auto-start server with fast polling - grep "nohup node" ss.sh
if [[ ! -S "$SOCKET" ]]; then
    nohup node "$(dirname "$0")/sweet-search.js" --serve &>/dev/null &
    for _ in {1..50}; do
        [[ -S "$SOCKET" ]] && break
        sleep 0.1
    done
fi
```

### sweet-search.js (Server)

**Source**: `grep -n "async function startServer" sweet-search.js`

**Purpose**: HTTP server exposing search functionality via Unix socket and TCP

**Key Points**:
- Listens on both Unix socket (`/tmp/sweet-search.sock`) and TCP port 9876
- Pre-loads all indexes on startup (one-time cost)
- Handles search requests, formatting, server control

```javascript
// Server configuration - grep "SEARCH_SERVER_PORT" sweet-search.js
const SEARCH_SERVER_PORT = 9876;
const SEARCH_SERVER_SOCKET = '/tmp/sweet-search.sock';
const SEARCH_SERVER_PIDFILE = '/tmp/sweet-search-server.pid';
```

## ss-fast.c Implementation Details

### Options Structure (`grep -n "typedef struct" ss-fast.c`)

```c
typedef struct {
    const char *query;
    const char *mode;        // "auto", "lexical", "semantic", "hybrid"
    const char *fusion;      // "cc" or "rrf"
    int top_k;
    int summary;             // HCGS summary-first mode
    int mid;                 // Middle-res view
    int json;
    int no_expand;           // Disable graph expansion
    int no_rerank;           // Disable reranking
    int no_colbert;          // Disable ColBERT
    int stop;                // Stop server
    int verbose;
    int help;
} Options;
```

### URL Building (`grep -n "build_url" ss-fast.c`)

```c
static char *build_url(const Options *opts, char *buffer, size_t bufsize) {
    char *encoded_query = url_encode(opts->query);

    // Base URL
    int len = snprintf(buffer, bufsize, "/search?q=%s&k=%d&format=%s",
                       encoded_query, opts->top_k,
                       opts->json ? "json" : "text");

    // Conditional parameters
    if (strcmp(opts->mode, "auto") != 0)
        len += snprintf(buffer + len, bufsize - len, "&mode=%s", opts->mode);
    if (opts->summary)
        len += snprintf(buffer + len, bufsize - len, "&summary=true");
    if (opts->mid)
        len += snprintf(buffer + len, bufsize - len, "&mid=true");
    if (opts->no_expand)
        len += snprintf(buffer + len, bufsize - len, "&expand=false");
    if (opts->no_rerank)
        len += snprintf(buffer + len, bufsize - len, "&rerank=false");
    if (opts->no_colbert)
        len += snprintf(buffer + len, bufsize - len, "&colbert=false");

    return buffer;
}
```

### Socket Communication (`grep -n "do_request" ss-fast.c`)

```c
static int do_request(const char *path, int print_header_flag, const char *query) {
    // 1. Check socket exists
    if (access(SOCKET_PATH, F_OK) != 0) {
        fprintf(stderr, "Error: Socket not found\n");
        return 1;
    }

    // 2. Create and connect socket
    int sock_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un addr;
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);
    connect(sock_fd, (struct sockaddr *)&addr, sizeof(addr));

    // 3. Send HTTP/1.0 request
    snprintf(request, sizeof(request),
        "GET %s HTTP/1.0\r\nHost: l\r\n\r\n", path);
    write(sock_fd, request, n);

    // 4. Read response, skip headers, stream body to stdout
    while ((n = read(sock_fd, buffer, sizeof(buffer) - 1)) > 0) {
        if (!headers_done) {
            body_start = strstr(buffer, "\r\n\r\n");
            if (body_start) {
                headers_done = 1;
                fwrite(body_start + 4, ...);
            }
        } else {
            fwrite(buffer, ...);
        }
    }

    close(sock_fd);
    return 0;
}
```

## Server API Endpoints

**Source**: `grep -n "handleRequest" sweet-search.js`

### GET /search

Query parameters:
| Parameter | Default | Description |
|-----------|---------|-------------|
| q | (required) | Search query |
| k | 10 | Number of results |
| mode | auto | `auto`, `lexical`, `semantic`, `hybrid` |
| format | json | `json` or `text` |
| expand | true | Graph expansion |
| rerank | true | Reranking |
| fusion | cc | `cc` or `rrf` |
| colbert | (config) | ColBERT late interaction |
| summary | false | HCGS summary-first |
| mid | false | Middle-res view |

### GET /health

Returns: `{"status": "ok", "warm": true}`

### GET /stop

Gracefully shuts down both TCP and Unix socket servers.

## Server Startup

**Source**: `startServer()` function (`grep -n "async function startServer" sweet-search.js`)

```javascript
async function startServer() {
  // 1. Initialize SweetSearch with all indexes
  const searcher = new SweetSearch({ verbose: false });
  await searcher.init();  // ~400ms, loads HNSW, graph, etc.

  // 2. Write PID file
  await fs.writeFile(SEARCH_SERVER_PIDFILE, process.pid.toString());

  // 3. Create TCP server (port 9876)
  const tcpServer = http.createServer(handleRequest);
  tcpServer.listen(SEARCH_SERVER_PORT);

  // 4. Create Unix socket server (/tmp/sweet-search.sock)
  const unixServer = http.createServer(handleRequest);
  await fs.unlink(SEARCH_SERVER_SOCKET);  // Remove stale socket
  unixServer.listen(SEARCH_SERVER_SOCKET);
}
```

**Performance Note** (source code comment):
> Unix socket server: 30-50% faster than TCP

## Auto-Spawn in Node.js CLI

**Source**: `autoSpawnServer()` function (`grep -n "async function autoSpawnServer" sweet-search.js`)

The Node.js CLI can auto-spawn the server (unlike ss-fast):

```javascript
async function autoSpawnServer() {
  const child = spawn(process.execPath, [__filename, '--serve'], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(__filename),
  });
  child.unref();

  // Poll for server ready (up to 5 seconds)
  while (waited < 5000) {
    if (await isServerRunning()) {
      return true;
    }
    await sleep(100);
  }
  return false;
}
```

## Performance Numbers

| Component | Latency | Notes |
|-----------|---------|-------|
| ss-fast client overhead | ~2-5ms | **Target** (source comment) |
| ss.sh client overhead | ~5-10ms | **Target** (source comment) |
| Server startup | ~400ms | Index loading (one-time) |
| Socket connect | <1ms | Unix socket |
| HTTP parsing | <1ms | Simple GET |

**Note**: Latency numbers are **targets** from source code comments. Actual performance depends on system load and hardware.

## CLI Usage

### ss-fast

```bash
# Basic search
./ss "AuthService"

# With options
./ss "how does auth work" -k 5 -m semantic -s
./ss "EmployeeService" --summary --no-rerank

# Stop server
./ss --stop

# Help
./ss --help
```

### ss.sh

```bash
# Basic search (auto-starts server if needed)
./ss.sh "AuthService"

# With top_k
./ss.sh "AuthService" 20
```

## File Locations

| File | Path |
|------|------|
| C binary source | `./ss-fast/ss-fast.c` |
| Compiled binary | `./ss-fast/ss` (after compile) |
| Shell wrapper | `./ss.sh` |
| Symlink (recommended) | `./ss` -> `ss-fast/ss` or `ss.sh` |
| Server | `core/sweet-search.js` |
| Unix socket | `/tmp/sweet-search.sock` |
| PID file | `/tmp/sweet-search-server.pid` |

## Key Differences: ss-fast vs ss.sh

| Feature | ss-fast (C) | ss.sh (Bash) |
|---------|-------------|--------------|
| Auto-spawn server | No | Yes |
| All CLI options | Yes | No (only query + k) |
| Startup overhead | ~2-5ms | ~5-10ms |
| Dependencies | libc | bash, nc |
| Format output | Yes | Yes |
| JSON output | Yes | No |
