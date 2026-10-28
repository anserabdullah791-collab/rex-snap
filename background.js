// Rex Snap — background service worker
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-snap") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { rexSnap: true, cmd: "toggle" });
  });
});

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") {
    chrome.storage.sync.set({ enabled: true, particleStyle: "dust", duration: 2600 });
  }
});
