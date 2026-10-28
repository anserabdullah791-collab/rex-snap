/**
 * Rex Snap — inject.js  (runs in the PAGE's JS world)
 *
 * Wraps navigator.mediaDevices.getUserMedia so that when a meeting site asks for
 * the webcam, it receives a processed canvas stream instead. The processing
 * (segmentation + particle "snap" effect) runs 100% locally in the browser.
 * No video ever leaves the device.
 */
(function () {
  if (window.__rexSnapInstalled) return;
  window.__rexSnapInstalled = true;

  window.__rexSnapBase = window.__rexSnapBase || document.documentElement.getAttribute("data-rexsnap-base") || "";
  const state = {
    enabled: true,          // master switch (popup)
    phase: "visible",       // visible | snapping | gone | returning
    phaseStart: 0,
    particleStyle: "dust",  // dust | sand | embers | glitter
    duration: 2600,         // ms for the snap animation
    engine: null,
  };

  // ----- messaging with the content script (isolated world) -----
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__rexSnap !== true) return;
    const m = ev.data;
    if (m.type === "config") {
      if (typeof m.enabled === "boolean") state.enabled = m.enabled;
      if (m.particleStyle) state.particleStyle = m.particleStyle;
      if (m.duration) state.duration = m.duration;
      if (m.base) window.__rexSnapBase = m.base;
    } else if (m.type === "snap") {
      triggerSnap();
    } else if (m.type === "return") {
      triggerReturn();
    } else if (m.type === "toggle") {
      state.phase === "gone" || state.phase === "snapping" ? triggerReturn() : triggerSnap();
    }
  });

  function post(type, extra) {
    window.postMessage(Object.assign({ __rexSnapFromPage: true, type }, extra || {}), "*");
  }

  function triggerSnap() {
    if (!state.enabled) return;
    if (state.phase === "gone" || state.phase === "snapping") return;
    state.phase = "snapping";
    state.phaseStart = performance.now();
    post("phase", { phase: "snapping" });
  }
  function triggerReturn() {
    if (state.phase === "visible" || state.phase === "returning") return;
    state.phase = "returning";
    state.phaseStart = performance.now();
    post("phase", { phase: "returning" });
  }

  // ----- wrap getUserMedia -----
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const origGUM = md.getUserMedia.bind(md);

  md.getUserMedia = async function (constraints) {
    const wantsVideo = constraints && constraints.video;
    const stream = await origGUM(constraints);
    if (!wantsVideo || !state.enabled) return stream;

    try {
      const vTrack = stream.getVideoTracks()[0];
      if (!vTrack) return stream;
      const processed = await buildProcessedStream(stream, vTrack);
      // keep audio tracks untouched
      stream.getAudioTracks().forEach((t) => processed.addTrack(t));
      post("active", { active: true });
      return processed;
    } catch (e) {
      console.warn("[Rex Snap] falling back to raw camera:", e);
      return stream;
    }
  };

  // ----- processing pipeline -----
  async function buildProcessedStream(rawStream, vTrack) {
    const settings = vTrack.getSettings();
    const W = settings.width || 1280;
    const H = settings.height || 720;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([vTrack]);
    await video.play();

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d", { willReadFrequently: false });

    // offscreen buffers
    const personCanvas = document.createElement("canvas");
    personCanvas.width = W; personCanvas.height = H;
    const pctx = personCanvas.getContext("2d", { willReadFrequently: true });

    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = W; bgCanvas.height = H;
    const bctx = bgCanvas.getContext("2d");

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = W; maskCanvas.height = H;
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });

    // segmentation (loaded lazily through the content script bridge)
    await waitForLibs();
    const seg = await loadSegmentation();

    if (!window.RexSnapEngine) throw new Error('engine missing');
    const engine = window.RexSnapEngine.create({ width: W, height: H });
    state.engine = engine;

    let lastMaskAt = 0;
    let haveMask = false;
    let processing = false;

    async function segmentFrame() {
      if (processing || !seg) return;
      processing = true;
      try {
        await seg.send({ image: video });
      } catch (_) {}
      processing = false;
    }
    if (seg) {
      seg.onResults((res) => {
        if (!res.segmentationMask) return;
        mctx.save();
        mctx.clearRect(0, 0, W, H);
        mctx.drawImage(res.segmentationMask, 0, 0, W, H);
        mctx.restore();
        haveMask = true;
        lastMaskAt = performance.now();
      });
    }

    function draw() {
      const now = performance.now();
      segmentFrame();

      // 1. draw raw frame
      octx.clearRect(0, 0, W, H);
      octx.drawImage(video, 0, 0, W, H);

      if (state.phase === "visible" || !haveMask) {
        requestAnimationFrame(draw);
        return;
      }

      // 2. split person / background using mask
      pctx.clearRect(0, 0, W, H);
      pctx.drawImage(video, 0, 0, W, H);
      pctx.globalCompositeOperation = "destination-in";
      pctx.drawImage(maskCanvas, 0, 0, W, H);
      pctx.globalCompositeOperation = "source-over";

      // background-only frame = video minus person (filled by blurred neighbours)
      bctx.clearRect(0, 0, W, H);
      bctx.drawImage(video, 0, 0, W, H);

      const elapsed = now - state.phaseStart;
      let progress = Math.min(1, elapsed / state.duration);

      if (state.phase === "snapping") {
        engine.renderSnap(octx, bgCanvas, personCanvas, maskCanvas, progress, state.particleStyle);
        if (progress >= 1) {
          state.phase = "gone";
          post("phase", { phase: "gone" });
        }
      } else if (state.phase === "gone") {
        engine.renderGone(octx, bgCanvas, maskCanvas);
      } else if (state.phase === "returning") {
        engine.renderReturn(octx, bgCanvas, personCanvas, maskCanvas, progress, state.particleStyle);
        if (progress >= 1) {
          state.phase = "visible";
          post("phase", { phase: "visible" });
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    const outStream = out.captureStream(settings.frameRate || 30);
    return outStream;
  }

  function waitForLibs() {
    return new Promise((resolve) => {
      let tries = 0;
      (function check() {
        if (window.RexSnapEngine && window.__rexSnapBase !== undefined) return resolve();
        if (++tries > 80) return resolve(); // ~4s max, then continue anyway
        setTimeout(check, 50);
      })();
    });
  }

  function loadSegmentation() {
    return new Promise((resolve) => {
      const base = window.__rexSnapBase;
      if (!base || !window.SelfieSegmentation) return resolve(null);
      try {
        const s = new window.SelfieSegmentation({
          locateFile: (f) => base + "lib/" + f,
        });
        s.setOptions({ modelSelection: 1, selfieMode: false });
        s.initialize().then(() => resolve(s)).catch(() => resolve(null));
      } catch (e) {
        resolve(null);
      }
    });
  }
})();
