document.addEventListener('DOMContentLoaded', init);

// Per-tab memory estimate. Must match MB_PER_TAB in background.js. If you
// retune one, retune both: the popup uses it for stats display, the
// background uses it for toast counts and the forecast number.
var MB_PER_TAB = 150;

var _loaded = false;
var _toastTimer = null;
var _allTabs = null;
var _tabListSig = '';
var _sessionListSig = '';
var _renderedSessionIds = null;
var _pollTimer = null;
// Set while a loadAll is in flight. The 5s poll skips its tick when one is
// still running, so a slow answer from the worker (40+ tabs loading at once)
// cannot stack a second full round of messages on top of the first.
var _loadInFlight = false;
// The last status the strip drew. Suspend Others uses it for the "12/47"
// progress label: eligibleCount is exactly the set the worker is about to
// try, and suspendedCount is the baseline the live count is measured from.
var _lastStatus = null;
// Set while Suspend Others is running, so a poll landing mid-way cannot
// re-enable the button and let a second run start on top of the first.
var _suspendingOthers = false;
// loadAll restores scrollTop after every render so the 5s poll doesn't jump
// the list under you. That fights any deliberate programmatic scroll, so
// "Open settings" sets a short window during which the restore is skipped.
var _scrollLockUntil = 0;

function t(key, subs) {
  var val = chrome.i18n.getMessage(key, subs);
  return val || key;
}

var BADGES = {
  'Active tab': { icon: 'eye', type: 'active', labelKey: 'badgeActive' },
  'System page': { icon: 'lock', type: 'system', labelKey: 'badgeSystem' },
  'Pinned': { icon: 'pin', type: 'pinned', labelKey: 'badgePinned' },
  'Audio': { icon: 'volume2', type: 'audio', labelKey: 'badgeAudio' },
  'Whitelisted': { icon: 'shield', type: 'starred', labelKey: 'badgeWhitelisted' },
  'Kept awake': { icon: 'coffee', type: 'awake', labelKey: 'badgeAwake' },
};

async function init() {
  try {
    // Apply persisted section states synchronously before any await so the
    // browser paints the final open/closed state instead of transitioning
    // from closed to open when localStorage restore lands mid-init.
    restoreSectionStates();
    localizeHtml();
    // initTheme applies the mirrored theme synchronously before its first
    // await, so the reveal below never shows the wrong theme for a frame.
    var themeReady = initTheme();
    injectIcons();
    // Wire the buttons before any data arrives: the shell is on screen from
    // here on, and a button that is visible but dead reads as broken.
    attachListeners();
    // Reveal the shell now, with the list showing "Loading tabs...". This
    // used to wait for every worker message to answer first, which with 40+
    // tabs loading at once meant a blank popup for as long as the worker
    // took, and the CSS fallback only uncovered it after 500ms regardless.
    document.body.classList.add('popup-ready');
    await themeReady;
    await loadAll();
    await checkReviewPrompt();

    // Poll for tab changes instead of registering persistent chrome.tabs listeners
    // (popup context is short-lived; persistent listeners leak across reopens)
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(pollTick, 5000);

    // Pause polling when sidepanel is hidden, resume when visible
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        clearInterval(_pollTimer);
        _pollTimer = null;
      } else if (document.visibilityState === 'visible' && !_pollTimer) {
        // through the guard: a load that was already in flight when the panel
        // was hidden finishes on its own, and a second one on top would only
        // double the messages to a worker that is possibly still busy
        pollTick();
        _pollTimer = setInterval(pollTick, 5000);
      }
    });
  } finally {
    document.body.classList.add('popup-ready');
  }
}

// One poll tick. Skipped while the previous loadAll is still waiting on the
// worker; the next tick picks up whatever it missed.
function pollTick() {
  if (!_loadInFlight) loadAll();
}

function filterTabs(tabs) {
  if (!tabs) return tabs;
  var input = document.getElementById('tabSearchInput');
  if (!input || !input.value.trim()) return tabs;
  var q = input.value.trim().toLowerCase();
  return tabs.filter(function(tab) {
    return (tab.title && tab.title.toLowerCase().includes(q)) || (tab.url && tab.url.toLowerCase().includes(q));
  });
}

function localizeHtml() {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
    if (msg) el.placeholder = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
    if (msg) el.title = msg;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-aria'));
    if (msg) el.setAttribute('aria-label', msg);
  });

  // Set version in footer dynamically
  var footer = document.querySelector('.popup-footer .footer-version');
  if (footer) footer.textContent = 'Drowzy v' + chrome.runtime.getManifest().version;

  // Set lang attribute to match browser locale
  var uiLang = chrome.i18n.getUILanguage();
  document.documentElement.lang = uiLang;

  // Flip the whole UI to right-to-left for RTL languages so layout, alignment
  // and logical CSS properties mirror correctly (Arabic, Hebrew, Persian, Urdu).
  var RTL_LANGS = ['ar', 'he', 'iw', 'fa', 'ur'];
  var base = (uiLang || '').toLowerCase().split('-')[0];
  document.documentElement.dir = RTL_LANGS.indexOf(base) !== -1 ? 'rtl' : 'ltr';
}

// The chosen theme lives in chrome.storage (the changelog and welcome pages
// read it from there too), but that read is asynchronous and the popup is now
// revealed before it answers. A copy in the popup's own localStorage can be
// read synchronously, so the first frame is already the right theme; the
// storage value stays the authority and corrects the mirror if they differ.
var THEME_HINT_KEY = 'drowzy_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function rememberThemeHint(theme) {
  try { localStorage.setItem(THEME_HINT_KEY, theme); } catch {}
}

async function initTheme() {
  var hint = null;
  try { hint = localStorage.getItem(THEME_HINT_KEY); } catch {}
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var first = (hint === 'dark' || hint === 'light') ? hint : (dark ? 'dark' : 'light');
  applyTheme(first);
  updateThemeIcon();

  var res = await chrome.storage.local.get('theme');
  var stored = (res.theme === 'dark' || res.theme === 'light') ? res.theme : null;
  var wanted = stored || (dark ? 'dark' : 'light');
  if (stored) rememberThemeHint(stored);
  else { try { localStorage.removeItem(THEME_HINT_KEY); } catch {} }
  if (wanted !== first) {
    applyTheme(wanted);
    updateThemeIcon();
    // Any favicon drawn so far was measured against the first theme
    retuneAllFavicons();
  }
}

function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
  rememberThemeHint(next);
  updateThemeIcon();
  // which favicons blend depends on the panel background, so the verdicts
  // have to be recomputed against the theme we just switched to
  retuneAllFavicons();

  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.classList.remove('theme-icon-enter');
  void btn.offsetWidth;
  btn.classList.add('theme-icon-enter');
}

function updateThemeIcon() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = dark ? icon('sunMedium', 16) : icon('moon', 16);
  var label = dark ? t('switchToLight') : t('switchToDark');
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function injectIcons() {
  document.querySelectorAll('[data-icon]').forEach(function(el) {
    el.innerHTML = icon(el.dataset.icon, parseInt(el.dataset.iconSize || '14', 10));
  });
}

async function loadAll() {
  _loadInFlight = true;
  try {
    // All five requests go out at once, but each is rendered as it lands
    // rather than after the slowest one. The tab list is the heaviest answer
    // and the thing the popup was opened for, so it is drawn first; sessions
    // and stats are cheap local reads that follow.
    var pStatus = msg({ action: 'getStatus' });
    var pTabs = msg({ action: 'getTabList' });
    var pSettings = msg({ action: 'getSettings' });
    var pSessions = msg({ action: 'getSessions' });
    var pStats = msg({ action: 'getStats' });

    var scrollEl = document.querySelector('.main-content');
    // In sidepanel, .main-content doesn't scroll (body does) - detect correct container
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) {
      scrollEl = document.documentElement;
    }
    var savedScroll = scrollEl.scrollTop;

    var tabList = await pTabs;
    // msg() swallows a dead or unreachable worker into null. Rendering that as
    // an empty list would read "No tabs found", which is a lie; the catch below
    // draws the honest "could not load" state instead, and the poll retries.
    if (!Array.isArray(tabList)) throw new Error('no answer from the worker');
    _allTabs = tabList;
    renderTabList(filterTabs(tabList));
    var settings = await pSettings;
    renderCurrentTab(tabList, settings);
    renderSettings(settings);
    var status = await pStatus;
    renderStatsStrip(status);
    // Skip the restore while a deliberate scroll is in flight, otherwise a
    // poll landing mid-animation snaps the user back where they started.
    if (scrollEl && Date.now() > _scrollLockUntil) scrollEl.scrollTop = savedScroll;

    var sessions = await pSessions;
    var stats = await pStats;
    savedScroll = scrollEl.scrollTop;
    renderSessions(sessions);
    renderLifetimeStats(stats);
    // Re-poll shortcut bindings - user may have edited them in
    // chrome://extensions/shortcuts via the Customize link without closing
    // the popup. Cheap call; runs on the same 5s cadence as everything else.
    renderShortcutsStatus();
    if (scrollEl && Date.now() > _scrollLockUntil) scrollEl.scrollTop = savedScroll;
    _loaded = true;
  } catch (e) {
    var list = document.getElementById('tabList');
    if (list) list.innerHTML = '<div class="tab-list-empty"><span class="empty-icon">' + icon('x', 22) + '</span><span>' + esc(t('failedToLoad')) + '</span></div>';
    // Reset sig so a successful recovery render is not skipped by dedupe
    _tabListSig = '';
  } finally {
    _loadInFlight = false;
  }
}

async function msg(data) {
  try { return await chrome.runtime.sendMessage(data); }
  catch { return null; }
}

function animateStat(el, val) {
  var text = String(val);
  if (_loaded && el.textContent !== text) {
    el.textContent = text;
    el.classList.remove('stat-updated');
    void el.offsetWidth;
    el.classList.add('stat-updated');
  } else {
    el.textContent = text;
  }
}

function renderStatsStrip(status) {
  if (!status) return;
  _lastStatus = status;
  animateStat(document.getElementById('statSleepingValue'), status.suspendedCount);
  animateStat(document.getElementById('statProtectedValue'), status.protectedCount);

  // The third strip slot adapts based on state to avoid a 4-item strip:
  //  - if Drowzy has actually freed memory, show that ("saved", blue dot)
  //  - else if there are eligible tabs, show the forecast ("available", amber dot via .strip-stat-forecast)
  //  - else show an em-dash with the default "saved" label
  // Visual + label both differ between saved and forecast so the forecast
  // doesn't read as already-realized savings.
  var memItem = document.getElementById('statMemoryItem');
  var memLabel = document.getElementById('statMemoryLabel');
  var memValue = document.getElementById('statMemoryValue');
  if (status.estimatedMbSaved > 0) {
    memItem.classList.remove('strip-stat-forecast');
    memItem.title = t('ramEstimateTooltip');
    memLabel.textContent = t('statSaved');
    animateStat(memValue, fmtRam(status.estimatedMbSaved));
  } else if (status.eligibleCount && status.estimatedMbForecast) {
    memItem.classList.add('strip-stat-forecast');
    memItem.title = t('ramForecastTooltip');
    memLabel.textContent = t('statForecast');
    animateStat(memValue, fmtRam(status.estimatedMbForecast));
  } else {
    memItem.classList.remove('strip-stat-forecast');
    memItem.title = t('ramEstimateTooltip');
    memLabel.textContent = t('statSaved');
    animateStat(memValue, '\u2014');
  }

  // Disable quick-action buttons when there's nothing to act on, with an
  // explanatory tooltip \u2014 prevents the "click does nothing" feel that makes
  // a new user think the extension is broken.
  var btnSusp = document.getElementById('btnSuspendOthers');
  if (btnSusp) {
    var noEligible = !status.eligibleCount;
    btnSusp.disabled = noEligible || _suspendingOthers;
    btnSusp.title = noEligible ? t('noOthersToSuspend') : '';
  }
  var btnWake = document.getElementById('btnWakeAll');
  if (btnWake) {
    var noSleeping = !status.suspendedCount;
    btnWake.disabled = noSleeping;
    btnWake.title = noSleeping ? t('noSuspendedToWake') : '';
  }
}

function tabListSignature(tabs) {
  if (!tabs) return '';
  var parts = [];
  for (var i = 0; i < tabs.length; i++) {
    // Don't shadow the outer `t()` i18n helper
    var tab = tabs[i];
    parts.push(tab.id + '|' + tab.status + '|' + (tab.title || '') + '|' + (tab.timeLeft == null ? '' : tab.timeLeft) + '|' + (tab.protectReason || '') + '|' + (tab.favIconUrl || '') + '|' + (tab.keptAwake ? 1 : 0));
  }
  return parts.join('\u0001');
}

function renderTabList(tabs) {
  var container = document.getElementById('tabList');
  if (!tabs || !tabs.length) {
    var emptySig = '__empty__';
    if (_tabListSig === emptySig) return;
    _tabListSig = emptySig;
    container.innerHTML = '<div class="tab-list-empty"><span class="empty-icon">' + icon('search', 22) + '</span><span>' + esc(t('noTabsFound')) + '</span></div>';
    return;
  }

  var sig = tabListSignature(tabs);
  if (sig === _tabListSig) return;
  var firstRender = _tabListSig === '';
  _tabListSig = sig;

  container.innerHTML = '';
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var el = document.createElement('div');
    el.className = 'tab-item' + (tab.status === 'suspended' ? ' sleeping' : '') + (firstRender ? '' : ' no-anim');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (firstRender) el.style.setProperty('--i', Math.min(i, 10));

    el.appendChild(buildFavicon(tab));

    var title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;
    title.title = tab.title;
    el.appendChild(title);

    var meta = document.createElement('span');
    meta.className = 'tab-meta';

    if (tab.status === 'suspended') {
      meta.innerHTML = '<span class="badge badge-sleeping">' + icon('moon', 11) + ' ' + esc(t('badgeZzz')) + '</span>';
      // clicking a sleeping row wakes it, but nothing in the UI said so -
      // surface the affordance with a tooltip (title only; an aria-label here
      // would replace the row's accessible name, hiding the tab title).
      // The .tab-title span has its own tooltip that masks the row's over
      // most of its width, so append the hint there on a second line too.
      el.title = t('clickToWake');
      title.title = tab.title + '\n' + t('clickToWake');
    } else if (tab.status === 'protected' || tab.status === 'active') {
      // a held tab reports status 'active' when it's the one you're looking at,
      // so prefer the hold over the reason - otherwise the row says "Active"
      // while the panel above it says "Kept awake"
      var reason = tab.keptAwake ? 'Kept awake' : tab.protectReason;
      var info = BADGES[reason] || { icon: 'shield', type: 'system', labelKey: 'badgeProtected' };
      meta.innerHTML = '<span class="badge badge-' + info.type + '" title="' + esc(t(info.labelKey)) + '">' + icon(info.icon, 11) + ' ' + esc(t(info.labelKey)) + '</span>';
    } else if (tab.status === 'idle' && tab.timeLeft !== null) {
      var timeText = tab.timeLeft > 0 ? esc(String(tab.timeLeft)) + 'm' : esc(t('suspendingSoon'));
      meta.innerHTML = '<span class="badge badge-timer">' + icon('clock', 11) + ' ' + timeText + '</span>';
    }
    if (tab.status === 'idle') {
      var suspendBtn = document.createElement('button');
      suspendBtn.className = 'tab-suspend-btn';
      suspendBtn.innerHTML = icon('pause', 11);
      suspendBtn.title = t('ctxSuspendThis');
      suspendBtn.setAttribute('aria-label', t('ctxSuspendThis'));
      (function(tid) {
        suspendBtn.addEventListener('click', async function(e) {
          e.stopPropagation();
          var res = await msg({ action: 'suspendTab', tabId: tid });
          if (!res || !res.success) {
            showToast(res && res.reasonKey ? t(res.reasonKey) : t('suspendFailedGeneric'));
          }
          await loadAll();
        });
      })(tab.id);
      el.appendChild(meta);
      el.appendChild(suspendBtn);
    } else {
      el.appendChild(meta);
    }

    var tabAction = (function(tabData) {
      return async function() {
        if (tabData.status === 'suspended') {
          await msg({ action: 'wakeTab', tabId: tabData.id });
        }
        // Activate the tab and focus its window. Without the window focus,
        // clicking a tab that lives in a non-focused Chrome window updates
        // its active state but leaves the user looking at the popup's window
        // - the tab they asked for is "selected" somewhere they can't see.
        try {
          var updated = await chrome.tabs.update(tabData.id, { active: true });
          if (updated && updated.windowId != null) {
            try { await chrome.windows.update(updated.windowId, { focused: true }); } catch {}
          }
        } catch {}
        if (tabData.status === 'suspended') await loadAll();
      };
    })(tab);
    el.addEventListener('click', tabAction);
    (function(action) {
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); }
      });
    })(tabAction);

    container.appendChild(el);
  }
}

// Chrome's own favicon cache, via the "favicon" permission. This is the only
// reliable source: loading a site's favicon URL directly from an extension
// page is a cross-origin request with no cookies, and anything behind
// Cloudflare (claude.ai among many) answers it with a challenge instead of an
// image, so the icon silently fails and we fall back to a letter. Reading
// Chrome's cache makes no network request at all and works for sites that
// refuse us, for sleeping tabs, and for extension and system pages.
function faviconUrl(pageUrl, size) {
  if (!pageUrl) return '';
  try {
    var u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size || 32));
    return u.toString();
  } catch { return ''; }
}

// Favicons are images, so they cannot follow the theme the way our own icons
// do. A black glyph vanishes on the dark panel and a white one vanishes on
// the light panel. Rather than putting a plate behind every icon - which is
// heavy-handed and looks worse than the problem - measure each icon once and
// outline only the ones that would actually disappear.
//
// Readback works because _favicon/ is served from our own extension origin,
// so the canvas is not tainted. The https fallback path IS cross-origin and
// throws on getImageData; that is caught and the icon is left alone.
var _contrastCache = new Map();   // src -> boolean (needs an outline)
var _contrastCanvas = null;

// Returns 'none', 'invert' or 'outline'.
//
// Plenty of sites ship a monochrome mark and publish both a light and a dark
// version of it (GitHub is the obvious one). Chrome caches whichever one it
// saw, so we get a single fixed image that is right for one theme and
// invisible in the other. For a monochrome glyph on a transparent background
// we can just produce the other version ourselves: inverting near-black gives
// near-white and vice versa, which is exactly what the site's own alternate
// asset looks like. Only icons with actual colour fall back to an outline,
// because inverting a coloured logo would change its hue and look wrong.
function faviconTreatment(img) {
  if (!_contrastCanvas) {
    _contrastCanvas = document.createElement('canvas');
    _contrastCanvas.width = _contrastCanvas.height = 16;
  }
  var ctx = _contrastCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 16, 16);
  ctx.drawImage(img, 0, 0, 16, 16);
  var px = ctx.getImageData(0, 0, 16, 16).data;

  var sum = 0, chroma = 0, count = 0;
  for (var i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 40) continue;               // effectively transparent
    var r = px[i], g = px[i + 1], b = px[i + 2];
    // Rec. 601 luma, good enough and cheap
    sum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    count++;
  }
  if (!count) return 'none';                    // nothing to render either way

  var avg = sum / count;
  var light = document.documentElement.getAttribute('data-theme') === 'light';
  var bg = light ? 0.98 : 0.06;
  // 0.30 keeps mid-tone and colourful icons untouched; only near-white on
  // light and near-black on dark cross the line
  if (Math.abs(avg - bg) >= 0.30) return 'none';

  // 0.08, not something looser: a very dark navy like #0d1b2a still carries
  // ~0.11 of chroma, and inverting it produces a warm cream - a visible brand
  // colour shift. Anything with even that much hue takes the outline instead.
  var grey = (chroma / count) < 0.08;
  var glyph = (count / 256) <= 0.85;            // sits on transparency, not a
                                                // solid tile we would flip
  return (grey && glyph) ? 'invert' : 'outline';
}

function setFaviconTreatment(img, how) {
  img.classList.toggle('needs-contrast', how === 'outline');
  img.classList.toggle('needs-invert', how === 'invert');
}

function tuneFaviconContrast(img) {
  var src = img.getAttribute('src') || '';
  if (!src) return;
  if (_contrastCache.has(src)) {
    setFaviconTreatment(img, _contrastCache.get(src));
    return;
  }
  var apply = function() {
    var how;
    try { how = faviconTreatment(img); }
    catch { return; }                            // cross-origin, cannot measure
    _contrastCache.set(src, how);
    setFaviconTreatment(img, how);
  };
  if (img.complete && img.naturalWidth > 0) apply();
  else img.addEventListener('load', apply, { once: true });
}

// Theme changes flip which icons blend, and the verdict is cached per src, so
// both the cache and every icon on screen have to be re-evaluated.
function retuneAllFavicons() {
  _contrastCache.clear();
  // every favicon in the UI carries .favicon, so this cannot miss a surface
  var imgs = document.querySelectorAll('img.favicon');
  for (var i = 0; i < imgs.length; i++) tuneFaviconContrast(imgs[i]);
}

function buildFavicon(tab) {
  // 32px for a 16px slot so it stays crisp on high-DPI screens
  var primary = faviconUrl(tab.url, 32);
  var reported = (tab.favIconUrl && tab.favIconUrl.indexOf('chrome://') !== 0) ? tab.favIconUrl : '';
  var src = primary || reported;
  if (!src) return faviconFallback(tab.url);

  var img = document.createElement('img');
  img.className = 'favicon';
  img.src = src;
  img.alt = '';
  img.onerror = function() {
    // Chrome had nothing cached: try the icon the page itself reported, then
    // give up and draw a typed placeholder rather than a broken image.
    if (reported && img.src !== reported) {
      img.src = reported;
      img.onerror = function() { img.replaceWith(faviconFallback(tab.url)); };
      img.onload = function() { tuneFaviconContrast(img); };
      return;
    }
    img.replaceWith(faviconFallback(tab.url));
  };
  tuneFaviconContrast(img);
  return img;
}

// Pages Chrome never gives us a usable favicon for. A first-letter circle is
// meaningless for these: an extension page yields a letter from its random id,
// and a chrome:// page yields whatever the internal hostname starts with.
var FALLBACK_ICONS = [
  [/^chrome-extension:|^moz-extension:/, 'puzzle'],
  [/^chrome:|^edge:|^about:|^brave:/,    'lock'],
  [/^file:/,                             'fileText'],
  [/^view-source:/,                      'fileText'],
  [/^data:|^blob:/,                      'globe']
];

function faviconFallback(url) {
  var span = document.createElement('span');
  span.className = 'favicon-fallback';
  var u = url || '';
  for (var i = 0; i < FALLBACK_ICONS.length; i++) {
    if (FALLBACK_ICONS[i][0].test(u)) {
      span.classList.add('favicon-fallback-icon');
      span.innerHTML = icon(FALLBACK_ICONS[i][1], 11);
      return span;
    }
  }
  try {
    var host = new URL(u).hostname.replace(/^www\./, '');
    if (host) {
      span.textContent = host.charAt(0).toUpperCase();
      return span;
    }
  } catch {}
  // no host to letter it with (blank tab, malformed url) - a globe beats "?"
  span.classList.add('favicon-fallback-icon');
  span.innerHTML = icon('globe', 11);
  return span;
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCurrentTab(tabList, settings) {
  if (!tabList || !tabList.length || !settings) return;

  var active = tabList.find(function(tab) { return tab.status === 'active'; });
  if (!active) return;

  var domain = '\u2014';
  // The worker's verdict, and the exact stored entry behind it, so the button
  // below removes what is actually in the list (a path pattern, say) instead
  // of a bare domain that was never there. One matcher, not two copies.
  var whitelistEntry = active.whitelistEntry || '';
  var whitelisted = !!whitelistEntry;
  var urlObj = null;
  try {
    urlObj = new URL(active.url);
    domain = urlObj.hostname.replace(/^\[|\]$/g, '');
    if (urlObj.protocol === 'chrome-extension:') {
      domain = active.title || t('extensionPage');
    }
  } catch {}

  var isInternal = true;
  try {
    var proto = (urlObj || new URL(active.url)).protocol;
    isInternal = proto !== 'http:' && proto !== 'https:';
  } catch {}

  // Pick the status line based on why this tab is/isn't suspendable. Active
  // is the fallback; the more specific reasons take priority since a pinned
  // active tab is "active AND pinned" - the pin is the actually informative bit.
  // Kept awake outranks everything except a system page: it's the one the user
  // set themselves, and it's the one with a control sitting right below it.
  var keptAwake = !!active.keptAwake;
  var statusKey = 'activeWontSuspend';
  if (isInternal) statusKey = 'systemPageCantSuspend';
  else if (keptAwake) statusKey = 'keptAwakeWontSuspend';
  else if (settings.protectPinned && active.pinned) statusKey = 'pinnedWontSuspend';
  else if (settings.protectAudio && active.audible) statusKey = 'audioWontSuspend';
  else if (whitelisted) statusKey = 'whitelistedWontSuspend';

  // Chrome cannot discard the tab you are looking at, so "Suspend this tab"
  // switches to a neighbour first. Mirrors handleSuspendCurrent's candidate
  // filter (not discarded, not an internal page) so the button never claims an
  // action the background would refuse. A held tab still counts as a target:
  // we only activate it, we do not sleep it.
  var hasSwitchTarget = (tabList || []).some(function(tt) {
    return tt.id !== active.id && tt.status !== 'suspended' && tt.protectReason !== 'System page';
  });
  // Show the button whenever the control belongs here and explain when it
  // cannot act, instead of vanishing. Two separate uninstall notes said Drowzy
  // had no suspend button, on tabs where we had silently hidden it. It is
  // hidden in exactly two cases: a system page (nothing to suspend, ever) and
  // a held tab, where "Allow sleep" takes its place so the two can never both
  // be on screen contradicting each other.
  var showSuspendCurrent = !isInternal && !keptAwake;
  var suspendBlockedKey = null;
  if (showSuspendCurrent) {
    if (statusKey === 'pinnedWontSuspend') suspendBlockedKey = 'cantSuspendPinned';
    else if (statusKey === 'audioWontSuspend') suspendBlockedKey = 'cantSuspendAudio';
    else if (statusKey === 'whitelistedWontSuspend') suspendBlockedKey = 'cantSuspendWhitelisted';
    else if (!hasSwitchTarget) suspendBlockedKey = 'cantSuspendNoOtherTab';
  }

  // Inline fix-it action, shown only when the blocker is something the user
  // can actually change from here. Whitelist is deliberately excluded: the
  // "Whitelisted" button directly below is already that control.
  var fixKey = null;
  if (statusKey === 'pinnedWontSuspend') fixKey = 'togglePinned';
  else if (statusKey === 'audioWontSuspend') fixKey = 'toggleAudio';

  // Signature-dedupe: the polling loop runs every 5s; skip DOM writes when
  // nothing changed. Prevents the favicon/domain flicker from re-setting
  // img.src and retriggering onerror on every poll.
  var section = document.getElementById('currentTabSection');
  // active.id leads the signature: the Keep awake button stores a tab id in a
  // dataset, and two tabs on the same URL produce an otherwise identical
  // signature - without the id the dedupe would skip the re-render and leave
  // the button pointed at the tab the user just switched away from.
  var sig = active.id + '|' + (active.url || '') + '|' + (active.favIconUrl || '') + '|' + domain + '|' + whitelistEntry + '|' + (isInternal ? 1 : 0) + '|' + statusKey + '|' + (showSuspendCurrent ? 1 : 0) + '|' + (keptAwake ? 1 : 0) + '|' + (suspendBlockedKey || '') + '|' + (fixKey || '');
  if (section && section.dataset.sig === sig) return;
  if (section) section.dataset.sig = sig;

  var suspendCurrentBtn = document.getElementById('btnSuspendCurrent');
  if (suspendCurrentBtn) {
    suspendCurrentBtn.style.display = showSuspendCurrent ? '' : 'none';
    suspendCurrentBtn.disabled = !!suspendBlockedKey;
    suspendCurrentBtn.title = suspendBlockedKey ? t(suspendBlockedKey) : t('suspendThisTabHint');
  }

  var fixBtn = document.getElementById('btnCurrentTabFix');
  if (fixBtn) {
    fixBtn.style.display = fixKey ? '' : 'none';
    fixBtn.textContent = fixKey ? t('openSettingsAction') : '';
    fixBtn.dataset.target = fixKey || '';
  }

  // Keep awake / Allow sleep. Hidden on system pages, which can never be
  // discarded, so a hold there would be a control that does nothing. While a
  // hold is on, this button IS the suspend control's replacement - statusKey
  // is 'keptAwakeWontSuspend' by then, so showSuspendCurrent is already false
  // and the two buttons can never both be visible.
  var keepBtn = document.getElementById('btnKeepAwake');
  if (keepBtn) {
    keepBtn.style.display = isInternal ? 'none' : '';
    var keepText = keepBtn.querySelector('.btn-text');
    var keepIcon = keepBtn.querySelector('.btn-icon');
    if (keptAwake) {
      if (keepText) keepText.textContent = t('allowSleep');
      if (keepIcon) keepIcon.innerHTML = icon('moon', 14);
      keepBtn.title = t('allowSleepHint');
      keepBtn.classList.add('is-kept-awake');
    } else {
      if (keepText) keepText.textContent = t('keepThisTabAwake');
      if (keepIcon) keepIcon.innerHTML = icon('coffee', 14);
      keepBtn.title = t('keptAwakeHint');
      keepBtn.classList.remove('is-kept-awake');
    }
    keepBtn.dataset.keptAwake = keptAwake ? '1' : '0';
    keepBtn.dataset.tabId = String(active.id);
  }

  document.getElementById('currentTabDomain').textContent = domain;

  var fav = document.getElementById('currentTabFavicon');
  // same Chrome-cache source as the tab list, falling back to whatever the
  // page reported if Chrome has nothing for this URL
  var favSrc = faviconUrl(active.url, 32) || active.favIconUrl;
  if (favSrc) {
    if (fav.getAttribute('src') !== favSrc) {
      fav.style.display = '';
      fav.onerror = function() {
        if (active.favIconUrl && fav.src !== active.favIconUrl) {
          fav.onerror = function() { fav.style.display = 'none'; };
          fav.src = active.favIconUrl;
          // the fallback image needs measuring too, or a mark that blends
          // slips through whenever Chrome's cache misses
          tuneFaviconContrast(fav);
          return;
        }
        fav.style.display = 'none';
      };
      fav.src = favSrc;
      tuneFaviconContrast(fav);
    } else if (fav.style.display === 'none' && fav.complete && fav.naturalWidth > 0) {
      fav.style.display = '';
    }
  } else {
    fav.style.display = 'none';
    fav.removeAttribute('src');
  }

  document.getElementById('currentTabStatus').textContent = t(statusKey);

  var btn = document.getElementById('btnToggleWhitelist');
  btn.style.display = isInternal ? 'none' : '';
  var btnText = btn.querySelector('.btn-text');
  var btnIcon = btn.querySelector('.btn-icon');
  if (whitelisted) {
    if (btnText) btnText.textContent = t('siteWhitelisted');
    if (btnIcon) btnIcon.innerHTML = icon('shieldCheck', 14);
    btn.classList.add('is-whitelisted');
  } else {
    if (btnText) btnText.textContent = t('neverSuspendSite');
    if (btnIcon) btnIcon.innerHTML = icon('shield', 14);
    btn.classList.remove('is-whitelisted');
  }
  btn.dataset.domain = domain.replace(/^www\./, '').toLowerCase();
  btn.dataset.whitelisted = whitelisted ? '1' : '0';
  btn.dataset.entry = whitelistEntry;
}

function sessionListSignature(sessions) {
  if (!sessions || !sessions.length) return '__empty__';
  var parts = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    parts.push(s.id + '|' + (s.name || '') + '|' + (s.tabs ? s.tabs.length : 0) + '|' + (s.createdAt || 0));
  }
  return parts.join('\u0001');
}

function renderSessions(sessions) {
  var container = document.getElementById('sessionList');
  var sig = sessionListSignature(sessions);
  if (sig === _sessionListSig) return;
  _sessionListSig = sig;

  if (!sessions || !sessions.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">' + icon('folderOpen', 20) + '</span><span>' + esc(t('emptySessionState')) + '</span></div>';
    _renderedSessionIds = new Set();
    return;
  }

  // Track which session IDs were already on screen so we can apply a fresh
  // entrance animation only to genuinely new ones, not re-animate existing.
  var prevIds = _renderedSessionIds;
  var firstRender = prevIds === null;
  var currentIds = new Set();
  for (var n = 0; n < sessions.length; n++) currentIds.add(sessions[n].id);

  container.innerHTML = '';
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var card = document.createElement('div');
    card.className = 'session-card';
    card.style.setProperty('--i', i);
    if (!firstRender && prevIds && !prevIds.has(s.id)) {
      card.classList.add('is-new');
    }

    var stack = document.createElement('div');
    stack.className = 'session-favicon-stack';
    var icons = (s.tabs || []).slice(0, 4);
    for (var j = 0; j < icons.length; j++) {
      // sessions store the page URL, so Chrome's cache can render an icon even
      // for a session saved months ago whose stored favicon URL has rotted
      var siSrc = faviconUrl(icons[j].url, 32) || icons[j].favIconUrl;
      if (siSrc) {
        var fi = document.createElement('img');
        // shares the .favicon class so one CSS rule and one retune selector
        // cover every favicon in the UI; the stack's own rule still wins on
        // size because it is the more specific selector
        fi.className = 'favicon';
        fi.src = siSrc;
        fi.alt = '';
        fi.width = 16;
        fi.height = 16;
        fi.onerror = function() { this.style.display = 'none'; };
        tuneFaviconContrast(fi);
        stack.appendChild(fi);
      }
    }

    var info = document.createElement('div');
    info.className = 'session-info';
    info.innerHTML = '<div class="session-name" title="' + esc(s.name || '') + '">' + esc(s.name || '') + '</div>' +
      '<div class="session-meta">' + t('tabsCount', [String((s.tabs || []).length)]) + ' \u00B7 ' + relativeTime(s.createdAt) + '</div>';

    var actions = document.createElement('div');
    actions.className = 'session-actions';

    var restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-sm';
    restoreBtn.innerHTML = icon('download', 12) + ' ' + esc(t('open'));
    restoreBtn.title = t('openSessionTitle');

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-ghost-danger';
    deleteBtn.innerHTML = icon('trash2', 13);
    deleteBtn.title = t('deleteSessionTitle');

    var replaceBtn = document.createElement('button');
    replaceBtn.className = 'btn btn-sm';
    replaceBtn.innerHTML = icon('download', 12) + ' ' + esc(t('replace'));
    replaceBtn.title = t('replaceSessionTitle');

    (function(session, rBtn, rpBtn, dBtn) {
      function disableAll() { rBtn.disabled = true; rpBtn.disabled = true; dBtn.disabled = true; }
      function enableAll() { rBtn.disabled = false; rpBtn.disabled = false; dBtn.disabled = false; }
      rBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        disableAll();
        rBtn.textContent = t('loading');
        var res = await msg({ action: 'restoreSession', id: session.id, mode: 'open' });
        if (res && res.success) showToast(t('restoredTabs', [String(res.count)]));
        else showToast((res && res.error) || t('failedToRestore'));
        enableAll();
        rBtn.innerHTML = icon('download', 12) + ' ' + esc(t('open'));
      });
      rpBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        disableAll();
        rpBtn.textContent = t('loading');
        var res = await msg({ action: 'restoreSession', id: session.id, mode: 'replace' });
        if (res && res.success) showToast(t('restoredTabs', [String(res.count)]));
        else showToast((res && res.error) || t('failedToRestore'));
        enableAll();
        rpBtn.innerHTML = icon('download', 12) + ' ' + esc(t('replace'));
      });
    })(s, restoreBtn, replaceBtn, deleteBtn);

    (function(session, dBtn, sessionCard) {
      var confirmTimer = null;
      function reset() {
        dBtn.dataset.confirming = '';
        dBtn.classList.remove('confirming');
        dBtn.innerHTML = icon('trash2', 13);
        dBtn.title = t('deleteSessionTitle');
      }
      dBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (dBtn.dataset.confirming) {
          clearTimeout(confirmTimer);
          sessionCard.classList.add('is-removing');
          // Wait for the leave animation before actually deleting + reloading
          setTimeout(async function() {
            await msg({ action: 'deleteSession', id: session.id });
            await loadAll();
          }, 220);
        } else {
          dBtn.dataset.confirming = '1';
          dBtn.classList.add('confirming');
          dBtn.innerHTML = icon('check', 13);
          dBtn.title = t('confirmDeleteTitle');
          confirmTimer = setTimeout(reset, 3000);
        }
      });
    })(s, deleteBtn, card);

    actions.appendChild(restoreBtn);
    actions.appendChild(replaceBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(stack);
    card.appendChild(info);
    card.appendChild(actions);
    container.appendChild(card);
  }
  _renderedSessionIds = currentIds;
}

function renderLifetimeStats(stats) {
  if (!stats) return;
  animateStat(document.getElementById('statToday'), fmtCount(stats.totalTabsSuspendedToday || 0));
  animateStat(document.getElementById('statAllTime'), fmtCount(stats.totalTabsSuspended || 0));

  var ram = (stats.totalTabsSuspended || 0) * MB_PER_TAB;
  animateStat(document.getElementById('statRamAllTime'), ram ? fmtRam(ram) : '\u2014');

  if (stats.installDate) {
    var d = new Date(stats.installDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('statMemberSince').textContent = t('statMemberSince') + ' ' + d;
  }
}

function renderSettings(settings) {
  if (!settings) return;
  // Skip updating form controls when the user is actively interacting with settings
  var active = document.activeElement;
  var timer = document.getElementById('suspendTimer');
  if (active !== timer) {
    timer.value = settings.enableAutoSuspend ? String(settings.suspendAfterMinutes) : '0';
  }
  var toggles = [
    ['togglePinned', 'protectPinned'], ['toggleAudio', 'protectAudio'],
    ['toggleForms', 'protectForms'], ['toggleStartup', 'suspendOnStartup'],
    ['toggleAutoSuspend', 'enableAutoSuspend'], ['toggleMarkSuspended', 'markSuspendedTabs']
  ];
  for (var i = 0; i < toggles.length; i++) {
    var el = document.getElementById(toggles[i][0]);
    if (el && active !== el) el.checked = settings[toggles[i][1]];
  }
  renderWhitelist(settings.whitelist);
}

var _whitelistSig = '';
function renderWhitelist(list) {
  var el = document.getElementById('whitelistList');
  // Keep the count badge in sync even when the sig dedupe early-returns.
  var countEl = document.getElementById('whitelistCount');
  if (countEl) countEl.textContent = (list && list.length) ? '(' + list.length + ')' : '';
  var sig = list && list.length ? list.join('\u0001') : '__empty__';
  if (sig === _whitelistSig) return;
  _whitelistSig = sig;
  el.innerHTML = '';
  if (!list || !list.length) {
    el.innerHTML = '<li class="empty-whitelist"><span class="empty-icon">' + icon('shield', 16) + '</span><span>' + esc(t('noSitesWhitelisted')) + '</span></li>';
    return;
  }
  for (var i = 0; i < list.length; i++) {
    var li = document.createElement('li');
    li.className = 'whitelist-item';
    var span = document.createElement('span');
    span.className = 'whitelist-domain';
    span.textContent = list[i];
    span.title = list[i];
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'whitelist-remove';
    // Plain text label - the previous icon-only X was easy to miss.
    // The trailing × glyph is a literal character (not an SVG) so it always
    // renders even if the icons.js bundle hasn't loaded yet.
    rm.innerHTML = '<span class="whitelist-remove-text">' + esc(t('remove')) + '</span><span class="whitelist-remove-x" aria-hidden="true">×</span>';
    rm.title = t('remove');
    rm.setAttribute('aria-label', t('remove') + ': ' + list[i]);
    (function(domain, listItem) {
      rm.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        // Optimistic removal - fade the row out immediately so the click
        // feels instant. The polling timer can race and refresh
        // _whitelistSig to the post-removal shape before our own loadAll
        // runs, in which case renderWhitelist's sig dedupe would
        // early-return and leave the stale DOM untouched. Resetting the
        // sig forces the next render to execute.
        listItem.style.transition = 'opacity 140ms ease-out';
        listItem.style.opacity = '0';
        setTimeout(function() {
          if (listItem.parentNode) listItem.parentNode.removeChild(listItem);
        }, 150);
        _whitelistSig = '';
        msg({ action: 'removeWhitelist', domain: domain }).then(function() { loadAll(); });
      });
    })(list[i], li);
    li.appendChild(span);
    li.appendChild(rm);
    el.appendChild(li);
  }
}

function attachListeners() {
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.getElementById('btnSuspendOthers').addEventListener('click', async function() {
    if (this.disabled || _suspendingOthers) return;
    var btn = this;
    var text = btn.querySelector('.btn-text');
    var origLabel = t('suspendOthers');
    text.textContent = t('suspending');
    btn.disabled = true;
    _suspendingOthers = true;

    // Live progress while the worker works through the window. The numbers
    // come from Chrome's own discarded count, not from what was attempted, so
    // the label can only ever show tabs that are really asleep. The total is
    // the eligible count the strip last drew, which is the same set the
    // worker is about to try.
    var total = _lastStatus ? (_lastStatus.eligibleCount || 0) : 0;
    var baseline = _lastStatus ? (_lastStatus.suspendedCount || 0) : 0;
    var running = true;
    var polling = false;
    var progressTimer = setInterval(async function() {
      // One status request at a time: a slow worker is the very case this
      // label exists for, and stacking requests on it would only slow it more
      if (polling) return;
      polling = true;
      var s = await msg({ action: 'getStatus' });
      polling = false;
      if (!running || !s) return;
      var done = Math.max(0, (s.suspendedCount || 0) - baseline);
      if (total > 0) text.textContent = t('suspending') + ' ' + Math.min(done, total) + '/' + total;
    }, 700);

    var res = await msg({ action: 'suspendOthers' });
    running = false;
    clearInterval(progressTimer);
    _suspendingOthers = false;

    var count = (res && res.count) || 0;
    var stillLoading = (res && res.stillLoading) || 0;
    // refused for a reason of their own (unsaved input, switched to mid-run):
    // not loading, so "try again" would be wrong advice, but not nothing either
    var skipped = Math.max(0, ((res && res.refused) || 0) - stillLoading);
    if (count > 0) {
      var toast = t('suspendedToast', [String(count), bidiIsolate(fmtRam(res.mbFreed || count * MB_PER_TAB))]);
      // A count that stops short of the total must say why, rather than pass
      // for the whole job; the toast stays up a little longer to be read.
      if (stillLoading > 0) toast += ' \u00B7 ' + t('suspendFailedLoading');
      else if (skipped > 0) toast += ' \u00B7 ' + t('skippedTabsToast', [String(skipped)]);
      showToast(toast, (stillLoading > 0 || skipped > 0) ? 4000 : undefined);
    } else if (stillLoading > 0) {
      showToast(t('suspendFailedLoading'));
    } else if (skipped > 0) {
      showToast(t('skippedTabsToast', [String(skipped)]));
    } else {
      showToast(t('noOthersToSuspend'));
    }
    text.textContent = origLabel;
    btn.disabled = false;
    await loadAll();
  });

  document.getElementById('btnWakeAll').addEventListener('click', async function() {
    if (this.disabled) return;
    var text = this.querySelector('.btn-text');
    var origLabel = t('wakeAll');
    text.textContent = t('waking');
    this.disabled = true;
    var res = await msg({ action: 'unsuspendAll' });
    var count = (res && res.count) || 0;
    if (count > 0) {
      showToast(t('wokeToast', [String(count)]));
    } else {
      showToast(t('noSuspendedToWake'));
    }
    text.textContent = origLabel;
    this.disabled = false;
    await loadAll();
  });

  document.getElementById('btnSuspendCurrent').addEventListener('click', async function() {
    if (this.disabled) return;
    this.disabled = true;
    try {
      // Re-suspends the active tab via the shared suspend-current path, which
      // switches to a neighbour first. In the popup this usually closes the
      // popup as focus moves to the newly-activated tab; in the side panel the
      // toast + refresh are visible.
      var res = await msg({ action: 'suspendCurrent' });
      if (res && res.success) {
        showToast(t('suspendedOneToast', [bidiIsolate(fmtRam(res.mbFreed || MB_PER_TAB))]));
      } else {
        // never fail silently - "I clicked it and nothing happened" was a
        // recurring uninstall note
        showToast(res && res.reasonKey ? t(res.reasonKey) : t('suspendFailedGeneric'));
      }
    } finally {
      this.disabled = false;
    }
    await loadAll();
  });

  // "Open settings" next to a protection reason: expand the Settings section,
  // scroll the relevant toggle into view and flash it, so the user lands on
  // the exact switch instead of a wall of options they have to scan.
  document.getElementById('btnCurrentTabFix').addEventListener('click', function() {
    var targetId = this.dataset.target;
    if (!targetId) return;
    var body = document.getElementById('settingsBody');
    var toggle = document.getElementById('settingsToggle');
    if (!body) return;
    var justOpened = !body.classList.contains('open');
    if (justOpened) {
      body.classList.add('open');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      try { localStorage.setItem('drowzy_section_settingsToggle', '1'); } catch {}
    }
    var target = document.getElementById(targetId);
    var row = target && target.closest ? target.closest('.setting-row') : null;
    if (!row) return;

    function reveal() {
      // cover the smooth-scroll animation plus a margin, so a poll that lands
      // mid-flight cannot restore the pre-click scroll position
      _scrollLockUntil = Date.now() + 900;
      try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { row.scrollIntoView(); }
      row.classList.remove('setting-row-flash');
      void row.offsetWidth;
      row.classList.add('setting-row-flash');
      setTimeout(function() { row.classList.remove('setting-row-flash'); }, 1600);
    }

    // .section-body opens on a 220ms grid-template-rows transition. Scrolling
    // before it finishes measures a row that is still collapsed and lands in
    // the wrong place, which defeats the point of the shortcut. Wait for the
    // transition when we opened it; a timeout backs up transitionend, which
    // does not fire under prefers-reduced-motion (transitions are 1ms there)
    // and would otherwise leave the scroll hanging.
    if (!justOpened) { requestAnimationFrame(reveal); return; }
    var done = false;
    function finish(e) {
      if (done || (e && e.target !== body)) return;
      done = true;
      body.removeEventListener('transitionend', finish);
      reveal();
    }
    body.addEventListener('transitionend', finish);
    setTimeout(finish, 300);
  });

  document.getElementById('btnKeepAwake').addEventListener('click', async function() {
    if (this.disabled) return;
    var turningOn = this.dataset.keptAwake !== '1';
    var tabId = Number(this.dataset.tabId);
    this.disabled = true;
    try {
      var res = await msg({ action: 'setKeepAwake', tabId: isNaN(tabId) ? undefined : tabId, on: turningOn });
      if (res && res.success) {
        showToast(t(turningOn ? 'keptAwakeToast' : 'allowSleepToast'));
      }
    } finally {
      this.disabled = false;
    }
    // force the current-tab block to re-render: the signature dedupe would
    // otherwise skip it if the poll lands before the background write settles
    var section = document.getElementById('currentTabSection');
    if (section) section.dataset.sig = '';
    await loadAll();
  });

  document.getElementById('btnToggleWhitelist').addEventListener('click', async function() {
    if (this.disabled) return;
    var d = this.dataset.domain;
    if (!d || d === '\u2014') return;
    var wasWhitelisted = this.dataset.whitelisted === '1';
    // Removing takes out the stored entry that actually matched this page,
    // which may be a path pattern like site.com/docs/* the bare domain would
    // never have found. Adding always adds the bare site.
    var target = wasWhitelisted ? (this.dataset.entry || d) : d;
    // Match background.addWhitelist's accept set: registrable domains, plus
    // localhost and bare IP literals (IPv4 + IPv6 loopback). Without this the
    // toggle silently no-ops on http://[::1]/ and similar local-dev URLs even
    // though the background would have whitelisted them.
    var isLocal = d === 'localhost' || d === '::1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(d);
    if (!wasWhitelisted && !isLocal && !d.includes('.')) {
      showToast(t('invalidDomain'));
      return;
    }
    // Optimistic flip \u2014 switch the button label/state immediately so the
    // click feels instant. The renderCurrentTab signature dedupe could
    // otherwise let a polling-timer render run first and leave a stale sig
    // that early-returns later.
    var btnText = this.querySelector('.btn-text');
    var btnIcon = this.querySelector('.btn-icon');
    if (wasWhitelisted) {
      if (btnText) btnText.textContent = t('neverSuspendSite');
      if (btnIcon) btnIcon.innerHTML = icon('shield', 14);
      this.classList.remove('is-whitelisted');
      this.dataset.whitelisted = '0';
    } else {
      if (btnText) btnText.textContent = t('siteWhitelisted');
      if (btnIcon) btnIcon.innerHTML = icon('shieldCheck', 14);
      this.classList.add('is-whitelisted');
      this.dataset.whitelisted = '1';
    }
    // Reset the currentTab signature so the next render is forced to
    // re-execute (otherwise it could match the now-stale pre-click sig).
    var section = document.getElementById('currentTabSection');
    if (section) section.dataset.sig = '';
    this.disabled = true;
    var res = null;
    try {
      res = await msg({ action: wasWhitelisted ? 'removeWhitelist' : 'addWhitelist', domain: target });
    } finally {
      this.disabled = false;
    }
    // Only say it happened if the worker says it did. On a refusal the refresh
    // below puts the button back to the truth, and the toast carries the
    // worker's reason when it gave one (a full sync quota, for instance).
    if (!res) {
      showToast(t('failedToSave'));
    } else if (res.error) {
      showToast(res.error);
    } else if (wasWhitelisted) {
      showToast(t('removedFromWhitelist', [target]));
    } else if (res.added) {
      showToast(t('addedToWhitelist', [res.entry || target]));
    } else {
      showToast(t('alreadyWhitelisted', [res.entry || target]));
    }
    await loadAll();
  });

  document.getElementById('btnCloseDuplicates').addEventListener('click', async function() {
    var res = await msg({ action: 'closeDuplicates' });
    if (res && res.closed > 0) {
      showToast(t('closedDuplicates', [String(res.closed)]));
      await loadAll();
    } else {
      showToast(t('noDuplicates'));
    }
  });

  document.getElementById('btnSearchToggle').addEventListener('click', function() {
    var wrap = document.getElementById('tabSearchWrap');
    var input = document.getElementById('tabSearchInput');
    if (wrap.style.display === 'none') {
      wrap.style.display = '';
      input.focus();
    } else {
      wrap.style.display = 'none';
      input.value = '';
      if (_allTabs) renderTabList(_allTabs);
    }
  });

  document.getElementById('tabSearchInput').addEventListener('input', function() {
    if (_allTabs) renderTabList(filterTabs(_allTabs));
  });

  document.getElementById('tabSearchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var wrap = document.getElementById('tabSearchWrap');
      this.value = '';
      wrap.style.display = 'none';
      if (_allTabs) renderTabList(_allTabs);
      document.getElementById('btnSearchToggle').focus();
    }
  });

  document.getElementById('btnExportTabs').addEventListener('click', async function() {
    if (this.disabled) return;
    this.disabled = true;
    var btn = this;
    var tabs = await msg({ action: 'getTabList' });
    if (!tabs || !tabs.length) { btn.disabled = false; return; }
    var text = tabs.map(function(tab) { return tab.title + '\n' + tab.url; }).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      var iconEl = btn.querySelector('[data-icon]');
      if (iconEl) iconEl.innerHTML = icon('clipboardCheck', 14);
      showToast(t('copiedTabs', [String(tabs.length)]));
      setTimeout(function() {
        var iconEl2 = btn.querySelector('[data-icon]');
        if (iconEl2) iconEl2.innerHTML = icon('clipboard', 14);
        btn.disabled = false;
      }, 2000);
    } catch {
      showToast(t('failedToCopy'));
      btn.disabled = false;
    }
  });

  setupCollapsible('sessionsToggle', 'sessionsBody');
  setupCollapsible('statsToggle', 'statsBody');
  setupCollapsible('settingsToggle', 'settingsBody');

  document.getElementById('btnSaveSession').addEventListener('click', saveSession);
  document.getElementById('sessionNameInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveSession();
  });

  document.getElementById('btnExportSessions').addEventListener('click', async function() {
    var sessions = await msg({ action: 'getSessions' });
    if (!sessions || !sessions.length) { showToast(t('noSessionsToExport')); return; }
    try {
      await navigator.clipboard.writeText(JSON.stringify(sessions, null, 2));
      showToast(t('copiedSessionsJson', [String(sessions.length)]));
    } catch { showToast(t('failedToCopy')); }
  });

  document.getElementById('suspendTimer').addEventListener('change', async function() {
    var val = parseInt(this.value, 10);
    var s = await msg({ action: 'getSettings' });
    if (!s) return;
    if (val === 0) { s.enableAutoSuspend = false; }
    else { s.enableAutoSuspend = true; s.suspendAfterMinutes = val; }
    await msg({ action: 'updateSettings', settings: s });
    document.getElementById('toggleAutoSuspend').checked = s.enableAutoSuspend;
    await loadAll();
  });

  bindToggle('togglePinned', 'protectPinned');
  bindToggle('toggleAudio', 'protectAudio');
  bindHostToggle('toggleForms', 'protectForms');
  bindToggle('toggleStartup', 'suspendOnStartup');
  bindToggle('toggleAutoSuspend', 'enableAutoSuspend');
  bindHostToggle('toggleMarkSuspended', 'markSuspendedTabs');

  document.getElementById('btnAddWhitelist').addEventListener('click', addFromInput);
  document.getElementById('whitelistInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addFromInput();
  });

  document.getElementById('btnExportWhitelist').addEventListener('click', async function() {
    var settings = await msg({ action: 'getSettings' });
    if (!settings || !settings.whitelist || !settings.whitelist.length) {
      showToast(t('noSitesWhitelisted'));
      return;
    }
    try {
      await navigator.clipboard.writeText(settings.whitelist.join('\n'));
      showToast(t('copiedSites', [String(settings.whitelist.length)]));
    } catch { showToast(t('failedToCopy')); }
  });

  document.getElementById('btnImportWhitelist').addEventListener('click', async function() {
    var text;
    try { text = await navigator.clipboard.readText(); }
    catch { showToast(t('clipboardReadFailed')); return; }
    var lines = text.split(/[\n,;]+/).map(function(d) { return d.trim(); }).filter(Boolean);
    if (!lines.length) { showToast(t('noValidDomains')); return; }
    // One message and one storage write for the whole list. Adding sites one
    // by one cost a sync write each, and Chrome allows only so many sync
    // writes a minute, so a long import used to stop part way through.
    var res = await msg({ action: 'importWhitelist', domains: lines });
    if (!res) { showToast(t('failedToSave')); return; }
    if (res.error) { showToast(res.error); return; }
    if (!res.added && res.invalid === lines.length) { showToast(t('noValidDomains')); return; }
    if (res.added) await loadAll();
    showToast(t('importedSites', [String(res.added || 0)]));
  });

  document.getElementById('btnShareStats').addEventListener('click', async function() {
    var stats = await msg({ action: 'getStats' });
    if (!stats) return;
    var total = stats.totalTabsSuspended || 0;
    var today = stats.totalTabsSuspendedToday || 0;
    var ram = total * MB_PER_TAB;
    var lines = [
      t('shareStatsHeader'),
      '',
      '\u2022 ' + t('shareStatsLineAllTime', [String(total)]),
      '\u2022 ' + t('shareStatsLineToday', [String(today)]),
      '\u2022 ' + t('shareStatsLineRam', [fmtRam(ram)]),
    ];
    if (stats.installDate) {
      var since = new Date(stats.installDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      lines.push('\u2022 ' + t('shareStatsLineSince', [since]));
    }
    lines.push('', 'https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa');
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast(t('copiedStats'));
    } catch { showToast(t('failedToCopy')); }
  });

  // Customize-shortcuts link: opens chrome://extensions/shortcuts. Chrome
  // forbids extensions from setting shortcuts programmatically (no
  // chrome.commands.update in Chrome, only in Firefox), so the manual
  // shortcuts editor is the only path. The status text reflects how many
  // commands Chrome actually bound, so users with conflicting suggested_keys
  // can see at a glance that something isn't set.
  var customizeBtn = document.getElementById('btnCustomizeShortcuts');
  if (customizeBtn) {
    customizeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      // Extensions may open chrome:// pages this way, which a normal link
      // cannot. Should a browser refuse, the hint carries the address to type.
      var opened = null;
      try { opened = chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (err) {}
      if (opened && opened.catch) {
        opened.catch(function() { showToast(t('shortcutsHint'), 5000); });
      } else if (!opened) {
        showToast(t('shortcutsHint'), 5000);
      }
    });
  }
  renderShortcutsStatus();

  var whatsNewBtn = document.getElementById('btnWhatsNew');
  // `whatsNew` uses a $VERSION$ placeholder so each locale puts the version
  // in the right grammatical position. Pass the live version as the sub.
  whatsNewBtn.textContent = chrome.i18n.getMessage('whatsNew', [chrome.runtime.getManifest().version]) || ('What\'s new v' + chrome.runtime.getManifest().version);
  whatsNewBtn.addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: 'changelog.html' });
  });

  // report-a-bug link - plain link to the public issue tracker. Nothing is
  // sent automatically; reporting a bug is always an explicit user action.
  var feedbackLink = document.getElementById('btnFeedback');
  if (feedbackLink) {
    feedbackLink.addEventListener('click', function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/ml3dev/drowzy/issues' });
    });
  }
}

function bindToggle(id, key) {
  document.getElementById(id).addEventListener('change', async function() {
    var s = await msg({ action: 'getSettings' });
    if (!s) return;
    s[key] = this.checked;
    await msg({ action: 'updateSettings', settings: s });
    await loadAll();
  });
}

function bindHostToggle(id, key) {
  var el = document.getElementById(id);
  el.addEventListener('change', async function() {
    if (this.checked) {
      var granted = false;
      try {
        granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      } catch { granted = false; }
      if (!granted) {
        this.checked = false;
        return;
      }
    }
    var s = await msg({ action: 'getSettings' });
    if (!s) return;
    s[key] = this.checked;
    await msg({ action: 'updateSettings', settings: s });
    await loadAll();
  });
}

var SECTION_IDS = [['sessionsToggle', 'sessionsBody'], ['statsToggle', 'statsBody'], ['settingsToggle', 'settingsBody']];

function restoreSectionStates() {
  for (var i = 0; i < SECTION_IDS.length; i++) {
    var toggleId = SECTION_IDS[i][0];
    var bodyId = SECTION_IDS[i][1];
    try {
      if (localStorage.getItem('drowzy_section_' + toggleId) === '1') {
        var body = document.getElementById(bodyId);
        var toggle = document.getElementById(toggleId);
        if (body) body.classList.add('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
      }
    } catch {}
  }
}

function setupCollapsible(toggleId, bodyId) {
  var toggle = document.getElementById(toggleId);
  var body = document.getElementById(bodyId);
  toggle.addEventListener('click', function() {
    var isOpen = body.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen);
    try { localStorage.setItem('drowzy_section_' + toggleId, isOpen ? '1' : '0'); } catch {}
  });
}

var _savingSession = false;
var _sessionFeedbackTimer = null;
async function saveSession() {
  if (_savingSession) return;
  _savingSession = true;
  var input = document.getElementById('sessionNameInput');
  var feedback = document.getElementById('sessionFeedback');
  var btn = document.getElementById('btnSaveSession');
  btn.disabled = true;
  input.disabled = true;

  var result = await msg({ action: 'saveSession', name: input.value.trim() });
  if (result && result.success) {
    input.value = '';
    feedback.textContent = '';
    feedback.className = 'session-feedback';
    showToast(t('sessionSaved'));
    await loadAll();
  } else {
    feedback.textContent = (result && result.error) || t('failedToSave');
    feedback.className = 'session-feedback error';
  }
  btn.disabled = false;
  input.disabled = false;
  _savingSession = false;
  // Clear any prior feedback timer before scheduling a fresh one, so rapid
  // re-saves don't stack timers and wipe the latest message early
  clearTimeout(_sessionFeedbackTimer);
  _sessionFeedbackTimer = setTimeout(function() {
    feedback.textContent = '';
    feedback.className = 'session-feedback';
  }, 3000);
}

var _addingWhitelist = false;
async function addFromInput() {
  if (_addingWhitelist) return;
  var input = document.getElementById('whitelistInput');
  var raw = input.value.trim();
  if (!raw) return;
  _addingWhitelist = true;
  input.disabled = true;
  // The worker normalises and validates (scheme, www, port, query, trailing
  // slash, IPv6 brackets), so a pasted address is stored as the entry the
  // matcher expects and the popup does not keep a second copy of the rules.
  var res = await msg({ action: 'addWhitelist', domain: raw });
  input.disabled = false;
  _addingWhitelist = false;
  if (!res || res.error) {
    showToast(res && res.error ? res.error : t('failedToSave'));
    input.classList.add('input-error');
    setTimeout(function() { input.classList.remove('input-error'); }, 1500);
    return;
  }
  // Clear any lingering error state from a previous failed attempt
  input.classList.remove('input-error');
  input.value = '';
  // Match the toggle button's confirmation toast for consistency. `res.added`
  // is false when the site was already in the whitelist - in that case the
  // user typed a duplicate; tell them rather than silently doing nothing.
  var entry = res.entry || raw;
  showToast(res.added ? t('addedToWhitelist', [entry]) : t('alreadyWhitelisted', [entry]));
  await loadAll();
}

function showToast(text, dur) {
  var el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, dur || 2500);
}

function renderShortcutsStatus() {
  var el = document.getElementById('shortcutsStatus');
  if (!el || !chrome.commands || !chrome.commands.getAll) return;
  chrome.commands.getAll(function(commands) {
    var total = commands.length;
    var bound = commands.filter(function(c) { return !!c.shortcut; }).length;
    // Neutral styling - Drowzy works fine without any shortcuts (popup,
    // context menu, side panel cover everything), so an amber/warning state
    // would imply a problem that isn't there. The Customize link next to
    // this text is invitation enough.
    if (bound === total) {
      el.textContent = t('shortcutsAllSet');
    } else {
      el.textContent = t('shortcutsSomeUnset', [String(bound), String(total)]);
    }
    // The bindings themselves, one per line, as the status text's tooltip.
    // Somebody who needs a key back for another app (the GitHub report was
    // Option+W) can see here which command holds it before opening Chrome's
    // page. Descriptions come from the manifest, so they are already in the
    // UI language.
    var lines = commands.map(function(c) {
      return (c.description || c.name) + ': ' + (c.shortcut || t('shortcutUnset'));
    });
    el.title = lines.join('\n');
  });
}

function trimZero(s) {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// A figure like "6.4 GB" dropped into right-to-left text comes out as "GB 6.4":
// the digits and the Latin unit are separate bidi runs and the paragraph
// direction reorders them. Wrapping the figure in an LTR isolate keeps it
// reading the right way round wherever it is spliced into a sentence. Used
// for toasts only; the Share Stats clipboard text stays plain characters.
function bidiIsolate(s) {
  return '⁦' + s + '⁩';
}

function fmtRam(mb) {
  if (mb < 1024) return mb + ' MB';
  var gb = mb / 1024;
  // Drop trailing .0 - "2 GB" reads cleaner than "2.0 GB" for whole values.
  if (gb < 1024) return trimZero(gb.toFixed(1)) + ' GB';
  // A long-running install genuinely reaches terabytes of cumulative total,
  // and four-digit GB overflows the stat card.
  return trimZero((gb / 1024).toFixed(1)) + ' TB';
}

// Counters are unbounded over an install's lifetime, so past a few thousand
// they stop fitting the card. Compact them rather than letting the layout
// break or the digits shrink to nothing.
function fmtCount(n) {
  n = Number(n) || 0;
  if (n < 10000) return String(n);
  if (n < 100000) return trimZero((n / 1000).toFixed(1)) + 'k';
  // 999500 rather than 1000000: rounding 999999 to the nearest thousand would
  // otherwise print "1000k" instead of "1M"
  if (n < 999500) return Math.round(n / 1000) + 'k';
  return trimZero((n / 1000000).toFixed(1)) + 'M';
}

function relativeTime(ts) {
  if (!ts || isNaN(ts)) return t('justNow');
  var diff = Date.now() - Number(ts);
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('minutesAgo', [String(mins)]);
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('hoursAgo', [String(hrs)]);
  var days = Math.floor(hrs / 24);
  if (days === 1) return t('yesterday');
  if (days < 7) return t('daysAgo', [String(days)]);
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

var REVIEW_URL = 'https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa/reviews';
var SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
var FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
// "Enough successful suspensions" before we'd consider asking for a review.
var REVIEW_MIN_SUSPENSIONS = 50;

// Decide whether the review prompt should appear, and wire up its buttons.
// Runs on every popup/sidepanel open (both load popup.js). The prompt is
// intentionally low-pressure: it only ever appears once the user has clearly
// gotten value out of Drowzy, and it never interrupts a core action - it sits
// as a quiet banner at the top of the main content and can always be ignored.
async function checkReviewPrompt() {
  try {
    var data = await chrome.storage.local.get([
      'drowzy_stats', 'reviewPromptCompleted', 'reviewPromptSnoozedUntil', 'reviewPromptOpenCount',
      'reviewPromptDismissCount', 'reviewPromptLastDismissed'
    ]);

    // One-time migration from the pre-1.3.6 prompt model, which used
    // reviewPromptDismissCount (hid permanently at 2 dismissals) and
    // reviewPromptLastDismissed (a 7-day cooldown). Fold that into the new model
    // so users who already dismissed the old prompt are never re-pestered.
    if (data.reviewPromptDismissCount !== undefined || data.reviewPromptLastDismissed !== undefined) {
      var migrate = {};
      if (!data.reviewPromptCompleted && (data.reviewPromptDismissCount || 0) >= 2) {
        // Dismissed the old prompt repeatedly -> treat as "Don't ask again".
        migrate.reviewPromptCompleted = true;
      } else if (!data.reviewPromptCompleted && !data.reviewPromptSnoozedUntil && data.reviewPromptLastDismissed) {
        // A single prior dismissal -> carry it forward as a snooze from that time.
        migrate.reviewPromptSnoozedUntil = data.reviewPromptLastDismissed + FOURTEEN_DAYS;
      }
      if (Object.keys(migrate).length) {
        chrome.storage.local.set(migrate);
        Object.assign(data, migrate);
      }
      // Drop the obsolete keys so this migration runs only once.
      chrome.storage.local.remove(['reviewPromptDismissCount', 'reviewPromptLastDismissed']);
    }

    // "Leave a review" or "Don't ask again" both close the door permanently.
    if (data.reviewPromptCompleted) return;

    // Count this open. We use it to guarantee we never prompt on the very first
    // popup/sidepanel open - only once the user has come back at least once.
    var opens = (data.reviewPromptOpenCount || 0) + 1;
    chrome.storage.local.set({ reviewPromptOpenCount: opens });

    var stats = data.drowzy_stats;
    if (!stats) return;

    // Gate 1: installed at least 7 days. This also covers "never on install"
    // and "never right after an update" - a fresh install is 0 days old, and
    // an update doesn't reset installDate so it has no effect here.
    var installDate = stats.installDate || 0;
    if (!installDate || (Date.now() - installDate) < SEVEN_DAYS) return;

    // Gate 2: enough successful suspensions that the user has felt the benefit.
    if ((stats.totalTabsSuspended || 0) < REVIEW_MIN_SUSPENSIONS) return;

    // Gate 3: not on the first ever open - they've opened the UI before.
    if (opens < 2) return;

    // Gate 4: respect a "Maybe later" cooldown.
    if (data.reviewPromptSnoozedUntil && Date.now() < data.reviewPromptSnoozedUntil) return;

    var banner = document.getElementById('reviewPrompt');
    if (!banner) return;
    banner.style.display = '';
    banner.classList.add('entering');

    function dismissBanner(cb) {
      banner.classList.remove('entering');
      banner.classList.add('dismissing');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        banner.style.display = 'none';
        if (cb) cb();
      }
      banner.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 500);
    }

    // Leave a review: open the store review page and never ask again.
    document.getElementById('reviewLeave').addEventListener('click', function() {
      chrome.storage.local.set({ reviewPromptCompleted: true });
      dismissBanner(function() {
        chrome.tabs.create({ url: REVIEW_URL });
      });
    }, { once: true });

    // Maybe later: hide for a 14-day cooldown, then it may reappear.
    document.getElementById('reviewLater').addEventListener('click', function() {
      chrome.storage.local.set({ reviewPromptSnoozedUntil: Date.now() + FOURTEEN_DAYS });
      dismissBanner();
    }, { once: true });

    // Don't ask again: hide permanently.
    document.getElementById('reviewDontAsk').addEventListener('click', function() {
      chrome.storage.local.set({ reviewPromptCompleted: true });
      dismissBanner();
    }, { once: true });
  } catch {}
}
