# Changelog

All notable changes to Drowzy are documented here.

## [1.5.0] - 2026-09-02

Speed fixes for people with a lot of tabs, based on a store review and a GitHub issue. The popup opens right away with many tabs open, Suspend Others runs several tabs at a time and reports what it skipped, the timer can be set to 1 minute, and the Keyboard shortcuts row points to where Chrome lets you change them. No new permissions, no telemetry, and the native `chrome.tabs.discard` approach is unchanged.

### Fixed
- **Whitelist entries saved by older versions are cleaned up once, on update.** Entries used to be stored as typed (`https://Site.com/`, `WWW.site.com`, the same site twice in different case) and 1.5.0 matches and removes by the normalised form, so `normalizeStoredWhitelist` runs in `onInstalled` for updates: it normalises each entry, drops blanks and exact duplicates, keeps anything it does not recognise as it was, and writes only if something changed.
- **Suspend Others handles several tabs at a time.** `suspendAllOthers` and the per-minute auto pass now run through a shared `suspendMany` helper with four suspends in flight at a time (`runLimited`). Every one still goes through `suspendTab`, so the active-tab rule, pinned, audio, whitelist, kept-awake, system-page and form checks, and the fresh pre-discard recheck all apply per tab exactly as before. Nothing about which tabs qualify changed.
- **A slow page can no longer stall every suspend behind it.** `chrome.scripting.executeScript` does not resolve until the page reaches `document_idle`, and the `markSuspended` message had no timeout at all, so one tab still loading behind forty others could hold the whole batch. Injection is now bounded at 1.5 s and tab messages at 0.5 s (`withTimeout`). The suspend-warning banner loop is bounded the same way.
- **Lifetime stats could lose counts under concurrent suspends.** `recordSuspension` is a read-modify-write on `storage.local`; two in flight read the same number and one increment was lost. Writes are now queued so each waits for the previous one. Sequential suspends hid this in 1.4.0; the concurrency above would have exposed it.
- **"Never suspend this site" could not undo a path-pattern entry.** On a page covered by an entry like `site.com/docs/*` the button showed "Site is whitelisted", and pressing it asked the worker to remove the bare domain, which was never in the list. The optimistic label flipped, the toast said "Removed site.com from whitelist", and the next poll flipped it back. The worker now returns the exact stored entry that covers each tab (`whitelistEntry` in `getTabList`), the popup removes that, and every whitelist toast is written from the worker's answer rather than from the intent: "already in whitelist" for a duplicate, the worker's reason on a refusal, "Failed to save" when it did not answer. The popup's private copy of the matcher is gone.
- **Whitelist entries are normalised once, in the worker.** Pasting `https://Site.com/` used to store `site.com/`, a pattern that matched only the root page; a query string or fragment was stored literally; `[::1]:3000` lost to a port-stripping regex; `*.site.com` was accepted and then never matched anything; and an internationalised domain typed as `münchen.de` never matched the punycode Chrome reports. `normalizeWhitelistEntry` now strips scheme, `www.`, query, fragment, trailing slashes, port and IPv6 brackets; the matcher reads `*.` as "this host and its subdomains" and compares hosts in punycode. Path patterns are compiled once per entry instead of once per tab per poll.
- **The whitelist reports when it hits Chrome's sync limit.** `storage.sync` caps one item at 8 KB, and a long whitelist reached it with a raw quota error in the toast. Adding now reports "The whitelist is full for Chrome sync" and leaves the stored list untouched.
- **Clipboard import is one write.** It made one sync write per site, and Chrome allows only so many a minute, so a long import stopped part way through silently. `importWhitelist` normalises the whole list and writes once, reporting how many were added and how many were unusable.
- **"Suspend this tab" checks for unsaved input before switching tabs.** With Protect tabs with forms on, the old order switched you to a neighbour first and only then refused, leaving you on another tab with no explanation (the popup closes when focus moves). The check runs before the switch now, the toast says "this tab has unsaved input", and a page that could not be checked in time is reported as still loading rather than as "needs another open tab". All form-protection paths share one `formCheckBlocks` helper.
- **Cleaner result toasts.** "Suspend this tab" says "Tab suspended" instead of "Suspended 1 tab(s)". Suspend Others reports tabs it skipped for a reason of their own ("3 tab(s) skipped") separately from tabs still loading, and no longer says "No other tabs to suspend" when there were others it deliberately left alone.
- **The welcome page no longer overstates the protections.** It said active, pinned and audio tabs "are never touched", which stopped being true when pinned and audio became switches; it now says they are protected by default. It also no longer promises an "instant" wake or that tabs are "always safe": a woken tab reloads, and what is true is that tabs stay normal Chrome tabs and survive an uninstall. Reworded in all 57 locales, fragment by fragment, so the rest of each translation is untouched.
- **The popup says "could not load" instead of "No tabs found" when the worker does not answer.** `msg()` turns an unreachable service worker into `null`, and the list used to render that as an empty result. The poll keeps retrying.
- **Suspend Others counts a tab that fell asleep by other means during the run.** If the per-minute pass or Chrome itself discarded a targeted tab before Drowzy got to it, `suspendTab` refused it as already discarded and the toast under-reported. Refused ids are now sorted into still loading, asleep after all, and refused for their own reason; the asleep ones count.
- **The side panel's resume-from-hidden refresh goes through the poll guard**, so it cannot stack on a load that was already in flight.
- **Memory figures read the right way round in right-to-left languages.** In Arabic, Hebrew, Persian and Urdu the strip and the stats card showed "GB 6.4" because the digits and the unit are separate bidi runs; the value elements are now LTR isolates, and the figure inside the suspend toasts is wrapped in a Unicode isolate. The Share Stats clipboard text is unchanged.
- **Long toasts no longer run off both sides of the popup.** The toast box was `white-space: nowrap` and centred with a transform, so any message wider than the panel was clipped at both ends; the 90-character "needs another open tab" reason from 1.4.0 already did this. It now wraps inside the panel (`width: max-content` with a `max-width`), and short toasts are unchanged.
- **With Protect tabs with forms on, a page Drowzy could not check in time is left alone instead of discarded.** Before, an injection that had not landed yet or a form check that got no answer within the timeout both fell through to a discard. Now either counts as "could not verify" and the tab is left alone: the per-minute pass retries it, and a manual run reports it as still loading if that is what it is. Pages Chrome refuses to inject into at all (store pages and the like) keep the previous behaviour. Without form protection the script only marks the title, so a slow page there does not hold anything up.

### Added
- **Live progress and an accurate result for Suspend Others.** While it runs, the button reads "Suspending... 12/47", where the count comes from Chrome's own discarded-tab count polled every 0.7 s (one request at a time), so the label can only ever show tabs that are really asleep. Tabs Chrome refused because their navigation had not committed yet are retried twice, two seconds apart. The worker now returns `{ count, total, refused, stillLoading }`, counting only Chrome-confirmed discards, and the toast appends the existing "Still loading" line when some tabs were refused for that reason. Suspend Others stays disabled while a run is in flight, including across the 5 s poll.
- **1 minute auto-suspend option.** The check alarm runs once a minute, so a tab sleeps one to two minutes after you leave it. Every protection applies as before. Existing saved timer values are untouched; `0` still means Never.
- **The Keyboard shortcuts row explains where to change the keys.** Its tooltip explains that Chrome manages the shortcuts and that Customize opens `chrome://extensions/shortcuts`, where each one can be changed or cleared. The status text's tooltip lists every command with its current key, or "Not set". Should a browser refuse to open a `chrome://` page from an extension, Customize shows the hint as a toast instead of failing silently. No custom shortcut system, no new permission.

### Changed
- **The popup appears immediately and fills in as data arrives.** `init()` used to await the theme read and all five worker messages before adding `popup-ready`, so with the worker slow the popup sat blank until the 500 ms CSS fallback and then showed everything at once. The shell now appears immediately with "Loading tabs...", the buttons are wired before data arrives, and `loadAll` renders each answer as it lands (tab list first, then the current tab and settings, then the counts, then sessions and stats). The chosen theme is mirrored in the popup's own `localStorage` (`drowzy_theme`) so the first frame is already the right theme; `chrome.storage` remains the authority and corrects the mirror if they differ.
- **The 5 s poll skips a tick while the previous load is still waiting**, so a slow worker cannot get a second full round of messages stacked on top of the first. The side panel benefits most, since it stays open.
- **A cold worker no longer holds the tab list behind the timestamp reload.** `getTabList` starts `initTimestamps()` without awaiting it (single-flight via `ensureTimestamps`, shared with the per-minute check); the list already falls back to `tab.lastAccessed`, which is the same value the reload seeds from.

### i18n
- New keys across all 57 locales: `timer1min`, `shortcutsHint`, `shortcutUnset`, `suspendedOneToast`, `skippedTabsToast`, `whitelistFull`, `changelog150Title1` to `changelog150Title5` and `changelog150Desc1` to `changelog150Desc5`. UI labels quoted inside the new strings (Suspend Others, Protect tabs with forms, Keyboard shortcuts, Settings, Customize) were filled from each locale's own existing translations so they match the buttons as that language shows them.
- `timer1min` added to the validator's identical-to-English exemption alongside the other timer keys, since "1 minute" is spelled the same in several languages.
- In-app What's New page updated to 1.5.0 (`changelog.html`): five short entries in plain language (`changelog150Title1..5`, `changelog150Desc1..5`); the technical detail stays in this file. Earlier releases are collapsed to their titles, each one sliding open on click (native `<details>`, with a short height and fade animation from `changelog.js`, skipped for users who prefer reduced motion), so the current release has the room. It opens once after this update (`SHOW_CHANGELOG_VERSIONS` lists 1.5.0 alongside 1.4.0), the way 1.4.0 did.
- `extDescription`, the manifest description Chrome shows in chrome://extensions and as the store's short summary, no longer claims "up to 80% RAM". It now reads: Puts tabs you are not using to sleep so Chrome stays fast. Light, private, no tracking, open source. Translated in all 57 locales, all under the 132-character limit.
- `changelogReleaseHeading` now takes the version as a `$VERSION$` placeholder in all 57 locales, placed where each language wants it. The page used to append the version after the words, which read backwards in Japanese, Korean, Chinese and the Indic languages ("の新機能 1.5.0").
- Every release section on the What's New page now carries the month it shipped, so the page reads as a timeline. The dates live in the markup as ISO strings and `changelog.js` formats them with `toLocaleDateString` in the reader's language, so there are no month names to translate.

### Audit
- `node --check` on every touched script; `scripts/validate.js` clean (locale parity, placeholders, dashes, i18n references, manifest `__MSG__` references, popup and side panel alignment, HTML and CSS balance, icons, packaging, line endings). No manifest permission change; `manifest.json` changed only in `version`.
- A mocked-Chrome harness exercised the worker: 48 tabs suspended with at most four discards in flight; 40 concurrent stat writes counted as 40; tabs whose navigation committed late picked up by the retry and stuck ones reported as still loading; pinned, audio, whitelisted, system and kept-awake tabs excluded from the total; typed input never discarded; slow injection and unanswered checks refused; a busy page with title marking on discarded within the timeout; the 1 minute timer sleeping only tabs idle past a minute; audio protection honoured in both positions; the auto pass leaving loading, recently used and kept-awake tabs alone.

## [1.4.0] - 2026-08-05

Control and clarity. This release comes out of uninstall feedback: the recurring theme was not that Drowzy did the wrong thing, but that it did not say what it was doing or give people a simple way to override it. No new permissions, no telemetry, and the native `chrome.tabs.discard` approach is unchanged. The 1.3.8 startup catch-up sweep is untouched.

### Fixed
- **"Protect audio tabs" now works in both directions.** The final pre-discard recheck in `suspendTab` refused *any* audible tab regardless of the setting. Because every suspend path funnels through that function, turning the protection off had no effect anywhere: auto-suspend, Suspend Others, Suspend this tab, the context menu, the keyboard shortcut, and the startup sweep all still refused background video and music tabs. The recheck now honours `settings.protectAudio`. With the setting on, behaviour is byte-for-byte what it was. This was reported directly: a user could not sleep background Twitch tabs even after unchecking the box.
- **The popup no longer hides "Suspend this tab" on audible tabs.** That gate existed only to paper over the bug above, and its own comment said so.
- **What's New, onboarding and the privacy page now follow the theme you picked.** All three only ever honoured the OS setting and ignored the popup's light/dark toggle, so switching Drowzy to light on a dark machine left them dark. 1.4.0 opens What's New automatically on update, so this would have been the first thing every user saw. The OS preference is still the default when no explicit choice has been made.
- **The Settings shortcut no longer gets yanked back.** The popup restores its scroll position after every 5-second refresh, which fought the deliberate scroll from "Open settings" if a refresh landed mid-animation.

### Added
- **"Keep this tab awake".** A per-tab, session-scoped hold for the case the whitelist is too blunt for: this tab, right now, not this site forever. While held, no Drowzy path sleeps the tab - not auto-suspend, not Suspend Others, not the context menu, not the shortcut, not the startup sweep. (Chrome's own Memory Saver is a separate system and can still discard tabs on its own; the hold is scoped to what Drowzy controls, and it survives such a discard.) The button is replaced by "Allow sleep" while the hold is on, so no visible control ever contradicts the badge. Held tabs show an "Awake" badge in the tab list.
  - Stored in `chrome.storage.session`, following the same in-flight-promise memoisation as the 1.3.8 restore and activated sets. It survives service-worker restarts and is cleared by the browser on restart, which is deliberate: a hold is a "not right now" decision, not a setting.
  - Cleared when the tab closes, and carried across the tab-id swap on `onTabReplaced`.
  - Releasing a hold restarts the idle clock, so a tab held past its threshold does not vanish the instant you allow it to sleep again.
- **Reasons instead of silence.** "Suspend this tab" is now shown disabled with an explanation rather than quietly disappearing. Two separate uninstall notes said Drowzy had no suspend button on tabs where it had in fact been hidden.
- **A shortcut to the setting that would change it.** When a tab is protected by a toggle you control (pinned, audio), the reason line offers "Open settings", which expands Settings, scrolls to that exact row and flashes it.
- **Failed suspends now say why.** Clicking suspend and getting nothing back was a recurring "not working" report. The failure path now reports the actual reason (pinned, audio, whitelisted, kept awake, still loading, unsaved form input) and falls back to an honest generic message when Chrome refuses for its own reasons. The explanation is computed only after a suspend has already failed, so it costs nothing on the happy path and can never influence whether a tab is discarded.
- **Honest framing on the memory numbers.** Around ten uninstalls cited "didn't notice a memory difference", and overclaiming was making that worse. "Lifetime RAM saved" now has its own tooltip stating plainly that it counts ~150 MB per tab ever slept and is a running total over time rather than memory free right now. No disclaimer paragraph was added to the panel; the tooltips carry it.

- **Site icons now come from Chrome's own favicon cache.** Loading a site's favicon URL directly from an extension page is a cross-origin request with no cookies, and anything sitting behind Cloudflare answers it with a challenge instead of an image - so the icon silently failed and the tab fell back to a letter circle. This affected a whole class of sites, `claude.ai` among them. Drowzy now reads Chrome's local cache instead, which works for sites that refuse us, for sleeping tabs, and for extension and system pages.
  - **This adds one permission, `favicon`.** It reads a cache already on your machine, makes no network request, is not a host permission, and Chrome shows no warning for it. It is the only way to render these icons at all; the alternative was leaving them permanently broken.
- **Favicons no longer disappear into the background.** Favicons are images, so unlike every icon Drowzy draws they cannot follow the theme: a black mark vanished on the dark panel and a white one vanished on the light panel. Nothing is drawn behind any icon. Instead each one is measured once against the current theme and left alone unless it would genuinely disappear:
  - A **monochrome mark on transparency** (GitHub's is the obvious example) is flipped to its opposite shade. Sites like these publish both a light and a dark version of the same mark and Chrome only cached one of them, so Drowzy produces the other. There is no hue to damage, so the result matches the site's own alternate asset.
  - A **coloured** icon that blends gets a thin outline tracing the glyph instead, because inverting it would change the brand colour. The threshold for "monochrome" is deliberately tight: a very dark navy still carries enough hue to invert into a warm cream, so it takes the outline.
  - Everything else, which is the large majority, is untouched. Switching theme re-measures them all.
  - This applies to every favicon in the UI - the tab list, the current-tab header and the stacked icons on saved session cards - and to both icon sources, Chrome's cache and the page-reported fallback used when the cache misses.
- **Sleeping tabs keep their favicon.** Chrome drops `tab.favIconUrl` the moment a tab is discarded, so the tab list turned into a wall of anonymous letter circles the instant you hit Suspend Others - the icons disappeared exactly when the list mattered most. Drowzy now remembers the last icon it saw for each tab and serves it back when Chrome has none. The same fallback applies to saved sessions, which previously stored no icons at all if you saved while tabs were asleep.
- **Real icons for pages that never have a favicon.** Extension pages used to show a letter taken from their random extension id, and `chrome://` pages a letter from an internal hostname. They now get a puzzle piece, a padlock, or a document icon as appropriate.
- **27 more icons** in the shared Lucide map (57 total), all `currentColor` so they follow the theme.

### Changed
- **No more bounce.** Suspend Others re-renders every row at once, and the badges scaled up from 0.8 while the stat numbers scaled to 1.08, which read as cartoony rather than responsive. Both are plain fades now, and the session-card entrance no longer uses an overshooting easing curve.
- **Stats count tabs going to sleep, not button presses.** Suspend Others followed by Wake All, in a loop, used to inflate the lifetime figures without limit - the numbers stopped meaning anything, and a large enough one overflowed the stat cards. A tab re-slept within a minute of last being counted no longer counts again; nobody legitimately wakes and re-sleeps the same tab twice inside sixty seconds, so real use is unaffected. (Spamming Suspend Others alone never inflated anything - already-discarded tabs are skipped before the counter is reached.)
- **Large numbers can no longer break the layout.** Counters compact past ten thousand (`15.4k`, `12.3M`) and the RAM figure carries on into TB instead of printing four-digit gigabytes.
- **The suspend-warning banner's button is now "Not now" (was "Keep awake").** It only ever deferred one imminent suspend by bumping the tab's idle timer; with a real open-ended hold now available under nearly the same name, the old label was actively misleading. The i18n key `keepAwakeBtn` is replaced by `bannerNotNow`.
- **What's New opens once on update to 1.4.0.** The rule is still major-bump-only; 1.4.0 is a narrow, explicitly listed exception, because a release about telling people what Drowzy is doing is worth one tab.
- **Em and en dashes removed from every locale.** The 1.3.7 pass cleaned the changelog and code comments but missed `_locales` entirely, so all 57 locales still carried them - 375 strings in total. They were not a native punctuation choice: the same dash sat in the same structural slot in every language, including Japanese, Chinese, Arabic, Hebrew and Thai, because it had been carried over from the English source. English and most locales now use a plain hyphen; Chinese and Japanese use their own comma, which is what the surrounding translations already did. This mattered beyond house style: five of the affected strings are the tab status lines this release is built around, so an English user and a German user were seeing two different styles of the same sentence.

### Internal
- New `scripts/validate.js`, and CI now runs it (plus `node --check` on every shipped file) *before* building a release zip, so a broken locale cannot reach the Web Store. It checks: all 57 locales parse; key parity and placeholder integrity against `en`; no em or en dashes in any locale; no translation left byte-identical to English; no translation far longer than English in width-constrained furniture like badges; every `data-i18n*` and i18n key reference resolves; no dead keys (a dead key costs 57 files); manifest `__MSG_*` keys; the permission list has not grown; popup and side panel element ids have not drifted; HTML tag balance; every `data-icon` and `icon()` name exists in `icons.js` (a missing one renders as blank space, silently); and every referenced asset exists on disk *and* appears in `scripts/package.sh`.
- 26 new message keys across all 57 locales. The 11 best-effort locales (Amharic, Bengali, Filipino, Gujarati, Kannada, Malayalam, Marathi, Odia, Swahili, Tamil, Telugu) use machine translations flagged for a future native-speaker pass, same as 1.3.7 and 1.3.8.

## [1.3.8] - 2026-07-02

Faster memory recovery after a browser restart, plus small clarity touches. No new permissions, no telemetry, and the native `chrome.tabs.discard` approach is unchanged.

### Added
- **"Report a bug" link** in the popup and side panel Settings section, on the same row as "What's new". It opens the public GitHub issue tracker in a new tab - reporting is always an explicit user action; nothing is ever sent automatically.
- **Memory Saver tip on the welcome page.** A fourth onboarding tip explains honestly how Drowzy relates to the browser's built-in Memory Saver: keep it on if you like it, it frees memory automatically, and Drowzy adds control on top (live list of sleeping tabs, one-click suspend, whitelist). No claim that Drowzy saves more per tab.
- **"Click to wake" tooltip on sleeping tab rows.** Clicking a sleeping row has always woken the tab, but nothing said so; sleeping rows now carry a tooltip (title attribute only - an `aria-label` would have replaced the row's accessible name and hidden the tab title from screen readers).

### Fixed
- **Restored tabs are re-suspended within about a minute of appearing, however slowly Chrome restores them.** Chrome restores large sessions progressively (deferred windows, staggered background tab loading), so tabs that appeared after the old one-shot ~30s startup pass used to sit in RAM until the full auto-suspend timer (default 15 min) caught them - the "Chrome restores my tabs, RAM spikes, Drowzy only suspends them later" report.
  - **How it works:** restore artifacts are tagged - every non-active tab present at startup, plus any tab later born in the background in Chrome's `unloaded` state (the shape only restored or reopened tabs have; user-opened background tabs start loading immediately). One guarded sweep drains the tag set: fired once by the existing ~30s `startup-suspend` alarm, then by the per-minute `check-tabs` tick until no tags remain. A session that takes ten minutes to restore is covered minute by minute with zero new alarms, and still-`unloaded` tabs are discarded before Chrome's tab loader ever loads them - the RAM spike is prevented, not recovered from.
  - **What it never touches:** tabs you have actually viewed this session (tracked from activation events in `chrome.storage.session`, which Chrome clears on restart; a time-based guard would wrongly treat late-restored tabs as "recently touched", since restore itself bumps timestamps), plus the standard exclusions - active, pinned, audio, whitelisted, and internal pages, shared via `shouldSuspend` rather than copied. Every discard goes through `suspendTab`, so form protection and the fresh pre-discard active/audible recheck apply too.
  - **Edge handling:** tabs mid-load stay tagged and retry next tick (discarding an uncommitted navigation can revert a tab to a stale URL); every other outcome untags - including before Drowzy's own discards, so a woken tab is never re-swept - and the sweep converges to a no-op. Tags accumulated while the setting is off are dropped, so toggling it on later can't mass-discard.
  - **Scope:** gated on the same **Suspend tabs on startup** setting, re-read every tick, and works even when auto-suspend is off or the timer is set to Never. The old raw 30s pass (which ignored viewed and mid-load tabs) is replaced by this sweep - same timing, stronger protections. Session-set loads are single-flight and tag writes are coalesced, so a 200-tab restore doesn't thrash `storage.session`.

### Changed
- **Store summary (`extDescription`) reworded** in `en`, `en_GB`, and `en_US`: now "Auto-suspend inactive tabs to save up to 80% RAM. Lightweight, private, no tracking, and open source." - drops the "Tabs are never lost." line and adds the open-source mention `en_GB` / `en_US` were missing. Store-listing copy only; no behavior change.

### i18n
- New keys translated across all 57 locales: `reportBug` (the Settings link), `clickToWake` (the sleeping-row tooltip), `onboardingMemorySaverTip` (the welcome-page tip), and the in-app "What's New" 1.3.8 entries (`changelog138Title1-3` / `changelog138Desc1-3`). The 11 best-effort locales (Amharic, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Tamil, Telugu, Filipino, Swahili) use machine translations flagged for a future native-speaker pass.
- In-app "What's New" page updated to 1.3.8 (`changelog.html`) so it leads with this release, above the existing 1.3.7 section. As before, the page only auto-opens on major version bumps, so updating to 1.3.8 does not pop the What's New tab.
- Removed the dead `onboardingRemapHint` key from all 57 locales (referenced nowhere since the onboarding shortcut-hint rework).

### Audit
- All 57 locale files validated: JSON validity, key parity against `en` (211 keys, no missing or extra keys), no empty values, placeholder integrity, balanced `<strong>` tags in every HTML-injected key, and no untranslated-English left in non-English locales for the new keys. `background.js`, `popup.js`, `onboarding.js`, and `changelog.js` pass `node --check`, and every `data-i18n*` / `getMessage` / dynamic (`labelKey` / `statusKey`) / manifest `__MSG__` reference resolves to a real key. The suspension changes went through two multi-agent adversarial review rounds plus independent re-verification of every fix. Permissions are unchanged from 1.3.7.

## [1.3.7] - 2026-06-07

Small, additive fix. No new permissions, and the core suspension pipeline is unchanged.

### Added
- **"Suspend this tab" button in the current-tab section** (popup and side panel). After you wake a sleeping tab to look at it, you can now put just that one tab back to sleep straight from the UI. It switches you to another open tab first, since Chrome cannot suspend the tab you are currently viewing, then suspends the one you left. The button shows only when the active tab can actually be suspended (a normal page that is not pinned, playing audio, whitelisted, or a system page) and there is another awake tab to switch to.

### Fixed
- **Could not re-suspend a single woken tab from the popup.** Waking a tab from the list activates it, and an active tab has no suspend control, so a woken tab could only be put back to sleep with the Alt+Shift+P shortcut or the right-click menu. The new button closes that loop, reusing the same proven suspend-current path as those two entry points.

### i18n
- New keys translated across all 57 locales: `suspendThisTabHint` (the button's tooltip) and the in-app "What's New" 1.3.7 entry (`changelog137Title1`, `changelog137Desc1`). The visible button label reuses the existing `ctxSuspendThis`. The 11 best-effort locales (Amharic, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Tamil, Telugu, Filipino, Swahili) use machine translations flagged for a future native-speaker pass.
- **In-app "What's New" page updated to 1.3.7** (`changelog.html`) so it leads with this release instead of 1.3.6. As before, the page only auto-opens on major version bumps, so updating to 1.3.7 does not pop the What's New tab.

### Audit
- All 57 locale files validated: JSON validity, key parity against `en` (203 keys, no missing or extra keys), no empty values, no untranslated-English left in non-English locales for the new keys, and no unexpected placeholder tokens. `background.js`, `popup.js`, and `changelog.js` pass `node --check`, and every `data-i18n*` reference in `popup.html` / `sidepanel.html` / `changelog.html` resolves to a real key. Permissions are unchanged from 1.3.6.

## [1.3.6] - 2026-05-29

Localization and polish release. No new permissions; the suspension pipeline is untouched (the only `background.js` change is rebuilding the context menus on startup).

### Fixed
- **`whitelistPlaceholder` was untranslated - and stale - in all 56 non-English locales.** Every locale showed the old English `example.com or site.com/path/*` (also missing the `full URL` hint that was added to `en`). Now localized across all 57; the `example.com` / `site.com/path/*` example tokens stay literal, only the connectors are translated.
- **Onboarding inline fallbacks still read "30 minutes" and "zero RAM"** after 1.3.5 changed the default timer and reworded the feature. Synced the static HTML to the current `en` values (`featureAutoSuspend`, `featureZeroRam`, `onboardingTimerTip`) so a failed i18n pass no longer shows stale copy.
- **Context menus didn't follow a Chrome UI-language change.** They're created once at install in the then-current language; `createContextMenus()` (which `removeAll`s then recreates and re-reads `chrome.i18n`) now also runs in `onStartup`, so a language change applies on the next launch instead of staying stale.
- **`privacyFooterText` left "open source" in Latin script mid-sentence in `ru` / `uk`** while the other Cyrillic locales had translated it. Now uses native terms (`открытый исходный код` / `відкритий вихідний код`).

### Changed
- **Review prompt reworked end to end** (`popup.js`, shared by popup + side panel). It now appears only once the install is at least 7 days old (`drowzy_stats.installDate`), at least 50 tabs have been suspended, and the UI has been opened before (`reviewPromptOpenCount` >= 2) - so never on install, never on first open, never right after an update. Buttons are now **Leave a review** / **Maybe later** / **Don't ask again**: "Maybe later" snoozes for 14 days (`reviewPromptSnoozedUntil`), while "Leave a review" and "Don't ask again" both set `reviewPromptCompleted`. No star-rating ask, no reward. A one-time migration folds the old `reviewPromptDismissCount` / `reviewPromptLastDismissed` state into the new model so prior dismissers are never re-prompted. New keys `reviewLeave`, `reviewMaybeLater`, `reviewDontAsk`; removed the now-dead `reviewYes` / `reviewNo` / `reviewLeaveTitle` / `reviewReportTitle` / `reviewDismissTitle` from all locales.

### Added
- **The 12 keys that shipped untranslated in 1.3.4/1.3.5 are now translated in all 57 locales** - they had been falling back to English everywhere: the whitelist toasts (`addedToWhitelist`, `removedFromWhitelist`, `alreadyWhitelisted`), the Keyboard Shortcuts row (`keyboardShortcuts`, `customizeShortcuts`, `shortcutsAllSet`, `shortcutsSomeUnset`), and the Share Stats text (`shareStatsHeader`, `shareStatsLineAllTime` / `Today` / `Ram` / `Since`).
- **Right-to-left layout.** `popup.js`, `onboarding.js`, and `changelog.js` set `document.documentElement.dir` for `ar` / `he` / `fa` / `ur`, and CSS mirrors the accent rail and the overlapping favicon stack. Popup, side panel, onboarding, and changelog now render correctly right-to-left.
- **Uninstall feedback page is now localized.** It's a standalone GitHub Pages page with no `chrome.i18n`, so it self-detects `navigator.language` (with region handling for `pt-BR`, `zh-CN`/`zh-TW`, `es-419`, `en-GB`, `he`) and translates the visible text inline, falling back to English. The submitted form `value`s stay English so the feedback dashboard stays consistent across languages.
- **In-app "What's New" page localized** - the section headings (`changelogReleaseHeading`), the 1.3.6 entries, and a condensed set of 1.3.5 highlights. The full technical history stays in this file.

### Polish
- Review prompt stacks the question above wrapped buttons so long languages (German, Russian, French, Portuguese) don't overflow or clip the banner; "Leave a review" uses `--gradient-primary` for readable contrast in both light and dark themes.
- 11 less-common languages (Amharic, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Tamil, Telugu, Filipino, Swahili) use best-effort machine translations for the new strings and are flagged for a future native-speaker pass.

### Audit
- **All 57 locale files validated:** JSON validity, key parity against `en` (200 keys, no missing or extra keys in any locale), placeholder integrity (every `$DOMAIN$` / `$COUNT$` / `$RAM$` / `$DATE$` / `$BOUND$` / `$TOTAL$` token present), and no empty values.
- **No English left behind:** every `data-i18n*` attribute and `chrome.i18n.getMessage` / `t(...)` call resolves to a real key, and a script-integrity scan of all keys across the non-Latin locales confirmed correct scripts, no mojibake, and no untranslated-English values.
- **Changelog auto-open** still fires only on major version bumps, so updating to 1.3.6 does not pop the What's New tab.

## [1.3.5] - 2026-05-15

### Fixed
- **Whitelist remove button replaced with a visible "Remove ×" pill** (was an icon-only X users reported missing entirely). Optimistic fade on click + `_whitelistSig` reset to defeat a race with the polling `loadAll` that could otherwise short-circuit the re-render.
- **"Never suspend this site" toggle flips optimistically** + confirmation toast (`Added X to whitelist` / `Removed X from whitelist`). New i18n keys: `addedToWhitelist`, `removedFromWhitelist`.
- **Whitelist text-input add now toasts** to match: success or `X is already in whitelist` on duplicate. New i18n key: `alreadyWhitelisted`.
- **`renderShortcutsStatus` now re-polls on each `loadAll`** so the Settings → Keyboard shortcuts row updates without a popup reopen if the user edits bindings in `chrome://extensions/shortcuts` via the Customize link. Previously it ran once at popup init only.
- **"Suspend Others" silently skipped tabs in Chrome's `loading` state.** `suspendTab`'s pre-discard recheck bailed on `fresh.status === 'loading'` for every path. SPAs like Reddit sit in `loading` indefinitely from background streaming, so the manual action did nothing on those tabs. Check is now inside `if (opts && opts.auto)` - manual paths bypass it.
- **Welcome page showed bogus shortcut hints for commands Chrome couldn't auto-bind.** `onboarding.js` now hides the `<li>` entirely for unbound commands; bound commands swap the `<kbd>` for the real `cmd.shortcut`.
- **`closeDuplicates` could close a live tab and keep a discarded shell.** Pick order is now pinned → active → live → first; the live-tab tiebreaker is new.
- **Popup whitelist toggle no-op'd on IP-literal current tabs** (`http://[::1]/`, `http://127.0.0.1:3000/`). Gate now matches `background.addWhitelist`'s accept set (IPv4 dotted-quads + `::1`).
- **`addWhitelist` skipped the `^www\.` strip on whitespace-prefixed input.** `.trim()` runs before the regex now. Read-time normalization in `getSettings` had been masking it.
- **Share Stats clipboard text was hardcoded English.** All five strings now go through `chrome.i18n.getMessage` (new `shareStats*` keys with `$COUNT$` / `$RAM$` / `$DATE$` placeholders).
- **Share Stats used hardcoded `150` instead of `MB_PER_TAB`.** Missed spot from 1.3.4's constant cleanup.

### Changed
- **Default auto-suspend timer: 30 min → 15 min.** Industry median is 10-15 min (Auto Tab Discard 10, Tab Wrangler 20, Chrome Memory Saver 2 hrs and panned for it). 30 was on the long end; 1.3.3 added the first-run quick-suspend pass specifically because users didn't notice memory savings at 30. Drowzy's protections (active/pinned/audio/forms/warning banner) let it run more aggressive than competitors. Existing users keep their setting via `chrome.storage.sync`. Updated `featureAutoSuspend` + `onboardingTimerTip` across all 57 locales (substring 30→15 inside those two keys only).
- **Windows `suggested_key` defaults rotated** to less-claimed combos: `suspend-current` `Alt+Shift+Z` → `Alt+Shift+P`, `wake-all` `Alt+Shift+W` → `Alt+Shift+O`. Old combos collided too often (Zoom, screen recorders, Office). New installers only - Chrome doesn't retry `suggested_key` for existing installs. `suspend-others` stays on `Alt+Shift+S`.

### Added
- **Whitelisted-sites label now shows a count** (`Whitelisted sites (5)`) so the list reads as bounded; it already scrolled at `max-height: 140px`.
- **Settings → "Keyboard shortcuts" row.** Shows bind status from `chrome.commands.getAll()` ("All set" or "$BOUND$ of $TOTAL$ set") and a Customize link to `chrome://extensions/shortcuts`. Persistent path to the shortcuts editor; welcome page was the only entry before and it only shows on install. New i18n keys: `keyboardShortcuts`, `customizeShortcuts`, `shortcutsAllSet`, `shortcutsSomeUnset`. Chrome has no programmatic shortcut-set API (`chrome.commands` exposes only `getAll()`), so the editor is the only path.

### Polish
- **Whitelisted badge icon: `star` → `shield`.** Star reads as bookmark/favorite; shield matches the rest of the whitelist UI (the "Never suspend this site" toggle, the empty-whitelist state, the popup button), where shield/shieldCheck already mean "protected from suspension." Gold badge color kept so the row still visually distinguishes from blue/green/amber neighbors.
- **"Today" stat icon: `moon` → `calendarDays`.** Moon is the right icon for sleeping tabs and dark-mode (both = night) but reading "today" off a crescent doesn't connect. Calendar icon makes the stat readable at a glance. Added Lucide's `calendar-days` SVG to `icons.js`.
- **`fmtRam` strips trailing `.0` for whole-GB values** ("2 GB" not "2.0 GB"). Affects stats strip, hero card, suspend toast, share text.
- **Wake-tab click from popup focuses the destination window** via `chrome.windows.update({focused: true})` so a click on a tab in another window actually takes you there.
- **Per-tab suspend button has `aria-label`** matching its `title`.
- **Toolbar action-badge color changed `#6C63FF` → `#7c3aed`** to match Drowzy's brand accent (it was a slightly-off indigo before). Also explicitly set the badge text color to white via `chrome.action.setBadgeTextColor` (feature-detected - Chrome 110+; older browsers fall back to Chrome's default auto-contrast).
- **Welcome page CTA rewritten** from *"Drowzy is already running. Open a few tabs and try it out!"* (misleading with 15-min default) to *"Drowzy is now running. Open it from your toolbar and hit 'Suspend Others' to try it out."* - points at a button that gives instant feedback. Updated `onboardingCta` in `en` / `en_US` / `en_GB` + HTML fallback; 54 translated locales keep their existing copy until translators update.
- **Popup `max-height` raised 520 → 580px** + `html { overflow: hidden }` added. Old 520 surfaced a near-useless ~20px scroll range in popups with 3+ visible tabs. 600 (Chrome's nominal max) triggered a double scrollbar on some displays because actual usable popup height is closer to 580 in practice. Sidepanel unaffected (overrides with `max-height: none`).

## [1.3.4] - 2026-05-14

Small quality update from a full audit pass: bug fixes, polish, accessibility, and one minor code-quality cleanup. No new permissions, no new strings, no schema changes.

### Fixed
- **Startup suspend pass could be skipped when the service worker died before the 5s timer fired.** `onStartup` scheduled `suspendAllOnStartup` via `setTimeout(..., 5000)`. Once `onStartup`'s awaits resolve, the service worker has no pending events keeping it alive; Chrome can terminate it after ~30s of idle, and a setTimeout doesn't count as keepalive. On a cold browser launch where the worker has no other work, the 5s deadline was usually hit, but not guaranteed. Replaced with `chrome.alarms.create('startup-suspend', { delayInMinutes: 0.1 })` which Chrome clamps to ~30s in production and survives a worker restart. The `onAlarm` handler now dispatches the `startup-suspend` alarm to `suspendAllOnStartup` (after re-fetching settings, in case the user toggled "Suspend on startup" off between the schedule and the fire).
- **`handleSuspendCurrent` fell back to `candidates[length - 1]` when no next tab existed**, which could land far from the active tab (the last candidate in the filtered list, not necessarily the previous tab). Now it explicitly looks for the closest previous tab (largest `index` below `activeTab.index`), then falls back to any candidate only if both next and previous are absent. Triggered when you suspend the active tab via `Alt+S` / context menu while it's the rightmost tab in a window.

### Changed
- **`MB_PER_TAB` is now defined once per file** rather than scattered as a magic `150` in three places in `popup.js`. The constant must stay in sync with `background.js`'s `MB_PER_TAB`; comment in `popup.js` calls this out. No user-visible change; defensive cleanup so a future tuning is a one-line edit.

### Polish
- **`prefers-reduced-motion` honored on the onboarding page.** The popup, side panel, changelog, and privacy-policy pages all already had the media query that flattens animations and transitions to 1ms; `onboarding.html` was the only page that didn't, so a user with reduced-motion enabled would still see the 0.4s fade-up of the welcome container. Added the same `* { animation-duration: 1ms !important; ... }` block to `onboarding.html`'s inline style.
- **Whitelist input HTML placeholder synced with the i18n value.** The 1.3.3 release updated `en/messages.json#whitelistPlaceholder` to `"example.com, full URL, or site.com/path/*"` but the static `placeholder=` attribute in `popup.html` and `sidepanel.html` was still `"example.com or site.com/path/*"`. Localization overwrites it at popup-open, so users normally see the new wording, but a failed i18n pass (extension reload race, unusual locale) would leave the old text visible. HTML defaults now match en exactly.

### Audit
- **Full read-through of all source files.** `background.js`, `popup.js`/`html`/`css`, `sidepanel.html`, `formcheck.js`, `icons.js`, `onboarding.html`/`js`, `changelog.html`/`js`, `privacy-policy.html`/`js`. No additional bugs found beyond the two fixed above; the 1.3.2 / 1.3.3 polish work held up.
- **All 57 locale files validated** for JSON validity, key parity against `en` (175 keys, no missing/extra in any locale), and placeholder structure (every `$COUNT$` / `$RAM$` / `$VERSION$` / `$DATE$` substitution token present in `en` is also present in the corresponding translated value). No locale repairs needed.
- **i18n key reference scan** confirms every `data-i18n*` attribute and `chrome.i18n.getMessage` / `t(...)` call resolves to a real key, and every key in `en/messages.json` is reachable from source (including the dynamic ones referenced via variable interpolation: `t(statusKey)` for the current-tab status and `BADGES[reason].labelKey` for the protect-reason badges).
- **Chrome MV3 best practices verified** for the suspend pipeline: `chrome.tabs.discard()` remains the canonical API; `tab.lastAccessed` (Chrome 121+) is feature-detected with `typeof === 'number'` and gracefully falls back on 120; `chrome.storage.session` correctly used for the in-memory `tabTimestamps` cache that survives worker restarts via re-seeding from `tab.lastAccessed`; `chrome.alarms` minimum delay (0.5 min in production) respected. The known quirk that `tab.lastAccessed` becomes `undefined` for discarded tabs is handled correctly: every code path that reads it either guards with the typeof check or has already early-returned on `tab.discarded`.

## [1.3.3] - 2026-04-25

### Added
- **First-run quick-suspend pass** (`firstRunQuickSuspend` in `background.js`). 30s after install, Drowzy suspends tabs that Chrome reports as idle for 10+ minutes via `tab.lastAccessed` (Chrome 121+; skipped on 120). Without this, a fresh installer waited the full 30-minute timer before any visible effect - the most common reason cited for "didn't notice a memory difference" in uninstall feedback. Conservative threshold (10 min via Chrome's own tracking) avoids surprising a user with a recently-used tab going away. Honors all the usual protections (pinned, audio, whitelist, internal pages).
- **`tab.lastAccessed` honored in suspend decisions** (`shouldSuspend` and the final recheck inside `suspendTab`). Drowzy now takes the more recent of its own activation timestamp and Chrome's `tab.lastAccessed` (Chrome 121+) when deciding whether a tab is past the idle threshold. Fixes a class of "tab I just used got suspended" caused by service-worker restarts: when the worker came up cold, Drowzy's in-memory `_timestamps` were re-seeded to `Date.now()` for missing tabs, but `tab.lastAccessed` had the truer "last focused" timestamp. Feature-detected so 120 still works.
- **"Keep awake" button on the suspend warning banner** (`formcheck.js`). The banner used to be a click-to-dismiss strip with no way to actually stop the imminent discard - the only recourse was to whitelist the site after the fact. The banner now has an explicit "Keep awake" button that sends a `keepTabAwake` message to the background; the background bumps the tab's timestamp via `touchTab` and `suspendTab`'s pre-discard recheck reads the bumped timestamp and bails out. New i18n key: `keepAwakeBtn`.
- **`keepTabAwake` action allowed from content-script senders** in `background.js#onMessage`. The unauthorized-content-script guard still blocks every other action, but `keepTabAwake` is whitelisted because the suspend-warning banner runs in page context. Scoped to the sender's own tab id so a content script can't bump arbitrary tabs.
- **Pre-discard timestamp recheck inside `suspendTab`.** After the form-check + message round-trips, before calling `chrome.tabs.discard`, the function now re-reads `_timestamps[tabId]` and `tab.lastAccessed` and aborts if either is now within the threshold. Closes the race where the user hits Keep awake during the 2500ms warning window or refocuses the tab via a different code path.
- **Suspend-timer hint tooltip** on the Settings row (`data-i18n-title="suspendTimerHint"` in `popup.html` and `sidepanel.html`). New users with workflows where they come back to a tab every ~35 min had no hint that 30 was tunable; the tooltip points them at it. New i18n key: `suspendTimerHint`.
- **Two new onboarding tip cards** addressing the actual top uninstall reasons: "Suspending tabs you still want?" points at the timer + whitelist as fixes for over-aggressive suspends, and "Filling out a form?" points at the `protectForms` setting. Both ship as `data-i18n-html` so the embedded `<strong>` survives translation. New i18n keys: `onboardingTimerTip`, `onboardingFormsTip`.
- **Windows-specific keyboard shortcut defaults** to avoid Microsoft Office Web access-key collisions:
  - `suspend-current` on Windows is now `Alt+Shift+Z` (was `Alt+S`). On Windows, `Alt+S` is the access key for **Send** in Outlook Web, Teams, OWA, and most Microsoft 365 surfaces. A user composing an email who hit `Alt+S` to send would instead suspend the compose tab - silently, with potential draft loss. macOS/Linux/ChromeOS keep `Alt+S` since those platforms don't have the conflict (Mac Outlook uses `Cmd+Enter`).
  - `wake-all` on Windows is now `Alt+Shift+W` (was `Alt+W`). `Alt+W` is the access key for the **View ribbon** in Word, Excel, and PowerPoint Web. Same per-platform override pattern.
  - `suspend-others` stays at `Alt+Shift+S` everywhere - no known conflict.
  - Existing users who customized their shortcuts via `chrome://extensions/shortcuts` are unaffected; only new installs and unmodified bindings pick up the new defaults.
- **Dynamic shortcut display in the onboarding page.** The `Press <kbd>Alt+S</kbd> ...` lines now query `chrome.commands.getAll()` after i18n localization runs and replace each `<kbd>`'s text with the user's actual binding - so Windows users see `Alt+Shift+Z` / `Alt+Shift+W` and any user remap is reflected without re-translating 57 locale files. If a command is unbound, the translated default is left alone.
- **Forecast stat in the stats strip - adaptive third slot.** The third memory slot now adapts based on state to keep the strip at three items (a fourth would feel cramped). When Drowzy has actually freed memory, it shows that ("saved", blue dot, `ramEstimateTooltip`). Before any tabs have been suspended but eligible tabs exist, it shows the forecast instead ("available", amber dot, `ramForecastTooltip`) - e.g. `~3.4 GB available`. First-session users no longer see " - saved" with no signal anything will happen; they see a real number immediately, addressing the most common uninstall reason ("didn't notice a memory difference"). When neither applies, the slot shows an em-dash with the default "saved" label. Computed in `getStatus` as `(allTabs - protected - discarded) × MB_PER_TAB` and exposed as `eligibleCount` + `estimatedMbForecast`.
- **`statForecast` and `ramForecastTooltip` i18n keys** in `en/messages.json` for the new strip item label and tooltip.
- **Quantified toast feedback for Suspend Others and Wake All.** Pre-1.3.3 the buttons flashed `Suspending... → Done → Suspend Others` regardless of whether anything actually happened - a window with zero eligible tabs would still show "Done" and the user would close the popup confused. Now: `suspendAllOthers` and `unsuspendAll` both return their actual count, the popup handlers show `"Suspended N tab(s) · ~M MB freed"` / `"Woke N tab(s)"` toasts on success, and `"No other tabs to suspend"` / `"No suspended tabs to wake"` toasts when the action would have been a no-op. Removed the now-redundant `Done` text-flip and the 400ms timeout since the toast carries the confirmation. New i18n keys: `suspendedToast`, `wokeToast`, `noOthersToSuspend`, `noSuspendedToWake`.
- **Smarter current-tab status line.** The status under the active tab's domain (e.g. `"Active - won't be suspended"`) used to be hardcoded regardless of why the tab was protected. Now picks the actual reason in priority order: `systemPageCantSuspend` for `chrome://` and other non-http schemes, `pinnedWontSuspend` when the user has Protect Pinned on and the tab is pinned, `audioWontSuspend` when Protect Audio is on and the tab is audible, `whitelistedWontSuspend` when the tab's host matches the whitelist, falling back to the existing `activeWontSuspend`. The whitelist button below already updated correctly; only the status text was stale. New i18n keys: `pinnedWontSuspend`, `audioWontSuspend`, `whitelistedWontSuspend`, `systemPageCantSuspend`.
- **Onboarding now includes a pin-to-toolbar tip and a one-click link to remap shortcuts.** Two of the most common first-hour confusions: "where is the icon?" and "I don't like the default keys." A subtle accent-bordered tip card sits above the CTA with a tip about pinning Drowzy via the puzzle icon, plus a link that opens `chrome://extensions/shortcuts` directly (`<a href="chrome://...">` is blocked from regular pages, so the click handler uses `chrome.tabs.create`). New i18n keys: `onboardingPinTip`, `onboardingRemapHint`.

### Changed
- **Strip-stat dot color** for the third slot stays blue (`:last-child`) by default for "saved", and is overridden to amber (`.strip-stat.strip-stat-forecast`) when the slot is rendering the forecast instead. JS toggles the class as the slot's mode flips between saved/forecast/empty.
- **Suspend Others and Wake All buttons disable themselves when there's nothing to act on.** `renderStatsStrip` now flips `btn.disabled` based on `status.eligibleCount` / `status.suspendedCount` and sets a `title` tooltip explaining why (`noOthersToSuspend` / `noSuspendedToWake`). The existing `.btn:disabled { opacity: 0.5 }` rule already handled the visuals - no CSS change needed. The click handlers also short-circuit on `this.disabled` as belt-and-braces.
- **Whitelist input placeholder** updated from `"example.com or site.com/path/*"` to `"example.com, full URL, or site.com/path/*"`. The popup's `addFromInput` already strips `http(s)://` and `www.` so users can paste full URLs directly, but the old placeholder didn't say so - users would manually trim URLs first. The 56 non-English locale translations of `whitelistPlaceholder` still say the old wording; semantically equivalent so they stay valid until the next translation pass.

### Fixed
- **Stale-init of `_timestamps` could give every tab a fresh 30-min timer after a service-worker restart.** Caught in the pre-publish audit. When the worker came up cold and `_timestamps` was empty (browser restart, session-storage cleared, or first install), both `initTimestamps` and the lazy-reload branch in `checkAndSuspendTabs` seeded missing entries with `Date.now()` - so a tab Chrome itself reported as last-accessed 45 minutes ago still got `lastActive = NOW`, and the new `tab.lastAccessed`-aware `shouldSuspend` couldn't help because it took the *max* of the two (NOW vs. 45m-ago = NOW). Fix: seed missing entries from `tab.lastAccessed` when Chrome 121+ reports it, falling back to `Date.now()` only on Chrome 120. Now a service-worker restart recovers the actual idle time instead of resetting it. Same fix applied to the lazy-init in `checkAndSuspendTabs` and the timer countdown in `getTabList` so the popup's "Xm" badge matches the actual eligibility check.
- **Forecast strip-stat had no visual differentiation from "saved".** The 1.3.3 changelog claimed an amber dot for the third slot when rendering the forecast (vs blue for actual saved memory), but neither `popup.css` nor `popup.js` actually toggled the class - both states rendered with the identical blue dot, so a user reading "~3.4 GB available" had no visual cue that this was a forecast and not a number Drowzy had actually freed. Fixed in three places: `popup.js#renderStatsStrip` now adds/removes `strip-stat-forecast` on the slot, and `popup.css` now has `.strip-stat.strip-stat-forecast .strip-stat-label::before` (amber dot) and `.strip-stat.strip-stat-forecast #statMemoryValue` (amber value color) overrides. The blue stays for `:last-child` by default, so saved still reads as saved. Color transitions added on `.strip-stat-value` and `.strip-stat-label::before` so the saved↔forecast flip animates smoothly instead of snapping.
- **Suspend warning banner ran on hidden tabs** - pure theater, since the banner was being painted onto a tab the user definitionally wasn't looking at (it had been idle for 30 minutes). `formcheck.js#showSuspendWarning` now early-returns if `document.visibilityState !== 'visible'`, so the banner only renders when there's a chance of being seen and the "Keep awake" button is reachable.
- **Form-data check missed several common input types.** `hasUnsavedFormData` queried only `text/email/url/tel/password/number/no-type/textarea/contenteditable` - a search input on a long query, a date picker mid-fill, or a `time`/`week`/`month`/`datetime-local`/`color` field would all read clean and the tab would get discarded. Query expanded to cover those types. Also added a separate scan for `input[type="checkbox"]` and `input[type="radio"]` whose `checked` differs from `defaultChecked`, since a half-toggled settings page is just as lost as a typed-but-unsaved input.
- **`currentTabStatus` initial text** was the literal string `"Loading..."` (via `data-i18n="loading"`) which would stick on screen if `loadAll` threw before the first `renderCurrentTab` ran - the user would see a tab marked "Loading..." indefinitely with no way to know what was wrong. Replaced with an em-dash (matching the `currentTabDomain` initial state). Same change in both `popup.html` and `sidepanel.html`.
- **Suspend-warning banner "Click to dismiss" tooltip** in `formcheck.js` was hardcoded English; only the banner body text was localized. Wired up via the new `clickToDismiss` i18n key with English fallback for unknown locales.

### Translations
- **Full localization parity across all 57 locales for all 20 new keys** added in this release (16 from the initial 1.3.3 work + 4 from the pre-publish audit pass: `keepAwakeBtn`, `suspendTimerHint`, `onboardingTimerTip`, `onboardingFormsTip`). 56 locales × 20 keys = 1120 fresh translations. Every locale now has all 175 keys; no English fallback gaps anywhere in the popup, side panel, onboarding, or content scripts. Same approach as the 1.3.2 parity sweep - AI-authored translations preserving the `$COUNT$` / `$RAM$` placeholder structure where applicable and the `<strong>` wrappers in onboarding tips, with native-speaker review welcomed for any awkward phrasing. The `whitelistPlaceholder` rewording is the one exception held back: existing locale translations of the old wording remain semantically valid so they stay until the next translation pass.

### Final QA pass
- **`changelog.html` body content rewritten for 1.3.3.** The page was still showing the v1.3.2 "Polish & Fixes" cards verbatim, but the dynamic version badge and the "What's new vX" link in Settings would render `v1.3.3` - so a user clicking the link would see a header that says 1.3.3 paired with v1.3.2 changes. Replaced with six v1.3.3-specific cards (forecast stat, Windows-friendly shortcuts, quantified suspend/wake toasts, smart current-tab status, friendlier first-run tips, full translation coverage).
- **Dead `done` i18n key removed from all 57 locale files.** It was used by the old text-flip pattern on Suspend Others / Wake All (`Suspending... → Done → Suspend Others`); the toast refactor in this release removed every reference. 57 stale entries dropped.
- **Three review-prompt button `title=` tooltips localized.** The visible button text (`reviewYes`, `reviewNo`) was already i18n'd, but the hover tooltips on the thumbs-up, thumbs-down, and dismiss buttons in `popup.html` / `sidepanel.html` were hardcoded English. Added `data-i18n-title` bindings + three new keys (`reviewLeaveTitle`, `reviewReportTitle`, `reviewDismissTitle`) translated across all 56 non-English locales (168 strings). Low-frequency UI (only shown after 50+ suspensions) but rounds out the parity story.

## [1.3.2] - 2026-04-24

### Added
- **`data-i18n-aria` attribute support** in `localizeHtml` so any HTML element carrying `data-i18n-aria="key"` has its `aria-label` populated from `_locales` at init time
- **`ramEstimateTooltip`** i18n key (was referenced from `popup.html` / `sidepanel.html` but never defined; users previously always saw the hardcoded English fallback)
- **i18n hooks on the privacy policy "Your data" section and footer** (`privacyYourDataTitle`, `privacyYourDataText`, `privacyFooterText`, `privacyFooterLink`). Those blocks were added in 1.3.1 as hardcoded English and skipped the existing `data-i18n` pass on the rest of the page

### Changed
- **Sessions section overhaul.**
  - Delete confirm UX no longer uses the awkward red "Sure?" text. The trash icon now morphs into a check mark with a red filled background and a soft pulsing halo; clicking the check confirms, auto-reverts after 3s.
  - Newly saved sessions slide in from above with a brief tinted highlight and a subtle scale bounce - only the new card animates, not every existing one.
  - Deleting a session plays a short slide-out + collapse animation before the row disappears, instead of snapping out.
  - Action buttons (Open / Replace / Trash) sit at 70% opacity at rest and go to 100% on hover - they're visible without hovering now, so users on touch/no-hover devices can find them.
  - Removed the redundant inline "Session saved!" feedback below the input on success - the toast already confirms it. Errors still inline for visibility.
  - Added new i18n key `confirmDeleteTitle` ("Click again to confirm delete") translated into all 57 locales for the trash button's tooltip in confirming state.
  - Removed the now-dead `confirm` ("Sure?") i18n key from all 57 locales.
  - Added a `check` icon to `icons.js` for the confirm state.
- **Changelog now only opens on major version bumps** (e.g. `1.x.x → 2.x.x`). Previously it also opened on minor bumps (`1.2.x → 1.3.x`). The "What's new" link in Settings still takes you to the changelog anytime.
- **Changelog page content** reframed as a short "Polish & Fixes" section for 1.3.2; previously showed v1.3.1-specific items verbatim
- **Sleeping-tab text contrast** bumped from `opacity: 0.45` to `0.55` in light mode so suspended titles clear WCAG AA (they scraped the bottom before); dark mode unchanged
- **Whitelist list** now caps at `max-height: 140px` with internal scroll - a long whitelist no longer stretches the Settings panel
- **`whatsNewBtn` text** now uses the `whatsNew` i18n key (matching the 1.3.1 intent), not `changelogWhatsNew` - those keys are distinct and had different capitalization
- **Locale files pretty-printed** via `json.dump(indent=2)` for formatting consistency across all 57 locales (non-en locales were already pretty-printed; `en` now matches)

### Fixed
- **Tab list recovers from transient load errors.** The `catch` branch in `popup.js#loadAll` replaced the `#tabList` DOM but didn't reset `_tabListSig`. If the next poll returned the same tabs, the signature-dedupe guard would short-circuit the re-render and leave the "Failed to load" state stuck on screen. `_tabListSig` is now reset to `''` in the catch path.
- **Icon-only toolbar buttons now expose accessible names.** `#btnCloseDuplicates`, `#btnSearchToggle`, and `#btnExportTabs` in both `popup.html` and `sidepanel.html` only carried a `title` attribute; added explicit `aria-label` (plus `data-i18n-aria` so it localizes) so screen readers announce them reliably.
- **Locale cleanup backport.** The 1.3.1 release stripped 23 orphaned keys from `en/messages.json` only. The other 56 locales still shipped with the dead `changelogA11y*`, `changelogAnimations*`, `changelogBugFixes`, `changelogChangelog*`, `changelogFormCheck*`, `changelogLiveStats*`, `changelogReviewPrompt*`, `changelogSessionOptions*`, `changelogSessionRestore*`, `changelogWhitelistDupes*`, `changelogWhitelistVal*`, `failedToSuspend`, and `suspendThis` keys. Cleaned in this release.
- **Two more dead i18n keys removed** from every locale: `statRamSaved` (replaced by `statLifetimeRam` in 1.3.1) and `privacyShortTitle` (the privacy policy no longer uses a separate heading for the TL;DR block). Plus `changelogNewFeatures` and `changelogImprovements` which aren't referenced by the simplified 1.3.2 changelog page.
- **`faviconFallback` hostname regex** hardened from `.replace('www.', '')` (unanchored literal, technically could match `www.` mid-hostname) to `.replace(/^www\./, '')`
- **`tabListSignature` variable-shadow cleanup** - inner `var t = tabs[i]` was shadowing the outer `t()` i18n helper inside the same function's scope; renamed to `tab` for clarity. No behavior change, lint hygiene.
- **Safety guard in changelog-open branch:** if `drowzy_lastChangelogVersion` is unexpectedly empty on an `update` event (shouldn't happen but belt-and-suspenders), we now silently update the stored version instead of comparing against an empty string and opening the tab.
- **Share-stats URL uses canonical slug.** The "Share" button in Stats was copying `https://chromewebstore.google.com/detail/drowzy/oijfnkaakdamnijjgehjpfmclhigmapa` - Chrome Web Store redirects that to the real listing, but fixed to use the canonical `drowzy-tab-suspender-memo` slug so the pasted link doesn't look like an unrelated shortener.
- **Whitelist input clears its error state on success.** If the user tried an invalid domain (red border + toast), then within 1.5s tried a valid domain, the red border lingered until the original fade-timer fired even though the add had succeeded. The success path now explicitly removes `.input-error`.
- **`docs/privacy-policy.html` re-synced** with the in-extension copy. The "Your data" section and footer were missing the `data-i18n` hooks added to the extension's `privacy-policy.html`; the GitHub Pages mirror is now byte-identical to the extension copy.
- **"What's new" link showed double version (`v1.3.1 v1.3.2`) in non-English locales.** 56 of 57 locales had the previous version baked into the translated string (e.g. `de` was `"Neu in v1.3.1"`), and `popup.js` was appending ` v$CURRENT$` on top - producing concatenations like `"Neu in v1.3.1 v1.3.2"`. Fixed by switching `whatsNew` to a `$VERSION$` chrome.i18n placeholder so each locale puts the version in the correct grammatical position natively, then passing the live manifest version as the substitution. Removed `data-i18n="whatsNew"` from `popup.html` / `sidepanel.html` so `localizeHtml` doesn't render the literal placeholder before `attachListeners` substitutes it.
- **Full localization parity across all 57 locales.** Twelve i18n keys (`changelogVersionLabel`, `copiedStats`, `privacyFooterLink`, `privacyFooterText`, `privacyPermHost`, `privacyPermScripting`, `privacyPermSidePanel`, `privacyYourDataText`, `privacyYourDataTitle`, `ramEstimateTooltip`, `shareStats`, `statLifetimeRam`) had been added to `en` over 1.3.1 / 1.3.2 but never translated to the other 56 locales - non-English users were silently falling back to English text on those strings. Added native translations for all 12 keys × 56 locales (672 strings). Every locale now has all 156 keys.
- **Reconciled three privacy permission strings** (`privacyPermHost`, `privacyPermScripting`, `privacyPermSidePanel`) where the `en/messages.json` value was older verbose text disagreeing with the concise text in `privacy-policy.html`'s static fallback. `localizeHtml` was overwriting the rendered text with the older copy, causing a flash of wrong content. The `en` values now match the HTML fallbacks exactly.
- **Reconciled six more privacy strings** (`privacyTitle`, `privacyPermissionsIntro`, `privacyPermTabs`, `privacyPermStorage`, `privacyPermAlarms`, `privacyPermContextMenus`) with the same drift pattern - the `en` values were stale (e.g. `"tabs - listing, suspending, and restoring browser tabs"` redundantly included the permission name and dash that's already rendered separately by the `<code>` element). Updated `en` to the HTML's concise form and re-translated all six keys across the 56 non-English locales (336 fresh translations). Caught by a deeper localization audit that compares static HTML fallback text against the corresponding `en` i18n value.

## [1.3.1] - 2026-04-19

### Added
- **Uninstall feedback page** - on uninstall, Chrome opens a Drowzy-themed feedback page hosted on GitHub Pages (`docs/uninstall.html`) asking what made the user leave, how long they used it, what OS they're on, and an optional comment + follow-up email. Submissions land in a Pageclip dashboard (1000/month free tier). After submit, the page shows a thank-you state with a "Reinstall Drowzy" button that deep-links back to the Chrome Web Store listing and a "Star on GitHub" button, so users who change their mind have a one-click path back. The page is mobile-responsive, has dark/light theme support, no analytics, and no guilt-trippy copy.
- **`chrome.runtime.setUninstallURL`** wired in `onInstalled` and `onStartup` so the uninstall page is shown every time, including after browser updates that may clear the URL.
- **Polished empty states** - the tab list, sessions list, and whitelist all now show a centered icon with the existing copy instead of bare gray text
- **Animated loading indicator** - the "Loading tabs..." placeholder shown on popup open now has a gently pulsing moon icon
- **Persistent section state** - Sessions, Stats, and Settings sections remember whether you had them open or closed between popup opens (stored locally)
- **Tab search Escape shortcut** - pressing Esc in the tab search field clears the query, closes the search, and returns focus to the search toggle button
- **Cross-window badge accuracy** - the badge refreshes when you switch between Chrome windows so the count always reflects the window you're looking at
- **Memory estimate tooltip** - the "saved" strip stat and the "Lifetime RAM saved" hero card now show a tooltip on hover explaining that the number is based on ~150 MB per suspended tab and actual savings vary by page content. Transparency about what the number means.

### Changed
- **Current-tab card no longer jitters** - the domain/favicon area was shifting every few seconds as the 5s poll re-set the favicon `src` and retriggered `onerror`; `renderCurrentTab` now signature-dedupes and only touches the DOM when url, favicon, domain, or whitelist/internal state actually change
- **Session list no longer rebuilds on every poll** - added signature dedupe; session cards only re-render when the session data actually changes, eliminating the subtle 5-second flicker
- **Whitelist list no longer rebuilds on every poll** - same treatment; remove-buttons don't get recreated between polls unless the whitelist actually changes
- **Badge clears when Chrome is unfocused** - previously fell through to counting discarded tabs across every window when no window was focused (e.g. Chrome minimized), giving a misleading cross-window count; now just clears
- **Save-session feedback timer no longer stacks** - rapid re-saves were queuing multiple clear timers, which could wipe a fresh message early
- **Stats section visuals** - hero card toned down, distinct colored left borders on section cards, cleaner strip label colors (four-commit refinement pass)
- **Permission surface reduced**
  - `tabGroups` permission dropped; session save/restore still works without it
  - Host access moved to `optional_host_permissions`; `protectForms` and `markSuspendedTabs` request `<all_urls>` on toggle and revert if denied
  - Host-gated settings reset on install/update if host permission is absent
- **Collapsible sections** animate via `grid-template-rows` so stats/settings no longer snap-scroll on open/close
- **Popup/sidepanel poll interval** raised to 5s
- **`suspendTab` hardening** - rechecks pinned/audio/whitelist status after the 2500ms warning delay so tabs whose state changed mid-warning aren't suspended
- **Paused-audio tabs get a grace period** - when a tab's audio stops (pause, mute, call ends), Drowzy treats that as activity and resets the idle timer so the tab gets the full suspend threshold before becoming eligible. Previously, pausing Spotify or ending a Meet call would immediately expose the tab to suspension (since `tab.audible` flipped to false), forcing a full page reload when you came back.
- **Session restore rollback** - replace mode now rolls back if any tab fails to create, and the cleanup wraps `chrome.tabs.remove` so a failed cleanup doesn't mask the original error
- **Tab list rendering** is now idempotent via signature diffing; skip DOM rebuild when tabs unchanged and disable re-entry animations on subsequent renders
- **Whitelist button hidden** on `chrome://`, `chrome-extension://`, and other non-http pages where it cannot function
- **Re-check `tab.active`** immediately before `chrome.tabs.discard` so the active tab can't be reloaded after form-check awaits
- **Privacy policy** wording tightened for `scripting` and host permissions to match actual behavior
- **Onboarding** "zero RAM" claim corrected
- **"What's new" link** in settings now shows the live version from `manifest.json` via a single i18n key (`whatsNew`), instead of two keys plus a hardcoded fallback
- **`changelog.html` content replaced** with v1.3.1-specific items (polished empty states, rock-steady current tab, refined stats, permission surface reduction, 22-fix pass, smarter suspension, safer session restore) so the "What's new" link no longer shows v1.3.0 features
- **Dead `changelog120*` i18n keys removed** from the English locale (18 orphaned keys) - they referenced the old v1.3.0 changelog items that no longer exist in the HTML

### Fixed

**Background script**
- `injectFormCheck` TOCTOU race: add `tabId` to set before `await`
- `handleSuspendCurrent` compares `tab.index`, not array index
- `onTabRemoved` flushes timestamps immediately instead of scheduling
- `onTabRemoved` no longer marks the timestamp store dirty (and triggers a session-storage write) when the removed tab wasn't being tracked
- `suspendTab` skips tabs still loading in the final recheck and accepts an optional `cachedSettings` param
- `suspendAllOthers` passes settings to avoid N storage reads
- `addWhitelist` accepts `localhost` and IP addresses
- `getTabList` lazily reloads timestamps after service-worker restart
- `closeDuplicates` URL normalization now lowercases the dedup key so `https://EXAMPLE.com/` and `https://example.com/` collapse correctly
- `closeDuplicates` never closes a pinned tab even if it's a duplicate, and prefers keeping pinned over active when choosing which copy to keep
- `_injectedTabs` marker now also clears when the tab starts loading again (covers manual reload / browser restore), not just on URL change
- `restoreSession` returns the number of tabs actually created, not the input count, so partial-restore toasts report real numbers
- Fresh install writes `drowzy_lastChangelogVersion` so the changelog doesn't pop on first run

**Popup**
- `loadAll` catch path null-checks the tab list element
- `relativeTime` guards for `NaN`/0/string timestamps
- `addFromInput` has a double-submit guard with disabled state
- Whitelist toggle accepts `localhost`
- RAM display drops the stray `~` prefix
- `formcheck.js` message handler guards against cross-extension senders
- Session cards defensive-guard against missing `tabs` array or `name` field (no more crash on corrupted storage)
- Section state restoration now runs synchronously before the first async operation in `init()`, preventing a visible closed-to-open animation on popup open

**Misc**
- `icon()` trailing space in class attribute
- Removed spurious `src=""` from favicon `<img>` that triggered an empty request
- Removed no-op `backdrop-filter` on the opaque toast background
- `toggleTheme` null-guards `#themeToggle`
- Dead `badgeStarred` i18n key removed from all locale files

## [1.3.0] - 2026-04-13

### Added
- **Close duplicate tabs** - one-click button to find and close duplicate tabs in the current window (keeps the first occurrence)
- **Tab search** - search and filter your tab list by title or URL
- **Dark / light theme** - toggle between themes with the button in the header; preference is saved across sessions
- **Side panel** - open Drowzy in Chrome's side panel for a persistent, full-height view
- **Mark suspended tabs** - optional `[zzz]` prefix on suspended tab titles so you can spot them in the tab bar
- **Export tab list** - copy all tab titles and URLs to clipboard with one click
- **Export sessions as JSON** - copy all saved sessions for backup or transfer
- **Suspend warning** - tabs show a brief "Suspending tab soon..." notice before being auto-suspended
- **Whitelist import/export** - copy your whitelist for backup or paste one from another machine
- **Session replace mode** - replace current window's tabs with a saved session
- **`sidePanel` permission** - enables Chrome side panel integration
- **`optional_host_permissions`** - host access for form detection is now optional and requested only when you enable the feature (avoids broad install-time permission prompt)
- **`scripting` permission** - programmatic content script injection for form checking (replaces static content scripts)

### Removed
- **`tabGroups` permission** - tab group reconstruction on session restore is no longer supported; sessions still save and restore tabs themselves (dropped to minimize permission surface)

### Changed
- Privacy policy updated with new permissions (April 2026)
- Changelog page redesigned with feature cards and dark/light theme support
- Review prompt threshold raised from 10 to 50 suspensions
- Form check content script now injected on-demand via `chrome.scripting.executeScript` instead of running on every page
- Formcheck uses `WeakMap` snapshots for contenteditable detection
- Badge count scoped to current window instead of all windows
- Stats use local date instead of UTC for "today" tracking
- Whitelist validation requires domain to contain a dot
- Session save filters out incognito tabs to prevent privacy leaks
- Onboarding close uses `chrome.tabs.remove()` instead of `window.close()`
- All pages set `document.documentElement.lang` dynamically for accessibility
- All collapsible sections have `aria-controls` and `aria-expanded` attributes
- Light theme tertiary text darkened for WCAG AA contrast compliance
- Focus-visible outlines on form inputs (replaces `outline: none`)
- Review prompt dismiss button enlarged for easier click targets
- Minimum Chrome version: 120

### Fixed
- Whitelist import no longer silently drops domains (uses individual `addWhitelist` calls instead of bulk `updateSettings`)
- Session save no longer crashes on untitled tabs (fixed variable shadowing of i18n function)
- Protected count no longer includes suspended pinned/audio tabs
- Startup suspend now correctly records suspensions in stats
- Port-stripping regex no longer breaks path-containing whitelist entries
- `isInternalUrl` uses URL parsing instead of fragile prefix matching
- Alarm creation checks for existing alarm to avoid resetting the period
- Tab timestamps properly mark dirty flag for flush
- Duplicate detection strips URL fragments and trailing slashes
- `[zzz]` prefix cleaned up before tab reload
- Changelog only opens on major/minor version bumps, not patches
- Content script has idempotency guard against double-injection
- Message handler blocks unauthorized content script messages

## [1.2.1] - 2026-04-12

### Fixed
- Moved inline scripts to external `.js` files for Manifest V3 CSP compliance
- Removed broken "Suspend Tab" button from quick actions (redundant with keyboard shortcut)
- Fixed invalid JSON in several locale translation files
- Removed dead `suspendCurrentTab` message handler from background.js

## [1.2.0] - 2026-04-09

### Added
- **Side panel support** - Drowzy can now be opened in Chrome's side panel (`sidepanel.html`)
- **Tab group awareness** - sessions preserve tab group names and colors on restore
- **Form data protection** - content script detects unsaved form data before suspension via `chrome.scripting.executeScript`
- **`tabGroups` permission** for tab group operations
- **`scripting` permission** for programmatic content script injection

### Changed
- Content script injection switched from static `content_scripts` manifest entry to on-demand `chrome.scripting.executeScript`
- Extended popup UI with additional settings and controls

## [1.1.0] - 2026-03-17

### Added
- **57 language translations** - full i18n support; UI automatically matches browser language
- **Changelog page** (`changelog.html`) - in-extension "What's New" page shown after updates
- **Session management** - save, name, restore, and delete tab sessions
- **Stats tracking** - daily and all-time suspension counts, estimated RAM saved, member-since date
- **Whitelist management UI** - add, remove, and view whitelisted sites from the popup

### Changed
- Popup UI expanded with collapsible sections (Sessions, Stats, Settings)
- Settings panel moved into the popup (previously separate or minimal)
- Background script extended with session save/restore, stats recording, and whitelist CRUD

## [1.0.0] - 2026-02-24

### Added
- Initial release
- Auto-suspend inactive tabs using Chrome's native `chrome.tabs.discard()` API
- Configurable suspend timer (5 minutes to 4 hours, or never)
- Protect pinned tabs and audio-playing tabs from suspension
- Site whitelist with pattern matching
- Keyboard shortcuts: `Alt+S` (suspend current), `Alt+Shift+S` (suspend others), `Alt+W` (wake all)
- Right-click context menu for quick suspend actions
- Popup UI with tab list, quick actions, and settings
- Onboarding page for first-time users
- Privacy policy page
- 57 language locale files
- MIT license
