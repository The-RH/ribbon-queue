# Contributing

Use Node.js 22.21.1 or newer. Run `npm ci`, `npm test`, `npm run check`, and `npm run build` before a pull request.

Keep participant data anonymous. Preserve ticket numbering, quota floors, admission idempotence, and server-side time checks. Test concurrent claims, lost-response retries, expiry boundaries, and cross-event isolation for changes to queue logic.

Do not commit private host data, passcodes, signing material, build-tool caches, real shop photographs, or deployment identifiers. Use synthetic fixtures and original/generic assets. Update the user and platform documentation when behavior changes.

Windows, Android and iOS wrappers use the same bundled frontend and independent host API. Report native build status precisely; an unsigned simulator build is not a signed iPhone release.
