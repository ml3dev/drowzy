// background service worker
// all listeners at top level for MV3

const DEFAULT_SETTINGS = {
  suspendAfterMinutes: 15,
  whitelist: [],
  enableAutoSuspend: true,
  protectPinned: true,
  protectAudio: true,
  protectForms: false,
  suspendOnStartup: true,
  markSuspendedTabs: false
};

let _injectedTabs = new Set();
let _suspending = false;

async function hasHostPermission() {
  try {
    return await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch { return false; }
}

async function injectFormCheck(tabId) {
  if (_injectedTabs.has(tabId)) return;
  if (!(await hasHostPermission())) return;
  // Add optimistically before await to prevent concurrent callers from double-injecting
  _injectedTabs.add(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['formcheck.js']
    });
  } catch {
    _injectedTabs.delete(tabId);
  }
}

const ALARM_NAME = 'check-tabs';
const BADGE_COLOR = '#7c3aed';
const MB_PER_TAB = 150;
const MAX_SESSIONS = 20;
const UNINSTALL_URL = 'https://ml3dev.github.io/drowzy/uninstall.html';

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

// Refresh the badge when the user switches between Chrome windows, so the
// window-scoped count reflects the focused window. WINDOW_ID_NONE means focus
// moved out of Chrome entirely - let updateBadgeNow clear the badge.
try {
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener(function() {
      debouncedBadgeUpdate();
    });
  }
} catch {}

// Reset host-gated settings when user revokes optional host permission
chrome.permissions.onRemoved.addListener(async (permissions) => {
  if (permissions.origins && permissions.origins.includes('<all_urls>')) {
    let settings = await getSettings();
    let changed = false;
    if (settings.protectForms) { settings.protectForms = false; changed = true; }
    if (settings.markSuspendedTabs) { settings.markSuspendedTabs = false; changed = true; }
    if (changed) await chrome.storage.sync.set({ settings });
  }
});

async function onInstalled(details) {
  await initSettings();
  await createAlarm();
  createContextMenus();
  await initTimestamps();
  await updateBadgeNow();
  try { await chrome.runtime.setUninstallURL(UNINSTALL_URL); } catch {}

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
    await chrome.storage.local.set({ drowzy_lastChangelogVersion: chrome.runtime.getManifest().version });
    try { chrome.tabs.create({ url: 'onboarding.html' }); } catch {}
    // first-run quick-suspend: without this the user waits the full 15 min
    // (default) before anything visibly happens, which is the most common
    // reason cited for "didn't notice a memory difference" and uninstalling.
    // ~30s after install, suspend tabs Chrome reports as idle for 10+ minutes
    // - only the obviously-stale ones, so it doesn't surprise the user with
    // a recently-used tab going away. Uses chrome.alarms (not setTimeout) so
    // the pass survives MV3 service-worker termination during the wait.
    try { chrome.alarms.create('first-run-suspend', { delayInMinutes: 0.5 }); } catch {}
  } else if (details.reason === 'update') {
    let version = chrome.runtime.getManifest().version;
    let data = await chrome.storage.local.get('drowzy_lastChangelogVersion');
    let lastVer = data.drowzy_lastChangelogVersion || '';
    // Only show changelog on MAJOR version bumps (e.g. 1.x.x → 2.x.x).
    // Minor and patch bumps silently update the stored version.
    let curMajor = version.split('.')[0];
    let lastMajor = lastVer.split('.')[0];
    if (lastVer && curMajor !== lastMajor) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
      try { chrome.tabs.create({ url: 'changelog.html' }); } catch {}
    } else if (lastVer !== version) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
    }
  }
}

async function onStartup() {
  await createAlarm();
  // Rebuild context menus on every startup. They're created once at install in
  // the then-current UI language and don't otherwise refresh, so a user who
  // changes Chrome's display language would keep stale-language menu items
  // until the next reload. createContextMenus() removes-all-then-recreates and
  // re-reads chrome.i18n, so this picks up a language change on next launch.
  createContextMenus();
  await initTimestamps();
  await updateBadgeNow();
  // Re-affirm in case it was cleared or we updated the URL since install
  try { await chrome.runtime.setUninstallURL(UNINSTALL_URL); } catch {}

  let settings = await getSettings();
  if (settings.suspendOnStartup) {
    // Use an alarm rather than setTimeout. Once onStartup's awaits resolve the
    // service worker has no pending events keeping it alive: a 5s timer can
    // miss its deadline if the worker is terminated first. Alarms survive
    // worker death. 0.1 min gets clamped to ~30s in production, which is also
    // enough delay for Chrome to finish restoring saved tabs.
    try { chrome.alarms.create('startup-suspend', { delayInMinutes: 0.1 }); } catch {}

    // Chrome restores big sessions progressively (deferred windows, staggered
    // background loading), so tabs can keep materializing long after startup.
    // Instead of stacking one-shot alarms, tag everything that is a restore
    // artifact right now; restoredCatchupSweep drains the tag set from the
    // 30s alarm above and then the per-minute check-tabs tick, so even a
    // session that takes ten minutes to restore is fully covered. Tabs
    // restored later still are tagged as they appear (onTabCreated). Each
    // window's startup-active tab is instead seeded as viewed - it is on the
    // user's screen right now, and without this a tab they look at and then
    // switch away from before the sweep runs would be swept.
    try {
      let all = await chrome.tabs.query({});
      let pending = await loadRestoredPending();
      let added = false;
      for (let tab of all) {
        if (tab.active) {
          await markActivated(tab.id);
          continue;
        }
        if (tab.discarded) continue;
        if (!pending.has(tab.id)) { pending.add(tab.id); added = true; }
      }
      if (added) await persistRestoredPending();
    } catch {}
  }
}

async function firstRunQuickSuspend() {
  // Conservative first-run pass. Uses tab.lastAccessed (Chrome 121+) so we
  // only touch tabs Chrome itself confirms have been idle for a while; on
  // 120 (no lastAccessed), we skip - better to miss the boost than surprise
  // a fresh installer with a tab they were just using.
  try {
    let settings = await getSettings();
    if (!settings.enableAutoSuspend) return;
    let tabs = await chrome.tabs.query({});
    let staleBefore = Date.now() - 10 * 60 * 1000;
    for (let tab of tabs) {
      if (tab.active || tab.discarded) continue;
      if (typeof tab.lastAccessed !== 'number') continue;
      if (tab.lastAccessed > staleBefore) continue;
      if (isInternalUrl(tab.url)) continue;
      if (settings.protectPinned && tab.pinned) continue;
      if (settings.protectAudio && tab.audible) continue;
      if (isWhitelisted(tab.url, settings.whitelist)) continue;
      try {
        let result = await chrome.tabs.discard(tab.id);
        if (result) await recordSuspension();
      } catch {}
    }
    await updateBadgeNow();
  } catch {}
}

// Tab ids that are session-restore artifacts still owed a re-suspend: seeded
// at startup (everything non-active), extended as late-restored tabs appear
// (onTabCreated), and drained by restoredCatchupSweep. Backed by
// chrome.storage.session - cleared on browser restart, survives MV3
// service-worker restarts in between.
//
// Both session sets memoize the IN-FLIGHT PROMISE, not the resolved value:
// concurrent first callers (onStartup seeding vs an onTabCreated burst) must
// share one Set. Caching the value would let a second caller's storage read
// clobber a Set the first caller already mutated, silently dropping tags.
let _restoredPendingPromise = null;
let _restoredPersistTimer = null;

function loadRestoredPending() {
  if (!_restoredPendingPromise) {
    _restoredPendingPromise = chrome.storage.session.get('restoredTabIds')
      .then(function(data) { return new Set(data.restoredTabIds || []); })
      .catch(function() { return new Set(); });
  }
  return _restoredPendingPromise;
}

async function persistRestoredPending() {
  try {
    let set = await loadRestoredPending();
    await chrome.storage.session.set({ restoredTabIds: [...set] });
  } catch {}
}

function scheduleRestoredPersist() {
  // restores create tabs in bursts; rewriting the whole array per tab would
  // be O(n^2) during the exact burst this feature targets - coalesce writes.
  // A write lost to worker death degrades gracefully: an untagged tab just
  // falls back to the normal idle timer.
  if (_restoredPersistTimer) return;
  _restoredPersistTimer = setTimeout(function() {
    _restoredPersistTimer = null;
    persistRestoredPending();
  }, 1000);
}

async function tagRestored(tabId) {
  let set = await loadRestoredPending();
  if (set.has(tabId)) return;
  set.add(tabId);
  scheduleRestoredPersist();
}

async function untagRestored(tabId) {
  let set = await loadRestoredPending();
  if (!set.has(tabId)) return;
  set.delete(tabId);
  await persistRestoredPending();
}

async function clearRestoredPending() {
  let set = await loadRestoredPending();
  if (!set.size) return;
  set.clear();
  await persistRestoredPending();
}

let _sweeping = false;

async function restoredCatchupSweep(settings) {
  // startup catch-up: re-suspend restore-tagged tabs the user hasn't viewed.
  // Runs from the 30s startup-suspend alarm AND the existing per-minute tick
  // until the tag set drains, so a session that restores slowly is covered
  // minute by minute rather than by fixed-delay passes. Guards:
  //   1. tabs the user has actually VIEWED this session are left alone (see
  //      the activated set). A time-based guard would misfire here: restore
  //      itself bumps timestamps, so late-restored tabs - the exact
  //      stragglers this sweep targets - would look "recently touched".
  //   2. tabs still mid-load stay tagged and are retried next tick;
  //      discarding a tab whose navigation hasn't committed can revert it to
  //      a stale URL. suspendTab gets skipLoading so its FRESH pre-discard
  //      recheck enforces this too - the snapshot alone could miss a load
  //      that started mid-sweep. Still-unloaded tabs ARE swept - discarding
  //      them before Chrome's tab loader gets to them prevents the RAM
  //      spike entirely.
  //   3. every other outcome untags: suspended, closed, viewed, or protected
  //      (pinned/audio/whitelist/internal via shouldSuspend). From then on
  //      the tab belongs to the normal idle timer, so the sweep converges
  //      to a no-op instead of re-checking the same tabs forever.
  // Suspends go through suspendTab, so protectForms / markSuspendedTabs and
  // the final pre-discard recheck all apply.
  if (_sweeping) return; // the 30s alarm and the per-minute tick can overlap
  _sweeping = true;
  try {
    let pending = await loadRestoredPending();
    if (!pending.size) return;
    let activated = await loadActivatedSet();
    let tabs = await chrome.tabs.query({});
    let now = Date.now();
    let byId = new Map();
    for (let tab of tabs) byId.set(tab.id, tab);
    let dirty = false;
    for (let id of [...pending]) {
      let tab = byId.get(id);
      if (!tab) {
        // absent from the snapshot: usually closed - but a tab created and
        // tagged during this sweep's own awaits is also absent, so confirm
        // it is truly gone before untagging (it sweeps next tick otherwise)
        try {
          await chrome.tabs.get(id);
        } catch {
          pending.delete(id);
          dirty = true;
        }
        continue;
      }
      if (tab.discarded || tab.active || activated.has(id)) {
        pending.delete(id); dirty = true; continue;
      }
      if (tab.status === 'loading') continue;
      seedTimestamp(tab, now);
      // untag BEFORE the discard: a discard swaps the tab id via onReplaced,
      // and the tag must not outlive the suspend - a tab Drowzy just put to
      // sleep is done, and re-tagging its new id would let the sweep discard
      // it again right after a Wake All reloads it in the background.
      pending.delete(id);
      dirty = true;
      // threshold 0 = shouldSuspend's eligibility checks only (active,
      // discarded, internal, pinned, audio, whitelist) with no idle
      // requirement - the idle rule for this sweep is the activated-set guard
      if (shouldSuspend(tab, settings, _timestamps, now, 0)) {
        let suspended = await suspendTab(tab.id, settings, { skipLoading: true });
        if (!suspended) {
          // suspendTab's fresh recheck may have refused because a load
          // started after our snapshot - re-tag that one case so it retries
          // next tick, same as a load that was visible in the snapshot.
          // Other refusals (activated, audible, form data) stay untagged.
          try {
            let fresh = await chrome.tabs.get(id);
            if (fresh.status === 'loading' && !fresh.active && !fresh.discarded) {
              pending.add(id);
            }
          } catch {}
        }
      }
    }
    if (dirty) await persistRestoredPending();
    if (_tsDirty) scheduleFlush();
  } catch {} finally {
    _sweeping = false;
  }
}

// Tab ids the user has actually activated (viewed) this browser session.
// Backed by chrome.storage.session, which Chrome clears on browser restart -
// exactly the "this session" lifetime we want - and which survives MV3
// service-worker restarts in between. Same in-flight-promise memoization as
// the restored-pending set, for the same clobbering reason.
let _activatedPromise = null;

function loadActivatedSet() {
  if (!_activatedPromise) {
    _activatedPromise = chrome.storage.session.get('activatedTabIds')
      .then(function(data) { return new Set(data.activatedTabIds || []); })
      .catch(function() { return new Set(); });
  }
  return _activatedPromise;
}

async function persistActivatedSet() {
  try {
    let set = await loadActivatedSet();
    await chrome.storage.session.set({ activatedTabIds: [...set] });
  } catch {}
}

async function markActivated(tabId) {
  try {
    let set = await loadActivatedSet();
    if (set.has(tabId)) return;
    set.add(tabId);
    await persistActivatedSet();
  } catch {}
}

async function unmarkActivated(tabId) {
  try {
    let set = await loadActivatedSet();
    if (!set.has(tabId)) return;
    set.delete(tabId);
    await persistActivatedSet();
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

    // Add missing tabs (see seedTimestamp for the lastAccessed reasoning)
    for (let tab of tabs) {
      seedTimestamp(tab, now);
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

function seedTimestamp(tab, now) {
  // Seed an untracked tab from Chrome's own tab.lastAccessed (121+) when
  // available, so a service-worker restart with cleared session storage
  // doesn't reset the apparent idle time of long-untouched tabs to NOW -
  // that would silently grant every tab a fresh full timer on restart.
  if (tab.id in _timestamps) return;
  _timestamps[tab.id] = (typeof tab.lastAccessed === 'number') ? tab.lastAccessed : now;
  _tsDirty = true;
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
  else if (alarm.name === 'first-run-suspend') await firstRunQuickSuspend();
  else if (alarm.name === 'startup-suspend') {
    // same guarded sweep the per-minute tick runs - one mechanism, fired
    // early. (Before 1.3.8 this pass was a raw discard-everything loop that
    // ignored viewed and mid-load tabs; the sweep keeps its speed but adds
    // those protections.)
    let settings = await getSettings();
    if (settings.suspendOnStartup) await restoredCatchupSweep(settings);
  }
}

async function onTabActivated(activeInfo) {
  await touchTab(activeInfo.tabId);
  await markActivated(activeInfo.tabId);
  // the user is looking at it now - it is no longer the startup sweep's business
  await untagRestored(activeInfo.tabId);
  // Flush immediately on activation since worker is alive during this event
  await flushTimestamps();
  debouncedBadgeUpdate();
}

async function onTabUpdated(tabId, changeInfo) {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await touchTab(tabId);
  }
  // Audio going quiet (pause, mute, call ending) counts as activity so the
  // tab gets the full suspend threshold before becoming eligible. Prevents
  // paused-Spotify / ended-meeting tabs from being suspended immediately
  // after their audible flag drops, which would force a full page reload.
  if (changeInfo.audible === false) {
    await touchTab(tabId);
  }
  // Content scripts are torn down on navigation AND reload. Drop the
  // _injectedTabs marker on either a URL change or when the page starts
  // loading again (covers manual reload / browser restore where URL stays).
  if (changeInfo.url || changeInfo.status === 'loading') {
    _injectedTabs.delete(tabId);
  }
  if (changeInfo.discarded !== undefined) debouncedBadgeUpdate();
}

async function onTabCreated(tab) {
  await touchTab(tab.id);
  if (tab.active) {
    // born on the user's screen (new tab, or the active tab of a late-restored
    // window that onStartup's seeding query ran too early to see) - count it
    // as viewed so the startup catch-up sweep leaves it alone
    await markActivated(tab.id);
  } else if (tab.status === 'unloaded' || tab.discarded) {
    // born in the background with no content: that's the shape of a
    // session-restored (or reopened) tab, not one the user opened - tabs a
    // user opens in the background (middle-click, "open in new tab") start
    // loading immediately. Tag it for the startup catch-up sweep.
    await tagRestored(tab.id);
  }
}

async function onTabRemoved(tabId) {
  _injectedTabs.delete(tabId);
  await untagRestored(tabId);
  await unmarkActivated(tabId);
  // Only mark dirty if we actually removed a tracked timestamp - avoids
  // flushing session storage when the tab wasn't being tracked.
  if (tabId in _timestamps) {
    delete _timestamps[tabId];
    _tsDirty = true;
    // Flush immediately - worker may be killed before a scheduled flush runs
    await flushTimestamps();
  }
  debouncedBadgeUpdate();
}

async function onTabReplaced(addedTabId, removedTabId) {
  _timestamps[addedTabId] = _timestamps[removedTabId] || Date.now();
  delete _timestamps[removedTabId];
  _tsDirty = true;
  scheduleFlush();
  // a discard swaps the tab id - carry viewed-this-session membership over
  // so the sweep still recognizes the tab under its new id. The restore tag
  // is deliberately NOT transferred: onReplaced here means the tab was just
  // discarded (usually by Drowzy itself), so the sweep's job for it is done.
  // Carrying the tag would let the sweep re-discard the tab right after a
  // Wake All reloads it in the background without activating it.
  try {
    let set = await loadActivatedSet();
    if (set.has(removedTabId)) {
      set.delete(removedTabId);
      set.add(addedTabId);
      await persistActivatedSet();
    }
    await untagRestored(removedTabId);
  } catch {}
}

async function touchTab(tabId) {
  _timestamps[tabId] = Date.now();
  _tsDirty = true;
  scheduleFlush();
}

async function checkAndSuspendTabs() {
  // Guard against concurrent alarm firings (2.5s warning delay can overlap)
  if (_suspending) return;
  _suspending = true;
  try {
    // Lazy-reload timestamps if service worker restarted mid-session
    if (Object.keys(_timestamps).length === 0) {
      await initTimestamps();
    }

    let settings = await getSettings();

    // startup catch-up runs before (and independently of) the auto-suspend
    // gates below: "Suspend tabs on startup" works even when auto-suspend is
    // off or the timer is set to Never. The sweep queries tabs itself only
    // while tags are pending, so the steady state adds no work here.
    if (settings.suspendOnStartup) {
      await restoredCatchupSweep(settings);
    } else {
      // feature off: drop any tags onTabCreated accumulated, so toggling it
      // on later can't trigger a surprise mass discard of tabs reopened
      // while it was off
      await clearRestoredPending();
    }

    if (!settings.enableAutoSuspend) return;

    let minutes = Number(settings.suspendAfterMinutes);
    if (!minutes || minutes <= 0) return;

    let tabs = await chrome.tabs.query({});
    let now = Date.now();
    let threshold = minutes * 60 * 1000;

    let toSuspend = [];
    for (let tab of tabs) {
      seedTimestamp(tab, now);
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
        // auto:true so suspendTab respects a Keep awake / refocus that landed
        // during the warning window. Manual suspends bypass this check.
        await suspendTab(tabId, settings, { auto: true });
      }
    }
  } finally { _suspending = false; }
}

function shouldSuspend(tab, settings, timestamps, now, threshold) {
  if (tab.active || tab.discarded) return false;
  if (isInternalUrl(tab.url)) return false;
  if (settings.protectPinned && tab.pinned) return false;
  if (settings.protectAudio && tab.audible) return false;
  if (isWhitelisted(tab.url, settings.whitelist)) return false;

  let lastActive = timestamps[tab.id] || 0;
  // tab.lastAccessed (Chrome 121+) is what Chrome itself tracks for tab activation;
  // prefer the more recent of our timestamp and Chrome's so a tab activated
  // before the service worker came up isn't immediately suspendable.
  if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > lastActive) {
    lastActive = tab.lastAccessed;
  }
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

async function suspendTab(tabId, cachedSettings, opts) {
  try {
    let tab = await chrome.tabs.get(tabId);
    if (tab.active || tab.discarded) return false;
    if (isInternalUrl(tab.url)) return false;

    let settings = cachedSettings || await getSettings();
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

    // Final recheck immediately before discard - user may have switched to
    // this tab during the preceding awaits (form check, message round-trips).
    // Discarding an active tab forces a visible reload when the user looks at it.
    try {
      let fresh = await chrome.tabs.get(tabId);
      if (fresh.active || fresh.discarded || fresh.audible) return false;
      // for auto-suspend only: if Keep awake bumped the timestamp during the
      // warning window or tab.lastAccessed updated mid-await (user refocused),
      // bail out. Also skip tabs still in 'loading' to avoid discarding mid-navigation.
      // Manual suspends (context menu, Suspend Others, popup button) pass auto=false
      // because the user has explicit intent - bypass timing and loading checks, since
      // SPAs like Reddit can sit in 'loading' indefinitely from background streaming.
      // skipLoading gives the same fresh mid-navigation guard without the
      // idle-threshold check - used by the startup catch-up sweep, which is
      // automatic (so it must not discard an uncommitted navigation) but
      // sweeps tabs that are by definition younger than the idle threshold.
      if (opts && (opts.auto || opts.skipLoading)) {
        if (fresh.status === 'loading') return false;
      }
      if (opts && opts.auto) {
        let now = Date.now();
        let threshold = settings.suspendAfterMinutes * 60 * 1000;
        let lastActive = _timestamps[tabId] || 0;
        if (typeof fresh.lastAccessed === 'number' && fresh.lastAccessed > lastActive) {
          lastActive = fresh.lastAccessed;
        }
        if (lastActive && now - lastActive < threshold) return false;
      }
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
    // If no window is focused (e.g., Chrome minimized or focus in another app),
    // clear the badge rather than counting discarded tabs across every window - 
    // a cross-window count is misleading in a window-scoped badge.
    if (!active) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    let discarded = await chrome.tabs.query({ discarded: true, windowId: active.windowId });
    let n = discarded.length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    // setBadgeTextColor is Chrome 110+; guard so older Chromes don't throw.
    // Forcing white guarantees contrast over our brand purple regardless of
    // what Chrome's auto-contrast heuristic would pick.
    if (chrome.action.setBadgeTextColor) {
      try { await chrome.action.setBadgeTextColor({ color: '#ffffff' }); } catch {}
    }
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
  // chrome.tabs.query returns tabs ordered by index. Prefer the next tab by
  // position; if none, fall back to the closest previous tab (largest index
  // below activeTab). Old code fell back to candidates[length-1], which could
  // pick a tab far from the current position.
  let candidates = allTabs.filter(tab => tab.id !== activeTab.id && !tab.discarded && !isInternalUrl(tab.url));
  if (!candidates.length) return;
  let next = candidates.find(tab => tab.index > activeTab.index);
  let prev = null;
  for (let tab of candidates) {
    if (tab.index < activeTab.index && (!prev || tab.index > prev.index)) prev = tab;
  }
  let other = next || prev || candidates[0];
  if (!other) return;

  try {
    await chrome.tabs.update(other.id, { active: true });
    await suspendTab(activeTab.id);
  } catch {}
}

async function suspendAllOthers(windowId) {
  let settings = await getSettings();
  let tabs = await chrome.tabs.query(windowId ? { windowId } : {});

  let count = 0;
  for (let tab of tabs) {
    if (tab.active || tab.discarded || isInternalUrl(tab.url)) continue;
    if (settings.protectPinned && tab.pinned) continue;
    if (settings.protectAudio && tab.audible) continue;
    if (isWhitelisted(tab.url, settings.whitelist)) continue;
    if (await suspendTab(tab.id, settings)) count++;
  }
  return count;
}

async function unsuspendAll(windowId) {
  let query = { discarded: true };
  if (windowId) query.windowId = windowId;
  let tabs = await chrome.tabs.query(query);
  let count = 0;
  for (let tab of tabs) {
    try {
      await chrome.tabs.reload(tab.id);
      count++;
    } catch {}
  }
  await updateBadgeNow();
  return count;
}

async function addWhitelist(domain) {
  if (!domain || typeof domain !== 'string') return { added: false, error: t('invalidDomain') };
  // trim() before the www-strip so a leading-whitespace input like "  www.x.com"
  // still gets normalized (regex anchors to ^, so the leading space would
  // otherwise prevent the www. strip).
  let d = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!d) return { added: false, error: t('invalidDomain') };
  // Strip port from domain part before validation
  let domainPart = d.split('/')[0].replace(/:\d+$/, '');
  let isLocal = domainPart === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(domainPart) || domainPart === '::1';
  if (!isLocal && (!domainPart.includes('.') || domainPart.startsWith('.') || domainPart.endsWith('.'))) {
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

  return { success: true, count: createdTabs.length };
}

async function getTabList(windowId) {
  // Lazy-reload timestamps if service worker restarted
  if (Object.keys(_timestamps).length === 0) await initTimestamps();
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
      // mirror shouldSuspend's logic so the displayed timer matches what
      // actually happens - max of our timestamp and Chrome's lastAccessed
      let lastActive = _timestamps[tab.id] || 0;
      if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > lastActive) {
        lastActive = tab.lastAccessed;
      }
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
  // Content scripts (sender.tab exists) should never call background actions,
  // with one narrow exception: the suspend-warning banner's "Keep awake" button
  // needs to bump its own tab's timestamp. Scoped to the sender's own tab id.
  if (sender.tab) {
    if (msg && msg.action === 'keepTabAwake' && sender.tab.id) {
      touchTab(sender.tab.id);
      sendResponse({ success: true });
      return false;
    }
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
      // Tabs that aren't already discarded and aren't protected - i.e. the
      // ones Drowzy will eventually suspend. Used for the forecast stat so
      // first-session users see a non-zero number before the suspend timer fires.
      let eligibleCount = Math.max(0, allTabs.length - protectedCount - discardedTabs.length);
      return {
        totalTabs: allTabs.length,
        suspendedCount: discardedTabs.length,
        protectedCount,
        eligibleCount,
        estimatedMbSaved: discardedTabs.length * MB_PER_TAB,
        estimatedMbForecast: eligibleCount * MB_PER_TAB
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
    case 'suspendCurrent': {
      // Re-suspend the active tab (e.g. one the user just woke). Reuses the
      // proven handleSuspendCurrent path, which activates a neighbour first
      // (Chrome can't discard the active tab) and then discards this one.
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!at) return { success: false };
      await handleSuspendCurrent(at);
      // Confirm by re-reading discard state rather than trusting the call - 
      // handleSuspendCurrent no-ops if the tab is protected or has no neighbour.
      let after = await chrome.tabs.get(at.id).catch(() => null);
      let ok = !!(after && after.discarded);
      return { success: ok, mbFreed: ok ? MB_PER_TAB : 0 };
    }
    case 'suspendOthers': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      let count = await suspendAllOthers(at?.windowId);
      return { success: true, count, mbFreed: count * MB_PER_TAB };
    }
    case 'unsuspendAll': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      let count = await unsuspendAll(at?.windowId);
      return { success: true, count };
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
        // Tab is discarded - can't inject scripts or send messages.
        // Just reload; the page title resets naturally (no [zzz] prefix).
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
        // Normalize: lowercase, strip fragment, strip trailing slash before query or end
        let url = tab.url.toLowerCase().replace(/#.*$/, '').replace(/\/(\?|$)/, '$1');
        if (!groups[url]) groups[url] = [];
        groups[url].push(tab);
      }
      for (let url in groups) {
        if (groups[url].length < 2) continue;
        // Prefer pinned, then active, then a live (non-discarded) tab, then the
        // first occurrence. The live-tab tiebreaker matters: without it, when a
        // group has only one non-discarded duplicate and one or more discarded
        // shells of the same URL, the [0] fallback could pick a discarded tab,
        // and we'd close the live one - keeping an empty placeholder. Order:
        // pinned > active > live > index 0.
        let keep = groups[url].find(tab => tab.pinned)
          || groups[url].find(tab => tab.active)
          || groups[url].find(tab => !tab.discarded)
          || groups[url][0];
        for (let tab of groups[url]) {
          // Never close pinned tabs (even if not the chosen "keep")
          if (tab.id !== keep.id && !tab.pinned) {
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
