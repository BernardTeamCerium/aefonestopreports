// Local preview server: serves public/ and runs the same API code as Netlify,
// storing data in data/local/*.json instead of Netlify Blobs.
//   ADMIN_PASSWORD=... CLIENT_PASSWORD=... npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const dataDir = path.join(root, 'data', 'local');
fs.mkdirSync(dataDir, { recursive: true });

const env = { ...process.env };
const store = {
  async get(key) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, key + '.json'), 'utf8')); } catch { return null; } },
  async set(key, value) { fs.writeFileSync(path.join(dataDir, key + '.json'), JSON.stringify(value, null, 2)); },
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handle(request, { store, env, ip: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
  }
  let file = path.join(pub, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(pub, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`Portal preview on http://localhost:${process.env.PORT || 3000}`));
