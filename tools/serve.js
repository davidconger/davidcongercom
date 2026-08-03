/**
 * Minimal static file server for local preview of the site.
 *
 * Usage: node tools/serve.js [root] [port]
 * Mirrors IIS behaviour closely enough for checking pages: directory requests
 * fall back to index.htm, then index.html.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const port = parseInt(process.argv[3] || '8080', 10);

const TYPES = {
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      rel = req.url.split('?')[0];
    }

    let file = path.join(root, rel);
    // Refuse to serve outside the root.
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    try {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        const idx = ['index.htm', 'index.html'].map((n) => path.join(file, n)).find(fs.existsSync);
        if (!idx) {
          res.writeHead(404).end('No index in directory');
          return;
        }
        file = idx;
      }
      if (!fs.existsSync(file)) {
        res.writeHead(404).end('Not found: ' + rel);
        return;
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
