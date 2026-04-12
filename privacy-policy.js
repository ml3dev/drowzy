try {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  var title = chrome.i18n.getMessage('privacyTitle');
  if (title) document.getElementById('pageTitle').textContent = title;
} catch(e) {}
