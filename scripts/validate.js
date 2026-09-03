#!/usr/bin/env node
// Pre-release checks. Run from the repo root:  node scripts/validate.js
//
// Catches the failure modes that actually bit us: a locale missing a key so
// Chrome silently falls back to English, a data-i18n attribute pointing at a
// key nobody ever added, a placeholder dropped in translation, and the popup
// and side panel drifting apart because a change landed in only one of them.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rel = p => path.relative(root, p).replace(/\\/g, '/');

let errors = 0;
let warnings = 0;
// read early: the dead-key check needs the manifest's __MSG_*__ references
const manifestForKeys = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
function fail(msg) { console.error('  FAIL  ' + msg); errors++; }
function warn(msg) { console.warn('  WARN  ' + msg); warnings++; }
function ok(msg) { console.log('  ok    ' + msg); }

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

/* locales */

console.log('\nlocales');
const localeDir = path.join(root, '_locales');
const locales = fs.readdirSync(localeDir).filter(d =>
  fs.statSync(path.join(localeDir, d)).isDirectory());

const messages = {};
for (const loc of locales) {
  const p = path.join(localeDir, loc, 'messages.json');
  try {
    messages[loc] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(rel(p) + ' does not parse: ' + e.message);
  }
}

const base = messages.en;
if (!base) {
  fail('_locales/en/messages.json is missing - cannot check parity');
} else {
  const baseKeys = Object.keys(base);
  ok(locales.length + ' locales parsed, ' + baseKeys.length + ' keys in en');

  for (const loc of locales) {
    if (loc === 'en' || !messages[loc]) continue;
    const m = messages[loc];
    const missing = baseKeys.filter(k => !(k in m));
    const extra = Object.keys(m).filter(k => !(k in base));
    if (missing.length) fail(loc + ' missing ' + missing.length + ' key(s): ' + missing.slice(0, 6).join(', '));
    if (extra.length) fail(loc + ' has ' + extra.length + ' key(s) not in en: ' + extra.slice(0, 6).join(', '));
  }

  // Placeholder integrity. A $NAME$ used in the message must be declared, and
  // a translation must use the same set the English one does - a dropped
  // placeholder renders as a literal or an empty gap at runtime.
  const phUsed = s => [...String(s).matchAll(/\$([A-Za-z0-9_]+)\$/g)].map(m => m[1].toLowerCase());
  for (const loc of locales) {
    const m = messages[loc];
    if (!m) continue;
    for (const k of Object.keys(m)) {
      const entry = m[k];
      if (!entry || typeof entry.message !== 'string') { fail(loc + '/' + k + ' has no message string'); continue; }
      const used = new Set(phUsed(entry.message));
      const declared = new Set(Object.keys(entry.placeholders || {}).map(x => x.toLowerCase()));
      for (const u of used) {
        if (!declared.has(u)) fail(loc + '/' + k + ' uses $' + u.toUpperCase() + '$ but does not declare it');
      }
      if (base[k] && loc !== 'en') {
        const baseUsed = new Set(phUsed(base[k].message));
        for (const b of baseUsed) {
          if (!used.has(b)) fail(loc + '/' + k + ' drops placeholder $' + b.toUpperCase() + '$ that en uses');
        }
      }
    }
  }
  if (!errors) ok('key parity and placeholders clean across all locales');

  // House style: no em or en dashes, in ANY locale. These are not a native
  // punctuation choice in the translations - they are separators copied from
  // the English source, so a locale-only check would miss 54 files.
  let dashLocales = 0;
  for (const loc of locales) {
    if (!messages[loc]) continue;
    const bad = Object.keys(messages[loc]).filter(k => /[—–]/.test(messages[loc][k].message));
    if (bad.length) { fail(loc + ' has em/en dashes in ' + bad.length + ' key(s): ' + bad.slice(0, 5).join(', ')); dashLocales++; }
  }
  if (!dashLocales) ok('no em/en dashes in any locale');

  // A non-English locale whose string is byte-identical to English is almost
  // always an untranslated fallback that slipped in. Brand-only strings are
  // legitimately identical, so they are exempt.
  // Words that are genuinely the same in many target languages. Without this
  // the check is pure noise and nobody reads it.
  const brandOnly = new Set([
    'extName', 'markSuspendedPrefix',
    'badgeZzz',              // onomatopoeia, universal
    'badgeAudio', 'badgeSystem', 'changelogVersionLabel', 'privacyContactTitle',
    'sessions', 'sessionDefaultName', 'importWhitelist',
    'timer1min', 'timer5min', 'timer10min', 'timer15min', 'timer30min'
  ]);
  const untranslated = [];
  for (const loc of locales) {
    if (loc.startsWith('en') || !messages[loc]) continue;
    const same = Object.keys(base).filter(k =>
      !brandOnly.has(k) && messages[loc][k] && messages[loc][k].message === base[k].message);
    if (same.length) untranslated.push(loc + '(' + same.length + ')');
  }
  if (untranslated.length) warn('locales with English-identical strings: ' + untranslated.join(' '));
  else ok('no untranslated leftovers');

  // Layout guard: badges and status lines sit in fixed-width furniture. Flag a
  // translation that is wildly longer than English so it gets eyeballed.
  const tight = { badgeAwake: 3.0, badgeActive: 3.0, badgePinned: 3.0, badgeAudio: 3.0, badgeSystem: 3.0, badgeWhitelisted: 3.0, allowSleep: 3.0, openSettingsAction: 3.0 };
  for (const loc of locales) {
    if (!messages[loc]) continue;
    for (const k of Object.keys(tight)) {
      if (!base[k] || !messages[loc][k]) continue;
      const ratio = messages[loc][k].message.length / base[k].message.length;
      if (ratio > tight[k]) warn(loc + '/' + k + ' is ' + ratio.toFixed(1) + 'x the English length: "' + messages[loc][k].message + '"');
    }
  }
}

/* i18n references from HTML and JS */

console.log('\ni18n references');
const htmlFiles = ['popup.html', 'sidepanel.html', 'onboarding.html', 'changelog.html', 'privacy-policy.html'];
const jsFiles = ['popup.js', 'background.js', 'onboarding.js', 'changelog.js', 'privacy-policy.js', 'formcheck.js'];

const referenced = new Map(); // key -> where
function refer(k, where) {
  if (!referenced.has(k)) referenced.set(k, where);
}

for (const f of htmlFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const m of src.matchAll(/data-i18n(?:-title|-aria|-html|-placeholder)?\s*=\s*"([^"]+)"/g)) {
    refer(m[1], f);
  }
}
for (const f of jsFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  // Any quoted bare identifier that happens to name a real key counts as a
  // reference. Matching only `t('key')` misses the ways keys actually get
  // used - ternaries like t(on ? 'aToast' : 'bToast'), lookup tables like
  // BADGES' labelKey, and reason codes returned from the background.
  for (const m of src.matchAll(/['"]([A-Za-z][A-Za-z0-9_]{2,})['"]/g)) {
    if (base && (m[1] in base)) refer(m[1], f);
  }
}

if (base) {
  let unresolved = 0;
  for (const [k, where] of referenced) {
    if (!(k in base)) { fail(where + ' references i18n key "' + k + '" that is not in en'); unresolved++; }
  }
  if (!unresolved) ok(referenced.size + ' referenced keys all resolve in en');

  // Dead keys: referenced by nothing, including the manifest. Every locale
  // pays for these 57 times over, so they are worth surfacing.
  const inManifest = new Set(
    [...JSON.stringify(manifestForKeys).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]));
  const unused = Object.keys(base).filter(k => !referenced.has(k) && !inManifest.has(k));
  if (unused.length) warn(unused.length + ' key(s) referenced by nothing: ' + unused.slice(0, 8).join(', '));
  else ok('no dead keys');
}

/* manifest */

console.log('\nmanifest');
const manifest = JSON.parse(read('manifest.json'));
ok('version ' + manifest.version);
if (base) {
  const msgKeys = [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]);
  const bad = msgKeys.filter(k => !(k in base));
  if (bad.length) fail('manifest references missing keys: ' + bad.join(', '));
  else ok(msgKeys.length + ' manifest __MSG__ keys resolve');
}
// Deliberate allowlist. Growing it is a decision, not a detail: update this
// line and the README/privacy-policy permission tables in the same commit.
// 'favicon' was added in 1.4.0 to read Chrome's local favicon cache; it makes
// no network request and carries no user-facing permission warning.
const expectedPerms = ['tabs', 'storage', 'alarms', 'contextMenus', 'scripting', 'sidePanel', 'favicon'];
const extraPerms = manifest.permissions.filter(p => !expectedPerms.includes(p));
if (extraPerms.length) fail('unexpected new permission(s): ' + extraPerms.join(', '));
else ok('permissions unchanged (' + manifest.permissions.length + ')');

/* popup vs side panel drift */

console.log('\npopup / side panel');
const popup = read('popup.html');
const side = read('sidepanel.html');
const ids = src => [...src.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const pIds = new Set(ids(popup));
const sIds = new Set(ids(side));
// Known-intentional differences live here so real drift still stands out.
const allowed = new Set([]);
const onlyPopup = [...pIds].filter(i => !sIds.has(i) && !allowed.has(i));
const onlySide = [...sIds].filter(i => !pIds.has(i) && !allowed.has(i));
if (onlyPopup.length) fail('ids only in popup.html: ' + onlyPopup.join(', '));
if (onlySide.length) fail('ids only in sidepanel.html: ' + onlySide.join(', '));
if (!onlyPopup.length && !onlySide.length) ok(pIds.size + ' element ids match across popup and side panel');

/* html tag balance */

console.log('\nhtml');
for (const f of htmlFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'use', 'stop']);
  const stack = [];
  let broken = null;
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const [, slash, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (voids.has(name) || attrs.trimEnd().endsWith('/')) continue;
    if (slash) {
      if (!stack.length || stack[stack.length - 1] !== name) { broken = name; break; }
      stack.pop();
    } else {
      stack.push(name);
    }
  }
  if (broken) fail(f + ' tag mismatch near </' + broken + '>');
  else if (stack.length) fail(f + ' has unclosed: ' + stack.join(' > '));
  else ok(f + ' tags balanced');
}

/* css: unbalanced braces silently kill every rule after the break, and the
   HTML tag check above does not look inside <style> */

console.log('\ncss');
function checkCss(label, css) {
  let depth = 0, line = 1, broke = 0;
  for (const ch of css) {
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0 && !broke) { fail(label + ': stray } at line ~' + line); broke = line; } }
  }
  if (!broke && depth !== 0) fail(label + ': ' + depth + ' unclosed block(s)');
  if (!broke && depth === 0) ok(label + ' braces balanced');
}
checkCss('popup.css', read('popup.css'));

// Theme parity: a var defined in one theme and not the other silently keeps
// the other theme's value, which is invisible until someone toggles and finds
// unreadable text or an icon that blends into the background.
{
  const css = read('popup.css');
  const blockVars = sel => {
    const i = css.indexOf(sel);
    if (i < 0) return null;
    const s = css.indexOf('{', i);
    let d = 0, e = 0;
    for (let j = s; j < css.length; j++) {
      if (css[j] === '{') d++;
      else if (css[j] === '}') { d--; if (!d) { e = j; break; } }
    }
    return new Set([...css.slice(s, e).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  };
  const dark = blockVars(':root,');
  const light = blockVars('[data-theme="light"]');
  if (dark && light) {
    const onlyDark = [...dark].filter(v => !light.has(v));
    const onlyLight = [...light].filter(v => !dark.has(v));
    if (onlyDark.length) fail('vars missing from the light theme: ' + onlyDark.join(', '));
    if (onlyLight.length) fail('vars missing from the dark theme: ' + onlyLight.join(', '));
    if (!onlyDark.length && !onlyLight.length) ok('both themes define the same ' + dark.size + ' vars');
  }
}
for (const f of htmlFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  const m = src.match(/<style>([\s\S]*?)<\/style>/);
  if (m) checkCss(f + ' <style>', m[1]);
}
// Line endings. .gitattributes pins `* -text`, so a checkout must byte-match
// the commit and the release zip is reproducible from a tag. Two ways that
// breaks: a file ends up with mixed endings, or a whole file silently flips
// style and buries a one-line change under a few hundred phantom ones.
const eolStyle = s => {
  const crlf = (s.match(/\r\n/g) || []).length;
  const bare = (s.match(/(?<!\r)\n/g) || []).length;
  return (crlf && bare) ? 'MIXED' : crlf ? 'CRLF' : bare ? 'LF' : 'none';
};
for (const f of [...htmlFiles, 'popup.css', 'background.js', 'popup.js']) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  if (eolStyle(raw) === 'MIXED') fail(f + ' has mixed line endings');
}
// Compare against what is committed. No-ops on a clean CI checkout; the point
// is catching it locally before the diff is made.
try {
  const { execSync } = require('child_process');
  const changed = execSync('git diff --name-only', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    .trim().split('\n').filter(Boolean);
  const flipped = [];
  for (const f of changed) {
    let head;
    try { head = execSync('git show HEAD:' + f, { cwd: root, encoding: 'buffer', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'ignore'] }).toString(); }
    catch { continue; }
    const now = fs.readFileSync(path.join(root, f), 'utf8');
    const a = eolStyle(head), b = eolStyle(now);
    if (a !== b) flipped.push(f + ' (' + a + ' -> ' + b + ')');
  }
  if (flipped.length) fail('line-ending style changed vs the commit: ' + flipped.join(', '));
  else if (changed.length) ok(changed.length + ' modified files kept their committed line endings');
} catch {}

/* icons: a name that is not in the map renders as blank space, silently */

console.log('\nicons');
const iconsSrc = read('icons.js');
const iconNames = new Set([...iconsSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*'/gm)].map(m => m[1]));
const usedIcons = new Map();
for (const f of htmlFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const m of src.matchAll(/data-icon\s*=\s*"([^"]+)"/g)) usedIcons.set(m[1], f);
}
for (const f of jsFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const m of src.matchAll(/\bicon\(\s*'([A-Za-z0-9_]+)'/g)) usedIcons.set(m[1], f);
  for (const m of src.matchAll(/\bicon:\s*'([A-Za-z0-9_]+)'/g)) usedIcons.set(m[1], f);
}
let badIcons = 0;
for (const [name, where] of usedIcons) {
  if (!iconNames.has(name)) { fail(where + ' uses icon "' + name + '" which is not in icons.js'); badIcons++; }
}
if (!badIcons) ok(usedIcons.size + ' icon references all resolve (' + iconNames.size + ' defined)');

/* packaging: everything referenced must exist and must ship */

console.log('\npackaging');
const pkg = read('scripts/package.sh');
// the zip line lists the shipped paths; take everything between `zip -qr "$OUT"` and the blank line
const zipBlock = pkg.split(/zip -qr "\$OUT"/)[1] || '';
const shipped = new Set(
  zipBlock.split('\n\n')[0]
    .split(/\s+/)
    .map(s => s.replace(/\\$/, '').trim())
    .filter(s => s && !s.startsWith('$') && s !== '\\')
);

// every local asset referenced from the manifest or the HTML must exist on disk
const refs = new Set();
for (const p of Object.values(manifest.icons || {})) refs.add(p);
for (const p of Object.values((manifest.action || {}).default_icon || {})) refs.add(p);
if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
if (manifest.action && manifest.action.default_popup) refs.add(manifest.action.default_popup);
if (manifest.side_panel && manifest.side_panel.default_path) refs.add(manifest.side_panel.default_path);
for (const f of htmlFiles) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const m of src.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(v)) continue;
    refs.add(v.split(/[?#]/)[0]);
  }
}
// content script injected programmatically, not declared in the manifest
refs.add('formcheck.js');

let missingFiles = 0, unshipped = 0;
for (const r of [...refs].sort()) {
  if (!fs.existsSync(path.join(root, r))) { fail('referenced but missing on disk: ' + r); missingFiles++; continue; }
  const top = r.split('/')[0];
  if (!shipped.has(r) && !shipped.has(top)) { fail('referenced but NOT in scripts/package.sh: ' + r); unshipped++; }
}
if (!missingFiles && !unshipped) ok(refs.size + ' referenced assets all exist and are packaged');

// and nothing listed for packaging should be absent
for (const s of shipped) {
  if (!fs.existsSync(path.join(root, s))) fail('scripts/package.sh lists a path that does not exist: ' + s);
}

console.log('\n' + (errors ? errors + ' error(s), ' : 'no errors, ') + warnings + ' warning(s)\n');
process.exit(errors ? 1 : 0);
