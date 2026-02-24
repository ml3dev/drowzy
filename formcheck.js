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
  }
});

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
