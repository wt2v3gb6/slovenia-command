const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeTileHandler, makeDownloadHandler } = require('./tile-proxy.js');
const { handleMp } = require('./mp-relay.js');
const cacheDir = path.join(__dirname, '.tilecache');
const handleTile = makeTileHandler(cacheDir);
const handleDownload = makeDownloadHandler(cacheDir);
const PORT = 8934;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg' };
http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  try { p = decodeURIComponent(p); } catch (e) {} // handle spaces etc. in filenames
  // Co-op multiplayer relay (async). Handles all /mp/* requests.
  if (p.indexOf('/mp/') === 0) { handleMp(req, res, p, { port: PORT, localIp: '127.0.0.1' }); return; }
  if (p.indexOf('/tiles/download/') === 0 && handleDownload(req, res, p)) return; // offline pre-download
  if (p.indexOf('/tiles/') === 0 && handleTile(req, res, p)) return; // local satellite cache
  // Main-menu video list: any file in videos/ whose name contains "MAINMENU".
  if (p === '/videos/list') {
    fs.readdir(path.join(__dirname, 'videos'), (err, files) => {
      const list = (err ? [] : files).filter(f => /mainmenu/i.test(f) && /\.(mp4|webm|ogv)$/i.test(f));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    });
    return;
  }
  if (p === '/') p = '/index.html';
  const fp = path.join(__dirname, p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log('listening on ' + PORT));
