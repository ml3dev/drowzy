document.addEventListener('DOMContentLoaded', function() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
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

  // Replace the embedded <kbd> text in each shortcut hint with the user's
  // actual binding (handles per-platform manifest defaults and user remaps).
  // If a command is unbound, leave the translated default alone.
  if (chrome.commands && chrome.commands.getAll) {
    var hintKeys = {
      'suspend-current': 'actionAltS',
      'suspend-others': 'actionAltShiftS',
      'wake-all': 'actionAltW'
    };
    chrome.commands.getAll(function(commands) {
      commands.forEach(function(cmd) {
        if (!cmd.shortcut) return;
        var dataKey = hintKeys[cmd.name];
        if (!dataKey) return;
        var span = document.querySelector('[data-i18n-html="' + dataKey + '"]');
        var kbd = span && span.querySelector('kbd');
        if (kbd) kbd.textContent = cmd.shortcut;
      });
    });
  }

  document.getElementById('btnClose').addEventListener('click', function() {
    chrome.tabs.getCurrent(function(tab) {
      if (tab) chrome.tabs.remove(tab.id);
    });
  });

  // Plain <a href="chrome://..."> is blocked from regular pages by Chrome;
  // open via chrome.tabs.create which is allowed from extension pages.
  var remapBtn = document.getElementById('btnRemapShortcuts');
  if (remapBtn) {
    remapBtn.addEventListener('click', function(e) {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }
});
