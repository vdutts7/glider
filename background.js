const RELAY_URL = 'ws://localhost:19988/extension';
// WS lives in offscreen.js; SW talks via persistent port (wakes live chrome.* context).
let bridgePort = null;
let relayOpen = false;
let connectedTabs = new Map();
let nextSessionId = 1;

function relayConnected() {
  return !!(bridgePort && relayOpen);
}

function relaySend(obj) {
  if (!bridgePort) return false;
  try {
    bridgePort.postMessage(obj);
    return true;
  } catch (_) {
    bridgePort = null;
    return false;
  }
}

// OOPIF-PATCH v1: track child (OOPIF/worker) sessions spawned by Target.setAutoAttach flatten
// keyed by child sessionId. Value: { tabId (parent), targetId, targetType }
let childSessions = new Map();

// VENDOR-AGNOSTIC-PATCH v1: browser-internal URLs are un-attachable regardless of vendor.
// Chromium forks each ship their own scheme (chrome://, edge://, brave://, opera://,
// vivaldi://, arc://) plus 'about:' pages. Any attempt to chrome.debugger.attach one
// throws; we skip them wholesale via this single predicate so vendor-specific literals
// never sprawl through the codebase.
function isBrowserInternalUrl(u) {
  if (!u) return true;
  if (u.startsWith('about:')) return true;
  return /^(chrome|chrome-extension|edge|brave|opera|vivaldi|arc):\/\//.test(u);
}

// Chromium returns literal "No SW" when an extension API is dispatched after the
// MV3 worker stopped (crbug 341232995). Retry + poke an extension API to revive.
async function withSwRetry(fn, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = (e && e.message) ? e.message : String(e);
      if (!/No SW/i.test(msg)) throw e;
      try { await chrome.runtime.getPlatformInfo(); } catch (_) {}
      try { await setupOffscreen(); } catch (_) {}
      if (!relayConnected()) connect();
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw last;
}

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
          reasons: ['BLOBS', 'WORKERS'],
          justification: 'Hold relay WebSocket outside MV3 SW so chrome.* APIs stay live'
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
  // Prefer offscreen-owned WS. SW only ensures the document + bridge port exist.
  setupOffscreen().catch(() => {});
}

function bindBridgePort(port) {
  bridgePort = port;
  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'keepalive') return;
    if (msg.type === 'relay-open') {
      relayOpen = true;
      updateIcon();
      await new Promise((r) => setTimeout(r, 300));
      await autoAttachActiveTab();
      return;
    }
    if (msg.type === 'relay-closed') {
      relayOpen = false;
      connectedTabs.clear();
      updateIcon();
      return;
    }
    if (msg.type === 'relay') {
      await handleRelayInbound(msg.payload || {});
    }
  });
  port.onDisconnect.addListener(() => {
    if (bridgePort === port) bridgePort = null;
    relayOpen = false;
    updateIcon();
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'relay-bridge') return;
  bindBridgePort(port);
});

async function handleRelayInbound(msg) {
  if (msg.method === 'ping') {
    relaySend({ method: 'pong' });
    return;
  }

  if (msg.method === 'attachActiveTab') {
    await autoAttachActiveTab();
    relaySend({ id: msg.id, result: { attached: connectedTabs.size } });
    return;
  }

  if (msg.method === 'reloadSelf') {
    try {
      await persistAttachedUrls();
      relaySend({ id: msg.id, result: { reloading: true, persisted: connectedTabs.size } });
      setTimeout(() => { try { chrome.runtime.reload(); } catch (e) {} }, 200);
    } catch (e) {
      relaySend({ id: msg.id, error: { message: e.message } });
    }
    return;
  }

  if (msg.method === 'attachAllTabs') {
    const filter = msg.params?.urlSubstring;
    const perTabTimeoutMs = Number(msg.params?.perTabTimeoutMs) || 5000;
    let attached = 0, skipped = 0, failed = 0, timeouts = 0;
    try {
      const tabs = await withSwRetry(() => chrome.tabs.query({}));
      const attachPromises = [];
      for (const tab of tabs) {
        if (!tab || !tab.id || !tab.url) { skipped++; continue; }
        if (isBrowserInternalUrl(tab.url)) { skipped++; continue; }
        if (filter && !tab.url.includes(filter)) { skipped++; continue; }
        if (connectedTabs.has(tab.id)) { skipped++; continue; }
        const p = Promise.race([
          attachTab(tab.id).then(() => ({ ok: true })),
          new Promise((_, rej) => setTimeout(() => rej(new Error('per-tab-timeout')), perTabTimeoutMs))
        ]).then(
          () => { attached++; },
          (e) => { failed++; if (e && /per-tab-timeout/.test(e.message || '')) timeouts++; }
        );
        attachPromises.push(p);
      }
      await Promise.allSettled(attachPromises);
      await persistAttachedUrls();
      relaySend({ id: msg.id, result: { attached, skipped, failed, timeouts, total_connected: connectedTabs.size } });
    } catch (e) {
      relaySend({ id: msg.id, error: { message: e.message } });
    }
    return;
  }

  if (msg.method === 'corsFetch') {
    const response = { id: msg.id };
    try {
      const { url, options = {} } = msg.params || {};
      const cookies = await withSwRetry(() => chrome.cookies.getAll({ url: url }));
      const cookieString = cookies
        .filter(c => !c.expirationDate || c.expirationDate > Date.now() / 1000)
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
      const fetchOpts = {
        method: options.method || 'GET',
        headers: {
          ...(options.headers || { 'Accept': 'application/json' }),
          'Cookie': cookieString
        }
      };
      if (options.body) fetchOpts.body = options.body;
      const resp = await fetch(url, fetchOpts);
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      response.result = { status: resp.status, ok: resp.ok, data };
    } catch (err) {
      response.error = err.message || 'Fetch failed';
    }
    relaySend(response);
    return;
  }

  if (msg.method === 'forwardCDPCommand') {
    const response = { id: msg.id };
    try {
      response.result = await handleCDP(msg.params);
    } catch (err) {
      response.error = err.message || 'Unknown error';
    }
    relaySend(response);
    return;
  }

  if (msg.method === 'getCookies') {
    const response = { id: msg.id };
    try {
      const p = msg.params || {};
      const query = {};
      if (p.url) query.url = p.url;
      if (p.domain) query.domain = p.domain;
      if (p.name) query.name = p.name;
      const cookies = await withSwRetry(() => chrome.cookies.getAll(query));
      response.result = { data: cookies };
    } catch (err) {
      response.error = err.message || 'getCookies failed';
    }
    relaySend(response);
    return;
  }

  if (msg.method === 'setCookie') {
    const response = { id: msg.id };
    try {
      const p = msg.params || {};
      if (!p.url || !p.name) throw new Error('setCookie requires url and name');
      const details = { url: p.url, name: p.name, value: p.value ?? '' };
      for (const k of ['domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expirationDate', 'storeId']) {
        if (p[k] !== undefined) details[k] = p[k];
      }
      const cookie = await withSwRetry(() => chrome.cookies.set(details));
      response.result = { cookie };
    } catch (err) {
      response.error = err.message || 'setCookie failed';
    }
    relaySend(response);
    return;
  }

  if (msg.method === 'removeCookie') {
    const response = { id: msg.id };
    try {
      const p = msg.params || {};
      if (!p.url || !p.name) throw new Error('removeCookie requires url and name');
      const details = { url: p.url, name: p.name };
      if (p.storeId) details.storeId = p.storeId;
      const removed = await withSwRetry(() => chrome.cookies.remove(details));
      response.result = { removed };
    } catch (err) {
      response.error = err.message || 'removeCookie failed';
    }
    relaySend(response);
    return;
  }
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
      // v3.24-FIX (OOPIF-DISPATCH): the requested targetId may be a CHILD (OOPIF /
      // worker / service worker) surfaced by Target.setAutoAttach{flatten:true} on a
      // parent tab. In that case it's already in childSessions and we just return
      // its sessionId - no re-attach needed (auto-attach did it).
      for (const [csid, cinfo] of childSessions) {
        if (cinfo.targetId === targetId) {
          return { sessionId: csid };
        }
      }
      // v3.24-FIX: last resort - the client discovered the targetId via
      // Target.getTargets but the OOPIF hasn't fired the auto-attach event yet.
      // Try live attach on each parent tab; first one that succeeds wins.
      for (const [ptid, pinfo] of connectedTabs) {
        try {
          const r = await chrome.debugger.sendCommand({ tabId: ptid }, 'Target.attachToTarget', { targetId, flatten: true });
          if (r && r.sessionId) {
            // Record it - attachedToTarget listener will double-record; harmless.
            childSessions.set(r.sessionId, { tabId: ptid, targetId, targetType: 'iframe', url: '' });
            return { sessionId: r.sessionId };
          }
        } catch (_) { /* try next parent */ }
      }
      throw new Error('Target not found: ' + targetId);
    }
    
    if (method === 'Target.createTarget') {
      // Strip tab, background only. No focus steal. Strip-invisible (CDP hidden)
      // stays in glidercli remotedebug path, not here.
      const url = params?.url || 'about:blank';
      let tab;
      if (params?.newWindow) {
        const win = await withSwRetry(() => chrome.windows.create({
          url,
          focused: false,
          state: 'minimized',
        }));
        tab = win.tabs[0];
      } else {
        tab = await withSwRetry(() => chrome.tabs.create({
          url,
          active: false,
        }));
      }
      await new Promise(r => setTimeout(r, 500));
      try {
        await chrome.debugger.detach({ tabId: tab.id });
      } catch (e) {}
      const { targetInfo } = await withSwRetry(() => attachTab(tab.id));
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
          if (relayConnected()) {
            relaySend({
              method: 'forwardCDPEvent',
              params: {
                method: 'Target.targetDestroyed',
                params: { targetId }
              }
            })
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
      // v3.24-FIX (OOPIF-DISPATCH): include both top-level tabs AND tracked
      // OOPIF/worker child sessions so callers can discover children without
      // per-tab probing; nested iframe targets are now listed for callers.
      const parents = Array.from(connectedTabs.values()).map(info => ({
        targetId: info.targetId,
        type: 'page',
        attached: true
      }));
      const children = Array.from(childSessions.entries()).map(([sid, cinfo]) => ({
        targetId: cinfo.targetId,
        type: cinfo.targetType || 'iframe',
        url: cinfo.url || '',
        attached: true,
        openerId: (function() {
          const p = connectedTabs.get(cinfo.tabId);
          return p ? p.targetId : undefined;
        })(),
        _oopif: true
      }));
      return { targetInfos: parents.concat(children) };
    }
  }
  
  // Session-scoped commands need a valid tab
  let tabId = null;
  let childRoute = null;  // OOPIF-PATCH: if sessionId is a child, route with {tabId, sessionId} to chrome.debugger
  for (const [tid, info] of connectedTabs) {
    if (info.sessionId === sessionId) { tabId = tid; break; }
  }
  if (!tabId) {
    // OOPIF-PATCH: check child sessions
    const child = childSessions.get(sessionId);
    if (child) {
      tabId = child.tabId;
      childRoute = sessionId;
    }
  }

  if (!tabId) throw new Error('Session not found');
  // OOPIF-PATCH: for child (OOPIF) sessions, chrome.debugger.sendCommand accepts
  // {tabId, sessionId} as the target to route into the flatten sub-session.
  const target = childRoute ? { tabId, sessionId: childRoute } : { tabId };
  return await chrome.debugger.sendCommand(target, method, params);
}

async function attachTab(tabId) {
  console.log('[glider] Attempting to attach tab:', tabId);
  try {
    await withSwRetry(() => chrome.debugger.attach({ tabId }, '1.3'));
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
  
  if (relayConnected()) {
    relaySend({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false }
      }
    })
  }
  
  updateIcon();
  // Persist attached URL list for post-restart restore
  persistAttachedUrls().catch(() => {});
  return { targetInfo, sessionId };
}

function detachTab(tabId) {
  const info = connectedTabs.get(tabId);
  if (!info) return;
  
  if (relayConnected()) {
    relaySend({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: info.sessionId, targetId: info.targetId }
      }
    })
  }
  
  connectedTabs.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
  updateIcon();
  // Keep persisted URLs fresh so restart-restore reflects reality
  persistAttachedUrls().catch(() => {});
}

function updateIcon() {
  const n = connectedTabs.size;
  const ok = relayConnected();
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : (ok ? '' : '!') });
  chrome.action.setBadgeBackgroundColor({ color: n > 0 ? '#22c55e' : (ok ? '#64748b' : '#ef4444') });
}

chrome.debugger.onEvent.addListener((src, method, params) => {
  const info = connectedTabs.get(src.tabId);
  if (!info || !relayConnected()) return;

  // OOPIF-PATCH: intercept child attach/detach events (params.sessionId identifies child)
  // and forward under the CHILD's sessionId so client-side session routing works.
  const childSid = params && params.sessionId ? params.sessionId : null;

  if (method === 'Target.attachedToTarget' && childSid) {
    const ti = params.targetInfo || {};
    childSessions.set(childSid, {
      tabId: src.tabId,
      targetId: ti.targetId,
      targetType: ti.type,
      url: ti.url
    });
    // Forward the event verbatim (params still carry childSid) but under an EMPTY
    // top-level sessionId so client-side sees "browser-level" attached event -
    // matches CDP flatten semantics: attach events for children are emitted at the
    // parent session level with params.sessionId identifying the new child.
    relaySend({
      method: 'forwardCDPEvent',
      params: { sessionId: info.sessionId, method, params }
    })
    return;
  }

  if (method === 'Target.detachedFromTarget' && childSid) {
    childSessions.delete(childSid);
    relaySend({
      method: 'forwardCDPEvent',
      params: { sessionId: info.sessionId, method, params }
    })
    return;
  }

  // OOPIF-PATCH: for events emitted from within a CHILD session (Network.*, Runtime.*),
  // chrome.debugger sets src.sessionId. Route those under the child sessionId.
  if (src.sessionId && childSessions.has(src.sessionId)) {
    relaySend({
      method: 'forwardCDPEvent',
      params: { sessionId: src.sessionId, method, params }
    })
    return;
  }

  // Default: forward under parent tab's sessionId (existing behavior)
  relaySend({ method: 'forwardCDPEvent', params: { sessionId: info.sessionId, method, params } })
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
  if (!relayConnected()) return;
  if (connectedTabs.size > 0) return; // Already have a connection
  
  console.log('[glider] No tabs connected, auto-attaching...');
  await autoAttachActiveTab();
}

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[glider] Extension icon clicked, tab:', tab?.id, tab?.url);
  if (!tab.id || isBrowserInternalUrl(tab.url)) {
    console.log('[glider] Skipping browser-internal or extension page');
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

// Keep service worker alive - Chrome suspends inactive workers (~30s).
// Alarms wake SW in background with zero focus/tab mutation (Chrome docs + OpenClaw pattern).
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'keepalive') return;
  // Extension API poke resets idle timer even if WS is already open.
  chrome.runtime.getPlatformInfo().catch(() => {});
  setupOffscreen().catch(() => {});
  if (!relayConnected()) connect();
});

// Top-level reconnect: setInterval dies with SW; alarms survive. Keep a short interval
// only while the worker is alive; alarms restart the loop after suspension.
setInterval(() => {
  if (!relayConnected()) {
    connect();
  } else if (connectedTabs.size === 0) {
    autoAttachActiveTab();
  }
}, 3000);

// Auto-attach to active tab when relay connects
async function autoAttachActiveTab() {
  console.log('[glider] autoAttachActiveTab called');
  try {
    // Attempt to restore previously-attached tabs from chrome.storage
    // so `glider restart` doesn't lose N sessions per restart.
    let priorUrls = [];
    try {
      const s = await chrome.storage.local.get('lastAttachedUrls');
      priorUrls = s.lastAttachedUrls || [];
    } catch(e) {}

    const tabs = await chrome.tabs.query({});
    console.log('[glider] Found', tabs.length, 'total tabs; prior attached count:', priorUrls.length);

    let attachedThisCall = 0;
    // Priority 1: reattach tabs whose URLs match priorUrls
    if (priorUrls.length > 0) {
      const priorSet = new Set(priorUrls);
      for (const tab of tabs) {
        if (!tab || !tab.id || !tab.url) continue;
        if (isBrowserInternalUrl(tab.url)) continue;
        if (!priorSet.has(tab.url)) continue;
        if (connectedTabs.has(tab.id)) continue;
        try { await attachTab(tab.id); attachedThisCall++; console.log('[glider] Restored prior tab:', tab.url.slice(0,80)); }
        catch(e) { console.log('[glider] Prior-restore failed:', tab.id, e.message); }
      }
    }

    // Priority 2: if nothing restored, fall back to attaching the active tab (original behavior)
    if (attachedThisCall === 0) {
      for (const tab of tabs) {
        if (!tab || !tab.id) continue;
        if (isBrowserInternalUrl(tab.url)) continue;
        if (connectedTabs.has(tab.id)) continue;
        try { await attachTab(tab.id); console.log('[glider] Fallback-attached:', tab.url?.slice(0,80)); return; }
        catch(e) {}
      }
    }
    console.log('[glider] autoAttachActiveTab done; attached this call:', attachedThisCall);
  } catch (e) {
    console.log('[glider] Auto-attach failed:', e.message);
  }
}

// Persist URL of every attached tab so we can restore across restarts.
async function persistAttachedUrls() {
  try {
    const urls = [];
    for (const [tabId, _info] of connectedTabs) {
      try { const t = await chrome.tabs.get(tabId); if (t && t.url) urls.push(t.url); } catch(e) {}
    }
    await chrome.storage.local.set({ lastAttachedUrls: urls });
  } catch(e) {}
}

// Also auto-attach when switching tabs (optional aggressive mode)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!relayConnected()) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && !isBrowserInternalUrl(tab.url)) {
      if (!connectedTabs.has(tab.id)) {
        await attachTab(tab.id);
        console.log('[glider] Auto-attached on tab switch:', tab.url);
      }
    }
  } catch {}
});

// Auto-attach when new tabs are created (if we have no connections)
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!relayConnected()) return;
  if (connectedTabs.size > 0) return; // Already have connections
  
  // Wait for tab to load
  await new Promise(r => setTimeout(r, 1000));
  
  try {
    const updatedTab = await chrome.tabs.get(tab.id);
    if (updatedTab && !isBrowserInternalUrl(updatedTab.url)) {
      await attachTab(tab.id);
      console.log('[glider] Auto-attached to new tab:', updatedTab.url);
    }
  } catch {}
});

// When a tab finishes loading, check if we need to attach
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!relayConnected()) return;
  if (connectedTabs.size > 0) return; // Already have connections
  
  if (tab && !isBrowserInternalUrl(tab.url)) {
    try {
      await attachTab(tabId);
      console.log('[glider] Auto-attached on tab load:', tab.url);
    } catch {}
  }
});
