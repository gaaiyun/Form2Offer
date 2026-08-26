# Security Policy

## Supported versions

Security fixes target the latest GitHub Release and the current `main` branch.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/gaaiyun/Form2Offer/security/advisories/new). Do not disclose API keys, resumes, cookies, identity data, private ATS pages, or exploit details in a public issue.

Include the affected version, impact, minimal reproduction, and a suggested mitigation when available. Use fictional data wherever possible.

## Security boundaries

Form2Offer does not claim to protect a compromised browser profile or operating system. Local extension storage is not passphrase encrypted. File upload, CAPTCHA handling, final submission, and recruitment declarations remain user-controlled actions.

The optional Local Bridge binds only to `127.0.0.1`, validates Chrome extension origins and bearer tokens, limits request bodies, expires in-memory sessions, and resolves resume files through an exact allowlist. Do not expose its port through a reverse proxy, port forward, tunnel, or firewall rule.
