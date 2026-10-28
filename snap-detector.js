/**
 * Rex Snap — snap-detector.js  (runs in the PAGE world, before the camera is requested)
 *
 * Detects a FINGER SNAP gesture using two independent signals, either can fire the effect:
 *   A) VISION: MediaPipe Hands. Thumb tip (4) and middle-finger tip (12) pinch together
 *      (distance small relative to hand size) and then RELEASE quickly (the "snap" motion).
 *   B) AUDIO:  optional microphone peak detector. A snap is a short, loud, broadband click.
 *
 * Everything runs locally. Nothing is uploaded.
 *
 * Exposes: window.RexSnapDetector.create({ onSnap, getVideo, base, useAudio, sensitivity })
 */
(function () {
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function create(opts) {
    const onSnap = opts.onSnap;
    const base = opts.base || "";
    const sens = opts.sensitivity || 1.0;     // 0.5 (strict) .. 1.5 (loose)
    const COOLDOWN_MS = 1800;                  // ignore repeats right after a snap
    let lastFire = 0;
    let stopped = false;

    function fire(source) {
      const now = performance.now();
      if (now - lastFire < COOLDOWN_MS) return;
      lastFire = now;
      try { onSnap(source); } catch (_) {}
    }

    // ---------- A) VISION ----------
    let hands = null;
    let state = "open";          // open -> pinched -> (release fast) => SNAP
    let pinchStart = 0;
    let lastRatio = 1;

    async function initHands() {
      if (!window.Hands) return null;
      const h = new window.Hands({ locateFile: (f) => base + "lib/" + f });
      h.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,            // lite model: fast, fine for a big gesture
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
      h.onResults((res) => {
        if (stopped) return;
        const list = res.multiHandLandmarks || [];
        if (!list.length) { state = "open"; return; }
        let bestPinch = false, bestRelease = false;
        for (const lm of list) {
          const handSize = dist(lm[0], lm[9]) || 0.0001;      // wrist -> middle MCP
          const ratio = dist(lm[4], lm[12]) / handSize;       // thumb tip <-> middle tip
          const pinchedNow = ratio < 0.28 / sens;
          const openNow    = ratio > 0.75 * sens;
          const now = performance.now();

          if (state === "open" && pinchedNow) {
            state = "pinched"; pinchStart = now;
          } else if (state === "pinched") {
            const held = now - pinchStart;
            if (openNow && held > 40 && held < 700) {
              bestRelease = true;                              // quick pinch -> release
              state = "open";
            } else if (held >= 700) {
              state = "open";                                  // held too long: not a snap
            }
          }
          lastRatio = ratio;
          bestPinch = bestPinch || pinchedNow;
        }
        if (bestRelease) fire("hand");
      });
      try { await h.initialize(); } catch (e) { return null; }
      return h;
    }

    let rafId = 0, busy = false;
    async function loopVision() {
      if (stopped) return;
      const v = opts.getVideo && opts.getVideo();
      if (hands && v && v.readyState >= 2 && !busy) {
        busy = true;
        try { await hands.send({ image: v }); } catch (_) {}
        busy = false;
      }
      rafId = requestAnimationFrame(loopVision);
    }

    // ---------- B) AUDIO ----------
    let audioCtx = null, analyser = null, audioStream = null;
    async function initAudio() {
      if (!opts.useAudio) return;
      try {
        // use the ORIGINAL (unwrapped) getUserMedia so we do not recurse into our own hook
        const gum = opts.rawGetUserMedia || navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        audioStream = await gum({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(audioStream);
        const hp = audioCtx.createBiquadFilter();       // snaps live in the highs
        hp.type = "highpass"; hp.frequency.value = 1800;
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(hp); hp.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let floor = 0.01, prevPeak = 0;
        (function tick() {
          if (stopped || !analyser) return;
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
          floor = floor * 0.98 + peak * 0.02;            // slow-moving background level
          const spike = peak > Math.max(0.12 / sens, floor * 6) && peak > prevPeak * 1.8;
          if (spike) fire("sound");
          prevPeak = peak;
          setTimeout(tick, 12);
        })();
      } catch (_) { /* mic denied: vision still works */ }
    }

    async function start() {
      hands = await initHands();
      if (hands) loopVision();
      initAudio();
      return { vision: !!hands };
    }
    function stop() {
      stopped = true;
      cancelAnimationFrame(rafId);
      try { audioStream && audioStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { audioCtx && audioCtx.close(); } catch (_) {}
    }
    return { start, stop, _debug: () => ({ state, lastRatio }) };
  }

  window.RexSnapDetector = { create };
})();
