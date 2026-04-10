// content script -- form data check + tab title marking

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'checkFormData') {
    sendResponse({ hasFormData: hasUnsavedFormData() });
  } else if (msg.action === 'markSuspended') {
    var prefix = chrome.i18n.getMessage('markSuspendedPrefix') || '[zzz] ';
    if (!document.title.startsWith(prefix)) {
      document.title = prefix + document.title;
    }
    sendResponse({ success: true });
  } else if (msg.action === 'suspendWarning') {
    showSuspendWarning();
    sendResponse({ success: true });
  }
});

function showSuspendWarning() {
  if (document.getElementById('drowzy-suspend-warning')) return;
  var el = document.createElement('div');
  el.id = 'drowzy-suspend-warning';
  el.textContent = chrome.i18n.getMessage('suspendWarningText') || 'Suspending tab soon...';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:6px 12px;background:rgba(167,139,250,0.95);color:#fff;font:13px -apple-system,system-ui,sans-serif;text-align:center;z-index:2147483647;transition:opacity 0.3s;';
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; }, 2000);
  setTimeout(function() { if (el.parentNode) el.remove(); }, 2500);
}

function hasUnsavedFormData() {
  var fields = document.querySelectorAll(
    'input[type="text"], input[type="search"], input[type="email"], ' +
    'input[type="url"], input[type="tel"], input[type="password"], ' +
    'input[type="number"], input:not([type]), textarea, [contenteditable="true"]'
  );

  for (var i = 0; i < fields.length; i++) {
    var el = fields[i];
    if (el.isContentEditable) {
      if (el.textContent.trim()) return true;
    } else if (el.value && el.value !== el.defaultValue) {
      return true;
    }
  }
  return false;
}
