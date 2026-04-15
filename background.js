// background service worker
// all listeners at top level for MV3

const DEFAULT_SETTINGS = {
  suspendAfterMinutes: 30,
  whitelist: [],
  enableAutoSuspend: true,
  protectPinned: true,
  protectAudio: true,
  protectForms: false,
  suspendOnStartup: true,
  markSuspendedTabs: false
};

let _injectedTabs = new Set();

async function hasHostPermission() {
  try {
    return await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch { return false; }
}

async function injectFormCheck(tabId) {
  if (_injectedTabs.has(tabId)) return;
  if (!(await hasHostPermission())) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['formcheck.js']
    });
    _injectedTabs.add(tabId);
  } catch {}
}

const ALARM_NAME = 'check-tabs';
const BADGE_COLOR = '#6C63FF';
const MB_PER_TAB = 150;
const MAX_SESSIONS = 20;

let badgeTimer = null;

function t(key, subs) {
  return chrome.i18n.getMessage(key, subs) || key;
}

chrome.runtime.onInstalled.addListener(onInstalled);
chrome.runtime.onStartup.addListener(onStartup);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onCreated.addListener(onTabCreated);
chrome.tabs.onRemoved.addListener(onTabRemoved);
chrome.tabs.onReplaced.addListener(onTabReplaced);
chrome.contextMenus.onClicked.addListener(onContextMenuClicked);
chrome.commands.onCommand.addListener(onCommand);
chrome.runtime.onMessage.addListener(onMessage);

async function onInstalled(details) {
  await initSettings();
  await createAlarm();
  createContextMenus();
  await initTimestamps();
  await updateBadgeNow();

  // Sync host-gated settings with actual permission state
  try {
    let hasHost = await hasHostPermission();
    if (!hasHost) {
      let settings = await getSettings();
      let changed = false;
      if (settings.protectForms) { settings.protectForms = false; changed = true; }
      if (settings.markSuspendedTabs) { settings.markSuspendedTabs = false; changed = true; }
      if (changed) await chrome.storage.sync.set({ settings });
    }
  } catch {}

  if (details.reason === 'install') {
    await initStats();
    try { chrome.tabs.create({ url: 'onboarding.html' }); } catch {}
  } else if (details.reason === 'update') {
    let version = chrome.runtime.getManifest().version;
    let data = await chrome.storage.local.get('drowzy_lastChangelogVersion');
    let lastVer = data.drowzy_lastChangelogVersion || '';
    // Only show changelog on major/minor bumps (e.g. 1.2.x → 1.3.x), not patches
    let curMinor = version.split('.').slice(0, 2).join('.');
    let lastMinor = lastVer.split('.').slice(0, 2).join('.');
    if (curMinor !== lastMinor) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
      try { chrome.tabs.create({ url: 'changelog.html' }); } catch {}
    } else if (lastVer !== version) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
    }
  }
}

async function onStartup() {
  await createAlarm();
  await initTimestamps();
  await updateBadgeNow();

  let settings = await getSettings();
  if (settings.suspendOnStartup) {
    setTimeout(() => suspendAllOnStartup(settings), 5000);
  }
}

async function suspendAllOnStartup(settings) {
  try {
    let tabs = await chrome.tabs.query({});
    for (let tab of tabs) {
      if (tab.active || tab.discarded) continue;
      if (isInternalUrl(tab.url)) continue;
      if (settings.protectPinned && tab.pinned) continue;
      if (settings.protectAudio && tab.audible) continue;
      if (isWhitelisted(tab.url, settings.whitelist)) continue;
      // Use discard directly at startup for speed (avoids per-tab getSettings + form injection)
      // Form check is skipped at startup since content scripts aren't reliably loaded yet
      if (settings.markSuspendedTabs) {
        try {
          await injectFormCheck(tab.id);
          await chrome.tabs.sendMessage(tab.id, { action: 'markSuspended' });
        } catch {}
      }
      try {
        let result = await chrome.tabs.discard(tab.id);
        if (result) await recordSuspension();
      } catch {}
    }
    await updateBadgeNow();
  } catch {}
}

let _timestamps = {};
let _tsDirty = false;
let _tsFlushTimer = null;

async function initTimestamps() {
  try {
    let data = await chrome.storage.session.get('tabTimestamps');
    _timestamps = data.tabTimestamps || {};
    let tabs = await chrome.tabs.query({});
    let now = Date.now();
    let liveIds = new Set(tabs.map(tab => tab.id));

    // Add missing tabs
    for (let tab of tabs) {
      if (!(tab.id in _timestamps)) {
        _timestamps[tab.id] = now;
        _tsDirty = true;
      }
    }

    // Prune stale tab IDs that no longer exist
    for (let id in _timestamps) {
      if (!liveIds.has(Number(id))) {
        delete _timestamps[id];
        _tsDirty = true;
      }
    }

    await flushTimestamps();
  } catch {}
}

function scheduleFlush() {
  if (_tsFlushTimer) return;
  _tsFlushTimer = setTimeout(() => {
    _tsFlushTimer = null;
    flushTimestamps();
  }, 5000);
}

async function flushTimestamps() {
  if (!_tsDirty) return;
  try {
    await chrome.storage.session.set({ tabTimestamps: _timestamps });
    _tsDirty = false;
  } catch {}
}

/* settings */

async function initSettings() {
  let synced = await chrome.storage.sync.get('settings');
  if (synced.settings) return;

  let local = await chrome.storage.local.get('settings');
  if (local.settings) {
    await chrome.storage.sync.set({ settings: local.settings });
    await chrome.storage.local.remove('settings');
    return;
  }

  await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
}

async function getSettings() {
  let stored = await chrome.storage.sync.get('settings');
  if (!stored.settings) return { ...DEFAULT_SETTINGS };
  let merged = { ...DEFAULT_SETTINGS, ...stored.settings };
  if (!Array.isArray(merged.whitelist)) merged.whitelist = [];
  merged.whitelist = merged.whitelist.map(w => w.toLowerCase().replace(/^www\./, ''));
  return merged;
}

async function initStats() {
  let data = await chrome.storage.local.get('drowzy_stats');
  if (!data.drowzy_stats) {
    await chrome.storage.local.set({
      drowzy_stats: {
        totalTabsSuspended: 0,
        totalTabsSuspendedToday: 0,
        todayDate: _localDate(),
        installDate: Date.now()
      }
    });
  }
}

function _localDate() {
  let d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _defaultStats() {
  return {
    totalTabsSuspended: 0,
    totalTabsSuspendedToday: 0,
    todayDate: _localDate(),
    installDate: Date.now()
  };
}

async function recordSuspension() {
  try {
    let data = await chrome.storage.local.get('drowzy_stats');
    let stats = data.drowzy_stats || _defaultStats();

    let today = _localDate();
    if (stats.todayDate !== today) {
      stats.totalTabsSuspendedToday = 0;
      stats.todayDate = today;
    }
    stats.totalTabsSuspended++;
    stats.totalTabsSuspendedToday++;
    await chrome.storage.local.set({ drowzy_stats: stats });
  } catch {}
}

async function getStats() {
  let data = await chrome.storage.local.get('drowzy_stats');
  let stats = data.drowzy_stats || _defaultStats();

  let today = _localDate();
  if (stats.todayDate !== today) {
    stats.totalTabsSuspendedToday = 0;
    stats.todayDate = today;
    await chrome.storage.local.set({ drowzy_stats: stats });
  }
  return stats;
}

async function createAlarm() {
  let existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}

async function onAlarm(alarm) {
  if (alarm.name === ALARM_NAME) await checkAndSuspendTabs();
}

async function onTabActivated(activeInfo) {
  await touchTab(activeInfo.tabId);
  // Flush immediately on activation since worker is alive during this event
  await flushTimestamps();
  debouncedBadgeUpdate();
}

async function onTabUpdated(tabId, changeInfo) {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await touchTab(tabId);
    if (changeInfo.url) _injectedTabs.delete(tabId);
  }
  if (changeInfo.discarded !== undefined) debouncedBadgeUpdate();
}

async function onTabCreated(tab) { await touchTab(tab.id); }

async function onTabRemoved(tabId) {
  delete _timestamps[tabId];
  _injectedTabs.delete(tabId);
  _tsDirty = true;
  scheduleFlush();
  debouncedBadgeUpdate();
}

async function onTabReplaced(addedTabId, removedTabId) {
  _timestamps[addedTabId] = _timestamps[removedTabId] || Date.now();
  delete _timestamps[removedTabId];
  _tsDirty = true;
  scheduleFlush();
}

async function touchTab(tabId) {
  _timestamps[tabId] = Date.now();
  _tsDirty = true;
  scheduleFlush();
}

async function checkAndSuspendTabs() {
  let settings = await getSettings();
  if (!settings.enableAutoSuspend) return;

  let minutes = Number(settings.suspendAfterMinutes);
  if (!minutes || minutes <= 0) return;

  let tabs = await chrome.tabs.query({});
  let now = Date.now();
  let threshold = minutes * 60 * 1000;

  let toSuspend = [];
  for (let tab of tabs) {
    if (!(tab.id in _timestamps)) {
      _timestamps[tab.id] = now;
      _tsDirty = true;
    }
    if (shouldSuspend(tab, settings, _timestamps, now, threshold)) {
      toSuspend.push(tab.id);
    }
  }

  if (_tsDirty) scheduleFlush();

  if (toSuspend.length) {
    for (let tabId of toSuspend) {
      await injectFormCheck(tabId);
      try { await chrome.tabs.sendMessage(tabId, { action: 'suspendWarning' }); } catch {}
    }
    await new Promise(r => setTimeout(r, 2500));
    for (let tabId of toSuspend) {
      await suspendTab(tabId);
    }
  }
}

function shouldSuspend(tab, settings, timestamps, now, threshold) {
  if (tab.active || tab.discarded) return false;
  if (isInternalUrl(tab.url)) return false;
  if (settings.protectPinned && tab.pinned) return false;
  if (settings.protectAudio && tab.audible) return false;
  if (isWhitelisted(tab.url, settings.whitelist)) return false;

  let lastActive = timestamps[tab.id];
  return lastActive && (now - lastActive >= threshold);
}

function isInternalUrl(url) {
  if (!url) return true;
  try {
    let protocol = new URL(url).protocol;
    return protocol !== 'http:' && protocol !== 'https:';
  } catch { return true; }
}

function isWhitelisted(url, whitelist) {
  if (!url || !whitelist || !whitelist.length) return false;
  try {
    let parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let fullUrl = (parsed.hostname + parsed.pathname).toLowerCase().replace(/^www\./, '');
    return whitelist.some(d => {
      d = d.toLowerCase().replace(/^www\./, '');
      if (d.includes('/')) {
        let escaped = d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        try { return new RegExp('^' + escaped + '(/.*)?$').test(fullUrl); } catch { return false; }
      }
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch { return false; }
}

async function suspendTab(tabId) {
  try {
    let tab = await chrome.tabs.get(tabId);
    if (tab.active || tab.discarded) return false;
    if (isInternalUrl(tab.url)) return false;

    let settings = await getSettings();
    if (settings.protectPinned && tab.pinned) return false;
    if (settings.protectAudio && tab.audible) return false;
    if (isWhitelisted(tab.url, settings.whitelist)) return false;

    if (settings.protectForms || settings.markSuspendedTabs) {
      await injectFormCheck(tabId);
    }

    if (settings.protectForms) {
      try {
        let resp = await Promise.race([
          chrome.tabs.sendMessage(tabId, { action: 'checkFormData' }),
          new Promise(resolve => setTimeout(() => resolve(null), 500))
        ]);
        if (resp && resp.hasFormData) return false;
      } catch {}
    }

    if (settings.markSuspendedTabs) {
      try { await chrome.tabs.sendMessage(tabId, { action: 'markSuspended' }); } catch {}
    }

    // Final recheck immediately before discard — user may have switched to
    // this tab during the preceding awaits (form check, message round-trips).
    // Discarding an active tab forces a visible reload when the user looks at it.
    try {
      let fresh = await chrome.tabs.get(tabId);
      if (fresh.active || fresh.discarded || fresh.audible) return false;
    } catch { return false; }

    let result = await chrome.tabs.discard(tabId);
    if (result) {
      debouncedBadgeUpdate();
      await recordSuspension();
      return true;
    }
    return false;
  } catch { return false; }
}

function debouncedBadgeUpdate() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => updateBadgeNow(), 300);
}

async function updateBadgeNow() {
  try {
    let [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let query = { discarded: true };
    if (active) query.windowId = active.windowId;
    let discarded = await chrome.tabs.query(query);
    let n = discarded.length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch {}
}

/* context menus + shortcuts */

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'suspend-this', title: t('ctxSuspendThis'),
      contexts: ['page', 'action']
    });
    chrome.contextMenus.create({
      id: 'suspend-others', title: t('ctxSuspendOthers'),
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'whitelist-site', title: t('ctxNeverSuspend'),
      contexts: ['page', 'action']
    });
  });
}

async function onContextMenuClicked(info, tab) {
  try {
    if (info.menuItemId === 'suspend-this') {
      if (tab) await handleSuspendCurrent(tab);
    } else if (info.menuItemId === 'suspend-others') {
      await suspendAllOthers(tab?.windowId);
    } else if (info.menuItemId === 'whitelist-site') {
      if (tab?.url && !isInternalUrl(tab.url)) {
        let domain = new URL(tab.url).hostname;
        if (domain && domain.includes('.')) await addWhitelist(domain);
      }
    }
  } catch {}
}

async function onCommand(command) {
  try {
    if (command === 'suspend-current') {
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await handleSuspendCurrent(tab);
    } else if (command === 'suspend-others') {
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await suspendAllOthers(tab?.windowId);
    } else if (command === 'wake-all') {
      let [wakeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await unsuspendAll(wakeTab?.windowId);
    }
  } catch {}
}

async function handleSuspendCurrent(activeTab) {
  if (activeTab.discarded || isInternalUrl(activeTab.url)) return;

  let settings = await getSettings();
  if (settings.protectPinned && activeTab.pinned) return;
  if (settings.protectAudio && activeTab.audible) return;
  if (isWhitelisted(activeTab.url, settings.whitelist)) return;

  let allTabs = await chrome.tabs.query({ windowId: activeTab.windowId });
  let other = allTabs.find(tab => tab.id !== activeTab.id && !tab.discarded && !isInternalUrl(tab.url));
  if (!other) return;

  try {
    await chrome.tabs.update(other.id, { active: true });
    await suspendTab(activeTab.id);
  } catch {}
}

async function suspendAllOthers(windowId) {
  let settings = await getSettings();
  let tabs = await chrome.tabs.query(windowId ? { windowId } : {});

  for (let tab of tabs) {
    if (tab.active || tab.discarded || isInternalUrl(tab.url)) continue;
    if (settings.protectPinned && tab.pinned) continue;
    if (settings.protectAudio && tab.audible) continue;
    if (isWhitelisted(tab.url, settings.whitelist)) continue;
    await suspendTab(tab.id);
  }
}

async function unsuspendAll(windowId) {
  let query = { discarded: true };
  if (windowId) query.windowId = windowId;
  let tabs = await chrome.tabs.query(query);
  for (let tab of tabs) {
    try { await chrome.tabs.reload(tab.id); } catch {}
  }
  await updateBadgeNow();
}

async function addWhitelist(domain) {
  if (!domain || typeof domain !== 'string') return { added: false, error: t('invalidDomain') };
  let d = domain.toLowerCase().replace(/^www\./, '').trim();
  if (!d) return { added: false, error: t('invalidDomain') };
  // Strip port from domain part before validation
  let domainPart = d.split('/')[0].replace(/:\d+$/, '');
  if (!domainPart.includes('.') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return { added: false, error: t('invalidDomain') };
  }
  // Also strip port from stored value so it matches hostname-based lookups
  d = d.replace(/^([^/:]+):\d+/, '$1');
  let settings = await getSettings();
  if (!settings.whitelist.includes(d)) {
    settings.whitelist.push(d);
    await chrome.storage.sync.set({ settings });
    return { added: true };
  }
  return { added: false };
}

async function removeWhitelist(domain) {
  if (!domain || typeof domain !== 'string') return;
  let settings = await getSettings();
  let d = domain.toLowerCase().replace(/^www\./, '');
  settings.whitelist = settings.whitelist.filter(w => w !== d);
  await chrome.storage.sync.set({ settings });
}

async function getSessions() {
  let data = await chrome.storage.local.get('drowzy_sessions');
  return data.drowzy_sessions || [];
}

async function saveSession(name) {
  let sessions = await getSessions();
  if (sessions.length >= MAX_SESSIONS) {
    return { success: false, error: t('maxSessionsReached') };
  }

  let tabs = await chrome.tabs.query({ currentWindow: true });
  let valid = tabs.filter(tab => tab.url && !isInternalUrl(tab.url) && !tab.incognito);
  if (!valid.length) {
    return { success: false, error: t('noSaveableTabs') };
  }

  let groupMap = {};
  if (chrome.tabGroups) {
    for (let tab of valid) {
      if (tab.groupId != null && tab.groupId !== -1 && !groupMap[tab.groupId]) {
        try {
          let group = await chrome.tabGroups.get(tab.groupId);
          groupMap[tab.groupId] = { title: group.title || '', color: group.color || 'grey' };
        } catch { groupMap[tab.groupId] = { title: '', color: 'grey' }; }
      }
    }
  }

  let session = {
    id: 'session_' + Date.now(),
    name: name || _formatSessionName(),
    createdAt: Date.now(),
    groups: groupMap,
    tabs: valid.map(tab => ({
      url: tab.url,
      title: tab.title || t('tabUntitled'),
      favIconUrl: tab.favIconUrl || '',
      pinned: tab.pinned || false,
      groupId: tab.groupId != null ? tab.groupId : -1
    }))
  };

  sessions.unshift(session);
  await chrome.storage.local.set({ drowzy_sessions: sessions });
  return { success: true, session };
}

function _formatSessionName() {
  let d = new Date();
  let dateStr = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return t('sessionDefaultName', [dateStr]);
}

async function deleteSession(id) {
  let sessions = await getSessions();
  await chrome.storage.local.set({ drowzy_sessions: sessions.filter(s => s.id !== id) });
  return { success: true };
}

async function restoreSession(id, mode) {
  let sessions = await getSessions();
  let session = sessions.find(s => s.id === id);
  if (!session) return { success: false, error: t('sessionNotFound') };

  let restorable = session.tabs.filter(tab => tab.url && !isInternalUrl(tab.url));
  if (!restorable.length) {
    return { success: false, error: t('noRestorableTabs') };
  }

  let createdTabs = [];
  if (mode === 'replace') {
    let currentTabs = await chrome.tabs.query({ currentWindow: true });
    try {
      for (let i = 0; i < restorable.length; i++) {
        try {
          let created = await chrome.tabs.create({ url: restorable[i].url, pinned: restorable[i].pinned, active: i === 0 });
          await touchTab(created.id);
          createdTabs.push({ tabId: created.id, groupId: restorable[i].groupId });
        } catch {}
      }
      if (createdTabs.length === 0) {
        return { success: false, error: t('failedToRestore') };
      }
      if (createdTabs.length < restorable.length) {
        try { await chrome.tabs.remove(createdTabs.map(ct => ct.tabId)); } catch {}
        return { success: false, error: t('failedToRestore') };
      }
      let oldIds = currentTabs.map(tab => tab.id).filter(id => !createdTabs.some(ct => ct.tabId === id));
      if (oldIds.length) await chrome.tabs.remove(oldIds);
    } catch (e) {
      return { success: false, error: e.message };
    }
  } else {
    for (let tab of restorable) {
      try {
        let created = await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
        await touchTab(created.id);
        createdTabs.push({ tabId: created.id, groupId: tab.groupId });
      } catch {}
    }
  }

  // Reconstruct tab groups (only if tabGroups permission is available)
  if (session.groups && chrome.tabGroups) {
    let oldToNew = {};
    for (let ct of createdTabs) {
      if (ct.groupId == null || ct.groupId === -1) continue;
      try {
        if (!oldToNew[ct.groupId]) {
          let newGroupId = await chrome.tabs.group({ tabIds: [ct.tabId] });
          if (chrome.tabGroups) {
            let gInfo = session.groups[ct.groupId] || {};
            try { await chrome.tabGroups.update(newGroupId, { title: gInfo.title || '', color: gInfo.color || 'grey' }); } catch {}
          }
          oldToNew[ct.groupId] = newGroupId;
        } else {
          await chrome.tabs.group({ tabIds: [ct.tabId], groupId: oldToNew[ct.groupId] });
        }
      } catch {}
    }
  }

  return { success: true, count: restorable.length };
}

async function getTabList(windowId) {
  let settings = await getSettings();
  let tabs = await chrome.tabs.query(windowId ? { windowId } : {});
  let now = Date.now();
  let threshold = settings.suspendAfterMinutes * 60 * 1000;

  return tabs.map(tab => {
    let status = 'idle';
    let protectReason = null;
    let timeLeft = null;

    if (tab.active) {
      status = 'active';
      protectReason = 'Active tab';
    } else if (tab.discarded) {
      status = 'suspended';
    } else if (isInternalUrl(tab.url)) {
      status = 'protected';
      protectReason = 'System page';
    } else if (settings.protectPinned && tab.pinned) {
      status = 'protected';
      protectReason = 'Pinned';
    } else if (settings.protectAudio && tab.audible) {
      status = 'protected';
      protectReason = 'Audio';
    } else if (isWhitelisted(tab.url, settings.whitelist)) {
      status = 'protected';
      protectReason = 'Whitelisted';
    } else if (settings.enableAutoSuspend && threshold > 0) {
      let lastActive = _timestamps[tab.id];
      if (lastActive) {
        let remaining = threshold - (now - lastActive);
        timeLeft = Math.max(0, Math.ceil(remaining / 60000));
      }
    }

    return {
      id: tab.id,
      title: tab.title || t('tabUntitled'),
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      status, protectReason, timeLeft,
      pinned: tab.pinned,
      audible: tab.audible
    };
  });
}

function onMessage(msg, sender, sendResponse) {
  // Content scripts (sender.tab exists) should never call background actions
  if (sender.tab) {
    sendResponse({ error: 'Unauthorized' });
    return false;
  }
  handleMessage(msg).then(sendResponse).catch(e => {
    sendResponse({ error: e.message || 'Unknown error' });
  });
  return true;
}

async function handleMessage(msg) {
  switch (msg.action) {
    case 'getStatus': {
      let [allTabs, discardedTabs] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        chrome.tabs.query({ discarded: true, currentWindow: true })
      ]);
      let settings = await getSettings();
      let protectedCount = allTabs.filter(tab =>
        !tab.discarded && (
          tab.active || isInternalUrl(tab.url) ||
          (settings.protectPinned && tab.pinned) ||
          (settings.protectAudio && tab.audible) ||
          isWhitelisted(tab.url, settings.whitelist)
        )
      ).length;
      return {
        totalTabs: allTabs.length,
        suspendedCount: discardedTabs.length,
        protectedCount,
        estimatedMbSaved: discardedTabs.length * MB_PER_TAB
      };
    }

    case 'getSettings': return await getSettings();
    case 'updateSettings': {
      let current = await chrome.storage.sync.get('settings');
      let currentWhitelist = (current.settings && Array.isArray(current.settings.whitelist))
        ? current.settings.whitelist : DEFAULT_SETTINGS.whitelist;
      let merged = { ...DEFAULT_SETTINGS, ...msg.settings };
      // Always preserve the authoritative whitelist from storage
      // (whitelist is managed exclusively via addWhitelist/removeWhitelist)
      merged.whitelist = currentWhitelist;
      await chrome.storage.sync.set({ settings: merged });
      return { success: true };
    }

    case 'suspendTab': return { success: await suspendTab(msg.tabId) };
    case 'suspendOthers': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      await suspendAllOthers(at?.windowId);
      return { success: true };
    }
    case 'unsuspendAll': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      await unsuspendAll(at?.windowId);
      return { success: true };
    }
    case 'addWhitelist': {
      let result = await addWhitelist(msg.domain);
      return { success: result.added, ...result };
    }
    case 'removeWhitelist': await removeWhitelist(msg.domain); return { success: true };
    case 'getTabList': {
      let [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return await getTabList(active?.windowId);
    }
    case 'wakeTab':
      try {
        // Remove [zzz] prefix before reloading if markSuspendedTabs was used
        try {
          await injectFormCheck(msg.tabId);
          await chrome.tabs.sendMessage(msg.tabId, { action: 'unmarkSuspended' });
        } catch {}
        await chrome.tabs.reload(msg.tabId);
        _injectedTabs.delete(msg.tabId);
        await updateBadgeNow();
        return { success: true };
      } catch (e) { return { success: false, error: e.message }; }

    case 'getSessions': return await getSessions();
    case 'saveSession': return await saveSession(msg.name);
    case 'deleteSession': return await deleteSession(msg.id);
    case 'restoreSession': return await restoreSession(msg.id, msg.mode);
    case 'getStats': return await getStats();

    case 'closeDuplicates': {
      let tabs = await chrome.tabs.query({ currentWindow: true });
      let groups = {};
      let closed = 0;
      for (let tab of tabs) {
        if (!tab.url || isInternalUrl(tab.url)) continue;
        let url = tab.url.replace(/#.*$/, '').replace(/\/$/, '');
        if (!groups[url]) groups[url] = [];
        groups[url].push(tab);
      }
      for (let url in groups) {
        if (groups[url].length < 2) continue;
        let keep = groups[url].find(tab => tab.active) || groups[url][0];
        for (let tab of groups[url]) {
          if (tab.id !== keep.id) {
            try { await chrome.tabs.remove(tab.id); closed++; } catch {}
          }
        }
      }
      await updateBadgeNow();
      return { success: true, closed };
    }

    default: return { error: 'Unknown action: ' + msg.action };
  }
}
