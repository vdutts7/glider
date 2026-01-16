const RELAY_URL = 'ws://localhost:19988/extension';
let ws = null;
let connectedTabs = new Map();
let nextSessionId = 1;

// Create offscreen document to keep service worker alive
let offscreenCreating = null;
async function setupOffscreen() {
  if (offscreenCreating) return offscreenCreating;
  
  offscreenCreating = (async () => {
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
    } finally {
      offscreenCreating = null;
    }
  })();
  
  return offscreenCreating;
}

// Handle keepalive messages from offscreen document
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'keepalive') {
    // Just receiving this keeps the worker alive
    sendResponse({ ok: true });
  }
  return true; // Keep channel open for async response
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
  // Browser-level commands that don't need a tab/session
  const browserLevelCommands = [
    'Target.createTarget',
    'Target.closeTarget',
    'Target.activateTarget',
    'Target.getTargets',
    'Target.attachToTarget'
  ];
  
  // For browser-level commands, handle without requiring a session
  if (browserLevelCommands.includes(method)) {
    if (method === 'Target.attachToTarget') {
      // Find the tab by targetId and return its sessionId
      const targetId = params?.targetId;
      for (const [tid, info] of connectedTabs) {
        if (info.targetId === targetId) {
          return { sessionId: info.sessionId };
        }
      }
      // If not found, try to attach to it
      // This handles the case where the target was created but not yet tracked
      throw new Error('Target not found: ' + targetId);
    }
    
    if (method === 'Target.createTarget') {
      // Create new tab (optionally in new window)
      let tab;
      if (params?.newWindow) {
        // Create in new window - these tabs CAN be closed
        const win = await chrome.windows.create({ url: params?.url || 'about:blank', focused: false });
        tab = win.tabs[0];
      } else {
        tab = await chrome.tabs.create({ url: params?.url || 'about:blank', active: false });
      }
      await new Promise(r => setTimeout(r, 500));
      
      // Try to detach any existing debugger first
      try {
        await chrome.debugger.detach({ tabId: tab.id });
      } catch (e) {
        // Ignore - no debugger attached
      }
      
      const { targetInfo } = await attachTab(tab.id);
      return { targetId: targetInfo.targetId };
    }
    
    if (method === 'Target.closeTarget') {
      // Find tab by targetId and close it
      const targetId = params?.targetId;
      let foundTabId = null;
      let foundWindowId = null;
      for (const [tid, info] of connectedTabs) {
        if (info.targetId === targetId) { foundTabId = tid; break; }
      }
      if (foundTabId) {
        try {
          // Get the window ID and tab count before closing
          const tab = await chrome.tabs.get(foundTabId);
          foundWindowId = tab.windowId;
          
          // Get window info to check tab count
          const win = await chrome.windows.get(foundWindowId, { populate: true });
          const isLastTab = win.tabs.length <= 1;
          
          // Detach debugger first
          await chrome.debugger.detach({ tabId: foundTabId }).catch(() => {});
          connectedTabs.delete(foundTabId);
          
          if (isLastTab) {
            // Close entire window if this is the last tab
            await chrome.windows.remove(foundWindowId);
          } else {
            // Just close the tab
            await chrome.tabs.remove(foundTabId);
          }
          
          // Notify relay
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              method: 'forwardCDPEvent',
              params: {
                method: 'Target.targetDestroyed',
                params: { targetId }
              }
            }));
          }
          return { success: true };
        } catch (e) {
          throw new Error('Could not close tab: ' + e.message);
        }
      }
      throw new Error('Target not found: ' + targetId);
    }
    
    if (method === 'Target.activateTarget') {
      // Bring tab to foreground
      const targetId = params?.targetId;
      let foundTabId = null;
      for (const [tid, info] of connectedTabs) {
        if (info.targetId === targetId) { foundTabId = tid; break; }
      }
      if (foundTabId) {
        await chrome.tabs.update(foundTabId, { active: true });
        const tab = await chrome.tabs.get(foundTabId);
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return { success: true };
      }
      throw new Error('Target not found: ' + targetId);
    }
    
    if (method === 'Target.getTargets') {
      return {
        targetInfos: Array.from(connectedTabs.values()).map(info => ({
          targetId: info.targetId,
          type: 'page',
          attached: true
        }))
      };
    }
  }
  
  // Session-scoped commands need a valid tab
  let tabId = null;
  for (const [tid, info] of connectedTabs) {
    if (info.sessionId === sessionId) { tabId = tid; break; }
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
  if (connectedTabs.has(src.tabId)) {
    detachTab(src.tabId);
    // Auto-reattach to another tab if we lost our only connection
    ensureConnected();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (connectedTabs.has(tabId)) {
    detachTab(tabId);
    // Auto-reattach to another tab if we lost our only connection
    ensureConnected();
  }
});

// Ensure at least one tab is always connected
async function ensureConnected() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (connectedTabs.size > 0) return; // Already have a connection
  
  console.log('[glider] No tabs connected, auto-attaching...');
  await autoAttachActiveTab();
}

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
// setupOffscreen called via onInstalled/onStartup listeners

// More aggressive reconnect - check every 3 seconds
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connect();
  } else if (connectedTabs.size === 0) {
    // WebSocket is connected but no tabs - auto-attach
    autoAttachActiveTab();
  }
}, 3000);

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

// Auto-attach when new tabs are created (if we have no connections)
chrome.tabs.onCreated.addListener(async (tab) => {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (connectedTabs.size > 0) return; // Already have connections
  
  // Wait for tab to load
  await new Promise(r => setTimeout(r, 1000));
  
  try {
    const updatedTab = await chrome.tabs.get(tab.id);
    if (updatedTab && !updatedTab.url?.startsWith('chrome://') && !updatedTab.url?.startsWith('chrome-extension://')) {
      await attachTab(tab.id);
      console.log('[glider] Auto-attached to new tab:', updatedTab.url);
    }
  } catch {}
});

// When a tab finishes loading, check if we need to attach
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (connectedTabs.size > 0) return; // Already have connections
  
  if (tab && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://')) {
    try {
      await attachTab(tabId);
      console.log('[glider] Auto-attached on tab load:', tab.url);
    } catch {}
  }
});
