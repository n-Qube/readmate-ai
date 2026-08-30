# ReadMate WebMCP web deployment

Status: the guarded no-cost Firebase preview is deployed from project/site `readmate-ai-9df42` under `nii.nortey@gmail.com`. The current artifact is publicly verified at <https://readmate-ai-9df42.web.app>, including `/challenge`, `/challenge-demo`, and `/challenge-feed.xml`. `app.readmate.n-qube.com` is selected and attached in Firebase, but authoritative DNS still has no record and Firebase HTTPS provisioning has therefore not started. The pinned candidate API is healthy and remains at zero production traffic.

## Hosting contract

- Export the authenticated Expo Router workspace from `apps/mobile` in `server` mode, adapt the static route output with `npm run export:web:firebase`, and deploy only through the guarded Firebase target.
- Use the selected stable HTTPS origin `https://app.readmate.n-qube.com`, separate from both the accounts origin and the Cloud Run API root. The temporary `web.app` address is only a deployment preview because the production Clerk key is restricted to the selected ReadMate domain.
- Every HTML route must return `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. The app also sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.
- Do not delegate `tools` to cross-origin frames. The public marketing/privacy site explicitly uses `tools=()`; WebMCP belongs only on the authenticated workspace.

The header contract is stored in the mobile Expo configuration. Expo writes it to `dist/server/_expo/routes.json`; `apps/mobile/scripts/validate-web-deployment.cjs` checks the source and export, and `apps/mobile/scripts/validate-firebase-hosting.cjs` proves the Firebase response configuration exactly matches it.

## Environment contract

Production web export requires:

```text
APP_VARIANT=production
WEB_APP_ORIGIN=https://<owner-approved-web-host>
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_<publishable-value>
EXPO_PUBLIC_READMATE_API_URL=https://<production-api-host>
```

Only reviewed client values may use `EXPO_PUBLIC_*`. Never put `CLERK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CRON_SECRET`, `REVENUECAT_SECRET_API_KEY`, `WEBMCP_AUDIT_DIGEST_KEY`, Gemini/Khaya/Cartesia/Google credentials, private keys, or provider tokens in Expo public variables. The export validator checks the public-variable allowlist and scans the output for backend-only access and secret-shaped values.

The API requires two separate CORS inputs:

```text
EXTENSION_ORIGIN=chrome-extension://<production-extension-id>
WEB_APP_ORIGIN=https://<owner-approved-web-host>
```

Wildcards and URL paths are not accepted. The Cloud Run candidate script passes both values only after validating their exact shapes.

Live Clerk builds deliberately disable phone/SMS OTP in both the Expo web/mobile UI and Chrome extension. Production judges can use email code, password, or configured OAuth without requiring a paid SMS feature or access to the entrant's phone. Development Clerk keys retain phone OTP only for local testing.

Live preflight verification on August 30, 2026 returned `204` with an exact matching `Access-Control-Allow-Origin` for `https://app.readmate.n-qube.com` and `chrome-extension://ghhgjioafbolldibcpbjdemcgjiccgjk`. The same request from `https://unapproved.example` returned no CORS permission. This proves the current pinned candidate configuration, not future stable traffic or final browser sign-in.

Production audit events also require the backend-only `WEBMCP_AUDIT_DIGEST_KEY`, mounted from `readmate-webmcp-audit-digest-key:latest`. Use at least 32 characters, preferably 32 random bytes encoded as base64 or hex, and keep it stable across revisions. Do not put this value in EAS or any client environment.

## Paid-action idempotency

Apply all ordered WebMCP migrations before enabling the tools: the audit table, the study-pack effect table, the audit-table account-deletion grant, and the account-deletion fence. The audit row uses a short, fenced execution lease so a dead request can be recovered. Study-pack generation also uses a separate durable effect row keyed by the signed-in user and confirmed request ID. That paid-effect row is deliberately never leased to a second worker: once quota consumption or AI generation may have started, an exact retry can only report in-progress or replay the completed document. If that worker dies, the user must confirm a new request instead of risking a duplicate quota charge or duplicate study resources.

WebMCP audit rows are operational records, not a separate retained identity archive. Strictly reverified account deletion first installs a durable fence, then removes both `WebMcpAuditEvent` and `WebMcpStudyPackEffect` rows for that Clerk user before deleting the Clerk identity. The fence retains only a one-way SHA-256 digest of the high-entropy Clerk user ID, never the raw user ID; it remains as a narrow deletion-safety marker so stale authenticated requests and cleanup retries cannot recreate WebMCP identity rows. Database write triggers acquire the same per-user transaction lock and atomically reject late audit, effect, document, source, usage, settings, and generated-study writes after the fence exists. The runtime role receives only user-scoped `DELETE`; forced RLS continues to prevent one account from deleting another account's rows.

## Local validation without deployment

1. Put the public production values and `WEB_APP_ORIGIN` in the local EAS production environment or export them in the shell. Do not copy backend secrets into the mobile environment.
2. From the repository root, run:

```bash
npm run validate:public-ui -w apps/mobile
npm run export:web:firebase
npm run test:firebase-hosting
npm run test:firebase-hosting:emulator
npm run typecheck -w apps/extension
npm test -w apps/extension
```

`npm run export:web:firebase` validates the production Expo config, performs a clean web export, checks the exported route headers, scans generated HTML/JavaScript/JSON for backend-only configuration, and creates the ignored `apps/mobile/dist/firebase-hosting` artifact. It does not deploy. The emulator test proves the clean challenge, library, and one-segment document routes plus redirects, custom 404s, and all required headers.

Build an unpacked QA extension only with `READMATE_RELEASE_BUILD=1`; the release guard requires a live Clerk key, HTTPS API, enabled Clerk UI, and non-development identity/API hosts. The committed production manifest contains only the stable API host. A temporary candidate package may add the one exact zero-traffic candidate host to the generated `dist/manifest.json`, but that QA-only host must never be committed to the production manifest or submitted to the Chrome Web Store.

Print the deterministic artifact-manifest digest before an approved deployment:

```bash
npm run hash:firebase-hosting
```

## Provider actions requiring owner approval

1. In the authoritative `n-qube.com` cPanel zone, add `CNAME app.readmate.n-qube.com -> readmate-ai-9df42.web.app`; then verify it in Firebase and wait for certificate issuance.
2. Prove `https://app.readmate.n-qube.com/challenge` and the authenticated launch over valid HTTPS.
3. Confirm the exact production origin and OAuth redirect URLs in the Clerk production instance. Confirm Google/Apple sign-in returns to the same origin.
4. The candidate already contains `_EXTENSION_ORIGIN=chrome-extension://ghhgjioafbolldibcpbjdemcgjiccgjk` and `_WEB_APP_ORIGIN=https://app.readmate.n-qube.com`. Promote its exact revision only after a separate traffic-change approval; the challenge preview can continue using the pinned candidate tag.
5. Chrome exposes local testing through `chrome://flags/#enable-webmcp-testing`. Register the final HTTPS origin for the Chrome WebMCP origin trial only if an intended Chrome channel still requires it; the ChatGPT in-app-browser challenge path does not require that token.

## Live verification gate

After provider configuration and before recording a demo:

- Confirm the final URL and certificate, then inspect the two required WebMCP response headers on the live HTML response.
- Confirm signed-out pages expose no account tools and production Clerk sign-in completes on the approved origin.
- Confirm the browser discovers only the intended signed-in ReadMate tools.
- Complete one read journey and one user-confirmed write journey, then refresh Chrome/mobile to verify the same owned record.
- Confirm an unapproved origin receives no API CORS permission and no raw API URL or backend secret appears in customer-facing UI.

Reference: [Expo server headers](https://docs.expo.dev/router/web/server-headers/), [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config), and [Chrome WebMCP security and local testing](https://developer.chrome.com/docs/ai/webmcp).
