// Offscreen owns the relay WebSocket. MV3 SW can zombie-pong while chrome.*
// returns "No SW" (crbug 341232995 / Helium). Port messages wake a live SW.
const RELAY_URL = 'ws://localhost:19988/extension';
let ws = null;
let port = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connect({ name: 'relay-bridge' });
  } catch (_) {
    port = null;
    return null;
  }
  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch (_) {}
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(ensurePort, 250);
  });
  // SW may have restarted while WS stayed up - re-announce open.
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { port.postMessage({ type: 'relay-open' }); } catch (_) {}
  }
  return port;
}

function postToSw(msg) {
  const p = ensurePort();
  if (!p) return;
  try { p.postMessage(msg); } catch (_) {
    port = null;
    const p2 = ensurePort();
    if (p2) try { p2.postMessage(msg); } catch (_) {}
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(15000, 1000 * Math.pow(1.5, reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  ensurePort();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(RELAY_URL);
  } catch (_) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectAttempt = 0;
    postToSw({ type: 'relay-open' });
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    ws = null;
    postToSw({ type: 'relay-closed' });
    scheduleReconnect();
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.method === 'ping') {
      try { ws.send(JSON.stringify({ method: 'pong' })); } catch (_) {}
      postToSw({ type: 'keepalive' });
      return;
    }
    postToSw({ type: 'relay', payload: msg });
  };
}

connect();
setInterval(() => {
  ensurePort();
  postToSw({ type: 'keepalive' });
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connect();
  }
}, 20000);
