#!/usr/bin/env python3
"""$0 scripted fake Anthropic Messages API (streaming). Saves every request body.
Main session, first turn -> one Agent tool call (general-purpose). Any request whose
system text says "working as a subagent", or that already carries a tool_result -> a
short text answer. Usage: fake_model.py PORT OUTDIR"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT, OUT = int(sys.argv[1]), sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def sse(ev, data):
    return f"event: {ev}\ndata: {json.dumps(data)}\n\n".encode()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        n = len([f for f in os.listdir(OUT) if f.startswith('req')])
        with open(os.path.join(OUT, f"req{n:02d}.json"), 'wb') as f:
            f.write(body)
        if 'count_tokens' in self.path:
            self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers()
            self.wfile.write(b'{"input_tokens": 10}'); return
        try:
            req = json.loads(body)
        except Exception:
            req = {}
        text = json.dumps(req)
        is_sub = 'working as a subagent' in json.dumps(req.get('system', ''))
        has_result = '"tool_result"' in text
        has_agent_tool = any(t.get('name') == 'Agent' for t in req.get('tools', []))
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        w = self.wfile.write
        msg = {"id": f"msg_{n}", "type": "message", "role": "assistant", "model": req.get('model', 'x'),
               "content": [], "stop_reason": None, "stop_sequence": None,
               "usage": {"input_tokens": 10, "output_tokens": 1}}
        w(sse('message_start', {"type": "message_start", "message": msg}))
        if not is_sub and not has_result and has_agent_tool:
            w(sse('content_block_start', {"type": "content_block_start", "index": 0, "content_block":
                  {"type": "tool_use", "id": "toolu_fake1", "name": "Agent", "input": {}}}))
            inp = json.dumps({"description": "probe", "prompt": "Say hello and stop.", "subagent_type": "general-purpose"})
            w(sse('content_block_delta', {"type": "content_block_delta", "index": 0,
                  "delta": {"type": "input_json_delta", "partial_json": inp}}))
            w(sse('content_block_stop', {"type": "content_block_stop", "index": 0}))
            stop = 'tool_use'
        else:
            w(sse('content_block_start', {"type": "content_block_start", "index": 0,
                  "content_block": {"type": "text", "text": ""}}))
            w(sse('content_block_delta', {"type": "content_block_delta", "index": 0,
                  "delta": {"type": "text_delta", "text": "done"}}))
            w(sse('content_block_stop', {"type": "content_block_stop", "index": 0}))
            stop = 'end_turn'
        w(sse('message_delta', {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
              "usage": {"output_tokens": 5}}))
        w(sse('message_stop', {"type": "message_stop"}))


HTTPServer(('127.0.0.1', PORT), H).serve_forever()
