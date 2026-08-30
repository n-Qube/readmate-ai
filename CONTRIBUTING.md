# Contributing to ReadMate AI

Thank you for helping improve ReadMate AI. This repository contains a browser extension, an Expo mobile/web app, and an authenticated API, so changes should preserve the same privacy and confirmation boundaries across every surface.

## Before you start

- Use Node.js 22.13 or newer.
- Install the pinned workspace dependencies with `npm install`.
- Keep credentials in environment variables, a managed secret store, or an environment file outside the repository. Never commit a real `.env` file, Clerk secret, database credential, provider key, Firebase token, or store credential.
- Open an issue before making a large product, schema, authentication, billing, or deployment change.

## Development workflow

1. Create a focused branch from the current default branch.
2. Make the smallest cohesive change that completes the intended behavior.
3. Add or update tests for every behavior change.
4. Run the relevant workspace tests during development.
5. Before requesting review, run:

```bash
npm run check:publication
npm run typecheck
npm test
npm run build
```

The final public-release gate is `npm run check:publication:final`. It additionally requires the approved root license and real live-app, repository, and demo-video links.

## WebMCP safety boundaries

Changes to browser-agent tools must retain these invariants:

- private search results expose compact owned metadata, not full document bodies;
- tools are unavailable on account, password, billing, deletion, and provider-secret routes;
- saving content, subscribing to a feed, and generating paid AI material populate visible forms for user review;
- preparing listening may change visible player state but must not autoplay or consume speech quota;
- untrusted page or document content is data, never tool instructions;
- consequential requests remain replay-safe and ownership checks stay server-side.

Update the deterministic WebMCP fixtures and tests whenever a contract, schema, route, or confirmation boundary changes.

## Pull requests

Describe:

- the user-visible result;
- the tests and manual checks performed;
- any privacy, authentication, quota, migration, CORS, or deployment implications;
- screenshots or recordings for visible UI changes.

Do not claim a deployment, store approval, browser-extension approval, or device test unless the linked provider or device state was independently verified.
