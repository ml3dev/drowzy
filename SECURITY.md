# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.3.x   | Yes       |
| < 1.3   | No        |

## Reporting a vulnerability

If you find a security issue in Drowzy, please report it responsibly.

**Email:** [drowzyextension@gmail.com](mailto:drowzyextension@gmail.com)

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

I'll acknowledge your report within 48 hours and aim to release a fix within 7 days for confirmed issues.

**Please do not open a public GitHub issue for security vulnerabilities.**

## Security model

Drowzy runs entirely in your browser. It does not:

- Connect to any external server
- Collect or transmit any data
- Include any third-party scripts or analytics
- Access page content (except for form data detection before suspending)

All data (settings, sessions, stats) is stored locally using Chrome's `chrome.storage` API.
