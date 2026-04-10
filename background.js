// background service worker
// all listeners at top level for MV3

const DEFAULT_SETTINGS = {
  suspendAfterMinutes: 30,
  whitelist: [],
  enableAutoSuspend: true,
  protectPinned: true,
  protectAudio: true,
  protectForms: true,
  suspendOnStartup: true,
  markSuspendedTabs: false
};

async function injectFormCheck(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['formcheck.js']
    });
  } catch {}
}

const INTERNAL_PROTOCOLS = [
  'chrome:', 'chrome-extension:', 'chrome-search:',
  'about:', 'file:', 'devtools:', 'edge:'
];
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
  createAlarm();
  createContextMenus();
  await initTimestamps();
  await updateBadgeNow();

  if (details.reason === 'install') {
    await initStats();
    try { chrome.tabs.create({ url: 'onboarding.html' }); } catch {}
  } else if (details.reason === 'update') {
    let version = chrome.runtime.getManifest().version;
    let data = await chrome.storage.local.get('drowzy_lastChangelogVersion');
    if (data.drowzy_lastChangelogVersion !== version) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
      try { chrome.tabs.create({ url: 'changelog.html' }); } catch {}
    }
  }
}

async function onStartup() {
  createAlarm();
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
      await suspendTab(tab.id);
    }
  } catch {}
}

async function initTimestamps() {
  try {
    let tabs = await chrome.tabs.query({});
    let now = Date.now();
    let timestamps = {};
    for (let tab of tabs) timestamps[tab.id] = now;
    await chrome.storage.session.set({ tabTimestamps: timestamps });
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
        todayDate: new Date().toISOString().split('T')[0],
        installDate: Date.now()
      }
    });
  }
}

function _defaultStats() {
  return {
    totalTabsSuspended: 0,
    totalTabsSuspendedToday: 0,
    todayDate: new Date().toISOString().split('T')[0],
    installDate: Date.now()
  };
}

async function recordSuspension() {
  try {
    let data = await chrome.storage.local.get('drowzy_stats');
    let stats = data.drowzy_stats || _defaultStats();

    let today = new Date().toISOString().split('T')[0];
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

  let today = new Date().toISOString().split('T')[0];
  if (stats.todayDate !== today) {
    stats.totalTabsSuspendedToday = 0;
    stats.todayDate = today;
  }
  return stats;
}

function createAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

async function onAlarm(alarm) {
  if (alarm.name === ALARM_NAME) await checkAndSuspendTabs();
}

async function onTabActivated(activeInfo) {
  await touchTab(activeInfo.tabId);
  debouncedBadgeUpdate();
}

async function onTabUpdated(tabId, changeInfo) {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await touchTab(tabId);
  }
  if (changeInfo.discarded !== undefined) debouncedBadgeUpdate();
}

async function onTabCreated(tab) { await touchTab(tab.id); }

async function onTabRemoved(tabId) {
  try {
    let data = await chrome.storage.session.get('tabTimestamps');
    let ts = data.tabTimestamps || {};
    delete ts[tabId];
    await chrome.storage.session.set({ tabTimestamps: ts });
  } catch {}
  debouncedBadgeUpdate();
}

async function onTabReplaced(addedTabId, removedTabId) {
  try {
    let data = await chrome.storage.session.get('tabTimestamps');
    let ts = data.tabTimestamps || {};
    ts[addedTabId] = ts[removedTabId] || Date.now();
    delete ts[removedTabId];
    await chrome.storage.session.set({ tabTimestamps: ts });
  } catch {}
}

async function touchTab(tabId) {
  try {
    let data = await chrome.storage.session.get('tabTimestamps');
    let ts = data.tabTimestamps || {};
    ts[tabId] = Date.now();
    await chrome.storage.session.set({ tabTimestamps: ts });
  } catch {}
}

async function checkAndSuspendTabs() {
  let settings = await getSettings();
  if (!settings.enableAutoSuspend) return;

  let minutes = Number(settings.suspendAfterMinutes);
  if (!minutes || minutes <= 0) return;

  let tabs = await chrome.tabs.query({});
  let data = await chrome.storage.session.get('tabTimestamps');
  let timestamps = data.tabTimestamps || {};
  let now = Date.now();
  let threshold = minutes * 60 * 1000;
  let dirty = false;

  for (let tab of tabs) {
    if (!(tab.id in timestamps)) {
      timestamps[tab.id] = now;
      dirty = true;
    }
    if (shouldSuspend(tab, settings, timestamps, now, threshold)) {
      await injectFormCheck(tab.id);
      try { await chrome.tabs.sendMessage(tab.id, { action: 'suspendWarning' }); } catch {}
      await new Promise(r => setTimeout(r, 2500));
      await suspendTab(tab.id);
    }
  }

  if (dirty) await chrome.storage.session.set({ tabTimestamps: timestamps });
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
  return INTERNAL_PROTOCOLS.some(p => url.startsWith(p));
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
        let pattern = d.replace(/\*/g, '');
        return fullUrl.startsWith(pattern) || fullUrl === d.replace(/\/?\*?$/, '');
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
    let discarded = await chrome.tabs.query({ discarded: true });
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
        if (domain) await addWhitelist(domain);
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
      await unsuspendAll();
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
  let other = allTabs.find(t => t.id !== activeTab.id && !t.discarded);
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

async function unsuspendAll() {
  let tabs = await chrome.tabs.query({ discarded: true });
  for (let t of tabs) {
    try { await chrome.tabs.reload(t.id); } catch {}
  }
  await updateBadgeNow();
}

async function addWhitelist(domain) {
  if (!domain || typeof domain !== 'string') return;
  let settings = await getSettings();
  let d = domain.toLowerCase().replace(/^www\./, '').trim();
  if (!d) return;
  if (!settings.whitelist.includes(d)) {
    settings.whitelist.push(d);
    await chrome.storage.sync.set({ settings });
  }
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
  let valid = tabs.filter(t => t.url && !isInternalUrl(t.url));
  if (!valid.length) {
    return { success: false, error: t('noSaveableTabs') };
  }

  let groupMap = {};
  for (let tab of valid) {
    if (tab.groupId != null && tab.groupId !== -1 && !groupMap[tab.groupId]) {
      try {
        let group = await chrome.tabGroups.get(tab.groupId);
        groupMap[tab.groupId] = { title: group.title || '', color: group.color || 'grey' };
      } catch { groupMap[tab.groupId] = { title: '', color: 'grey' }; }
    }
  }

  let session = {
    id: 'session_' + Date.now(),
    name: name || _formatSessionName(),
    createdAt: Date.now(),
    groups: groupMap,
    tabs: valid.map(t => ({
      url: t.url,
      title: t.title || 'Untitled',
      favIconUrl: t.favIconUrl || '',
      pinned: t.pinned || false,
      groupId: t.groupId != null ? t.groupId : -1
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

  let restorable = session.tabs.filter(t => t.url && !isInternalUrl(t.url));
  if (!restorable.length) {
    return { success: false, error: t('noRestorableTabs') };
  }

  let createdTabs = [];
  if (mode === 'replace') {
    let currentTabs = await chrome.tabs.query({ currentWindow: true });
    try {
      let first = restorable[0];
      let newTab = await chrome.tabs.create({ url: first.url, pinned: first.pinned, active: true });
      await touchTab(newTab.id);
      createdTabs.push({ tabId: newTab.id, groupId: first.groupId });
      let oldIds = currentTabs.map(t => t.id).filter(id => id !== newTab.id);
      if (oldIds.length) await chrome.tabs.remove(oldIds);
      for (let i = 1; i < restorable.length; i++) {
        try {
          let created = await chrome.tabs.create({ url: restorable[i].url, pinned: restorable[i].pinned, active: false });
          await touchTab(created.id);
          createdTabs.push({ tabId: created.id, groupId: restorable[i].groupId });
        } catch {}
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  } else {
    for (let t of restorable) {
      try {
        let created = await chrome.tabs.create({ url: t.url, pinned: t.pinned, active: false });
        await touchTab(created.id);
        createdTabs.push({ tabId: created.id, groupId: t.groupId });
      } catch {}
    }
  }

  // Reconstruct tab groups
  if (session.groups) {
    let oldToNew = {};
    for (let ct of createdTabs) {
      if (ct.groupId == null || ct.groupId === -1) continue;
      try {
        if (!oldToNew[ct.groupId]) {
          let newGroupId = await chrome.tabs.group({ tabIds: [ct.tabId] });
          let gInfo = session.groups[ct.groupId] || {};
          await chrome.tabGroups.update(newGroupId, { title: gInfo.title || '', color: gInfo.color || 'grey' });
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
  let data = await chrome.storage.session.get('tabTimestamps');
  let timestamps = data.tabTimestamps || {};
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
    } else if (settings.enableAutoSuspend) {
      let lastActive = timestamps[tab.id];
      if (lastActive) {
        let remaining = threshold - (now - lastActive);
        timeLeft = Math.max(0, Math.ceil(remaining / 60000));
      }
    }

    return {
      id: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      status, protectReason, timeLeft,
      pinned: tab.pinned,
      audible: tab.audible
    };
  });
}

function onMessage(msg, sender, sendResponse) {
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
      let tabList = await getTabList(allTabs[0]?.windowId);
      let protectedCount = tabList.filter(t => t.status === 'protected' || t.status === 'active').length;
      return {
        totalTabs: allTabs.length,
        suspendedCount: discardedTabs.length,
        protectedCount,
        estimatedMbSaved: discardedTabs.length * MB_PER_TAB
      };
    }

    case 'getSettings': return await getSettings();
    case 'updateSettings':
      await chrome.storage.sync.set({ settings: msg.settings });
      return { success: true };

    case 'suspendTab': return { success: await suspendTab(msg.tabId) };
    case 'suspendOthers': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      await suspendAllOthers(at?.windowId);
      return { success: true };
    }
    case 'unsuspendAll': await unsuspendAll(); return { success: true };
    case 'addWhitelist': await addWhitelist(msg.domain); return { success: true };
    case 'removeWhitelist': await removeWhitelist(msg.domain); return { success: true };
    case 'getTabList': {
      let [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return await getTabList(active?.windowId);
    }
    case 'wakeTab':
      try {
        await chrome.tabs.reload(msg.tabId);
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
      let seen = {};
      let closed = 0;
      for (let tab of tabs) {
        if (!tab.url || isInternalUrl(tab.url)) continue;
        let url = tab.url.replace(/\/$/, '');
        if (seen[url]) {
          if (!tab.active) {
            try { await chrome.tabs.remove(tab.id); closed++; } catch {}
          }
        } else {
          seen[url] = true;
        }
      }
      await updateBadgeNow();
      return { success: true, closed };
    }

    case 'suspendCurrentTab': {
      let [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active) return { success: false };
      let allTabs = await chrome.tabs.query({ windowId: active.windowId });
      let other = allTabs.find(t => t.id !== active.id && !t.discarded);
      if (!other) return { success: false, error: 'No other tab to switch to' };
      await chrome.tabs.update(other.id, { active: true });
      let result = await suspendTab(active.id);
      return { success: result };
    }

    default: return { error: 'Unknown action: ' + msg.action };
  }
}
