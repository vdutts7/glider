const RELAY_URL = 'ws://localhost:19988/extension';
let ws = null;
let connectedTabs = new Map();
let nextSessionId = 1;

// Create offscreen document to keep service worker alive
async function setupOffscreen() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Keep service worker alive for persistent browser automation'
      });
    }
  } catch (e) {
    console.log('[glider] Offscreen setup:', e.message);
  }
}

// Handle keepalive messages from offscreen document
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'keepalive') {
    // Just receiving this keeps the worker alive
    sendResponse({ ok: true });
  }
  return false;
});

// Setup offscreen on install/startup
chrome.runtime.onInstalled.addListener(setupOffscreen);
chrome.runtime.onStartup.addListener(setupOffscreen);

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  try {
    ws = new WebSocket(RELAY_URL);
  } catch (e) {
    updateIcon();
    return;
  }
  
  ws.onopen = async () => {
    console.log('[glider] WebSocket connected to relay');
    updateIcon();
    // Wait a bit for everything to settle
    await new Promise(r => setTimeout(r, 500));
    // AUTO-ATTACH: When relay connects, attach to active tab automatically
    await autoAttachActiveTab();
  };
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
    
    // Command from relay to attach active tab
    if (msg.method === 'attachActiveTab') {
      await autoAttachActiveTab();
      ws.send(JSON.stringify({ id: msg.id, result: { attached: connectedTabs.size } }));
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
  console.log('[glider] Attempting to attach tab:', tabId);
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    console.log('[glider] Debugger attached to tab:', tabId);
  } catch (e) {
    console.log('[glider] Attach failed:', e.message);
    throw new Error('Could not attach to tab: ' + e.message);
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
  console.log('[glider] Extension icon clicked, tab:', tab?.id, tab?.url);
  if (!tab.id || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    console.log('[glider] Skipping chrome:// or extension page');
    return;
  }
  
  if (connectedTabs.has(tab.id)) {
    console.log('[glider] Tab already connected, detaching');
    detachTab(tab.id);
  } else {
    console.log('[glider] Connecting to relay and attaching tab');
    connect();
    try {
      await attachTab(tab.id);
      console.log('[glider] Successfully attached tab');
    } catch (e) {
      console.log('[glider] Failed to attach:', e.message);
    }
  }
});

connect();
setupOffscreen();
setInterval(() => { if (!ws || ws.readyState !== WebSocket.OPEN) connect(); }, 5000);

// Keep service worker alive - Chrome suspends inactive workers
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Just accessing ws keeps the worker alive
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ method: 'ping' }));
    }
  }
});

// Auto-attach to active tab when relay connects
async function autoAttachActiveTab() {
  console.log('[glider] autoAttachActiveTab called');
  try {
    // Get ALL tabs, not just active ones
    const tabs = await chrome.tabs.query({});
    console.log('[glider] Found', tabs.length, 'total tabs');
    
    for (const tab of tabs) {
      console.log('[glider] Checking tab:', tab.id, tab.url?.slice(0, 50));
      if (tab && tab.id && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://')) {
        if (!connectedTabs.has(tab.id)) {
          try {
            await attachTab(tab.id);
            console.log('[glider] Auto-attached to tab:', tab.url);
            // Only attach first valid tab
            return;
          } catch (e) {
            console.log('[glider] Failed to attach tab:', tab.id, e.message);
          }
        }
      }
    }
    console.log('[glider] No valid tabs found to attach');
  } catch (e) {
    console.log('[glider] Auto-attach failed:', e.message);
  }
}

// Also auto-attach when switching tabs (optional aggressive mode)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (ws?.readyState !== WebSocket.OPEN) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://')) {
      if (!connectedTabs.has(tab.id)) {
        await attachTab(tab.id);
        console.log('[glider] Auto-attached on tab switch:', tab.url);
      }
    }
  } catch {}
});
