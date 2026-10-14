# Live smoke tests

Signed-in checks against a Cloud Run revision. Run them on the 0%-traffic
candidate before promotion, and again on the service URL after. Each run
signs in with a Clerk sign-in ticket, deletes everything it creates and
revokes its session. Nothing secret is printed.

```bash
export CANDIDATE_URL=https://candidate-<hash>---readmate-api-olm4au6qra-uc.a.run.app
export SMOKE_EMAIL=<owner account email>
export CLERK_SECRET_KEY="$(gcloud secrets versions access latest --secret readmate-clerk-secret-key --project billbridge-c684f)"
export CLERK_PUBLISHABLE_KEY="$(grep '^EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=' apps/mobile/.env.local | cut -d= -f2-)"
node scripts/smoke/smoke.mjs         # 21 checks: settings, documents, TTS (incl. Ga/Ewe/Twi), save-url, AI study
node scripts/smoke/upload-smoke.mjs  # 12 checks: real-storage PDF upload, concurrent conversion, size enforcement
```

The AI study checks report `fallback=true` when the Gemini key hits its
free-tier quota; that is a provider limit, not a regression.
