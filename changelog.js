try {
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
  document.title = chrome.i18n.getMessage('changelogTitle') || document.title;

  // Set version dynamically
  var ver = chrome.runtime.getManifest().version;
  var footer = document.querySelector('.footer');
  if (footer) footer.textContent = 'Drowzy v' + ver;
  var badge = document.querySelector('.version-badge .version-label');
  if (badge) badge.textContent = (chrome.i18n.getMessage('changelogVersionLabel') || 'Version') + ' ' + ver;
} catch(e) {}
