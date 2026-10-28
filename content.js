/**
 * Rex Snap — content.js (isolated world)
 * Bridges the extension (popup/background/storage) with the injected page script.
 * Also loads snap-engine + MediaPipe into the PAGE world before getUserMedia is called.
 */
(function () {
  const base = chrome.runtime.getURL("");
  document.documentElement.setAttribute("data-rexsnap-base", base);

  function injectScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL(src);
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => { s.remove(); resolve(); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // Load order matters: engine + segmentation before the page can request the camera.
  // (inject.js is registered separately as a MAIN-world content script)
  injectScript("lib/selfie_segmentation.js")
    .then(() => injectScript("snap-engine.js"))
    .then(sendConfig);

  function sendConfig() {
    chrome.storage.sync.get(
      { enabled: true, particleStyle: "dust", duration: 2600 },
      (cfg) => {
        window.postMessage({ __rexSnap: true, type: "config", base, ...cfg }, "*");
      }
    );
  }

  // Re-send config whenever settings change
  chrome.storage.onChanged.addListener(sendConfig);

  // Commands from popup / background / keyboard shortcut
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.rexSnap) return;
    if (msg.cmd === "snap") window.postMessage({ __rexSnap: true, type: "snap" }, "*");
    else if (msg.cmd === "return") window.postMessage({ __rexSnap: true, type: "return" }, "*");
    else if (msg.cmd === "toggle") window.postMessage({ __rexSnap: true, type: "toggle" }, "*");
    else if (msg.cmd === "status") {
      sendResponse({ phase: window.__rexSnapPhase || "visible", active: !!window.__rexSnapActive });
      return true;
    }
  });

  // Phase updates from the page world
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__rexSnapFromPage !== true) return;
    if (ev.data.type === "phase") window.__rexSnapPhase = ev.data.phase;
    if (ev.data.type === "active") window.__rexSnapActive = ev.data.active;
  });

  // In-page floating button (so you can snap without opening the popup)
  function addFloatingButton() {
    if (window.top !== window) return; // only in top frame
    if (document.getElementById("rexsnap-fab")) return;
    const b = document.createElement("button");
    b.id = "rexsnap-fab";
    b.textContent = "🫰 Snap";
    b.title = "Rex Snap — click to disappear / reappear (Alt+S)";
    Object.assign(b.style, {
      position: "fixed", bottom: "92px", right: "18px", zIndex: 2147483647,
      padding: "10px 16px", borderRadius: "999px", border: "1px solid rgba(255,255,255,.25)",
      background: "linear-gradient(135deg,#0a84ff,#6e3bff)", color: "#fff",
      font: "600 14px system-ui, sans-serif", cursor: "pointer",
      boxShadow: "0 6px 24px rgba(10,132,255,.45)", opacity: ".92",
    });
    b.addEventListener("click", () =>
      window.postMessage({ __rexSnap: true, type: "toggle" }, "*")
    );
    document.documentElement.appendChild(b);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addFloatingButton);
  } else addFloatingButton();

  // Keyboard shortcut Alt+S
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      window.postMessage({ __rexSnap: true, type: "toggle" }, "*");
    }
  }, true);
})();
