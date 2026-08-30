# ReadMate AI Internal Testing

Last updated: 2026-05-27

This is the current release path. Public App Store and Google Play submission are out of scope until internal testing passes.

## Current Internal Targets

- Google Play internal testing: `ReadMate AI`, package `ai.readmate.mobile`, app ID `4974877436753122587`.
- App Store Connect TestFlight: `ReadMate AI`, bundle ID `ai.readmate.mobile`, Apple app ID `6772259378`.
- Expo project: `@nii.nortey/readmate-ai`, project ID `ba97c283-2128-48b8-b42a-dc257773f59c`.

## Required Before Store Builds

Internal testers cannot use `http://localhost:8787`. The API is currently deployed on Cloud Run:

- API URL: `https://readmate-api-olm4au6qra-uc.a.run.app`
- Latest verified revision: `readmate-api-00027-78k`
- The `store-internal` EAS build profile points mobile builds at this API URL.

The backend production smoke test passed for save content, Gemini learning, review state, flashcard review, quiz attempts, trusted study UI descriptors, Ask AI, and cleanup.

## Build For Internal Store Testing

Android Google Play internal testing uses an app bundle. iOS TestFlight uses an App Store build.

Current build status:

- Android build `4c2fce3b-3606-470c-ac05-c2cd40ec178b` is queued with versionCode `11`.
- A new iOS build did not start because the Expo free-plan iOS build quota is used until June 1, 2026. EAS reported the iOS distribution certificate and provisioning profile are otherwise ready.

```bash
cd apps/mobile
npm run build:internal:android
npm run build:internal:ios
```

## Submit Builds

```bash
cd apps/mobile
npm run submit:internal:android
npm run submit:internal:ios
```

The EAS submit profile is configured for:

- Android track: `internal`
- iOS App Store Connect app ID: `6772259378`

If EAS asks for Google Play credentials, use a Google Play service account JSON with release permissions. If EAS asks for Apple credentials, use the Daniel Nortey Apple Developer team.

## Console Setup After Upload

Google Play:

- Add internal testers or a Google Group.
- Complete only the forms required to make the internal track available.
- Use `docs/store-metadata.md` for listing copy and data-safety answers if Google requires them before internal rollout.

App Store Connect:

- Add internal TestFlight testers under Users and Access, or add testers in the TestFlight tab.
- Wait for Apple build processing after upload.
- Use `docs/store-metadata.md` for beta app description and review notes if requested.

## Still Not Required For Internal-Only

- Public production release.
- Full marketing assets beyond what the consoles require for internal availability.
- External TestFlight beta review, unless you want testers outside the App Store Connect team.
