// content script -- form data check + tab title marking

// Guard against double-injection (service worker restart re-injects)
if (!window._drowzyFormcheckLoaded) {
window._drowzyFormcheckLoaded = true;

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'checkFormData') {
    sendResponse({ hasFormData: hasUnsavedFormData() });
  } else if (msg.action === 'markSuspended') {
    const pfx = chrome.i18n.getMessage('markSuspendedPrefix') || '[zzz] ';
    if (!document.title.startsWith(pfx)) {
      document.title = pfx + document.title;
    }
    sendResponse({ success: true });
  } else if (msg.action === 'unmarkSuspended') {
    const pfx = chrome.i18n.getMessage('markSuspendedPrefix') || '[zzz] ';
    if (document.title.startsWith(pfx)) {
      document.title = document.title.substring(pfx.length);
    }
    sendResponse({ success: true });
  } else if (msg.action === 'suspendWarning') {
    showSuspendWarning();
    sendResponse({ success: true });
  }
});

function showSuspendWarning() {
  if (!document.body || document.getElementById('drowzy-suspend-warning')) return;
  var el = document.createElement('div');
  el.id = 'drowzy-suspend-warning';
  el.setAttribute('role', 'alert');
  el.textContent = chrome.i18n.getMessage('suspendWarningText') || 'Suspending tab soon...';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:6px 12px;background:rgba(167,139,250,0.95);color:#fff;font:13px -apple-system,system-ui,sans-serif;text-align:center;z-index:2147483647;transition:opacity 0.3s;cursor:pointer;';
  el.title = 'Click to dismiss';
  el.addEventListener('click', function() { if (el.parentNode) el.remove(); });
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; }, 2000);
  setTimeout(function() { if (el.parentNode) el.remove(); }, 2500);
}

var _ceSnapshots = null;

function snapshotContentEditables() {
  if (_ceSnapshots) return;
  _ceSnapshots = new WeakMap();
  var editables = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editables.length; i++) {
    _ceSnapshots.set(editables[i], editables[i].textContent);
  }
}

// Snapshot on load so we can compare later
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', snapshotContentEditables);
} else {
  snapshotContentEditables();
}

function hasUnsavedFormData() {
  var fields = document.querySelectorAll(
    'input[type="text"], input[type="email"], ' +
    'input[type="url"], input[type="tel"], input[type="password"], ' +
    'input[type="number"], input:not([type]), textarea, [contenteditable="true"]'
  );

  for (var i = 0; i < fields.length; i++) {
    var el = fields[i];
    if (el.isContentEditable) {
      var original = _ceSnapshots ? _ceSnapshots.get(el) : undefined;
      if (original === undefined) {
        // Element added after snapshot — treat as dirty if non-empty
        if (el.textContent.trim()) return true;
      } else if (el.textContent !== original) {
        return true;
      }
    } else if (el.value !== el.defaultValue) {
      return true;
    }
  }
  return false;
}

} // end double-injection guard
