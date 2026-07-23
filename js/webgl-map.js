// ============================================================================
// WebGLTileMap — a from-scratch, GPU-accelerated 2D satellite tile renderer.
//
// Single <canvas> + WebGL, no DOM tiles, no Leaflet. Streams Web-Mercator tiles
// from the LOCAL cache (tiles/imagery/{z}/{y}/{x} served by tile-proxy.js), so
// once the offline pack is downloaded it renders all of Europe with no network.
//
// Design goals met here:
//  • Never loads the whole map — only viewport tiles (+ margin) are fetched.
//  • LRU GPU-texture cache; distant textures are released automatically.
//  • Tiles decode in a background Web Worker (createImageBitmap) — no main-thread
//    jank during pan/zoom.
//  • Frustum culling: only tiles overlapping the viewport are drawn.
//  • Image pyramid = the zoom levels themselves; a coarser parent tile is drawn
//    underneath while a tile streams in, so zoom never "pops" to blank.
//  • Smooth, eased zoom-to-cursor and inertial-free continuous pan.
//  • Predictive prefetch along the camera velocity vector.
//  • Public API: getVisibleTiles, loadTile, unloadTile, prefetchTiles,
//    worldToTile, tileToWorld, screenToWorld, worldToScreen.
//  • An `onOverlay(gl, engine)` hook runs after tiles each frame, so borders /
//    roads / units / weather can be layered later without touching this core.
//
// Not included (documented as the next optimization): GPU-compressed textures
// (KTX2 / Basis / BC7 / ASTC). Those need the tiles transcoded to KTX2 offline
// and a transcoder; the upload path in `_uploadTexture` is the single place that
// would change. RGBA8 from JPEG is used here.
// ============================================================================

(function (global) {
  "use strict";

  const TILE_SIZE = 256; // native size of the cached Esri tiles

  // ---- Web Mercator: lon/lat <-> normalized world [0,1] (y increases south) --
  function lonToWorldX(lon) { return (lon + 180) / 360; }
  function latToWorldY(lat) {
    const s = Math.sin(lat * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function worldXToLon(x) { return x * 360 - 180; }
  function worldYToLat(y) {
    const n = Math.PI * (1 - 2 * y);
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
  }

  class WebGLTileMap {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      // Default tile source depends on how the page is loaded:
      //  • served over http (through the game's local server) -> the local
      //    caching proxy, which works offline once the pack is downloaded;
      //  • opened as a raw file:// (no server) -> fetch Esri directly so the
      //    page still shows a map when online.
      const DIRECT_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      const isFile = (typeof location !== "undefined" && location.protocol === "file:");
      this.tileUrl = opts.tileUrl || (isFile ? DIRECT_ESRI : "tiles/imagery/{z}/{y}/{x}");
      // Cross-origin tiles (Esri) must be CORS-approved to become GL textures.
      this.crossOrigin = opts.crossOrigin !== undefined ? opts.crossOrigin : "anonymous";
      this.minZoom = opts.minZoom != null ? opts.minZoom : 2;
      // Native Esri imagery goes to z19; the camera keeps zooming past that (up to
      // maxZoom), sampling/scaling the z19 tile so it never blanks out.
      this.maxNativeZoom = opts.maxNativeZoom != null ? opts.maxNativeZoom : 19;
      this.maxZoom = opts.maxZoom != null ? opts.maxZoom : 21;
      this.margin = opts.margin != null ? opts.margin : 1;   // preload ring of tiles
      this.maxTextures = opts.maxTextures || 900;             // LRU cap (GPU memory)
      this.onOverlay = opts.onOverlay || null;                // future overlays hook
      // Optional veto on left-drag panning, so the host can claim the drag for
      // its own tools (route drawing, road building) without the map sliding.
      this.canPan = opts.canPan || null;
      // Embedded mode: the engine doesn't own the camera or a continuous loop —
      // an external owner (e.g. Leaflet) calls syncView() and we render on demand.
      this.embedded = !!opts.embedded;
      this.controls = opts.controls !== false && !this.embedded;
      // Device-pixel scale so an embedded map aligns with a CSS-pixel host's zoom.
      this._pxScale = opts.pxScale || 1;
      this._pendingRender = 0;

      // Camera in normalized-world coords; zoom is fractional.
      const c = opts.center || [46.05, 14.5]; // Slovenia
      this.cx = lonToWorldX(c[1]); this.cy = latToWorldY(c[0]);
      this.zoom = opts.zoom != null ? opts.zoom : 8;
      // Targets the camera eases toward each frame (smoothness).
      this.tCx = this.cx; this.tCy = this.cy; this.tZoom = this.zoom;
      this.vx = 0; this.vy = 0; // camera velocity (world units/frame) for prefetch

      this.tiles = new Map();   // key "z/x/y" -> { tex, bitmap, state, lastUsed }
      this.pending = new Set();
      this._lru = 0;
      this.fps = 0; this._frames = 0; this._fpsT = performance.now();
      this.stats = { drawn: 0, loaded: 0, pending: 0, textures: 0 };

      this._initGL();
      if (this.controls) this._initInput();
      if (this.embedded) {
        this._render(); // draw once now; further renders come from syncView / tile loads
      } else {
        this._raf = this._frame.bind(this);
        requestAnimationFrame(this._raf);
      }
    }

    // Point the camera at a lon/lat + zoom from an external owner (Leaflet), and
    // schedule one render. pxScale keeps device pixels aligned with CSS zoom.
    syncView(lng, lat, zoom, pxScale) {
      const wp = this.lonLatToWorld(lng, lat);
      this.cx = this.tCx = wp[0];
      this.cy = this.tCy = wp[1];
      this.zoom = this.tZoom = zoom;
      if (pxScale != null) this._pxScale = pxScale;
      this._scheduleRender();
    }
    _scheduleRender() {
      if (this._pendingRender) return;
      this._pendingRender = requestAnimationFrame(() => { this._pendingRender = 0; this._render(); });
    }

    // ---------------- WebGL setup ----------------
    _initGL() {
      const o = { antialias: false, depth: false, premultipliedAlpha: false };
      const gl = this.canvas.getContext("webgl", o) || this.canvas.getContext("experimental-webgl", o) || this.canvas.getContext("webgl2", o);
      if (!gl) throw new Error("WebGL is not available on this device/GPU.");
      this.gl = gl;
      const vs = `attribute vec2 a; uniform vec4 uRect; uniform vec4 uUV; varying vec2 v;
        void main(){ v = uUV.xy + a * uUV.zw; vec2 ndc = uRect.xy + a * uRect.zw; gl_Position = vec4(ndc,0.0,1.0); }`;
      const fs = `precision mediump float; uniform sampler2D t; uniform float uA; varying vec2 v;
        void main(){ vec4 c = texture2D(t, v); gl_FragColor = vec4(c.rgb, c.a*uA); }`;
      const prog = this._program(vs, fs);
      this.prog = prog;
      this.aLoc = gl.getAttribLocation(prog, "a");
      this.uRect = gl.getUniformLocation(prog, "uRect");
      this.uUV = gl.getUniformLocation(prog, "uUV");
      this.uA = gl.getUniformLocation(prog, "uA");
      this.uT = gl.getUniformLocation(prog, "t");
      // Unit quad (two triangles) reused for every tile — 1 static buffer.
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.04, 0.06, 0.08, 1);
    }
    _program(vsrc, fsrc) {
      const gl = this.gl;
      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vsrc));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    // ---------------- Coordinate APIs ----------------
    get scale() { return TILE_SIZE * Math.pow(2, this.zoom) * this._pxScale; } // device px per world unit
    worldToScreen(wx, wy) { const s = this.scale; return [(wx - this.cx) * s + this.canvas.width / 2, (wy - this.cy) * s + this.canvas.height / 2]; }
    screenToWorld(sx, sy) { const s = this.scale; return [this.cx + (sx - this.canvas.width / 2) / s, this.cy + (sy - this.canvas.height / 2) / s]; }
    worldToTile(wx, wy, z) { const n = Math.pow(2, z); return [Math.floor(wx * n), Math.floor(wy * n)]; }
    tileToWorld(tx, ty, z) { const n = Math.pow(2, z); return [tx / n, ty / n]; }
    lonLatToWorld(lon, lat) { return [lonToWorldX(lon), latToWorldY(lat)]; }
    worldToLonLat(wx, wy) { return [worldXToLon(wx), worldYToLat(wy)]; }

    // ---------------- Visible tiles (frustum cull + margin) ----------------
    getVisibleTiles() {
      // Pick tiles at the nearest available (native) level; when the camera is
      // zoomed past it, those tiles simply render larger (upscaled).
      const z = Math.max(this.minZoom, Math.min(this.maxNativeZoom, Math.round(this.zoom)));
      const n = Math.pow(2, z);
      const tl = this.screenToWorld(0, 0);
      const br = this.screenToWorld(this.canvas.width, this.canvas.height);
      const x0 = Math.max(0, Math.floor(tl[0] * n) - this.margin);
      const x1 = Math.min(n - 1, Math.floor(br[0] * n) + this.margin);
      const y0 = Math.max(0, Math.floor(tl[1] * n) - this.margin);
      const y1 = Math.min(n - 1, Math.floor(br[1] * n) + this.margin);
      const out = [];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ z, x: tx, y: ty });
      return out;
    }

    // ---------------- Tile loading / LRU / eviction ----------------
    _key(z, x, y) { return z + "/" + x + "/" + y; }
    loadTile(z, x, y) {
      const key = this._key(z, x, y);
      let t = this.tiles.get(key);
      if (t) { t.lastUsed = ++this._lru; return t; }
      t = { z, x, y, tex: null, img: null, state: "loading", lastUsed: ++this._lru };
      this.tiles.set(key, t);
      // Load as a plain Image — same path Leaflet uses, which Chromium always
      // handles (decode happens off the main thread). This is far more robust
      // inside the packaged app than a Blob-worker fetch + createImageBitmap.
      const rel = this.tileUrl.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      const url = new URL(rel, location.href).href;
      const img = new Image();
      if (this.crossOrigin != null) img.crossOrigin = this.crossOrigin; // must be set before src
      img.decoding = "async";
      this.pending.add(key);
      img.onload = () => { const tt = this.tiles.get(key); if (tt) { tt.img = img; tt.state = "ready"; } this.pending.delete(key); if (this.embedded) this._scheduleRender(); };
      img.onerror = () => { const tt = this.tiles.get(key); if (tt) tt.state = "error"; this.pending.delete(key); };
      img.src = url;
      return t;
    }
    unloadTile(key) {
      const t = this.tiles.get(key);
      if (!t) return;
      if (t.tex) this.gl.deleteTexture(t.tex);
      this.tiles.delete(key);
    }
    _evictLRU(keepVisible) {
      if (this.tiles.size <= this.maxTextures) return;
      const arr = [];
      for (const [k, t] of this.tiles) if (!keepVisible.has(k)) arr.push([k, t.lastUsed]);
      arr.sort((a, b) => a[1] - b[1]);
      let toRemove = this.tiles.size - this.maxTextures;
      for (let i = 0; i < arr.length && toRemove > 0; i++) { this.unloadTile(arr[i][0]); toRemove--; }
    }
    _uploadTexture(t) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.img);
      // <-- KTX2/Basis/BC7/ASTC path would replace the line above with
      //     gl.compressedTexImage2D(...) after transcoding the tile offline.
      t.tex = tex;
      t.img = null;
    }

    // Find the nearest already-loaded ancestor tile, for a no-pop fallback.
    _findParent(z, x, y) {
      for (let pz = z - 1; pz >= this.minZoom; pz--) {
        const d = z - pz, px = x >> d, py = y >> d;
        const t = this.tiles.get(this._key(pz, px, py));
        if (t && t.tex) return { t, pz, px, py };
      }
      return null;
    }

    // ---------------- Predictive prefetch (camera velocity) ----------------
    prefetchTiles() {
      const sp = Math.hypot(this.vx, this.vy);
      if (sp < 1e-4) return;
      const z = Math.max(this.minZoom, Math.min(this.maxNativeZoom, Math.round(this.zoom)));
      const n = Math.pow(2, z);
      // Look ahead ~0.5s of motion, in tile space.
      const ax = this.cx + this.vx * 30, ay = this.cy + this.vy * 30;
      const [tx, ty] = this.worldToTile(ax, ay, z);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x >= 0 && y >= 0 && x < n && y < n) this.loadTile(z, x, y);
      }
    }

    // ---------------- Frame ----------------
    // Standalone loop: eases the camera toward its target each frame, renders,
    // and re-schedules itself. Embedded mode skips this and renders on demand.
    _frame() {
      const k = 0.22;
      const pcx = this.cx, pcy = this.cy;
      this.cx += (this.tCx - this.cx) * k;
      this.cy += (this.tCy - this.cy) * k;
      this.zoom += (this.tZoom - this.zoom) * k;
      this.vx = this.cx - pcx; this.vy = this.cy - pcy;
      this._render();
      requestAnimationFrame(this._raf);
    }

    // The actual draw — used by both the standalone loop and embedded syncView.
    _render() {
      const gl = this.gl;
      // Resize the backing store to the display size (devicePixelRatio-aware).
      const dpr = this.embedded ? this._pxScale : Math.min(2, global.devicePixelRatio || 1);
      const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(this.aLoc);
      gl.vertexAttribPointer(this.aLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(this.uT, 0);

      const visible = this.getVisibleTiles();
      const keep = new Set();
      let drawn = 0;

      // Pass 1: parent fallbacks under any not-yet-ready tile (no blank pop).
      for (const v of visible) {
        const key = this._key(v.z, v.x, v.y);
        keep.add(key);
        const t = this.loadTile(v.z, v.x, v.y);
        if (t.state === "ready" && !t.tex) this._uploadTexture(t);
        if (!t.tex) {
          const p = this._findParent(v.z, v.x, v.y);
          if (p) { keep.add(this._key(p.pz, p.px, p.py)); this._drawTileFromParent(v, p); drawn++; }
        }
      }
      // Pass 2: the crisp tiles themselves.
      for (const v of visible) {
        const t = this.tiles.get(this._key(v.z, v.x, v.y));
        if (t && t.tex) { this._drawTile(v.z, v.x, v.y, t.tex, 0, 0, 1, 1, 1); drawn++; }
      }

      this.prefetchTiles();
      this._evictLRU(keep);
      if (this.onOverlay) this.onOverlay(gl, this);

      // Stats
      this.stats.drawn = drawn; this.stats.pending = this.pending.size; this.stats.textures = this.tiles.size;
      this._frames++;
      const now = performance.now();
      if (now - this._fpsT >= 500) { this.fps = Math.round(this._frames * 1000 / (now - this._fpsT)); this._frames = 0; this._fpsT = now; }
    }

    _drawTile(z, x, y, tex, u0, v0, uw, vh, alpha) {
      const gl = this.gl;
      const n = Math.pow(2, z);
      const wx0 = x / n, wy0 = y / n, wsz = 1 / n;
      const s0 = this.worldToScreen(wx0, wy0);
      const s = this.scale * wsz; // tile size on screen in px
      // Screen rect -> NDC rect (y flips).
      const W = this.canvas.width, H = this.canvas.height;
      const nx = s0[0] / W * 2 - 1, ny = 1 - s0[1] / H * 2;
      const nw = s / W * 2, nh = -s / H * 2;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4f(this.uRect, nx, ny, nw, nh);
      gl.uniform4f(this.uUV, u0, v0, uw, vh);
      gl.uniform1f(this.uA, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // Draw a target tile's area using the matching sub-rectangle of a parent texture.
    _drawTileFromParent(v, p) {
      const d = v.z - p.pz, sub = 1 / Math.pow(2, d);
      const u0 = (v.x - (p.px << d)) * sub, vv0 = (v.y - (p.py << d)) * sub;
      // Draw the child-sized screen quad but sample the parent sub-rect.
      this._drawTile(v.z, v.x, v.y, p.t.tex, u0, vv0, sub, sub, 1);
    }

    // ---------------- Input (zoom-to-cursor, pan) ----------------
    _initInput() {
      const cv = this.canvas;
      let dragging = false, lastX = 0, lastY = 0;
      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        const mx = e.offsetX * dpr, my = e.offsetY * dpr;
        const before = this.screenToWorld(mx, my);
        this.tZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.tZoom - Math.sign(e.deltaY) * 0.5));
        // Keep the point under the cursor fixed: solve for a center at the NEW zoom.
        const s = TILE_SIZE * Math.pow(2, this.tZoom);
        this.tCx = before[0] - (mx - cv.width / 2) / s;
        this.tCy = before[1] - (my - cv.height / 2) / s;
      }, { passive: false });
      // A left-drag can mean "pan the map" or it can belong to something else —
      // drawing a unit's route, laying out a road, placing a building. Without
      // this check both happened at once and the camera slid away underneath the
      // path being drawn. Middle/right drag always pans, so panning is still
      // available while a unit is selected.
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      cv.addEventListener("mousedown", (e) => {
        const forcePan = e.button === 1 || e.button === 2;
        if (!forcePan && this.canPan && !this.canPan(e)) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY;
      });
      global.addEventListener("mouseup", () => { dragging = false; });
      global.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        const s = TILE_SIZE * Math.pow(2, this.tZoom);
        this.tCx -= (e.clientX - lastX) * dpr / s;
        this.tCy -= (e.clientY - lastY) * dpr / s;
        lastX = e.clientX; lastY = e.clientY;
      });
    }

    // Convenience: jump/ease to a lon/lat + zoom.
    flyTo(lat, lon, zoom) { const wp = this.lonLatToWorld(lon, lat); this.tCx = wp[0]; this.tCy = wp[1]; if (zoom != null) this.tZoom = zoom; }
  }

  global.WebGLTileMap = WebGLTileMap;
})(window);
