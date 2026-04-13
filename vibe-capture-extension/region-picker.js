/**
 * Injected into the active tab. Fullscreen overlay + canvas, red selection rect.
 * Resolves with { x, y, width, height, viewportWidth, viewportHeight, cssSnapshot? } or null.
 * Uses Pointer Events + setPointerCapture so pointerup still fires if release is over Chrome UI (e.g. side panel).
 */
(() => {
  return new Promise((resolve) => {
    const OVERLAY_ID = "__vibe_capture_region_overlay__";
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("data-vibe-capture-overlay", "true");
    root.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "width:100vw",
      "height:100vh",
      "z-index:2147483647",
      "cursor:crosshair",
      "touch-action:none",
      "user-select:none",
    ].join(";");

    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none";

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }

    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;
    let drawing = false;
    let activePointerId = null;

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function rectNorm(ax, ay, bx, by) {
      const x = Math.min(ax, bx);
      const y = Math.min(ay, by);
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);
      return { x, y, width: w, height: h };
    }

    function redraw() {
      ctx.clearRect(0, 0, vw, vh);
      ctx.fillStyle = "rgba(0,0,0,0.14)";
      ctx.fillRect(0, 0, vw, vh);
      if (drawing || sx !== cx || sy !== cy) {
        const r = rectNorm(sx, sy, cx, cy);
        ctx.clearRect(r.x, r.y, r.width, r.height);
        ctx.strokeStyle = "rgba(255, 40, 40, 0.95)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const inset = 1;
        ctx.strokeRect(
          r.x + inset,
          r.y + inset,
          Math.max(0, r.width - inset * 2),
          Math.max(0, r.height - inset * 2),
        );
        ctx.setLineDash([]);
      }
    }

    function clientToLocal(ev) {
      return {
        x: clamp(ev.clientX, 0, vw - 1),
        y: clamp(ev.clientY, 0, vh - 1),
      };
    }

    function releaseCaptureSafe() {
      if (activePointerId == null) return;
      try {
        if (root.releasePointerCapture) root.releasePointerCapture(activePointerId);
      } catch {
        /* ignore */
      }
      activePointerId = null;
    }

    function cleanup() {
      releaseCaptureSafe();
      window.removeEventListener("keydown", onKey, true);
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("pointermove", onPointerMove, true);
      root.removeEventListener("pointerup", onPointerUp, true);
      root.removeEventListener("pointercancel", onPointerCancel, true);
      root.remove();
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        drawing = false;
        finish(null);
      }
    }

    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof root.setPointerCapture === "function") {
          root.setPointerCapture(e.pointerId);
          activePointerId = e.pointerId;
        }
      } catch {
        activePointerId = null;
      }
      const p = clientToLocal(e);
      sx = cx = p.x;
      sy = cy = p.y;
      drawing = true;
      redraw();
    }

    function onPointerMove(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = clientToLocal(e);
      cx = p.x;
      cy = p.y;
      redraw();
    }

    function onPointerUp(e) {
      if (!drawing) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = false;
      releaseCaptureSafe();
      const p = clientToLocal(e);
      cx = p.x;
      cy = p.y;
      const r = rectNorm(sx, sy, cx, cy);
      const MIN = 4;
      if (r.width < MIN || r.height < MIN) {
        finish(null);
        return;
      }
      root.style.pointerEvents = "none";
      const midX = Math.floor(r.x + r.width / 2);
      const midY = Math.floor(r.y + r.height / 2);
      let cssSnapshot = null;
      if (globalThis.__VIBE_COMPUTED_CSS__) {
        cssSnapshot = globalThis.__VIBE_COMPUTED_CSS__.collectFromPoint(midX, midY, null);
      }
      finish({
        x: Math.floor(r.x),
        y: Math.floor(r.y),
        width: Math.ceil(r.width),
        height: Math.ceil(r.height),
        viewportWidth: vw,
        viewportHeight: vh,
        cssSnapshot,
      });
    }

    function onPointerCancel(e) {
      if (!drawing) return;
      drawing = false;
      releaseCaptureSafe();
      finish(null);
    }

    window.addEventListener("keydown", onKey, true);
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointermove", onPointerMove, true);
    root.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("pointercancel", onPointerCancel, true);
    root.appendChild(canvas);
    document.documentElement.appendChild(root);
    redraw();
  });
})();
