<p align="center">
  <img src="icons/icon-128.png" width="96" alt="Drowzy icon">
</p>

<h1 align="center">Drowzy</h1>

<p align="center">
  <strong>The open-source tab suspender for Chrome.</strong><br>
  Auto-suspend inactive tabs. Save up to 80% memory. No tracking, no servers, no nonsense.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa">
    <img src="https://img.shields.io/chrome-web-store/v/oijfnkaakdamnijjgehjpfmclhigmapa?label=version&style=flat-square&color=7c3aed" alt="Chrome Web Store Version">
  </a>
  <a href="https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa">
    <img src="https://img.shields.io/chrome-web-store/users/oijfnkaakdamnijjgehjpfmclhigmapa?style=flat-square&color=6ee7b7" alt="Chrome Web Store Users">
  </a>
  <a href="https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa">
    <img src="https://img.shields.io/chrome-web-store/rating/oijfnkaakdamnijjgehjpfmclhigmapa?style=flat-square&color=facc15" alt="Chrome Web Store Rating">
  </a>
  <a href="https://github.com/ml3dev/drowzy/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/ml3dev/drowzy?style=flat-square&color=60a5fa" alt="MIT License">
  </a>
  <a href="https://github.com/ml3dev/drowzy/stargazers">
    <img src="https://img.shields.io/github/stars/ml3dev/drowzy?style=flat-square&color=f59e0b" alt="GitHub Stars">
  </a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/drowzy-tab-suspender-memo/oijfnkaakdamnijjgehjpfmclhigmapa">
    <img src="https://img.shields.io/badge/Install_from-Chrome_Web_Store-7c3aed?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store">
  </a>
</p>

---

## Why Drowzy?

Most tab suspenders replace your tabs with custom placeholder pages. If the extension breaks, gets removed, or Chrome updates -- your tabs are gone.

**Drowzy is different.** It uses Chrome's built-in `chrome.tabs.discard()` API, which means:

- Suspended tabs are **managed by Chrome itself** -- they survive restarts, crashes, and even uninstalling Drowzy
- Tabs keep their **full history, scroll position, and form data**
- **No custom pages**, no redirects, no `chrome-extension://` URLs in your tab bar
- Waking a tab is instant -- just click it

On top of that, Drowzy is fully open source, collects zero data, and runs entirely in your browser. No servers, no analytics, no accounts. Your tabs are yours.

## Features

### Core
- **Auto-suspend** inactive tabs after a configurable timer (5 min -- 4 hours, or manual only)
- **Smart protection** -- pinned tabs, audio-playing tabs, and tabs with unsaved form data are never suspended
- **Whitelist** sites with pattern matching and wildcards (e.g., `github.com/ml3dev/*`)
- **Keyboard shortcuts** -- `Alt+S` suspend current, `Alt+Shift+S` suspend others, `Alt+W` wake all
- **Context menu** -- right-click any page for quick suspend options

### Sessions & Organization
- **Save and restore sessions** -- bookmark your entire window state and reopen it later
- **Tab group support** -- session restore preserves tab groups with names and colors
- **Close duplicate tabs** -- one click to deduplicate your window
- **Tab search** -- filter your tab list by title or URL
- **Export** -- copy your tab list or sessions as JSON for backup

### Polish
- **Dark and light theme** -- toggle in the header, preference is saved
- **Side panel** -- pin Drowzy to Chrome's side panel for a persistent full-height view
- **57 languages** -- UI automatically matches your browser language
- **Suspend indicator** -- optional `[zzz]` prefix on suspended tab titles
- **Suspend warning** -- brief notification before a tab is auto-suspended
- **Stats dashboard** -- track how many tabs you've suspended and how much memory you've saved
- **Review prompt** -- a gentle, dismissable nudge after 50+ suspensions (never annoying, never repeated)

## How It Works

```
Tab inactive for 15 min ──> Drowzy calls chrome.tabs.discard()
                                        │
                                        ▼
                              Chrome unloads the tab
                              (0 MB RAM, tab stays in bar)
                                        │
                                        ▼
                              User clicks tab ──> Chrome reloads it
```

Drowzy runs a lightweight alarm every 60 seconds. It checks each tab's last-active timestamp and suspends any that exceed your chosen threshold. Protected tabs (pinned, audible, whitelisted, active, or containing forms) are always skipped. That's it -- no background pages, no content scripts running on every page, no idle CPU usage.

## Comparison

| | Drowzy | Marvellous Suspender | Tab Suspender Pro | Chrome Memory Saver |
|---|:---:|:---:|:---:|:---:|
| Open source | **Yes** | Yes | No | N/A |
| Native discard API | **Yes** | No | No | Yes |
| Zero tracking | **Yes** | Yes | No | Yes |
| Tab sessions | **Yes** | No | No | No |
| Tab search | **Yes** | No | No | No |
| Duplicate cleanup | **Yes** | No | No | No |
| Whitelist wildcards | **Yes** | Yes | Yes | Limited |
| Tab group restore | **Yes** | No | No | No |
| Side panel | **Yes** | No | No | No |
| Dark mode | **Yes** | No | No | N/A |
| i18n languages | **57** | 1 | 6 | Varies |
| Export/backup | **Yes** | No | No | No |
| Size | **~1.3 MB** | ~2 MB | ~1.5 MB | Built-in |
| Tabs survive uninstall | **Yes** | No | No | Yes |

## Permissions

Drowzy requests only what it needs. Nothing is sent to external servers.

| Permission | Purpose |
|---|---|
| `tabs` | List, suspend, and restore tabs |
| `storage` | Save settings, stats, and sessions locally |
| `alarms` | Periodic check for inactive tabs (every 60s) |
| `contextMenus` | Right-click menu: suspend, whitelist |
| `scripting` | Detect unsaved form data before suspending a tab |
| `sidePanel` | Display Drowzy in Chrome's side panel |
| `optional_host_permissions` | Requested only if you enable form protection or tab marking |

Full details in the [Privacy Policy](https://github.com/ml3dev/drowzy/blob/main/privacy-policy.html).

## Development

Drowzy is vanilla JavaScript -- no build tools, no dependencies, no `node_modules`. Clone and load:

```bash
git clone https://github.com/ml3dev/drowzy.git
cd drowzy
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `drowzy` folder
4. The extension icon appears in your toolbar -- you're running from source

### Project structure

```
drowzy/
  background.js       Service worker (suspension logic, storage, alarms)
  popup.html/js/css    Popup UI (tab list, sessions, settings)
  sidepanel.html       Side panel (same UI, different layout)
  formcheck.js         Content script (form detection, suspend warnings)
  icons.js             SVG icon library
  onboarding.html/js   First-run welcome page
  changelog.html/js    What's new page
  privacy-policy.html  Privacy policy
  _locales/            57 language translations
  icons/               Extension icons (16-512px)
```

### Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Verifying a release

Every version on the [Releases page](https://github.com/ml3dev/drowzy/releases) attaches the exact `.zip` uploaded to the Chrome Web Store, along with its SHA-256 hash. To verify a Web Store build hasn't been tampered with:

1. Download the published `.crx` from the Web Store (or grab the unpacked extension folder).
2. Compare its contents against the matching `drowzy-X.Y.Z.zip` on the GitHub Releases page.
3. The SHA-256 in the release notes is computed against that exact zip.

You can also reproduce the build yourself: `git checkout vX.Y.Z`, then zip the extension files (everything except `.git/`, `.github/`, `*.md`, `docs/`).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

## License

[MIT](LICENSE) -- use it, fork it, learn from it.

---
<p align="center">
  <a href="https://sellwithboost.com" target="_blank" rel="noopener noreferrer">
    <img src="https://sellwithboost.com/badge/listing.svg" alt="Listed on Sell With Boost" style="height: 40px; width: auto;" />
  </a>
</p>
<p align="center">
  <sub>Built by <a href="https://github.com/ml3dev">ml3dev</a></sub>
</p>
