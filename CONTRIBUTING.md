# Contributing to Drowzy

Thanks for your interest in contributing. Drowzy is a small project and contributions of all sizes are welcome -- bug fixes, new features, translations, documentation, or just reporting issues.

## Getting started

1. Fork the repo and clone your fork
2. Load the extension in Chrome (see [README](README.md#development))
3. Make your changes
4. Test manually in Chrome -- there's no build step or test suite
5. Open a pull request

## Guidelines

### Code style

- Drowzy is **vanilla JavaScript** -- no frameworks, no transpilers, no build tools
- Use `let`/`const`, not `var`
- Keep functions short and focused
- Follow the existing patterns in the codebase (message passing, storage access, DOM manipulation)

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

- **One thing per PR** -- a bug fix, a feature, a refactor. Not all three
- **Test it** -- load the extension and verify your change works in both popup and side panel
- **Describe what and why** -- the PR description should explain what changed and why

### i18n

If you add user-facing strings:

1. Add the key to `_locales/en/messages.json`
2. The English value is the fallback for all languages -- non-English translations are appreciated but not required for a PR to be merged

### Things to avoid

- Adding dependencies (npm packages, build tools, frameworks)
- Large refactors without prior discussion
- Changes that break the existing storage format (users would lose their settings)

## Releasing

(For maintainers.)

1. Land all the fixes for the release as small, focused commits on `main`
2. Bump `manifest.json` version
3. Add a section to `CHANGELOG.md` describing what's in the release
4. Commit: `chore: release vX.Y.Z`
5. Tag and push:
   ```
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
6. The `.github/workflows/release.yml` action picks up the tag, builds the zip via `scripts/package.sh`, and creates the GitHub Release with the zip + SHA-256 attached
7. Upload the same zip to the Chrome Web Store

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
