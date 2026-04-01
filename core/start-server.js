#!/usr/bin/env node
// Minimal server-start entry point — avoids the circular import in sweet-search.js.
// Used by the Rust CLI's auto_start_server() to spawn the background server.

import { startServer } from './search/search-server.js';
await startServer();
