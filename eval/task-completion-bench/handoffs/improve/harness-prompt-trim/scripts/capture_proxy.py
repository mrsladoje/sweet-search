import http.server, json, sys, os
OUT=sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); body=self.rfile.read(n)
        i=len([f for f in os.listdir(OUT) if f.startswith('req')])
        open(f"{OUT}/req{i:02d}{self.path.replace('/','_')[:40]}.json","wb").write(body)
        self.send_response(400); self.send_header('content-type','application/json'); self.end_headers()
        self.wfile.write(b'{"type":"error","error":{"type":"invalid_request_error","message":"capture only"}}')
    def do_GET(self):
        self.send_response(404); self.end_headers()
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()
