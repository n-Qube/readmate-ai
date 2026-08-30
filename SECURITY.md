# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, leaked credential, authentication bypass, private-document exposure, unsafe WebMCP action, billing problem, or provider-secret disclosure.

Once the public GitHub repository is available, use its private vulnerability-reporting or Security Advisory flow. Include the affected surface, reproducible steps, expected and actual behavior, impact, and any safe proof-of-concept material. Do not include real user documents, session tokens, credentials, or destructive payloads.

Until that private channel is published, report the issue directly to the repository owner through an already-established private contact channel.

## Supported release

Security fixes target the current source and latest deployed ReadMate release candidate. Older mobile builds, unpacked extension packages, and archived candidates may not receive fixes.

## Scope priorities

High-priority reports include:

- cross-account document, audio, or study-data access;
- Clerk session or extension-origin bypass;
- production CORS allowing an unapproved web or extension origin;
- server-side request forgery in webpage, feed, or media ingestion;
- WebMCP tools exposed on blocked routes or performing hidden writes, playback, purchases, or quota use;
- replay or idempotency failures that repeat a consequential action;
- secrets included in client bundles, logs, artifacts, or repository history.

The repository includes automated secret and publication checks, but those checks do not replace responsible review of live DNS, HTTPS, identity-provider, API, database, browser, and store configuration.
