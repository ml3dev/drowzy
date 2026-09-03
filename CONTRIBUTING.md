# Contributing to Drowzy

Thanks for your interest in contributing. Drowzy is a small project and contributions of all sizes are welcome - bug fixes, new features, translations, documentation, or just reporting issues.

## Getting started

1. Fork the repo and clone your fork
2. Load the extension in Chrome (see [README](README.md#development))
3. Make your changes
4. Test manually in Chrome - there's no build step or test suite
5. Open a pull request

## Guidelines

### Code style

- Drowzy is **vanilla JavaScript** - no frameworks, no transpilers, no build tools
- Match the style of the file you're editing: `background.js` leans `let`/`const`, `popup.js` and `formcheck.js` use `var` and classic functions. Consistency within a file beats consistency across the repo
- Keep functions short and focused
- Follow the existing patterns in the codebase (message passing, storage access, DOM manipulation)
- No em dashes or en dashes anywhere (code comments, docs, commit messages). Use a plain hyphen instead

## Code map

Where things live and what owns what:

| File | Owns |
|---|---|
| `background.js` | Service worker. The suspension pipeline (`checkAndSuspendTabs` -> `shouldSuspend` -> `suspendTab`), `DEFAULT_SETTINGS` and `getSettings()`, sessions (`drowzy_sessions`), stats (`drowzy_stats`), whitelist matching, context menus, keyboard commands, and the `handleMessage` dispatcher |
| `chrome.storage.session` state | Four in-memory-mirrored sets, all cleared by Chrome on browser restart: `tabTimestamps` (idle clocks), `restoredTabIds` and `activatedTabIds` (the 1.3.8 startup catch-up sweep), and `keptAwakeTabIds` ("Keep this tab awake"). Each memoizes the **in-flight promise**, not the resolved value, so concurrent callers share one Set - caching the value lets a second caller's read clobber the first's mutation. Add new per-tab session state by copying that pattern |
| `scripts/validate.js` | Pre-release checks: locale parity and placeholders, no em/en dashes in any locale, every `data-i18n*` and `t()` reference resolves, manifest `__MSG_*` keys, permission list unchanged, popup/side panel id drift, HTML tag balance, and that every referenced asset exists and is in the packaging list. Run it before opening a PR; CI runs it before building a release |
| `popup.js` / `popup.html` / `popup.css` | All popup UI. Talks to the background only through `chrome.runtime.sendMessage({ action: ... })` |
| `sidepanel.html` | The side panel shell. It loads the same `popup.js` and `popup.css`, so UI markup changes usually need the same edit in both `popup.html` and `sidepanel.html` |
| `formcheck.js` | Content script, injected on demand. Form-data detection, the suspend-warning banner, and the `[zzz]` title prefix |
| `icons.js` | Lucide SVG icon map. `icon(name, size)` returns markup; `injectIcons()` fills every `[data-icon]` element |
| `onboarding.*`, `changelog.*`, `privacy-policy.*` | Standalone extension pages |
| `_locales/` | 57 locales. `en/messages.json` is the source of truth; every other locale must have exactly the same keys |
| `scripts/package.sh` | Builds the release zip (used locally and by CI) |
| `scripts/pack.ps1` | The same zip from PowerShell on Windows, same file list |
| `.github/workflows/release.yml` | Creates the GitHub Release when a `vX.Y.Z` tag is pushed |

## Common recipes

**Adding a setting:**

1. Add the default to `DEFAULT_SETTINGS` in `background.js` (it merges over stored settings, so old installs pick it up automatically)
2. Read it wherever the behavior lives (usually inside the suspension pipeline)
3. Add the toggle row to **both** `popup.html` and `sidepanel.html`, and wire it in `popup.js` (load in `loadAll`, save on change)
4. Add the label key to `_locales/en/messages.json` and reference it with `data-i18n`

**Adding a popup action:**

1. Button in `popup.html` + `sidepanel.html` with a `data-i18n` label (and `data-icon` if it needs one)
2. Click handler in `popup.js` that sends `chrome.runtime.sendMessage({ action: 'yourAction' })`
3. A case in `handleMessage` in `background.js` that does the work and returns `{ success: ... }`

**Adding a user-facing string:** add the key to `_locales/en/messages.json` first; `en` is the fallback for every locale, so the extension works immediately. Translating it into the other 56 locales is appreciated but not required for a PR.

### Commit style

Use [conventional-commit](https://www.conventionalcommits.org) prefixes so `git log` reads cleanly:

| Prefix | Use for |
|---|---|
| `feat:` | New user-facing functionality |
| `fix:` | Bug fix |
| `docs:` | README / CHANGELOG / inline comments only |
| `refactor:` | Code change that doesn't change behavior |
| `perf:` | Performance improvement |
| `a11y:` | Accessibility |
| `i18n:` | Translation or i18n key work |
| `chore:` | Build, CI, repo metadata (`.gitignore`, workflows, etc.) |

Examples:

```
fix: suspendOthers no longer skips tabs in chrome's loading state
feat: settings row exposing keyboard-shortcut bind status
docs: clarify whitelist wildcard syntax in README
chore: bump action-badge color to brand purple
```

Keep commits small and focused. One concern per commit; the PR can have many commits if needed.

### What makes a good PR

- **One thing per PR** - a bug fix, a feature, a refactor. Not all three
- **Test it** - load the extension and verify your change works in both popup and side panel
- **Describe what and why** - the PR description should explain what changed and why

### i18n

If you add user-facing strings:

1. Add the key to `_locales/en/messages.json`
2. The English value is the fallback for all languages - non-English translations are appreciated but not required for a PR to be merged

### Things to avoid

- Adding dependencies (npm packages, build tools, frameworks)
- Large refactors without prior discussion
- Changes that break the existing storage format (users would lose their settings)

## Releasing

(For maintainers.)

1. Land all the fixes for the release as small, focused commits on `main`
2. Run `node scripts/validate.js` and fix anything it reports (CI runs it too, but finding out at tag-push time is worse)
3. Bump `manifest.json` version
4. Add a section to `CHANGELOG.md` describing what's in the release
5. Update the in-app What's New (`changelog.html`). It only auto-opens on major bumps, plus any version explicitly listed in `SHOW_CHANGELOG_VERSIONS` in `background.js` - keep that list short
6. Commit: `chore: release vX.Y.Z`
7. Tag and push:
   ```
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
8. The `.github/workflows/release.yml` action picks up the tag, builds the zip via `scripts/package.sh`, and creates the GitHub Release with the zip + SHA-256 attached
9. Upload the same zip to the Chrome Web Store

The CI-built zip and the manually-uploaded Web Store zip should byte-match. If a contributor wants to verify, they can re-run the workflow on a fork and compare hashes.

## Reporting bugs

[Open an issue](https://github.com/ml3dev/drowzy/issues/new?template=bug_report.md) with:

- What you expected to happen
- What actually happened
- Chrome version and OS
- Steps to reproduce

## Feature requests

[Open an issue](https://github.com/ml3dev/drowzy/issues/new?template=feature_request.md) and describe the use case. The more context you provide, the easier it is to evaluate.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
