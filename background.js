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

// How long a content-script injection or a message to a tab may take before
// a suspend stops waiting on it. executeScript does not resolve until the
// page reaches document_idle, and a tab still loading behind forty others can
// sit there for a long time; sequential suspends used to stall on exactly that.
const INJECT_TIMEOUT_MS = 1500;
const TAB_MESSAGE_TIMEOUT_MS = 500;

// Resolves to undefined once `ms` has passed, whatever the promise is doing.
// A rejection still rejects, so callers keep their existing catch paths.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(undefined), ms))
  ]);
}

// Resolves to 'ok' when formcheck.js is in the tab, 'skipped' without host
// permission, 'timeout' when the page has not reached document_idle in time,
// and 'failed' when Chrome refused the injection (store pages and the like).
// Injections still in flight, by tab. A caller that arrives while one is
// pending waits on that same promise instead of trusting the marker: the
// marker is set the moment an injection starts, and reporting 'ok' off it
// while the script has not landed yet sent the form check to a page with no
// listener, which then read as "clean".
let _injecting = new Map();

async function injectFormCheck(tabId) {
  let pending = _injecting.get(tabId);
  if (pending) return (await withTimeout(pending, INJECT_TIMEOUT_MS)) || 'timeout';
  if (_injectedTabs.has(tabId)) return 'ok';
  if (!(await hasHostPermission())) return 'skipped';
  // Add optimistically before await to prevent concurrent callers from double-injecting
  _injectedTabs.add(tabId);
  let injection = chrome.scripting.executeScript({
    target: { tabId },
    files: ['formcheck.js']
  }).then(() => 'ok', () => { _injectedTabs.delete(tabId); return 'failed'; });
  _injecting.set(tabId, injection);
  injection.then(() => { if (_injecting.get(tabId) === injection) _injecting.delete(tabId); });
  // A timeout leaves the marker set: the script still lands when the page
  // settles, and the rejection path above clears it if it never does.
  return (await withTimeout(injection, INJECT_TIMEOUT_MS)) || 'timeout';
}

// Form protection's verdict for one tab: 'dirty' when it has unsaved input,
// 'unverified' when that could not be established in time (the script has not
// landed yet, or the page did not answer), false when it is clean. A page
// Chrome will not inject into at all comes back clean, as it always has.
// Every path that honours Protect tabs with forms asks this one function.
async function formCheckBlocks(tabId) {
  let injected = await injectFormCheck(tabId);
  if (injected === 'timeout') return 'unverified';
  try {
    let resp = await withTimeout(chrome.tabs.sendMessage(tabId, { action: 'checkFormData' }), TAB_MESSAGE_TIMEOUT_MS);
    if (resp && resp.hasFormData) return 'dirty';
    if (resp === undefined && _injectedTabs.has(tabId)) return 'unverified';
  } catch {}
  return false;
}

const ALARM_NAME = 'check-tabs';
const BADGE_COLOR = '#7c3aed';
const MB_PER_TAB = 150;
const MAX_SESSIONS = 20;
const UNINSTALL_URL = 'https://ml3dev.github.io/drowzy/uninstall.html';
// Versions that open What's New on update despite not being a major bump.
// See onInstalled for why this exists and why it should stay short.
const SHOW_CHANGELOG_VERSIONS = ['1.4.0', '1.5.0'];

// Opera and Opera GX. A GitHub report (#3) has Opera GX crashing within about
// a minute of opening with Drowzy enabled and around 20 tabs, on a 15 minute
// timer, and not crashing with Drowzy disabled. The only heavy thing Drowzy
// does in that first minute is discarding: the startup catch-up sweep goes
// through every restored tab the user has not looked at, some of which have
// never loaded at all, and the first per-minute pass can follow with a batch
// of four at a time, since restored tabs carry their old last-used times.
// Opera ships its own tab snoozing and RAM limiter on top of
// Chromium, and we cannot reproduce the crash here, so in Opera only the
// automatic paths are made gentler:
//   1. nothing is discarded automatically for the first few minutes after the
//      browser starts, so restore finishes before Drowzy touches anything
//   2. one discard at a time, with a short pause between them
//   3. tabs that have never loaded are left for the browser to handle; they
//      hold no page in memory, so there is nothing to free by discarding them
// Chrome and every other Chromium browser keep the exact behaviour they had.
const IS_OPERA = (function() {
  try {
    let brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    if (brands.some(b => /opera/i.test(b.brand || ''))) return true;
    return /\bOPR\//.test(navigator.userAgent || '');
  } catch { return false; }
})();
const OPERA_STARTUP_GRACE_MS = 3 * 60 * 1000;
const OPERA_DISCARD_GAP_MS = 400;

// True while Opera is inside the post-startup quiet period. The start time
// lives in session storage, so a worker restart inside the window keeps it.
async function inOperaStartupGrace() {
  if (!IS_OPERA) return false;
  try {
    let data = await chrome.storage.session.get('browserStartedAt');
    let at = data.browserStartedAt;
    return typeof at === 'number' && Date.now() - at < OPERA_STARTUP_GRACE_MS;
  } catch { return false; }
}

// A tab restored but never loaded. Only consulted in Opera (see above).
function isNeverLoaded(tab) {
  return IS_OPERA && tab.status === 'unloaded';
}

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
    await normalizeStoredWhitelist();
    let version = chrome.runtime.getManifest().version;
    let data = await chrome.storage.local.get('drowzy_lastChangelogVersion');
    let lastVer = data.drowzy_lastChangelogVersion || '';
    // Only show changelog on MAJOR version bumps (e.g. 1.x.x → 2.x.x).
    // Minor and patch bumps silently update the stored version.
    //
    // SHOW_CHANGELOG_VERSIONS is a narrow opt-in for releases where the whole
    // point is telling people what changed. 1.4.0 adds a per-tab hold and
    // explains why tabs are protected, both of which are invisible unless you
    // go looking. 1.5.0 answers a review about speed with many tabs; its page
    // covers the 1 minute timer and where shortcuts live, neither of which
    // anyone finds on their own. Keep this list short - a What's New tab that
    // opens for every release is just noise, which is why the major-bump rule
    // is still the default for everything not listed here.
    let curMajor = version.split('.')[0];
    let lastMajor = lastVer.split('.')[0];
    let forced = SHOW_CHANGELOG_VERSIONS.includes(version) && lastVer !== version;
    if (lastVer && (forced || curMajor !== lastMajor)) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
      try { chrome.tabs.create({ url: 'changelog.html' }); } catch {}
    } else if (lastVer !== version) {
      await chrome.storage.local.set({ drowzy_lastChangelogVersion: version });
    }
  }
}

async function onStartup() {
  // first, before any await: the Opera startup quiet period counts from here
  try { chrome.storage.session.set({ browserStartedAt: Date.now() }); } catch {}
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
    // this pass discards directly rather than through suspendTab, so it needs
    // its own Keep-awake check. In practice no hold can exist 30s after
    // install, but the bypass should not be the one path that ignores it.
    await loadKeptAwake();
    let tabs = await chrome.tabs.query({});
    let staleBefore = Date.now() - 10 * 60 * 1000;
    for (let tab of tabs) {
      if (tab.active || tab.discarded) continue;
      if (_keptAwake.has(tab.id)) continue;
      if (typeof tab.lastAccessed !== 'number') continue;
      if (tab.lastAccessed > staleBefore) continue;
      if (isNeverLoaded(tab)) continue;
      if (isInternalUrl(tab.url)) continue;
      if (settings.protectPinned && tab.pinned) continue;
      if (settings.protectAudio && tab.audible) continue;
      if (isWhitelisted(tab.url, settings.whitelist)) continue;
      try {
        let result = await chrome.tabs.discard(tab.id);
        if (result) await recordSuspension(tab.id);
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
      // Opera only: a never-loaded tab stays tagged and is picked up if the
      // browser loads it later without the user looking at it
      if (isNeverLoaded(tab)) continue;
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
        if (suspended && IS_OPERA) await new Promise(r => setTimeout(r, OPERA_DISCARD_GAP_MS));
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

// Tab ids the user has explicitly held awake ("Keep this tab awake"). Same
// chrome.storage.session backing and in-flight-promise memoization as the two
// sets above, for the same clobbering reason. Clearing on browser restart is
// the point, not a limitation: a hold is a "not right now" decision about one
// tab in front of you. The whitelist stays the permanent, per-site tool.
//
// Unlike the other two, the Set is also exposed as a module-level mirror,
// because shouldSuspend is synchronous and cannot await. Every caller of
// shouldSuspend awaits loadKeptAwake() first, so the mirror is warm by then;
// suspendTab does its own await and is the authoritative gate.
let _keptAwakePromise = null;
let _keptAwake = new Set();

function loadKeptAwake() {
  if (!_keptAwakePromise) {
    // fill the existing Set in place rather than replacing it - the mirror
    // and the promised value must stay the same object, or a mutation made
    // through one would be invisible to the other
    _keptAwakePromise = chrome.storage.session.get('keptAwakeTabIds')
      .then(function(data) {
        for (let id of (data.keptAwakeTabIds || [])) _keptAwake.add(id);
        return _keptAwake;
      })
      .catch(function() { return _keptAwake; });
  }
  return _keptAwakePromise;
}

async function persistKeptAwake() {
  try {
    let set = await loadKeptAwake();
    await chrome.storage.session.set({ keptAwakeTabIds: [...set] });
  } catch {}
}

async function setKeptAwake(tabId, on) {
  try {
    let set = await loadKeptAwake();
    if (on === set.has(tabId)) return on;
    if (on) set.add(tabId); else set.delete(tabId);
    // persist immediately, no debounce: these are one-at-a-time user actions,
    // and a hold lost to worker death would silently suspend a tab the user
    // just asked to keep
    await persistKeptAwake();
    return on;
  } catch { return false; }
}

// A held tab is also taken out of the browser's own automatic discarding
// (Chrome's Memory Saver, Opera's tab snoozing). Without this, "Keep this tab
// awake" only stopped Drowzy, and the browser could still sleep the tab under
// memory pressure, which reads to the user as Drowzy ignoring the hold. The
// flag only affects the browser's automatic discards, it changes nothing about
// the page or its address, and the browser resets it when the tab closes or
// the browser restarts, the same lifetime as the hold itself.
async function setBrowserAutoDiscard(tabId, allowed) {
  try { await chrome.tabs.update(tabId, { autoDiscardable: allowed }); } catch {}
}

async function isKeptAwake(tabId) {
  try {
    let set = await loadKeptAwake();
    return set.has(tabId);
  } catch { return false; }
}

// Chrome drops tab.favIconUrl once a tab is discarded, so the moment you hit
// Suspend Others the list turns into a wall of anonymous letter circles - the
// icons vanish exactly when the tab list matters most. Remember the last icon
// we saw per tab and serve it back when Chrome has none. Same session backing
// and memoization as the sets above; cleared on browser restart, which is
// fine because Chrome re-reports favicons as tabs reload.
let _faviconsPromise = null;
let _favicons = {};
let _favDirty = false;
let _favTimer = null;

function loadFavicons() {
  if (!_faviconsPromise) {
    _faviconsPromise = chrome.storage.session.get('tabFavicons')
      .then(function(data) {
        let stored = data.tabFavicons || {};
        // fill in place, never replace: a favicon remembered before the read
        // resolved must not be lost (same reasoning as the sets above)
        for (let id in stored) if (!(id in _favicons)) _favicons[id] = stored[id];
        return _favicons;
      })
      .catch(function() { return _favicons; });
  }
  return _faviconsPromise;
}

function rememberFavicon(tabId, url) {
  // chrome:// icons are not renderable from the popup, so caching them would
  // just reintroduce the broken-image path buildFavicon already guards against
  if (!url || url.indexOf('chrome://') === 0) return;
  if (_favicons[tabId] === url) return;
  _favicons[tabId] = url;
  _favDirty = true;
  // debounced: navigation churn would otherwise rewrite the whole map per hop
  if (_favTimer) return;
  _favTimer = setTimeout(function() { _favTimer = null; flushFavicons(); }, 3000);
}

async function flushFavicons() {
  if (!_favDirty) return;
  try {
    await chrome.storage.session.set({ tabFavicons: _favicons });
    _favDirty = false;
  } catch {}
}

// Why a suspend was refused, for the failure toast. Called ONLY after a
// suspend attempt already returned false, so it costs nothing on the happy
// path and cannot influence whether a tab is discarded. Returns an i18n key
// or null when we genuinely do not know (Chrome refused for its own reasons).
async function explainSuspendFailure(tabId, cachedSettings) {
  try {
    let tab = await chrome.tabs.get(tabId);
    // Already asleep: auto-suspend beat the click, or the tab was discarded
    // between render and click. The user got what they asked for, so the
    // caller must report success rather than an error toast.
    if (tab.discarded) return 'ALREADY_ASLEEP';
    if (isInternalUrl(tab.url)) return 'systemPageCantSuspend';
    if (await isKeptAwake(tabId)) return 'keptAwakeWontSuspend';
    let settings = cachedSettings || await getSettings();
    if (settings.protectPinned && tab.pinned) return 'pinnedWontSuspend';
    if (settings.protectAudio && tab.audible) return 'audioWontSuspend';
    if (isWhitelisted(tab.url, settings.whitelist)) return 'whitelistedWontSuspend';
    // Form input is asked about before "no other tab": handleSuspendCurrent
    // checks for it before switching, so a tab refused for it is still the
    // active one. A check that got no answer in time is reported as still
    // loading, which is what a page too busy to answer looks like.
    if (settings.protectForms) {
      let verdict = await formCheckBlocks(tabId);
      if (verdict === 'dirty') return 'suspendFailedForm';
      if (verdict === 'unverified') return 'suspendFailedLoading';
    }
    if (tab.active) {
      // "Needs another open tab" only when that is actually the case. With a
      // neighbour available, an active tab is refused for something passing
      // (a check that timed out, a discard Chrome declined), and the honest
      // advice is the same as for a loading tab: try again in a moment.
      let others = await chrome.tabs.query({ windowId: tab.windowId });
      let hasTarget = others.some(o => o.id !== tab.id && !o.discarded && !isInternalUrl(o.url));
      return hasTarget ? 'suspendFailedLoading' : 'cantSuspendNoOtherTab';
    }
    if (tab.status === 'loading') return 'suspendFailedLoading';
    return null;
  } catch { return null; }
}

let _timestamps = {};
let _tsDirty = false;
let _tsFlushTimer = null;

// One reload at a time. getTabList kicks this off without waiting on it; the
// per-minute check awaits it, and both must share a single run rather than
// each seeding and flushing over the other.
let _initTimestampsPromise = null;

function ensureTimestamps() {
  if (!_initTimestampsPromise) {
    _initTimestampsPromise = initTimestamps().finally(() => { _initTimestampsPromise = null; });
  }
  return _initTimestampsPromise;
}

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

    // Same prune for Keep-awake holds. onTabRemoved normally clears these, but
    // a removal that lands while the worker is down would leave the id behind
    // forever. Harmless today (Chrome does not recycle tab ids within a
    // session) but it would quietly grow the stored array.
    try {
      let held = await loadKeptAwake();
      let stale = [...held].filter(id => !liveIds.has(id));
      if (stale.length) {
        for (let id of stale) held.delete(id);
        await persistKeptAwake();
      }
      // same prune for the remembered favicons, which would otherwise be the
      // one session map that grows for the whole browser session
      await loadFavicons();
      for (let id in _favicons) {
        if (!liveIds.has(Number(id))) { delete _favicons[id]; _favDirty = true; }
      }
      await flushFavicons();
    } catch {}

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
  // Every suspend path starts here, so one non-string entry in synced storage
  // (a hand-edited or corrupted value) must not throw and take auto-suspend,
  // the popup and the startup sweep down with it. Such entries are skipped.
  merged.whitelist = merged.whitelist
    .filter(w => typeof w === 'string' && w)
    .map(w => w.toLowerCase().replace(/^www\./, ''));
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

// Stats are meant to count tabs going to sleep, not button presses. Suspend
// Others followed by Wake All, in a loop, otherwise inflates the lifetime
// figures without limit: the numbers stop meaning anything and the stat cards
// fill with absurd values. A tab re-slept within a minute of last being
// counted does not count again. Genuine use is unaffected - nobody legitimately
// wakes and re-sleeps the same tab twice inside sixty seconds.
//
// In memory on purpose: it only has to outlive a burst of clicking, and the
// worker is alive throughout one.
const RECOUNT_COOLDOWN_MS = 60 * 1000;
let _lastCounted = new Map();

function countsAsNewSuspension(tabId) {
  let now = Date.now();
  let prev = _lastCounted.get(tabId);
  if (prev && now - prev < RECOUNT_COOLDOWN_MS) return false;
  _lastCounted.set(tabId, now);
  if (_lastCounted.size > 500) {
    for (let [id, ts] of _lastCounted) {
      if (now - ts > RECOUNT_COOLDOWN_MS) _lastCounted.delete(id);
    }
  }
  return true;
}

// A stats update is a read-modify-write on storage.local, so two in flight at
// once would both read the same number and one increment would be lost. The
// writes are queued: each waits for the previous one to finish before it reads.
// Sequential suspends hid this; suspends now run a few at a time.
let _statsQueue = Promise.resolve();

async function recordSuspension(tabId) {
  if (typeof tabId === 'number' && !countsAsNewSuspension(tabId)) return;
  let job = _statsQueue.then(writeSuspension);
  _statsQueue = job.catch(() => {});
  return job;
}

async function writeSuspension() {
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
    // Opera: still inside the startup quiet period. The tags stay, and the
    // per-minute tick runs the sweep once the period is over.
    if (await inOperaStartupGrace()) return;
    let settings = await getSettings();
    // warm the Keep-awake mirror here too, so "loaded before any shouldSuspend
    // call" holds on every path rather than only on the per-minute tick. At
    // startup the set is always empty (session storage is cleared on restart),
    // but relying on that is a reasoning trap the next change would fall into.
    await loadKeptAwake();
    if (settings.suspendOnStartup) await restoredCatchupSweep(settings);
  }
}

async function onTabActivated(activeInfo) {
  await touchTab(activeInfo.tabId);
  await markActivated(activeInfo.tabId);
  _autoRefusals.delete(activeInfo.tabId);
  // the user is looking at it now - it is no longer the startup sweep's business
  await untagRestored(activeInfo.tabId);
  // Flush immediately on activation since worker is alive during this event
  await flushTimestamps();
  debouncedBadgeUpdate();
}

async function onTabUpdated(tabId, changeInfo, tab) {
  // capture the icon while the tab still has one - after a discard it is gone
  if (changeInfo.favIconUrl) rememberFavicon(tabId, changeInfo.favIconUrl);
  else if (tab && tab.favIconUrl && !tab.discarded) rememberFavicon(tabId, tab.favIconUrl);
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
  _injecting.delete(tabId);
  await untagRestored(tabId);
  await unmarkActivated(tabId);
  // a hold dies with its tab - ids get recycled, and inheriting a stranger's
  // hold would keep a brand new tab awake for no visible reason
  await setKeptAwake(tabId, false);
  if (tabId in _favicons) { delete _favicons[tabId]; _favDirty = true; }
  _lastCounted.delete(tabId);
  _autoRefusals.delete(tabId);
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
    // a discard swaps the id, and the discarded tab has no favicon of its own -
    // carrying the remembered one across is the whole point of the cache
    if (removedTabId in _favicons) {
      _favicons[addedTabId] = _favicons[removedTabId];
      delete _favicons[removedTabId];
      _favDirty = true;
      await flushFavicons();
    }
    // carry the hold across the id swap. The user held the page, not the id,
    // and a prerender/discard swap is invisible to them.
    let held = await loadKeptAwake();
    if (held.has(removedTabId)) {
      held.delete(removedTabId);
      held.add(addedTabId);
      await persistKeptAwake();
      // the swapped-in tab is a new tab object to the browser, so the
      // auto-discard opt-out has to be set on it again
      await setBrowserAutoDiscard(addedTabId, false);
    }
    if (_autoRefusals.has(removedTabId)) _autoRefusals.delete(removedTabId);
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
      await ensureTimestamps();
    }

    // Opera: nothing automatic during the startup quiet period. Timestamps
    // above are already loaded, so the first tick after it starts clean.
    if (await inOperaStartupGrace()) return;

    let settings = await getSettings();
    // warm the Keep-awake mirror before anything calls shouldSuspend, which
    // reads it synchronously. Cheap after the first tick: memoized promise.
    await loadKeptAwake();

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
      if (isNeverLoaded(tab)) continue;
      if (shouldSuspend(tab, settings, _timestamps, now, threshold)) {
        toSuspend.push(tab.id);
      }
    }

    if (_tsDirty) scheduleFlush();

    if (toSuspend.length) {
      await runLimited(toSuspend, async (tabId) => {
        await injectFormCheck(tabId);
        try { await withTimeout(chrome.tabs.sendMessage(tabId, { action: 'suspendWarning' }), TAB_MESSAGE_TIMEOUT_MS); } catch {}
      }, SUSPEND_CONCURRENCY);
      await new Promise(r => setTimeout(r, 2500));
      // auto:true so suspendTab respects a Keep awake / refocus that landed
      // during the warning window. Manual suspends bypass this check.
      await suspendMany(toSuspend, settings, { auto: true });
    }
  } finally { _suspending = false; }
}

function shouldSuspend(tab, settings, timestamps, now, threshold) {
  if (tab.active || tab.discarded) return false;
  // Reads the sync mirror. suspendTab re-checks authoritatively, so this is
  // not the gate that keeps the tab alive - it is here so a held tab never
  // gets a "Suspending tab soon..." banner for a suspend that cannot happen.
  if (_keptAwake.has(tab.id)) return false;
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

// A hostname the way the whitelist compares it: lowercase, no www., no IPv6
// brackets, and an internationalised name in the punycode form Chrome reports
// in tab.url, so "münchen.de" typed by the user still matches the tab.
function canonicalHost(host) {
  let h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/^\[|\]$/g, '');
  try { h = new URL('http://' + h).hostname.replace(/^\[|\]$/g, ''); } catch {}
  return h;
}

// Path patterns compiled once per entry. A whitelist of a few hundred paths
// matched against a couple of hundred tabs on every popup poll would otherwise
// build tens of thousands of RegExps a minute.
let _patternCache = new Map();

function whitelistPattern(entry) {
  let re = _patternCache.get(entry);
  if (re === undefined) {
    let slash = entry.indexOf('/');
    let host = canonicalHost(entry.slice(0, slash));
    let escaped = (host + entry.slice(slash)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    try { re = new RegExp('^' + escaped + '(/.*)?$'); } catch { re = null; }
    _patternCache.set(entry, re);
  }
  return re;
}

// The stored entry that covers this url, or null. An entry is either a host
// ("site.com" covers it and every subdomain; "*.site.com", which people type
// expecting exactly that, is read the same way) or a path pattern such as
// "site.com/docs/*". Returning the entry lets the popup remove what is
// actually stored rather than guess a bare domain that was never in the list.
function whitelistMatch(url, whitelist) {
  if (!url || !whitelist || !whitelist.length) return null;
  try {
    let parsed = new URL(url);
    let hostname = canonicalHost(parsed.hostname);
    let fullUrl = (hostname + parsed.pathname).toLowerCase();
    for (let entry of whitelist) {
      let d = String(entry).toLowerCase().replace(/^www\./, '');
      if (d.includes('/')) {
        let re = whitelistPattern(d);
        if (re && re.test(fullUrl)) return entry;
        continue;
      }
      if (d.startsWith('*.')) d = d.slice(2);
      d = canonicalHost(d);
      if (d && (hostname === d || hostname.endsWith('.' + d))) return entry;
    }
  } catch {}
  return null;
}

function isWhitelisted(url, whitelist) {
  return whitelistMatch(url, whitelist) !== null;
}

// Why the per-minute pass last left a due tab awake, for the popup. Without it
// a tab refused for unsaved input or a load that never settles sat in the list
// reading "soon" forever. Reporting only: nothing here feeds back into whether
// a tab is suspended. In memory, and an entry older than a few minutes is
// ignored, since the pass retries every minute and refreshes it while it holds.
const AUTO_REFUSAL_TTL_MS = 3 * 60 * 1000;
let _autoRefusals = new Map();

function noteAutoRefusal(tabId, opts, reason) {
  if (opts && opts.auto) _autoRefusals.set(tabId, { reason, at: Date.now() });
}

function autoRefusalFor(tabId) {
  let r = _autoRefusals.get(tabId);
  if (!r) return null;
  if (Date.now() - r.at > AUTO_REFUSAL_TTL_MS) {
    _autoRefusals.delete(tabId);
    return null;
  }
  return r.reason;
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
    // The authoritative Keep-awake gate. Every suspend path except
    // firstRunQuickSuspend funnels through here, including the startup catch-up
    // sweep, so this one await covers auto-suspend, Suspend Others, Suspend
    // this tab, the context menu, the shortcut, and the sweep. Checked before
    // injectFormCheck so a held tab never gets a content script injected for a
    // suspend that will not happen.
    if (await isKeptAwake(tabId)) return false;

    if (settings.protectForms) {
      // Refuses both unsaved input and a page that could not be checked in
      // time: discarding on a guess is exactly what form protection exists to
      // prevent. The per-minute check retries it; a manual run reports it.
      let verdict = await formCheckBlocks(tabId);
      if (verdict) {
        noteAutoRefusal(tabId, opts, verdict === 'dirty' ? 'form' : 'loading');
        return false;
      }
    } else if (settings.markSuspendedTabs) {
      // Only the title marking needs the script here, and it is cosmetic, so a
      // slow page does not hold anything up.
      await injectFormCheck(tabId);
    }

    if (settings.markSuspendedTabs) {
      // Bounded: the marking is cosmetic, and a page too busy to answer must
      // not delay its own suspend.
      try { await withTimeout(chrome.tabs.sendMessage(tabId, { action: 'markSuspended' }), TAB_MESSAGE_TIMEOUT_MS); } catch {}
    }

    // Final recheck immediately before discard - user may have switched to
    // this tab during the preceding awaits (form check, message round-trips).
    // Discarding an active tab forces a visible reload when the user looks at it.
    try {
      let fresh = await chrome.tabs.get(tabId);
      if (fresh.active || fresh.discarded) return false;
      // Audio is rechecked against the setting, not unconditionally. The fresh
      // read still matters (a tab can start playing during the awaits above),
      // but refusing here regardless of protectAudio made the setting a no-op:
      // every suspend path funnels through this function, so a user who turned
      // "Protect audio tabs" off still could not sleep a background video tab.
      if (settings.protectAudio && fresh.audible) return false;
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
        if (fresh.status === 'loading') {
          noteAutoRefusal(tabId, opts, 'loading');
          return false;
        }
        if (isNeverLoaded(fresh)) return false;
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
      _autoRefusals.delete(tabId);
      debouncedBadgeUpdate();
      await recordSuspension(tabId);
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
  // bail before the neighbour switch below. suspendTab would refuse a held tab
  // anyway, but only after we had already yanked the user to another tab.
  if (await isKeptAwake(activeTab.id)) return;

  let settings = await getSettings();
  if (settings.protectPinned && activeTab.pinned) return;
  if (settings.protectAudio && activeTab.audible) return;
  if (isWhitelisted(activeTab.url, settings.whitelist)) return;
  // Unsaved input is checked BEFORE switching tabs. suspendTab would refuse
  // it anyway, but only after the user had been moved to a neighbour for
  // nothing, with the popup gone and no toast to say why.
  if (settings.protectForms && await formCheckBlocks(activeTab.id)) return;

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

// Runs fn over items with at most `limit` in flight, in list order.
async function runLimited(items, fn, limit) {
  let queue = items.slice();
  let workers = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push((async () => {
      while (queue.length) {
        await fn(queue.shift());
      }
    })());
  }
  await Promise.all(workers);
}

// A few discards in flight at once is plenty: each one is a browser-process
// round trip, and it is the waiting in single file that made forty tabs take
// a minute, not the discards themselves. Opera gets one at a time (see
// IS_OPERA); slower there, on purpose.
const SUSPEND_CONCURRENCY = IS_OPERA ? 1 : 4;

// Suspends a batch through suspendTab, a few at a time, so every protection
// and the pre-discard recheck still apply per tab. Returns which ids went to
// sleep and which were refused, so a manual run can say what it did not do.
async function suspendMany(tabIds, settings, opts) {
  let suspended = [];
  let refused = [];
  await runLimited(tabIds, async (tabId) => {
    if (await suspendTab(tabId, settings, opts)) {
      suspended.push(tabId);
      if (IS_OPERA) await new Promise(r => setTimeout(r, OPERA_DISCARD_GAP_MS));
    } else {
      refused.push(tabId);
    }
  }, SUSPEND_CONCURRENCY);
  return { suspended, refused };
}

// Chrome refuses to discard a tab whose navigation has not committed yet, which
// is exactly the state a batch of freshly opened tabs is in. Those are retried
// a couple of times, a moment apart, before being reported as still loading.
const LOADING_RETRY_PASSES = 2;
const LOADING_RETRY_DELAY_MS = 2000;

// Sorts refused ids into what they are now: still mid-load (worth another
// try, or worth naming in the result), asleep after all (the per-minute pass
// or Chrome itself got there first, so the user has what they asked for and
// it counts), or refused for a reason of its own that stays refused. Closed
// tabs simply drop out.
async function sortRefused(tabIds) {
  let loading = [], asleep = [], other = [];
  for (let id of tabIds) {
    try {
      let tab = await chrome.tabs.get(id);
      if (tab.discarded) asleep.push(id);
      else if (tab.status === 'loading' && !tab.active) loading.push(id);
      else other.push(id);
    } catch {}
  }
  return { loading, asleep, other };
}

async function suspendAllOthers(windowId) {
  let settings = await getSettings();
  await loadKeptAwake();
  let tabs = await chrome.tabs.query(windowId ? { windowId } : {});

  // Same chain as getStatus's eligible count, so the total a caller reports
  // is the set the strip already showed as available.
  let targets = [];
  for (let tab of tabs) {
    if (tab.active || tab.discarded || isInternalUrl(tab.url)) continue;
    if (_keptAwake.has(tab.id)) continue;
    if (settings.protectPinned && tab.pinned) continue;
    if (settings.protectAudio && tab.audible) continue;
    if (isWhitelisted(tab.url, settings.whitelist)) continue;
    targets.push(tab.id);
  }

  let { suspended, refused } = await suspendMany(targets, settings);
  for (let pass = 0; pass < LOADING_RETRY_PASSES && refused.length; pass++) {
    let { loading } = await sortRefused(refused);
    if (!loading.length) break;
    await new Promise(r => setTimeout(r, LOADING_RETRY_DELAY_MS));
    let again = await suspendMany(loading, settings);
    suspended = suspended.concat(again.suspended);
    // Refusals that were never about loading keep their place
    refused = refused.filter(id => !loading.includes(id)).concat(again.refused);
  }
  let left = await sortRefused(refused);

  // Only tabs Chrome itself confirms as discarded are counted. Attempts are
  // not successes, and the popup's toast and progress are built from this.
  return {
    count: suspended.length + left.asleep.length,
    total: targets.length,
    refused: left.loading.length + left.other.length,
    stillLoading: left.loading.length
  };
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

// The one normaliser for everything that enters the whitelist: the input box,
// the current-site button, the context menu and clipboard import. It accepts
// what people actually paste (a full address with scheme, query, fragment,
// trailing slash, port or IPv6 brackets) and stores the plain form the
// matcher expects. Returns null when nothing usable is left.
function normalizeWhitelistEntry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let d = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.replace(/[?#].*$/, '');   // query and fragment never take part in matching
  d = d.replace(/\/+$/, '');      // "site.com/" is the whole site, "a/b/" is "a/b"
  if (!d) return null;
  let slash = d.indexOf('/');
  let host = slash === -1 ? d : d.slice(0, slash);
  let path = slash === -1 ? '' : d.slice(slash);
  if (/^\[/.test(host)) {
    // bracketed IPv6, with or without a port
    host = host.replace(/^\[([^\]]*)\].*$/, '$1');
  } else if ((host.match(/:/g) || []).length === 1) {
    host = host.replace(/:\d+$/, '');
  }
  let bare = host.replace(/^\*\./, '');
  let isLocal = bare === 'localhost' || bare === '::1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  if (!isLocal && (!bare.includes('.') || bare.startsWith('.') || bare.endsWith('.') || /\s/.test(bare))) return null;
  return host + path;
}

// Entries saved by older versions sit in storage as they were typed:
// "https://Site.com/", "WWW.site.com", the same site twice in different
// case. 1.5.0 matches and removes by the normalised form, so bring the stored
// list up to it once on update. Anything the normaliser does not recognise
// is kept as it was rather than dropped; only exact duplicates and blanks go.
async function normalizeStoredWhitelist() {
  try {
    let settings = await getSettings();
    let list = Array.isArray(settings.whitelist) ? settings.whitelist : [];
    let seen = new Set(), out = [];
    for (let raw of list) {
      let entry = normalizeWhitelistEntry(raw) || (typeof raw === 'string' ? raw.trim() : '');
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      out.push(entry);
    }
    if (out.length !== list.length || out.some((e, i) => e !== list[i])) {
      settings.whitelist = out;
      await chrome.storage.sync.set({ settings });
      _patternCache.clear();
    }
  } catch {}
}

// storage.sync caps a single item at 8 KB, and a whitelist of a few hundred
// paths gets there. Say so in plain words instead of surfacing Chrome's quota
// string, and leave the stored list exactly as it was.
async function saveWhitelist(settings, result) {
  try {
    await chrome.storage.sync.set({ settings });
    return result;
  } catch {
    return { added: false, error: t('whitelistFull') };
  }
}

async function addWhitelist(domain) {
  let d = normalizeWhitelistEntry(domain);
  if (!d) return { added: false, error: t('invalidDomain') };
  let settings = await getSettings();
  if (settings.whitelist.includes(d)) return { added: false, entry: d };
  settings.whitelist.push(d);
  return await saveWhitelist(settings, { added: true, entry: d });
}

// Clipboard import in one write. Adding sites one at a time cost a sync write
// each, and Chrome allows only so many sync writes a minute, so a long list
// used to stop part way through with no word about it.
async function importWhitelist(list) {
  if (!Array.isArray(list)) return { added: 0, invalid: 0, error: t('noValidDomains') };
  let settings = await getSettings();
  let added = 0, invalid = 0;
  for (let raw of list) {
    let d = normalizeWhitelistEntry(typeof raw === 'string' ? raw : '');
    if (!d) { invalid++; continue; }
    if (settings.whitelist.includes(d)) continue;
    settings.whitelist.push(d);
    added++;
  }
  if (!added) return { added: 0, invalid };
  let saved = await saveWhitelist(settings, { added, invalid });
  return saved.error ? { added: 0, invalid, error: saved.error } : saved;
}

async function removeWhitelist(domain) {
  if (!domain || typeof domain !== 'string') return;
  let settings = await getSettings();
  // the popup passes the stored entry that matched, so it is compared as is;
  // the normalised form is taken out too for callers that pass a bare site
  let d = domain.toLowerCase().replace(/^www\./, '');
  let n = normalizeWhitelistEntry(domain);
  settings.whitelist = settings.whitelist.filter(w => w !== d && w !== n);
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
  let sessionIcons = await loadFavicons();
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
      // same discard fallback as getTabList: saving a session while tabs are
      // asleep would otherwise store a session with no icons at all
      favIconUrl: tab.favIconUrl || sessionIcons[tab.id] || '',
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
    } catch {
      // Chrome's own error text is English-only and technical; the popup
      // shows this string as is, so give it the translated one
      return { success: false, error: t('failedToRestore') };
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

  // total lets the popup say "8 of 10" when some tabs could not be opened,
  // instead of a count that reads as the whole session
  return { success: createdTabs.length > 0, count: createdTabs.length, total: restorable.length,
    error: createdTabs.length ? undefined : t('failedToRestore') };
}

// Clipboard import for the JSON that "Copy all sessions" produces. Everything
// is rebuilt field by field from what the popup pasted, never stored as is:
// only http and https pages are kept, names and titles are plain strings with
// a length cap, and group colours must be ones Chrome knows. Sessions already
// saved here (same id) are skipped, and the 20-session limit still applies.
const SESSION_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

function sanitizeSession(raw, index) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tabs)) return null;
  let tabs = [];
  for (let tab of raw.tabs) {
    if (!tab || typeof tab.url !== 'string' || isInternalUrl(tab.url)) continue;
    tabs.push({
      url: tab.url,
      title: typeof tab.title === 'string' && tab.title ? tab.title.slice(0, 500) : t('tabUntitled'),
      favIconUrl: '',
      pinned: tab.pinned === true,
      groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1
    });
  }
  if (!tabs.length) return null;
  let groups = {};
  if (raw.groups && typeof raw.groups === 'object') {
    for (let id in raw.groups) {
      let g = raw.groups[id] || {};
      groups[id] = {
        title: typeof g.title === 'string' ? g.title.slice(0, 100) : '',
        color: SESSION_GROUP_COLORS.includes(g.color) ? g.color : 'grey'
      };
    }
  }
  let createdAt = Number(raw.createdAt);
  return {
    id: typeof raw.id === 'string' && /^session_[\w-]{1,40}$/.test(raw.id) ? raw.id : 'session_' + Date.now() + '_' + index,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : _formatSessionName(),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    groups,
    tabs
  };
}

async function importSessions(list) {
  if (!Array.isArray(list)) return { added: 0, duplicates: 0, full: 0, invalid: 0 };
  let sessions = await getSessions();
  let ids = new Set(sessions.map(s => s.id));
  // a session pasted twice is the same session even when its id had to be
  // regenerated (a hand-edited file), so the same list of addresses counts too
  let sig = s => (s.tabs || []).map(tab => tab.url).join('\u0001');
  let sigs = new Set(sessions.map(sig));
  let added = 0, duplicates = 0, full = 0, invalid = 0, fresh = [];
  for (let i = 0; i < list.length; i++) {
    let s = sanitizeSession(list[i], i);
    if (!s) { invalid++; continue; }
    if (ids.has(s.id) || sigs.has(sig(s))) { duplicates++; continue; }
    if (sessions.length + fresh.length >= MAX_SESSIONS) { full++; continue; }
    ids.add(s.id);
    sigs.add(sig(s));
    fresh.push(s);
    added++;
  }
  if (fresh.length) {
    // newest first, the same order the list is kept in
    let merged = sessions.concat(fresh).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    await chrome.storage.local.set({ drowzy_sessions: merged });
  }
  return { added, duplicates, full, invalid };
}

async function getTabList(windowId) {
  // A cold worker has no timestamps yet. Start the reload but do not wait
  // for it: the list falls back to Chrome's own tab.lastAccessed below, which
  // is the same value initTimestamps seeds from, so the first draw is right
  // either way and the popup is not held behind another query and two writes.
  if (Object.keys(_timestamps).length === 0) ensureTimestamps();
  let settings = await getSettings();
  let held = await loadKeptAwake();
  let icons = await loadFavicons();
  let tabs = await chrome.tabs.query(windowId ? { windowId } : {});
  let now = Date.now();
  let threshold = settings.suspendAfterMinutes * 60 * 1000;

  return tabs.map(tab => {
    let status = 'idle';
    let protectReason = null;
    let timeLeft = null;
    let keptAwake = held.has(tab.id);
    let waitReason = null;
    // the entry that covers this tab, handed to the popup so the current-site
    // button can remove exactly what is stored
    let whitelistEntry = whitelistMatch(tab.url, settings.whitelist);

    // The active tab keeps status 'active' even when held - the popup finds it
    // by that status, and it renders the hold from the keptAwake field below.
    if (tab.active) {
      status = 'active';
      protectReason = 'Active tab';
    } else if (tab.discarded) {
      status = 'suspended';
    } else if (keptAwake) {
      status = 'protected';
      protectReason = 'Kept awake';
    } else if (isInternalUrl(tab.url)) {
      status = 'protected';
      protectReason = 'System page';
    } else if (settings.protectPinned && tab.pinned) {
      status = 'protected';
      protectReason = 'Pinned';
    } else if (settings.protectAudio && tab.audible) {
      status = 'protected';
      protectReason = 'Audio';
    } else if (whitelistEntry) {
      status = 'protected';
      protectReason = 'Whitelisted';
    } else if (isNeverLoaded(tab)) {
      // Opera only: the automatic paths leave these alone, so a countdown
      // here would promise a sleep that is not going to happen
      waitReason = 'notLoaded';
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
      // overdue and still awake: say why, when the last pass knows
      if (timeLeft === 0) waitReason = autoRefusalFor(tab.id);
    }

    return {
      id: tab.id,
      title: tab.title || t('tabUntitled'),
      url: tab.url || '',
      // fall back to the icon we saw before Chrome dropped it on discard
      favIconUrl: tab.favIconUrl || icons[tab.id] || '',
      status, protectReason, timeLeft, keptAwake, whitelistEntry, waitReason,
      pinned: tab.pinned,
      audible: tab.audible
    };
  });
}

// What makes two tabs "the same page" for Close Duplicates. Only the scheme
// and host are case-insensitive; paths, queries and fragments are compared
// as they are. Before 1.6.0 the whole address was lowercased and the
// fragment dropped, so two Gmail messages (#inbox vs #inbox/abc), two pages
// of a hash-routed app, or two case-sensitive ids counted as one page and
// all but one were closed. Closing is not undoable from Drowzy, so this
// errs toward leaving a near-duplicate open. A bare trailing slash is still
// ignored: "site.com" and "site.com/" are the same page.
function duplicateKey(url) {
  try {
    let u = new URL(url);
    let path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '';
    return u.protocol + '//' + u.host + path + u.search + u.hash;
  } catch { return null; }
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
      let held = await loadKeptAwake();
      // Keep this in step with getTabList's protection chain. A held tab shows
      // as protected in the list, so counting it as eligible here would make
      // the strip contradict the list directly above it.
      let protectedCount = allTabs.filter(tab =>
        !tab.discarded && (
          tab.active || isInternalUrl(tab.url) || held.has(tab.id) ||
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

    case 'suspendTab': {
      let ok = await suspendTab(msg.tabId);
      if (ok) return { success: true };
      let why = await explainSuspendFailure(msg.tabId);
      // treat "it was already asleep" as the success the user perceives
      if (why === 'ALREADY_ASLEEP') return { success: true };
      return { success: false, reasonKey: why };
    }
    case 'setKeepAwake': {
      let tabId = msg.tabId;
      if (typeof tabId !== 'number') {
        let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!at) return { success: false };
        tabId = at.id;
      }
      let on = !!msg.on;
      // holding a system page is meaningless - it can never be discarded
      if (on) {
        let tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab || isInternalUrl(tab.url)) return { success: false };
      }
      await setKeptAwake(tabId, on);
      await setBrowserAutoDiscard(tabId, !on);
      // Releasing restarts the idle clock. Without this a tab held for longer
      // than the threshold is already overdue the moment it is released and
      // vanishes on the next tick - "Allow sleep" means back to normal, not
      // sleep right now. ("Suspend this tab" is there for sleep right now.)
      if (!on) await touchTab(tabId);
      return { success: true, keptAwake: on };
    }
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
      if (ok) return { success: true, mbFreed: MB_PER_TAB };
      let why = await explainSuspendFailure(at.id);
      if (why === 'ALREADY_ASLEEP') return { success: true, mbFreed: MB_PER_TAB };
      return { success: false, mbFreed: 0, reasonKey: why };
    }
    case 'suspendOthers': {
      let [at] = await chrome.tabs.query({ active: true, currentWindow: true });
      let result = await suspendAllOthers(at?.windowId);
      return {
        success: true,
        count: result.count,
        total: result.total,
        refused: result.refused,
        stillLoading: result.stillLoading,
        mbFreed: result.count * MB_PER_TAB
      };
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
    case 'importWhitelist': return await importWhitelist(msg.domains);
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
    case 'importSessions': return await importSessions(msg.sessions);
    case 'getStats': return await getStats();

    case 'closeDuplicates': {
      let tabs = await chrome.tabs.query({ currentWindow: true });
      let groups = {};
      let closed = 0;
      for (let tab of tabs) {
        if (!tab.url || isInternalUrl(tab.url)) continue;
        let url = duplicateKey(tab.url);
        if (!url) continue;
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
          // Never close pinned tabs (even if not the chosen "keep"), and never
          // close one that is playing sound: closing it would cut off whatever
          // the user is listening to, which no duplicate is worth
          if (tab.id !== keep.id && !tab.pinned && !tab.audible) {
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
