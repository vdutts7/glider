const RELAY_URL = 'ws://localhost:19988/extension';
let ws = null;
let connectedTabs = new Map();
let nextSessionId = 1;

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  try {
    ws = new WebSocket(RELAY_URL);
  } catch (e) {
    updateIcon();
    return;
  }
  
  ws.onopen = () => updateIcon();
  ws.onerror = () => {};
  ws.onclose = () => {
    ws = null;
    connectedTabs.clear();
    updateIcon();
    setTimeout(connect, 3000);
  };
  
  ws.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    
    if (msg.method === 'ping') {
      ws.send(JSON.stringify({ method: 'pong' }));
      return;
    }
    
    if (msg.method === 'forwardCDPCommand') {
      const response = { id: msg.id };
      try {
        response.result = await handleCDP(msg.params);
      } catch (err) {
        response.error = err.message || 'Unknown error';
      }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
    }
  };
}

async function handleCDP({ method, params, sessionId }) {
  let tabId = null;
  for (const [tid, info] of connectedTabs) {
    if (info.sessionId === sessionId) { tabId = tid; break; }
  }
  
  if (method === 'Target.createTarget') {
    const tab = await chrome.tabs.create({ url: params?.url || 'about:blank', active: false });
    await new Promise(r => setTimeout(r, 500));
    const { targetInfo } = await attachTab(tab.id);
    return { targetId: targetInfo.targetId };
  }
  
  if (!tabId) throw new Error('Session not found');
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}

async function attachTab(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    throw new Error('Could not attach to tab');
  }
  
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
  } catch {}
  
  let targetInfo;
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo');
    targetInfo = result.targetInfo;
  } catch {
    targetInfo = { targetId: `tab-${tabId}`, url: '', type: 'page' };
  }
  
  const sessionId = `session-${nextSessionId++}`;
  connectedTabs.set(tabId, { sessionId, targetId: targetInfo.targetId });
  
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false }
      }
    }));
  }
  
  updateIcon();
  return { targetInfo, sessionId };
}

function detachTab(tabId) {
  const info = connectedTabs.get(tabId);
  if (!info) return;
  
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: info.sessionId, targetId: info.targetId }
      }
    }));
  }
  
  connectedTabs.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
  updateIcon();
}

function updateIcon() {
  const n = connectedTabs.size;
  const ok = ws?.readyState === WebSocket.OPEN;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : (ok ? '' : '!') });
  chrome.action.setBadgeBackgroundColor({ color: n > 0 ? '#22c55e' : (ok ? '#64748b' : '#ef4444') });
}

chrome.debugger.onEvent.addListener((src, method, params) => {
  const info = connectedTabs.get(src.tabId);
  if (info && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ method: 'forwardCDPEvent', params: { sessionId: info.sessionId, method, params } }));
  }
});

chrome.debugger.onDetach.addListener((src) => {
  if (connectedTabs.has(src.tabId)) detachTab(src.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (connectedTabs.has(tabId)) detachTab(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) return;
  
  if (connectedTabs.has(tab.id)) {
    detachTab(tab.id);
  } else {
    connect();
    try {
      await attachTab(tab.id);
    } catch {}
  }
});

connect();
setInterval(() => { if (!ws || ws.readyState !== WebSocket.OPEN) connect(); }, 5000);
