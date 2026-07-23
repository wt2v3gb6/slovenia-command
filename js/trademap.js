// ============================================================================
// TradeWorldMap — the Trade tab's world choropleth, on a plain 2D canvas.
//
// This used to be a Leaflet map (the last thing in the game still using it).
// It never showed tiles — only GeoJSON country polygons coloured by price or
// availability — so it didn't need a tile engine, a layer system, or Leaflet's
// 150 KB. Everything it actually did is here: Mercator projection, drag to pan,
// wheel to zoom, hover tooltip, click to select.
//
// Countries are projected once and cached (same idea as the main map's overlay,
// for the same reason: reprojecting ~100k vertices per frame is not free).
// ============================================================================

(function (global) {
  "use strict";

  function lonToX(lon) { return (lon + 180) / 360; }
  function latToY(lat) {
    const c = Math.max(-85.05, Math.min(85.05, lat));
    const s = Math.sin(c * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }

  class TradeWorldMap {
    // host: the container element. onPick(countryId) fires on click.
    constructor(host, opts) {
      opts = opts || {};
      this.host = host;
      this.canvas = document.createElement("canvas");
      this.canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab";
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");

      this.tip = document.createElement("div");
      this.tip.className = "tmTip hidden";
      host.appendChild(this.tip);

      this.cx = lonToX(opts.lon != null ? opts.lon : 15);
      this.cy = latToY(opts.lat != null ? opts.lat : 48);
      this.zoom = opts.zoom != null ? opts.zoom : 4;
      this.minZoom = 2; this.maxZoom = 7;

      this.shapes = [];      // { id, rings: [Float64Array], bbox, style, label }
      this.onPick = opts.onPick || null;
      this.hoverId = null;

      this._bindInput();
      this._ro = new ResizeObserver(() => this.draw());
      this._ro.observe(host);
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      if (this.tip.parentNode) this.tip.parentNode.removeChild(this.tip);
    }

    get scale() { return 256 * Math.pow(2, this.zoom); } // CSS px per world unit

    // Replace the drawn set. `items` is [{ id, rings (lat/lon arrays), fill,
    // stroke, lineWidth, label, interactive }]. Projection is cached per ring
    // array, so passing the same arrays again is cheap.
    setShapes(items) {
      this.shapes = items.map(it => {
        const rings = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of it.rings) {
          if (!ring || ring.length < 3) continue;
          let p = ring.__tmProj;
          if (!p) {
            p = new Float64Array(ring.length * 2);
            for (let i = 0; i < ring.length; i++) {
              p[i * 2] = lonToX(ring[i][1]);
              p[i * 2 + 1] = latToY(ring[i][0]);
            }
            Object.defineProperty(ring, "__tmProj", { value: p, enumerable: false });
          }
          for (let i = 0; i < p.length; i += 2) {
            if (p[i] < minX) minX = p[i];
            if (p[i] > maxX) maxX = p[i];
            if (p[i + 1] < minY) minY = p[i + 1];
            if (p[i + 1] > maxY) maxY = p[i + 1];
          }
          rings.push(p);
        }
        return { id: it.id, rings, minX, minY, maxX, maxY, fill: it.fill, stroke: it.stroke,
                 lineWidth: it.lineWidth || 0.6, label: it.label, interactive: !!it.interactive };
      });
      this.draw();
    }

    // ---- projection helpers ----
    _view() {
      const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
      const k = this.scale;
      return { w, h, k, ox: w / 2 - this.cx * k, oy: h / 2 - this.cy * k };
    }
    screenToWorld(sx, sy) {
      const v = this._view();
      return [(sx - v.ox) / v.k, (sy - v.oy) / v.k];
    }

    draw() {
      const host = this.host;
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, global.devicePixelRatio || 1);
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0a0f14";
      ctx.fillRect(0, 0, w, h);

      const v = this._view();
      const pad = 8;
      const x0 = (-pad - v.ox) / v.k, x1 = (w + pad - v.ox) / v.k;
      const y0 = (-pad - v.oy) / v.k, y1 = (h + pad - v.oy) / v.k;

      for (const s of this.shapes) {
        if (s.maxX < x0 || s.minX > x1 || s.maxY < y0 || s.minY > y1) continue;
        ctx.beginPath();
        for (const p of s.rings) {
          ctx.moveTo(p[0] * v.k + v.ox, p[1] * v.k + v.oy);
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * v.k + v.ox, p[i + 1] * v.k + v.oy);
          ctx.closePath();
        }
        ctx.fillStyle = s.fill;
        ctx.fill();
        if (s.id && s.id === this.hoverId) {
          ctx.strokeStyle = "#ffe08a";
          ctx.lineWidth = 1.8;
        } else {
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = s.lineWidth;
        }
        ctx.stroke();
      }
    }

    // Even-odd ray cast against a shape's rings, in world space.
    _hit(wx, wy) {
      for (let i = this.shapes.length - 1; i >= 0; i--) {
        const s = this.shapes[i];
        if (!s.interactive) continue;
        if (wx < s.minX || wx > s.maxX || wy < s.minY || wy > s.maxY) continue;
        let inside = false;
        for (const p of s.rings) {
          const n = p.length >> 1;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const xa = p[a * 2], ya = p[a * 2 + 1], xb = p[b * 2], yb = p[b * 2 + 1];
            if ((ya > wy) !== (yb > wy) && wx < ((xb - xa) * (wy - ya)) / (yb - ya) + xa) inside = !inside;
          }
        }
        if (inside) return s;
      }
      return null;
    }

    _bindInput() {
      const cv = this.canvas;
      let dragging = false, moved = false, lx = 0, ly = 0;

      cv.addEventListener("mousedown", (e) => { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; cv.style.cursor = "grabbing"; });
      global.addEventListener("mouseup", () => { dragging = false; cv.style.cursor = "grab"; });

      cv.addEventListener("mousemove", (e) => {
        const r = cv.getBoundingClientRect();
        if (dragging) {
          if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 2) moved = true;
          const k = this.scale;
          this.cx -= (e.clientX - lx) / k;
          this.cy -= (e.clientY - ly) / k;
          this.cy = Math.max(0, Math.min(1, this.cy));
          lx = e.clientX; ly = e.clientY;
          this.draw();
          this.tip.classList.add("hidden");
          return;
        }
        const wpt = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = this._hit(wpt[0], wpt[1]);
        const id = hit ? hit.id : null;
        if (id !== this.hoverId) { this.hoverId = id; this.draw(); }
        if (hit && hit.label) {
          this.tip.innerHTML = hit.label;
          this.tip.classList.remove("hidden");
          this.tip.style.left = (e.clientX - r.left + 14) + "px";
          this.tip.style.top = (e.clientY - r.top + 12) + "px";
        } else {
          this.tip.classList.add("hidden");
        }
      });

      cv.addEventListener("mouseleave", () => { this.tip.classList.add("hidden"); if (this.hoverId) { this.hoverId = null; this.draw(); } });

      cv.addEventListener("click", (e) => {
        if (moved) return; // that was a pan, not a pick
        const r = cv.getBoundingClientRect();
        const wpt = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = this._hit(wpt[0], wpt[1]);
        if (hit && this.onPick) this.onPick(hit.id);
      });

      cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const before = this.screenToWorld(mx, my);
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom - Math.sign(e.deltaY) * 0.4));
        // Keep the point under the cursor fixed across the zoom change.
        const k = this.scale;
        const v = { w: this.host.clientWidth, h: this.host.clientHeight };
        this.cx = before[0] - (mx - v.w / 2) / k;
        this.cy = before[1] - (my - v.h / 2) / k;
        this.draw();
      }, { passive: false });
    }
  }

  global.TradeWorldMap = TradeWorldMap;
})(window);
