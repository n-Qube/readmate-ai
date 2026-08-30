# ReadMate Firebase Hosting adapter

Status: dedicated no-cost Firebase project `readmate-ai-9df42` created under `nii.nortey@gmail.com`; the current validated preview is deployed and publicly verified at <https://readmate-ai-9df42.web.app>. The Firebase CLI is authorized as that account and its project listing confirms ReadMate AI as the current project. The custom domain `app.readmate.n-qube.com` is attached in Firebase with status **Needs setup**. Its required DNS record has not yet been created, and no custom-domain certificate is active.

## Purpose

The Expo web build remains in `server` output mode for the existing EAS workflow. That export is split between `apps/mobile/dist/client` assets and prerendered HTML in `apps/mobile/dist/server`, which Firebase Hosting cannot serve directly.

Run this from the repository root to make a separate, ignored Hosting directory without changing either Expo output tree:

```bash
npm run export:web:firebase
```

The command performs the existing production Expo export and validation, then creates `apps/mobile/dist/firebase-hosting` by:

- copying all `dist/client` assets at their existing public paths;
- publishing the public WebMCP Challenge landing page at `/challenge` without requiring Clerk to initialize;
- publishing the original, stable Ghana demonstration article at `/challenge-demo` for judge-account search, Twi playback, and study workflows;
- publishing a first-party Atom fixture at `/challenge-feed.xml` for deterministic RSS subscription testing;
- flattening Expo route groups so `/library`, `/history`, `/study`, and `/more` resolve with clean URLs;
- preserving the current static pages;
- staging the `/document/[id]` HTML template for the one-segment `/document/*` rewrite (nested or empty document paths remain 404s);
- copying Expo's not-found page to `404.html`, with no catch-all rewrite;
- validating file parity, route coverage, the isolated Hosting target, and all five response headers.

`apps/mobile/firebase.web.json` intentionally uses the deploy target `readmate-web` and contains no Firebase project or site ID. The root `.firebaserc` maps that target only to the dedicated `readmate-ai-9df42` site in the dedicated project. This fail-closed split prevents an unqualified deploy from falling back to another Firebase project's default Hosting site. Keep the custom config filename; do not run `firebase init` over it.

The local HTTP contract can be exercised without a real Firebase project or cloud access when `firebase-tools` is available:

```bash
npm run test:firebase-hosting:emulator
```

It uses a temporary `demo-` project and the exact `readmate-web` target. It verifies clean `/library` routing and redirects, `/document/one`, rejection of empty or nested document paths, the custom 404 status/body, and all five required response headers. The temporary emulator configuration deliberately has no `Origin-Trial` header, so ordinary local export and QA remain usable before production trial registration.

## Provider gate

The current guarded preview deployment completed on August 30, 2026 at 09:05 UTC with artifact-manifest SHA-256 `5c4e70dc5a92da9879979ff5a2715e5006e83c10c1070a579540292491210993`, superseding the earlier preview releases. Live verification proved `/challenge`, `/challenge-demo`, and `/challenge-feed.xml` return 200, the feed is served as XML, `/challenge-demo.html` redirects to `/challenge-demo`, the candidate API health endpoint returns 200, and every tested Firebase response carries the reviewed WebMCP/security headers. The broader route contract also proves `/`, `/library`, and `/document/probe` return 200 while nested document and unknown paths remain 404s. The challenge landing launches `/?challenge=1`, which bypasses only first-run consumer onboarding; an ordinary `/` visit still preserves it.

The remaining provider steps are:

1. In the authoritative cPanel DNS zone, create the Firebase-supplied record `CNAME app.readmate.n-qube.com -> readmate-ai-9df42.web.app`. Current DNS lookup returns no A or CNAME record for the hostname, so there is no existing record to replace.
2. Verify propagation from the authoritative `serverhostgroup.com` nameservers and click **Verify** in Firebase.
3. Wait for Firebase certificate provisioning, then prove `https://app.readmate.n-qube.com/challenge` and the authenticated workspace over HTTPS.
4. For the challenge, use ChatGPT's in-app browser, which supports WebMCP without an Origin Trial token. A later stable production bundle still requires the reviewed API promotion; add a token only if ReadMate also chooses Chrome's origin-trial route instead of its experimental flag.

The required mapping shape is:

```json
{
  "projects": { "readmateRelease": "readmate-ai-9df42" },
  "targets": {
    "readmate-ai-9df42": {
      "hosting": { "readmate-web": ["readmate-ai-9df42"] }
    }
  }
}
```

After the final export, print its deterministic file-manifest digest and record the exact value being approved:

```bash
npm run hash:firebase-hosting
```

Before an approved preview, QA, or production deployment, supply all release-only values. The command must run inside the reviewed production public environment (`APP_VARIANT=production`, the live Clerk publishable key, and `WEB_APP_ORIGIN=https://app.readmate.n-qube.com`):

```bash
READMATE_FIREBASE_SITE_ID=readmate-ai-9df42 \
READMATE_FIREBASE_ARTIFACT_SHA256=<approved-64-character-manifest-sha256> \
READMATE_FIREBASE_RELEASE_MODE=preview \
READMATE_EXPECTED_API_ORIGIN=<exact-approved-candidate-origin> \
EXPO_PUBLIC_READMATE_API_URL=<exact-approved-candidate-origin> \
npm run validate:firebase-hosting-release
```

`preview` mode requires one exact tagged `candidate-…---readmate-api-….a.run.app` origin and deliberately emits no `Origin-Trial` header. Clerk sign-in is not expected on the Firebase `web.app` URL because the live Clerk key is bound to `readmate.n-qube.com`; the same preview release can be evaluated through ChatGPT's in-app browser after the attached custom hostname is verified. `qa` mode exists for optional Chrome origin-trial testing with the same candidate-origin rule and requires `READMATE_WEBMCP_ORIGIN_TRIAL_TOKEN`. `production` mode requires the stable untagged API origin and the token, and rejects every tagged candidate URL. Change the release mode and both exact API-origin values when moving to production, then regenerate the export and approve its new manifest SHA-256.

The release guard refuses a missing/ambiguous/cross-project target, a default alias, any target mapping to the existing `billbridge-c684f` BillBridge site, a missing or placeholder Origin-Trial token, a mismatched artifact digest, and an Origin-Trial token embedded in `firebase.web.json`. It proves the exact API origin is in the JavaScript API client, rejects mixed/stale ReadMate origins, derives a temporary release config with exactly one `Origin-Trial` response header, re-hashes the staged copy, requires Firebase CLI `15.4.0`, and removes all temporary files afterward.

Only after a separate deployment approval, use the same complete set of release-only values with:

```bash
npm run deploy:firebase-hosting:guarded
```

That wrapper deploys only `hosting:readmate-web` to the fixed project `readmate-ai-9df42`; it does not accept project, target, or site overrides. Never put the Origin-Trial token in source control or an `EXPO_PUBLIC_*` variable.

The guard proves the token is present and safely attached to the exact staged response configuration. Token validity, registered origin/feature, expiry, and actual WebMCP activation must still be verified in a supported Chrome build after deployment; no local script invents or registers a production trial token.

The web origin remains `https://app.readmate.n-qube.com`; it is separate from the Cloud Run API origin. The backend-only `WEBMCP_AUDIT_DIGEST_KEY` must never be placed in this export or any `EXPO_PUBLIC_*` variable.

References: [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config), [Firebase multisite deploy targets](https://firebase.google.com/docs/hosting/multisites).
