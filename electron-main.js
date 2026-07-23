// Electron entry point for Slovenia Command.
// The game is a static web app that fetches its data over HTTP (fetch() of
// file:// URLs is blocked), so we spin up a tiny local HTTP server on a free
// port and load it in a native BrowserWindow. Reading from __dirname works both
// when running from source and from inside the packaged app.asar archive.
const { app, BrowserWindow, Menu, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeTileHandler, makeDownloadHandler } = require("./tile-proxy.js");
const { handleMp } = require("./mp-relay.js");

// Preferred (forwardable) port for co-op hosting. The player forwards THIS port
// on their router; joiners reach the game at <public-ip>:<port>. Falls back to
// the next few ports if it's already taken.
const HOST_PORT = 8934;
function firstLanIp() {
  const ifs = os.networkInterfaces();
  for (const name in ifs) {
    for (const ni of ifs[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "127.0.0.1";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const ROOT = __dirname;
// Satellite tiles are cached to the user's writable app-data folder (the app
// itself lives in a read-only asar), so the map downloads once and reuses disk.
const tileCacheDir = path.join(app.getPath("userData"), "tilecache");
const handleTile = makeTileHandler(tileCacheDir);
const handleDownload = makeDownloadHandler(tileCacheDir);

let serverPort = HOST_PORT;
const localIp = firstLanIp();

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let rel = decodeURIComponent(req.url.split("?")[0]);
        // Co-op multiplayer relay (async). Handles all /mp/* requests.
        if (rel.indexOf("/mp/") === 0) { handleMp(req, res, rel, { port: serverPort, localIp: localIp }); return; }
        if (rel.indexOf("/tiles/download/") === 0 && handleDownload(req, res, rel)) return; // offline pre-download
        if (rel.indexOf("/tiles/") === 0 && handleTile(req, res, rel)) return; // local satellite cache
        // Main-menu video list: any file in videos/ whose name contains "MAINMENU".
        if (rel === "/videos/list") {
          fs.readdir(path.join(ROOT, "videos"), (err, files) => {
            const list = (err ? [] : files).filter((f) => /mainmenu/i.test(f) && /\.(mp4|webm|ogv)$/i.test(f));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(list));
          });
          return;
        }
        if (rel === "/") rel = "/index.html";
        // Normalise and confine to ROOT (no path traversal out of the app).
        const fp = path.normalize(path.join(ROOT, rel));
        if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
        fs.readFile(fp, (err, data) => {
          if (err) { res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500); res.end("error");
      }
    });
    // Bind on all interfaces (0.0.0.0) so a joined player can reach the host
    // over the internet via a forwarded port. Try the forwardable HOST_PORT
    // first, then a few fallbacks if it's already in use.
    let attempt = 0;
    const tryListen = () => {
      const port = HOST_PORT + attempt;
      server.listen(port, "0.0.0.0", () => { serverPort = port; resolve(port); });
    };
    server.on("error", (e) => {
      if (e && e.code === "EADDRINUSE" && attempt < 10) { attempt++; setTimeout(tryListen, 60); }
      else reject(e);
    });
    tryListen();
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    fullscreen: true,
    backgroundColor: "#0a0f14",
    title: "Slovenia Command",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Minimal menu: keep standard shortcuts (copy/paste, fullscreen, devtools)
  // without the default Electron "Help" clutter.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Game",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
  ]));

  // Open any external links (e.g. accidental) in the real browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`http://127.0.0.1:${port}/`);

  setupAutoUpdates(win);
}

// ---- Auto-update (electron-updater + GitHub Releases) ----------------------
// Only runs in the installed app. On launch (and every 30 min) it checks the
// GitHub release feed; a newer version downloads silently in the background,
// and when it's ready the player is asked to restart to finish updating.
function setupAutoUpdates(win) {
  if (!app.isPackaged) return; // no-op when running from source (npm start)
  let autoUpdater;
  try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { return; }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    const { dialog } = require("electron");
    dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Slovenia Command ${info && info.version ? info.version : ""} is ready to install.`,
      detail: "The update has been downloaded. Restart the game to finish updating.",
    }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
  });

  // Update failures must never break the game — just log and carry on.
  autoUpdater.on("error", (err) => { try { console.warn("auto-update:", err && err.message); } catch (e) {} });

  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 30 * 60 * 1000);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
