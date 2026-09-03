// Honour the theme chosen with the popup's toggle (see changelog.js).
try {
  chrome.storage.local.get('theme', function(res) {
    var t = res && res.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  });
} catch (e) {}

try {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  var title = chrome.i18n.getMessage('privacyTitle');
  if (title) document.getElementById('pageTitle').textContent = title;
} catch(e) {}
