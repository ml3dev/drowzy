// content script -- form data check + tab title marking

// Guard against double-injection (service worker restart re-injects). Keyed
// to the version: after an update, a copy left behind by the old version can
// no longer talk to the extension, and a plain true/false guard would let it
// block the new copy, so the form check would get no answer and read "clean".
var _drowzyVersion = '';
try { _drowzyVersion = chrome.runtime.getManifest().version; } catch {}
if (window._drowzyFormcheckLoaded !== _drowzyVersion) {
window._drowzyFormcheckLoaded = _drowzyVersion;

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'checkFormData') {
    sendResponse({ hasFormData: hasUnsavedFormData() });
  } else if (msg.action === 'markSuspended') {
    markTitle(msg.prefix || chrome.i18n.getMessage('markSuspendedPrefix') || '[zzz] ');
    sendResponse({ success: true });
  } else if (msg.action === 'unmarkSuspended') {
    unmarkTitle();
    sendResponse({ success: true });
  } else if (msg.action === 'suspendWarning') {
    showSuspendWarning();
    sendResponse({ success: true });
  }
});

// What this copy of the script did to the title: the prefix, the title it found
// and the title it left. Taking the mark off puts back exactly what it found, and
// only while the title is still exactly what it left. Anything else is the page's
// own text, even if it starts with the same characters, and is not ours to edit.
// The title is read back after writing it because the browser collapses whitespace:
// an empty title plus a prefix reads back without the trailing space.
var titleMark = null;

function markTitle(prefix) {
  if (titleMark && titleMark.left === document.title) {
    if (titleMark.prefix === prefix) return;
    unmarkTitle();
  }
  titleMark = null;
  var found = document.title;
  // a page whose own title already starts this way does not get a second copy
  if (found.startsWith(prefix)) return;
  document.title = prefix + found;
  titleMark = { prefix: prefix, found: found, left: document.title };
}

function unmarkTitle() {
  if (titleMark && titleMark.left === document.title) document.title = titleMark.found;
  titleMark = null;
}

function showSuspendWarning() {
  // a banner on a hidden tab is theater - the user can't see it. only render
  // when the tab is actually visible. when hidden, the suspend goes through
  // silently (which the user already wasn't paying attention to).
  if (document.visibilityState !== 'visible') return;
  if (!document.body || document.getElementById('drowzy-suspend-warning')) return;

  var el = document.createElement('div');
  el.id = 'drowzy-suspend-warning';
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 14px;background:rgba(167,139,250,0.97);color:#fff;font:13px -apple-system,system-ui,sans-serif;text-align:center;z-index:2147483647;transition:opacity 0.3s;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);';

  var bannerText = document.createElement('span');
  bannerText.textContent = chrome.i18n.getMessage('suspendWarningText') || 'Suspending tab soon...';
  bannerText.style.cssText = 'cursor:pointer;';
  bannerText.title = chrome.i18n.getMessage('clickToDismiss') || 'Click to dismiss';
  bannerText.addEventListener('click', function() { if (el.parentNode) el.remove(); });

  var keepBtn = document.createElement('button');
  // "Not now", not "Keep awake": this only defers the one imminent suspend by
  // bumping the tab's idle timer. The real open-ended hold is "Keep this tab
  // awake" in the popup, and two controls with the same name doing different
  // things is exactly the confusion this release is trying to remove.
  keepBtn.textContent = chrome.i18n.getMessage('bannerNotNow') || 'Not now';
  keepBtn.style.cssText = 'background:#fff;color:#7c3aed;border:none;padding:4px 12px;border-radius:4px;font:600 12px -apple-system,system-ui,sans-serif;cursor:pointer;';
  keepBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    // tells background to bump this tab's timestamp + skip the imminent discard
    try { chrome.runtime.sendMessage({ action: 'keepTabAwake' }); } catch {}
    if (el.parentNode) el.remove();
  });

  el.appendChild(bannerText);
  el.appendChild(keepBtn);
  document.body.appendChild(el);
  // background discards ~2500ms after warning, so the banner lifetime is bounded
  // by the tab itself unloading. fade slightly before discard so it's not jarring.
  setTimeout(function() { el.style.opacity = '0'; }, 2200);
  setTimeout(function() { if (el.parentNode) el.remove(); }, 2700);
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
    'input[type="number"], input[type="search"], ' +
    'input[type="date"], input[type="datetime-local"], ' +
    'input[type="month"], input[type="time"], input[type="week"], ' +
    'input[type="color"], input:not([type]), textarea, [contenteditable="true"]'
  );

  for (var i = 0; i < fields.length; i++) {
    var el = fields[i];
    if (el.isContentEditable) {
      var original = _ceSnapshots ? _ceSnapshots.get(el) : undefined;
      if (original === undefined) {
        // Element added after snapshot - treat as dirty if non-empty
        if (el.textContent.trim()) return true;
      } else if (el.textContent !== original) {
        return true;
      }
    } else if (el.value !== el.defaultValue) {
      return true;
    }
  }
  // also check for changed checkboxes/radio buttons (e.g. someone toggled a
  // settings page and didn't save). a discarded radio/checkbox state would be
  // just as lost as a typed input.
  var toggles = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  for (var j = 0; j < toggles.length; j++) {
    if (toggles[j].checked !== toggles[j].defaultChecked) return true;
  }
  return false;
}

} // end double-injection guard
