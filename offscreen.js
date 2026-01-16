// Offscreen document to keep service worker alive
// Sends periodic messages to prevent Chrome from suspending the worker

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {});
}, 20000); // Every 20 seconds

// Delay initial ping to let service worker initialize
setTimeout(() => {
  chrome.runtime.sendMessage({ type: 'keepalive' }).catch(() => {});
}, 1000);
