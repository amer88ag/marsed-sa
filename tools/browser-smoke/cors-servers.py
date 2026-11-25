"""Two real HTTP servers on different origins, so Chrome enforces CORS natively
(Playwright route.fulfill bypasses CORS and cannot test it).

  site  : http://127.0.0.1:8801  serves the repository read-only. TEST-ONLY change:
          the GIBS base URL in nasa-gibs.js is pointed at the tile server below.
  tiles : http://127.0.0.1:8802  synthetic GIBS: DescribeDomains XML + tiles with
          known content and per-layer CORS headers.
"""
import http.server, os, sys, threading, json
REPO = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
TILES = json.load(open(os.path.join(HERE, 'tiles', 'manifest.json')))
REAL_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
TEST_BASE = 'http://127.0.0.1:8802/wmts/epsg3857/best/'
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.geojson': 'application/json', '.css': 'text/css'}

class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        rel = self.path.split('?')[0].lstrip('/') or 'index.html'
        path = os.path.realpath(os.path.join(REPO, rel))
        if not path.startswith(os.path.realpath(REPO)) or not os.path.isfile(path):
            self.send_response(404); self.end_headers(); return
        body = open(path, 'rb').read()
        if rel == 'src/services/satellite/nasa-gibs.js':
            assert body.count(REAL_BASE.encode()) == 1
            body = body.replace(REAL_BASE.encode(), TEST_BASE.encode())
        self.send_response(200); self.send_header('Content-Type', TYPES.get(os.path.splitext(path)[1], 'application/octet-stream')); self.end_headers(); self.wfile.write(body)

class Tiles(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if 'wmts.cgi' in self.path:
            body = b'<Domains><DimensionDomain><Domain>2026-01-01/2026-11-23/P1D</Domain></DimensionDomain></Domains>'
            self.send_response(200); self.send_header('Content-Type', 'text/xml'); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(body); return
        layer = next((k for k in TILES if '/' + k + '/' in self.path), None)
        if not layer:
            self.send_response(404); self.end_headers(); return
        spec = TILES[layer]
        body = open(os.path.join(HERE, 'tiles', spec['file']), 'rb').read()
        self.send_response(200); self.send_header('Content-Type', 'image/png')
        if spec['cors']: self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers(); self.wfile.write(body)

for port, handler in ((8801, Site), (8802, Tiles)):
    threading.Thread(target=http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever, daemon=True).start()
print('ready', flush=True)
threading.Event().wait()
