document.addEventListener('DOMContentLoaded', init);

var _loaded = false;
var _toastTimer = null;
var _allTabs = null;
var _tabListSig = '';
var _sessionListSig = '';

function t(key, subs) {
  var val = chrome.i18n.getMessage(key, subs);
  return val || key;
}

var BADGES = {
  'Active tab': { icon: 'eye', type: 'active', labelKey: 'badgeActive' },
  'System page': { icon: 'lock', type: 'system', labelKey: 'badgeSystem' },
  'Pinned': { icon: 'pin', type: 'pinned', labelKey: 'badgePinned' },
  'Audio': { icon: 'volume2', type: 'audio', labelKey: 'badgeAudio' },
  'Whitelisted': { icon: 'star', type: 'starred', labelKey: 'badgeWhitelisted' },
};

async function init() {
  try {
    localizeHtml();
    await initTheme();
    injectIcons();
    await loadAll();
    attachListeners();
    await checkReviewPrompt();

    // Poll for tab changes instead of registering persistent chrome.tabs listeners
    // (popup context is short-lived; persistent listeners leak across reopens)
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(function() { loadAll(); }, 5000);

    // Pause polling when sidepanel is hidden, resume when visible
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        clearInterval(_pollTimer);
        _pollTimer = null;
      } else if (document.visibilityState === 'visible' && !_pollTimer) {
        loadAll();
        _pollTimer = setInterval(function() { loadAll(); }, 5000);
      }
    });
  } finally {
    document.body.classList.add('popup-ready');
  }
}

var _pollTimer = null;

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

  // Set version in footer dynamically
  var footer = document.querySelector('.popup-footer span');
  if (footer) footer.textContent = 'Drowzy v' + chrome.runtime.getManifest().version;

  // Set lang attribute to match browser locale
  document.documentElement.lang = chrome.i18n.getUILanguage();
}

async function initTheme() {
  var res = await chrome.storage.local.get('theme');
  if (res.theme) {
    document.documentElement.setAttribute('data-theme', res.theme);
  } else {
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  updateThemeIcon();
}

function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  chrome.storage.local.set({ theme: next });
  updateThemeIcon();

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
  btn.title = dark ? t('switchToLight') : t('switchToDark');
}

function injectIcons() {
  document.querySelectorAll('[data-icon]').forEach(function(el) {
    el.innerHTML = icon(el.dataset.icon, parseInt(el.dataset.iconSize || '14', 10));
  });
}

async function loadAll() {
  try {
    var [status, tabList, settings, sessions, stats] = await Promise.all([
      msg({ action: 'getStatus' }),
      msg({ action: 'getTabList' }),
      msg({ action: 'getSettings' }),
      msg({ action: 'getSessions' }),
      msg({ action: 'getStats' })
    ]);
    _allTabs = tabList;
    var scrollEl = document.querySelector('.main-content');
    // In sidepanel, .main-content doesn't scroll (body does) — detect correct container
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight) {
      scrollEl = document.documentElement;
    }
    var savedScroll = scrollEl.scrollTop;
    renderStatsStrip(status);
    renderTabList(filterTabs(tabList));
    renderCurrentTab(tabList, settings);
    renderSettings(settings);
    renderSessions(sessions);
    renderLifetimeStats(stats);
    if (scrollEl) scrollEl.scrollTop = savedScroll;
    _loaded = true;
  } catch (e) {
    document.getElementById('tabList').innerHTML =
      '<div class="tab-list-empty">' + esc(t('failedToLoad')) + '</div>';
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
  animateStat(document.getElementById('statSleepingValue'), status.suspendedCount);
  animateStat(document.getElementById('statProtectedValue'), status.protectedCount);
  var mem = status.estimatedMbSaved ? '~' + fmtRam(status.estimatedMbSaved) : '\u2014';
  animateStat(document.getElementById('statMemoryValue'), mem);
}

function tabListSignature(tabs) {
  if (!tabs) return '';
  var parts = [];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    parts.push(t.id + '|' + t.status + '|' + (t.title || '') + '|' + (t.timeLeft == null ? '' : t.timeLeft) + '|' + (t.protectReason || '') + '|' + (t.favIconUrl || ''));
  }
  return parts.join('\u0001');
}

function renderTabList(tabs) {
  var container = document.getElementById('tabList');
  if (!tabs || !tabs.length) {
    var emptySig = '__empty__';
    if (_tabListSig === emptySig) return;
    _tabListSig = emptySig;
    container.innerHTML = '<div class="tab-list-empty">' + esc(t('noTabsFound')) + '</div>';
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
    } else if (tab.status === 'protected' || tab.status === 'active') {
      var info = BADGES[tab.protectReason] || { icon: 'shield', type: 'system', labelKey: 'badgeProtected' };
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
      (function(tid) {
        suspendBtn.addEventListener('click', async function(e) {
          e.stopPropagation();
          await msg({ action: 'suspendTab', tabId: tid });
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
          try { await chrome.tabs.update(tabData.id, { active: true }); } catch {}
          await loadAll();
        } else {
          try { await chrome.tabs.update(tabData.id, { active: true }); } catch {}
        }
      };
    })(tab);
    el.addEventListener('click', tabAction);
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tabAction(); }
    });

    container.appendChild(el);
  }
}

function buildFavicon(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    var img = document.createElement('img');
    img.className = 'favicon';
    img.src = tab.favIconUrl;
    img.alt = '';
    img.onerror = function() { img.replaceWith(faviconFallback(tab.url)); };
    return img;
  }
  return faviconFallback(tab.url);
}

function faviconFallback(url) {
  var span = document.createElement('span');
  span.className = 'favicon-fallback';
  try {
    span.textContent = new URL(url).hostname.replace('www.', '').charAt(0).toUpperCase();
  } catch { span.textContent = '?'; }
  return span;
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCurrentTab(tabList, settings) {
  if (!tabList || !tabList.length || !settings) return;

  var active = tabList.find(function(tab) { return tab.status === 'active'; });
  if (!active) return;

  var domain = '\u2014';
  var whitelisted = false;
  try {
    var urlObj = new URL(active.url);
    domain = urlObj.hostname;
    if (urlObj.protocol === 'chrome-extension:') {
      domain = active.title || t('extensionPage');
    }
    var clean = domain.replace(/^www\./, '').toLowerCase();
    var fullUrl = (urlObj.hostname + urlObj.pathname).toLowerCase().replace(/^www\./, '');
    whitelisted = (settings.whitelist || []).some(function(w) {
      w = w.toLowerCase();
      if (w.includes('/')) {
        var escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        try { return new RegExp('^' + escaped + '(/.*)?$').test(fullUrl); } catch { return false; }
      }
      return clean === w || clean.endsWith('.' + w);
    });
  } catch {}

  document.getElementById('currentTabDomain').textContent = domain;

  var fav = document.getElementById('currentTabFavicon');
  fav.style.display = '';
  fav.src = active.favIconUrl || '';
  fav.onerror = function() { fav.style.display = 'none'; };

  document.getElementById('currentTabStatus').textContent = t('activeWontSuspend');

  var btn = document.getElementById('btnToggleWhitelist');
  var isInternal = false;
  try { isInternal = new URL(active.url).protocol !== 'http:' && new URL(active.url).protocol !== 'https:'; } catch {}
  btn.style.display = isInternal ? 'none' : '';
  if (whitelisted) {
    btn.querySelector('.btn-text').textContent = t('siteWhitelisted');
    btn.querySelector('.btn-icon').innerHTML = icon('shieldCheck', 14);
    btn.classList.add('is-whitelisted');
  } else {
    btn.querySelector('.btn-text').textContent = t('neverSuspendSite');
    btn.querySelector('.btn-icon').innerHTML = icon('shield', 14);
    btn.classList.remove('is-whitelisted');
  }
  btn.dataset.domain = domain.replace(/^www\./, '').toLowerCase();
  btn.dataset.whitelisted = whitelisted ? '1' : '0';
}

function renderSessions(sessions) {
  var container = document.getElementById('sessionList');
  if (!sessions || !sessions.length) {
    container.innerHTML = '<div class="empty-state">' + esc(t('emptySessionState')) + '</div>';
    return;
  }

  container.innerHTML = '';
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var card = document.createElement('div');
    card.className = 'session-card';
    card.style.setProperty('--i', i);

    var stack = document.createElement('div');
    stack.className = 'session-favicon-stack';
    var icons = s.tabs.slice(0, 4);
    for (var j = 0; j < icons.length; j++) {
      if (icons[j].favIconUrl) {
        var fi = document.createElement('img');
        fi.src = icons[j].favIconUrl;
        fi.alt = '';
        fi.width = 16;
        fi.height = 16;
        fi.onerror = function() { this.style.display = 'none'; };
        stack.appendChild(fi);
      }
    }

    var info = document.createElement('div');
    info.className = 'session-info';
    info.innerHTML = '<div class="session-name" title="' + esc(s.name) + '">' + esc(s.name) + '</div>' +
      '<div class="session-meta">' + t('tabsCount', [String(s.tabs.length)]) + ' \u00B7 ' + relativeTime(s.createdAt) + '</div>';

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

    (function(session, dBtn) {
      var confirmTimer = null;
      dBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (dBtn.dataset.confirming) {
          clearTimeout(confirmTimer);
          dBtn.dataset.confirming = '';
          await msg({ action: 'deleteSession', id: session.id });
          await loadAll();
        } else {
          dBtn.dataset.confirming = '1';
          dBtn.innerHTML = '<span style="font-size:11px">' + esc(t('confirm') || '?') + '</span>';
          confirmTimer = setTimeout(function() {
            dBtn.dataset.confirming = '';
            dBtn.innerHTML = icon('trash2', 13);
          }, 3000);
        }
      });
    })(s, deleteBtn);

    actions.appendChild(restoreBtn);
    actions.appendChild(replaceBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(stack);
    card.appendChild(info);
    card.appendChild(actions);
    container.appendChild(card);
  }
}

function renderLifetimeStats(stats) {
  if (!stats) return;
  animateStat(document.getElementById('statToday'), stats.totalTabsSuspendedToday || 0);
  animateStat(document.getElementById('statAllTime'), stats.totalTabsSuspended || 0);

  var ram = (stats.totalTabsSuspended || 0) * 150;
  animateStat(document.getElementById('statRamAllTime'), ram ? '~' + fmtRam(ram) : '\u2014');

  if (stats.installDate) {
    document.getElementById('statMemberSince').textContent =
      new Date(stats.installDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
    if (active !== el) el.checked = settings[toggles[i][1]];
  }
  renderWhitelist(settings.whitelist);
}

function renderWhitelist(list) {
  var el = document.getElementById('whitelistList');
  el.innerHTML = '';
  if (!list || !list.length) {
    el.innerHTML = '<li class="empty-whitelist">' + esc(t('noSitesWhitelisted')) + '</li>';
    return;
  }
  for (var i = 0; i < list.length; i++) {
    var li = document.createElement('li');
    li.className = 'whitelist-item';
    var span = document.createElement('span');
    span.textContent = list[i];
    var rm = document.createElement('button');
    rm.className = 'whitelist-remove';
    rm.innerHTML = icon('x', 13);
    rm.title = t('remove');
    (function(domain) {
      rm.onclick = function(e) {
        e.stopPropagation();
        msg({ action: 'removeWhitelist', domain: domain }).then(function() { loadAll(); });
      };
    })(list[i]);
    li.appendChild(span);
    li.appendChild(rm);
    el.appendChild(li);
  }
}

function attachListeners() {
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.getElementById('btnSuspendOthers').addEventListener('click', async function() {
    var text = this.querySelector('.btn-text');
    text.textContent = t('suspending');
    this.disabled = true;
    await msg({ action: 'suspendOthers' });
    text.textContent = t('done');
    var btn = this;
    setTimeout(async function() {
      text.textContent = t('suspendOthers');
      btn.disabled = false;
      await loadAll();
    }, 400);
  });

  document.getElementById('btnWakeAll').addEventListener('click', async function() {
    var text = this.querySelector('.btn-text');
    text.textContent = t('waking');
    this.disabled = true;
    await msg({ action: 'unsuspendAll' });
    text.textContent = t('done');
    var btn = this;
    setTimeout(async function() {
      text.textContent = t('wakeAll');
      btn.disabled = false;
      await loadAll();
    }, 400);
  });

  document.getElementById('btnToggleWhitelist').addEventListener('click', async function() {
    var d = this.dataset.domain;
    if (!d || d === '\u2014' || !d.includes('.')) return;
    await msg({ action: this.dataset.whitelisted === '1' ? 'removeWhitelist' : 'addWhitelist', domain: d });
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

  document.getElementById('btnExportTabs').addEventListener('click', async function() {
    if (this.disabled) return;
    this.disabled = true;
    var btn = this;
    var tabs = await msg({ action: 'getTabList' });
    if (!tabs || !tabs.length) { btn.disabled = false; return; }
    var text = tabs.map(function(tab) { return tab.title + '\n' + tab.url; }).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      btn.querySelector('[data-icon]').innerHTML = icon('clipboardCheck', 14);
      showToast(t('copiedTabs', [String(tabs.length)]));
      setTimeout(function() {
        btn.querySelector('[data-icon]').innerHTML = icon('clipboard', 14);
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
    try {
      var text = await navigator.clipboard.readText();
      var domains = text.split(/[\n,;]+/).map(function(d) {
        var clean = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
        if (!clean.includes('/')) clean = clean.replace(/[/:?#].*$/, '');
        return clean;
      }).filter(function(d) { return d && d.split('/')[0].includes('.') && !d.startsWith('.') && !d.split('/')[0].endsWith('.'); });
      if (!domains.length) { showToast(t('noValidDomains')); return; }
      var settings = await msg({ action: 'getSettings' });
      if (!settings) return;
      var added = 0;
      for (var i = 0; i < domains.length; i++) {
        if (!settings.whitelist.includes(domains[i])) {
          await msg({ action: 'addWhitelist', domain: domains[i] });
          added++;
        }
      }
      if (added) await loadAll();
      showToast(t('importedSites', [String(added)]));
    } catch { showToast(t('clipboardReadFailed')); }
  });

  var whatsNewBtn = document.getElementById('btnWhatsNew');
  whatsNewBtn.textContent = t('changelogWhatsNew') + ' v' + chrome.runtime.getManifest().version;
  whatsNewBtn.addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: 'changelog.html' });
  });
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

function setupCollapsible(toggleId, bodyId) {
  var toggle = document.getElementById(toggleId);
  var body = document.getElementById(bodyId);
  toggle.addEventListener('click', function() {
    var isOpen = body.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen);
  });
}

async function saveSession() {
  var input = document.getElementById('sessionNameInput');
  var feedback = document.getElementById('sessionFeedback');
  var btn = document.getElementById('btnSaveSession');
  btn.disabled = true;

  var result = await msg({ action: 'saveSession', name: input.value.trim() });
  if (result && result.success) {
    input.value = '';
    feedback.textContent = t('sessionSaved');
    feedback.className = 'session-feedback success';
    showToast(t('sessionSaved'));
    await loadAll();
  } else {
    feedback.textContent = (result && result.error) || t('failedToSave');
    feedback.className = 'session-feedback error';
  }
  btn.disabled = false;
  setTimeout(function() { feedback.textContent = ''; feedback.className = 'session-feedback'; }, 3000);
}

async function addFromInput() {
  var input = document.getElementById('whitelistInput');
  var raw = input.value.trim();
  if (!raw) return;
  var domain = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!domain.includes('/')) domain = domain.replace(/[/:?#].*$/, '');
  var domainPart = domain.split('/')[0];
  if (!domainPart || !domainPart.includes('.') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
    showToast(t('invalidDomain'));
    input.classList.add('input-error');
    setTimeout(function() { input.classList.remove('input-error'); }, 1500);
    return;
  }
  var res = await msg({ action: 'addWhitelist', domain: domain });
  if (res && res.error) {
    showToast(res.error);
    input.classList.add('input-error');
    setTimeout(function() { input.classList.remove('input-error'); }, 1500);
    return;
  }
  input.value = '';
  await loadAll();
}

function showToast(text, dur) {
  var el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, dur || 2500);
}

function fmtRam(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
}

function relativeTime(ts) {
  var diff = Date.now() - ts;
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
var ISSUES_URL = 'https://github.com/ml3dev/drowzy/issues';
var SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

async function checkReviewPrompt() {
  try {
    var data = await chrome.storage.local.get(['drowzy_stats', 'reviewPromptCompleted', 'reviewPromptDismissCount', 'reviewPromptLastDismissed']);
    var stats = data.drowzy_stats;
    if (!stats || (stats.totalTabsSuspended || 0) < 50) return;
    if (data.reviewPromptCompleted) return;
    if ((data.reviewPromptDismissCount || 0) >= 2) return;
    if (data.reviewPromptLastDismissed && (Date.now() - data.reviewPromptLastDismissed < SEVEN_DAYS)) return;

    var banner = document.getElementById('reviewPrompt');
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

    function recordDismiss() {
      var count = (data.reviewPromptDismissCount || 0) + 1;
      chrome.storage.local.set({
        reviewPromptDismissCount: count,
        reviewPromptLastDismissed: Date.now()
      });
    }

    document.getElementById('reviewThumbsUp').addEventListener('click', function() {
      chrome.storage.local.set({ reviewPromptCompleted: true });
      dismissBanner(function() {
        chrome.tabs.create({ url: REVIEW_URL });
      });
    }, { once: true });

    document.getElementById('reviewThumbsDown').addEventListener('click', function() {
      recordDismiss();
      dismissBanner(function() {
        chrome.tabs.create({ url: ISSUES_URL });
      });
    }, { once: true });

    document.getElementById('reviewDismiss').addEventListener('click', function() {
      recordDismiss();
      dismissBanner();
    }, { once: true });
  } catch {}
}
