/**
 * Rex Snap — snap-engine.js
 * Particle "Thanos snap" renderer. Pure Canvas 2D, no dependencies.
 *
 * Idea: the person (alpha-masked) is sampled into thousands of particles.
 * A "dissolve front" sweeps across the body (left -> right, with noise).
 * Particles behind the front detach and drift up/right with turbulence,
 * fade, and shrink. The remaining body is clipped by the front.
 * The background is shown untouched underneath, so it looks like you vanished.
 */
(function () {
  const STYLES = {
    dust:    { colors: null,                       size: [1.2, 2.8], life: 1.0, gravity: -18,  wind: 90,  glow: 0 },
    sand:    { colors: ["#e8c58a","#d9a85a","#c9914a","#f2d9a8"], size: [1.5, 3.2], life: 1.1, gravity: 20, wind: 120, glow: 0 },
    embers:  { colors: ["#ffb347","#ff7a18","#ff4d00","#ffd27a"], size: [1.2, 3.0], life: 1.2, gravity: -40, wind: 70,  glow: 6 },
    glitter: { colors: ["#ffffff","#a5d8ff","#d0bfff","#ffd6e8"], size: [1.0, 2.6], life: 1.0, gravity: -10, wind: 100, glow: 4 },
  };

  function rand(a, b) { return a + Math.random() * (b - a); }

  function create({ width, height }) {
    const W = width, H = height;
    // Work at reduced resolution for sampling (perf)
    const SW = Math.max(160, Math.round(W / 4));
    const SH = Math.max(90, Math.round(H / 4));
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = SW; sampleCanvas.height = SH;
    const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });

    let particles = [];
    let built = false;
    let bounds = { minX: 0, maxX: W };
    let noiseSeed = Math.random() * 1000;

    // cheap value-noise for the dissolve front
    function noise(x, y) {
      const s = Math.sin(x * 12.9898 + y * 78.233 + noiseSeed) * 43758.5453;
      return s - Math.floor(s);
    }

    function buildParticles(personCanvas, maskCanvas, style) {
      sctx.clearRect(0, 0, SW, SH);
      sctx.drawImage(personCanvas, 0, 0, SW, SH);
      const img = sctx.getImageData(0, 0, SW, SH).data;
      const cfg = STYLES[style] || STYLES.dust;
      particles = [];
      let minX = SW, maxX = 0;
      for (let y = 0; y < SH; y++) {
        for (let x = 0; x < SW; x++) {
          const i = (y * SW + x) * 4;
          const a = img[i + 3];
          if (a < 128) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          // several particles per sample pixel
          const n = 3;
          for (let k = 0; k < n; k++) {
            const col = cfg.colors
              ? cfg.colors[(Math.random() * cfg.colors.length) | 0]
              : `rgb(${img[i]},${img[i + 1]},${img[i + 2]})`;
            particles.push({
              x: (x + Math.random()) * (W / SW),
              y: (y + Math.random()) * (H / SH),
              nx: x / SW,
              ny: y / SH,
              vx: 0, vy: 0,
              col,
              size: rand(cfg.size[0], cfg.size[1]),
              threshold: 0, // set below
              seed: Math.random(),
            });
          }
        }
      }
      bounds.minX = (minX / SW);
      bounds.maxX = (maxX / SW);
      const span = Math.max(0.01, bounds.maxX - bounds.minX);
      for (const p of particles) {
        // dissolve order: left->right with noise
        const along = (p.nx - bounds.minX) / span;
        p.threshold = Math.min(0.999, Math.max(0, along * 0.78 + noise(p.nx * 9, p.ny * 9) * 0.22));
      }
      built = true;
    }

    function drawParticles(ctx, progress, style, reverse) {
      const cfg = STYLES[style] || STYLES.dust;
      const t = progress;
      ctx.save();
      if (cfg.glow) { ctx.shadowBlur = cfg.glow; }
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const local = (t - p.threshold) / 0.32; // 0..1 lifetime of this particle's flight
        if (local <= 0 || local >= 1) continue;
        const e = reverse ? (1 - local) : local;
        const drift = e * e;
        const px = p.x + (cfg.wind * drift) * (0.6 + p.seed) + Math.sin(p.seed * 20 + e * 6) * 14 * e;
        const py = p.y + (cfg.gravity * e * 6) * (0.4 + p.seed) - 60 * drift * p.seed;
        const alpha = reverse ? local : (1 - local);
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.col;
        if (cfg.glow) ctx.shadowColor = p.col;
        const s = p.size * (1 - 0.5 * local);
        ctx.fillRect(px, py, s, s);
      }
      ctx.restore();
    }

    // Draw the part of the body that has NOT yet dissolved (or has re-formed).
    // Uses a per-row, noise-displaced front with a feathered edge -> organic crumbling.
    const fx = document.createElement("canvas");
    fx.width = W; fx.height = H;
    const fctx = fx.getContext("2d");
    const ROWS = 48;
    function drawRemainingBody(ctx, personCanvas, progress, reverse) {
      const span = Math.max(0.01, bounds.maxX - bounds.minX);
      const p = reverse ? 1 - progress : progress;
      // front position in normalized x (0..1) incl. margin so it fully clears
      const front = bounds.minX + (p * 1.25 - 0.12) * span;
      fctx.clearRect(0, 0, W, H);
      fctx.globalCompositeOperation = "source-over";
      fctx.drawImage(personCanvas, 0, 0, W, H);
      // build a "keep" mask: everything RIGHT of the front is kept (dissolves left->right
      // means the LEFT disappears first), with a jagged noisy edge
      fctx.globalCompositeOperation = "destination-in";
      fctx.fillStyle = "#fff";
      fctx.beginPath();
      fctx.moveTo(W, 0);
      for (let r = 0; r <= ROWS; r++) {
        const y = (r / ROWS) * H;
        const n = noise(r * 0.37, p * 3.0) - 0.5;      // jitter per row
        const wobble = Math.sin(r * 0.55 + p * 9) * 0.015;
        const xEdge = (front + n * 0.10 + wobble) * W;
        fctx.lineTo(Math.max(0, Math.min(W, xEdge)), y);
      }
      fctx.lineTo(W, H);
      fctx.closePath();
      fctx.fill();
      fctx.globalCompositeOperation = "source-over";
      ctx.drawImage(fx, 0, 0);
    }

    function drawBackground(ctx, bgCanvas, maskCanvas) {
      // Show the background only (person area is "healed" by blurring neighbours)
      ctx.drawImage(bgCanvas, 0, 0, W, H);
    }

    // The empty room: keep the real, SHARP background. Only the area where the person
    // stood is replaced by a soft blurred patch (so no person ghost remains).
    const roomTmp = document.createElement("canvas");
    roomTmp.width = W; roomTmp.height = H;
    const rtx = roomTmp.getContext("2d");
    const softMask = document.createElement("canvas");
    softMask.width = W; softMask.height = H;
    const smx = softMask.getContext("2d");
    function paintEmptyRoom(ctx, bgCanvas, maskCanvas) {
      // 1) sharp original everywhere (the real room, untouched)
      ctx.drawImage(bgCanvas, 0, 0, W, H);

      // 2) feathered + slightly grown copy of the person mask on its OWN canvas
      smx.clearRect(0, 0, W, H);
      smx.filter = "blur(8px)";
      smx.drawImage(maskCanvas, 0, 0, W, H);
      smx.drawImage(maskCanvas, -3, 0, W, H);
      smx.drawImage(maskCanvas, 3, 0, W, H);
      smx.filter = "none";

      // 3) heavily blurred room, cut out ONLY where the person stood
      rtx.globalCompositeOperation = "source-over";
      rtx.clearRect(0, 0, W, H);
      rtx.filter = "blur(26px)";
      rtx.drawImage(bgCanvas, 0, 0, W, H);
      rtx.filter = "none";
      rtx.globalCompositeOperation = "destination-in";
      rtx.drawImage(softMask, 0, 0, W, H);
      rtx.globalCompositeOperation = "source-over";

      // 4) patch over the sharp room
      ctx.drawImage(roomTmp, 0, 0, W, H);
    }

    function renderSnap(ctx, bgCanvas, personCanvas, maskCanvas, progress, style) {
      if (!built || progress < 0.02) {
        if (!built) buildParticles(personCanvas, maskCanvas, style);
      }
      // base layer: room without person
      paintEmptyRoom(ctx, bgCanvas, maskCanvas);
      // remaining body
      drawRemainingBody(ctx, personCanvas, progress, false);
      // flying dust
      drawParticles(ctx, progress, style, false);
    }

    function renderGone(ctx, bgCanvas, maskCanvas) {
      paintEmptyRoom(ctx, bgCanvas, maskCanvas);
    }

    function renderReturn(ctx, bgCanvas, personCanvas, maskCanvas, progress, style) {
      if (!built) buildParticles(personCanvas, maskCanvas, style);
      paintEmptyRoom(ctx, bgCanvas, maskCanvas);
      drawRemainingBody(ctx, personCanvas, progress, true);
      drawParticles(ctx, progress, style, true);
      if (progress >= 1) built = false; // re-sample next time
    }

    return { renderSnap, renderGone, renderReturn };
  }

  window.RexSnapEngine = { create };
})();
