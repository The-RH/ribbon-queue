# Security

This application is a single-shop, single-process host. The native mobile apps are clients; they do not contain a shared production server, shop credentials, or other shops' data.

Implemented controls include server-authoritative schedules and quotas, atomic SQLite mutations, idempotent capacity operations, cryptographically random ticket secrets, per-event browser binding, scrypt password hashes, hashed and expiring staff sessions, Origin/Host validation, request-size limits, rate limits, CSP, image type restrictions, and a host-data write lock.

Capacity decreases cannot remove issued capacity. Admission verifies the inspected product and change count and only consumes a waiting ticket once. Expired tickets cannot be admitted, even before cleanup runs.

No names, emails, or telephone numbers are collected from queue participants. Rate-limit network identifiers are HMAC-derived and held temporarily in process memory; raw client IP addresses are not persisted by application code. Operators' proxies, platforms, and operating systems may have their own logs.

## Boundaries

- Use HTTPS for public deployments. Local HTTP is unencrypted and intended only for a trusted private network.
- Browser binding cannot establish a unique natural person; switching devices or clearing browser data can evade it.
- The app cannot determine physical queue order or count people who left. Staff must manage physical order and cancellations.
- Application limits do not replace provider-level DDoS protection.
- Keep the host computer, admin passcode, private data directory, bootstrap link, signing keys, and backups under the operator's control.
- Do not run multiple host replicas against a shared SQL.js database file.
- Client UI is bundled with native apps. They do not execute remote shop-supplied JavaScript.

For vulnerabilities, use the repository's private security reporting when enabled. Do not put live ticket secrets, passcodes, keystores, or participant data into a public issue. If private reporting is unavailable, open a minimal issue asking the maintainer for a private reporting channel without disclosing exploit details.
