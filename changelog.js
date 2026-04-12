try {
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-html'));
    if (msg) el.innerHTML = msg;
  });
  document.title = chrome.i18n.getMessage('changelogTitle') || document.title;
} catch(e) {}
