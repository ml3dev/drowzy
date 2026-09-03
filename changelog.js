// Honour the theme chosen with the popup's toggle; the CSS falls back to the
// OS preference only when no explicit choice is stored. This page auto-opens
// on the 1.4.0 update, so getting it wrong would be the first thing users see.
try {
  chrome.storage.local.get('theme', function(res) {
    var t = res && res.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  });
} catch (e) {}

try {
  var uiLang = chrome.i18n.getUILanguage();
  document.documentElement.lang = uiLang;
  document.documentElement.dir = ['ar', 'he', 'iw', 'fa', 'ur'].indexOf((uiLang || '').toLowerCase().split('-')[0]) !== -1 ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    // a release heading carries its version as a placeholder, because half
    // the languages put the version in front of the words, not after them
    var version = el.getAttribute('data-i18n-version');
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'), version ? [version] : undefined);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
    var msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-html'));
    if (msg) el.innerHTML = msg;
  });
  document.title = chrome.i18n.getMessage('changelogTitle') || document.title;

  // Release months, kept in the markup as ISO dates and shown in the reader's
  // own language. Noon UTC so no time zone can shift the day across a month
  // boundary; the English text in the page stays as the fallback.
  document.querySelectorAll('[data-date]').forEach(function(el) {
    var d = new Date(el.getAttribute('data-date') + 'T12:00:00Z');
    if (isNaN(d.getTime())) return;
    try { el.textContent = d.toLocaleDateString(uiLang || undefined, { month: 'long', year: 'numeric' }); } catch (e) {}
  });

  // Set version dynamically
  var ver = chrome.runtime.getManifest().version;
  var footer = document.querySelector('.footer');
  if (footer) footer.textContent = 'Drowzy v' + ver;
  var badge = document.querySelector('.version-badge .version-label');
  if (badge) badge.textContent = (chrome.i18n.getMessage('changelogVersionLabel') || 'Version') + ' ' + ver;
} catch(e) {}

// Earlier releases slide open and closed instead of snapping. A <details>
// element cannot animate its own height, so the click is taken over: the row
// is measured closed and open, the height is tweened between the two, and the
// description fades with it. The chevron turns the moment a close starts.
// Reduced-motion users get the native toggle, and so does anything without
// the Web Animations API.
try {
  var noMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.change-item.past details').forEach(function(box) {
    var summary = box.querySelector('summary');
    var desc = box.querySelector('.change-desc');
    if (!summary || !desc || noMotion || !box.animate) return;
    var slide = null, fade = null;
    summary.addEventListener('click', function(ev) {
      ev.preventDefault();
      var from = box.getBoundingClientRect().height;
      if (slide) slide.cancel();
      if (fade) fade.cancel();
      // a row still sliding shut counts as closed; one Chrome opened by itself
      // (find in page lands on hidden text) counts as open
      var opening = box.classList.contains('closing') || !box.open;
      if (opening) box.open = true;
      var to = opening ? box.scrollHeight : summary.offsetHeight;
      box.classList.toggle('closing', !opening);
      box.style.overflow = 'hidden';
      slide = box.animate({ height: [from + 'px', to + 'px'] }, { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      fade = desc.animate(
        { opacity: opening ? [0, 1] : [1, 0], transform: opening ? ['translateY(-4px)', 'none'] : ['none', 'translateY(-4px)'] },
        { duration: opening ? 220 : 140, easing: 'ease', fill: opening ? 'none' : 'forwards' });
      slide.onfinish = function() {
        slide = null;
        box.style.overflow = '';
        box.classList.remove('closing');
        if (!opening) box.open = false;
      };
    });
  });
} catch (e) {}
