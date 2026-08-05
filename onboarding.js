// Honour the theme chosen with the popup's toggle. Without this the page
// follows the OS only, so a user on a dark OS who switched Drowzy to light
// gets a dark page - and 1.4.0 opens this kind of page automatically on
// update, so it would have been the first thing they saw.
try {
  chrome.storage.local.get('theme', function(res) {
    var t = res && res.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  });
} catch (e) {}

document.addEventListener('DOMContentLoaded', function() {
  var uiLang = chrome.i18n.getUILanguage();
  document.documentElement.lang = uiLang;
  document.documentElement.dir = ['ar', 'he', 'iw', 'fa', 'ur'].indexOf((uiLang || '').toLowerCase().split('-')[0]) !== -1 ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-html'));
    if (msg) el.innerHTML = msg;
  });
  var title = chrome.i18n.getMessage('onboardingTitle');
  if (title) document.getElementById('pageTitle').textContent = title;

  // Reflect the user's actual key bindings (handles per-platform manifest
  // defaults and user remaps). When a command is bound, swap the embedded
  // <kbd> text with the real binding. When it's unbound - Chrome couldn't
  // auto-assign the suggested key because of a conflict with another
  // extension or a system shortcut - hide the entire <li>. The tip below
  // ("Want different keyboard shortcuts? Customize them here →") routes
  // users to chrome://extensions/shortcuts where they can set the unbound
  // ones; we don't need to litter the quick-actions list with stub rows.
  if (chrome.commands && chrome.commands.getAll) {
    var hintKeys = {
      'suspend-current': 'actionAltS',
      'suspend-others':  'actionAltShiftS',
      'wake-all':        'actionAltW'
    };
    chrome.commands.getAll(function(commands) {
      commands.forEach(function(cmd) {
        var dataKey = hintKeys[cmd.name];
        if (!dataKey) return;
        var span = document.querySelector('[data-i18n-html="' + dataKey + '"]');
        if (!span) return;
        var li = span.closest('li');
        if (cmd.shortcut) {
          var kbd = span.querySelector('kbd');
          if (kbd) kbd.textContent = cmd.shortcut;
          if (li) li.style.display = '';
        } else if (li) {
          li.style.display = 'none';
        }
      });
    });
  }

  document.getElementById('btnClose').addEventListener('click', function() {
    chrome.tabs.getCurrent(function(tab) {
      if (tab) chrome.tabs.remove(tab.id);
    });
  });
});
