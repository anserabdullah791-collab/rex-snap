const $ = (id) => document.getElementById(id);

function sendToTab(cmd, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return cb && cb(null);
    chrome.tabs.sendMessage(tabs[0].id, { rexSnap: true, cmd }, (res) => {
      if (chrome.runtime.lastError) return cb && cb(null);
      cb && cb(res);
    });
  });
}

function refreshStatus() {
  sendToTab("status", (res) => {
    if (!res) {
      $("dot").classList.remove("on");
      $("statusText").textContent = "Open a supported meeting tab (Meet / Zoom / Teams)";
      return;
    }
    $("dot").classList.toggle("on", !!res.active);
    $("statusText").textContent = res.active
      ? "Camera effect active • " + (res.gestureReady ? "finger-snap ready" : "gesture loading…") + " • state: " + res.phase
      : "Ready. Join a meeting and turn your camera on.";
  });
}

chrome.storage.sync.get({ enabled: true, particleStyle: "dust", duration: 2600, gesture: true, soundSnap: true, sensitivity: 1.0 }, (c) => {
  $("enabled").checked = c.enabled;
  $("style").value = c.particleStyle;
  $("dur").value = c.duration;
  $("gesture").checked = c.gesture;
  $("soundSnap").checked = c.soundSnap;
  $("sens").value = c.sensitivity;
  $("sensVal").textContent = Number(c.sensitivity).toFixed(1);
  $("durVal").textContent = (c.duration / 1000).toFixed(1);
});

$("snapBtn").onclick = () => sendToTab("snap", refreshStatus);
$("returnBtn").onclick = () => sendToTab("return", refreshStatus);
$("gesture").onchange = (e) => chrome.storage.sync.set({ gesture: e.target.checked });
$("soundSnap").onchange = (e) => chrome.storage.sync.set({ soundSnap: e.target.checked });
$("sens").oninput = (e) => { $("sensVal").textContent = Number(e.target.value).toFixed(1); chrome.storage.sync.set({ sensitivity: parseFloat(e.target.value) }); };
$("enabled").onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
$("style").onchange = (e) => chrome.storage.sync.set({ particleStyle: e.target.value });
$("dur").oninput = (e) => {
  $("durVal").textContent = (e.target.value / 1000).toFixed(1);
  chrome.storage.sync.set({ duration: parseInt(e.target.value, 10) });
};

refreshStatus();
setInterval(refreshStatus, 1500);
