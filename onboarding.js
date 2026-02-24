document.addEventListener('DOMContentLoaded', function() {
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

  document.getElementById('btnClose').addEventListener('click', function() {
    window.close();
  });
});
