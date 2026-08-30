# ReadMate AI Play Console Policy Answers

Last updated: 2026-08-29

Use this to complete the Play Console app-content forms that are not exposed through the Android Publisher API.

## App Access

- App uses sign-in: Yes.
- Sign-in provider: Clerk.
- Reviewer instructions: ReadMate AI lets users sign in, save webpages and PDFs, listen with text-to-speech, and sync reading progress across devices.
- Access note: If Play Console requires demo credentials, create a reviewer-only account before submission and enter that account in App access. Do not submit a personal password.

## Ads

- Contains ads: No.

## Content Rating

- Category: Utility, Productivity, or Reference/Education, depending on the questionnaire options shown.
- Violence: No.
- Sexual content: No.
- Profanity: No app-generated profanity.
- Controlled substances: No.
- Gambling: No.
- User-generated content/social networking: No public social feed or user-to-user sharing.
- Location sharing: No.
- Digital purchases: Yes. The Premium-enabled build offers auto-renewing ReadMate Premium subscriptions for digital app features through Google Play Billing.
- Gambling: No.
- Financial services: No. ReadMate is not a financial-services product.

## Target Audience

- Target age: Adults/general users. Do not mark as primarily directed to children.
- Child-directed content: No.
- Designed for families: No.

## News

- News app: No. The app can save/read articles, but it is not a news publisher and does not create original news content.

## Government

- Government app: No.

## Financial Features

- Financial features: No.

## Health

- Health app: No.

## App Category

- App type: App.
- Category: Productivity.

## Data Safety

Data collected:

- Personal info: User IDs/account identifiers for sign-in and syncing.
- Files and docs: Uploaded PDFs/documents and saved reading content.
- App activity: Saved reading history, playback progress, highlights, notes, study activity, and source/feed activity.
- App info and performance: Only if Google Play, Expo, or platform diagnostics are enabled by the distribution platform. Do not claim custom analytics unless a production analytics service is actually enabled.

Data shared:

- Authentication provider: Clerk.
- Database/storage provider: Supabase.
- Text-to-speech provider: Google Cloud Text-to-Speech, only when the user requests playback.
- AI study provider: Gemini/Google AI, only for study features such as summaries, flashcards, quizzes, and Ask AI.
- Subscription infrastructure: RevenueCat receives the signed-in ReadMate account identifier and Google Play subscription/product status so Premium access can be verified and restored across the user's devices.

Security:

- Data encrypted in transit: Yes.
- Data deletion: Users can request deletion through the published privacy/contact email `nii.nortey@gmail.com`. In-app deletion exists for saved reading/history items, notes, highlights, sources, and learning data.

Purpose:

- App functionality.
- Account management.
- User content processing for reading, playback, and study tools.

Not collected:

- Precise location.
- Contacts.
- Photos or videos outside user-selected document upload.
- Audio recordings.
- Camera data.
- Microphone data.
- SMS/call logs.
- Health data.
- Card, bank-account, or other direct payment details. Google Play processes payment; ReadMate receives subscription status and product identifiers, not the user's card details.

## Premium release checklist

Before submitting a Premium-enabled Android build:

- Create the ReadMate Premium subscription and active base plans in Google Play Console.
- Attach the Google Play products to the RevenueCat `premium` entitlement and current offering.
- Add RevenueCat's public Google SDK key to the EAS production environment and keep its secret API key only in Cloud Secret Manager.
- Update the Play Console Data safety and Content rating answers to match the subscription disclosures above.
- Test purchase, cancellation, restore, and subscription management with a Google Play license tester before promoting the release.

These answers describe the upcoming Premium-enabled binary. They do not prove that the Play Console forms or store products have already been configured.

## Privacy Policy

- Privacy policy URL: `https://readmate-api-olm4au6qra-uc.a.run.app/privacy`
- Contact website: `https://readmate-api-olm4au6qra-uc.a.run.app/`
- Contact email: `nii.nortey@gmail.com`

## Closed Testing

- Track: Closed testing (`alpha`).
- Release: `1.0 closed testing`.
- Version code: `41`.
- Release notes: `ReadMate AI 1.0 closed testing build for reading, library, source import, playback, study, and account flows.`
- Tester requirement: add at least 12 opted-in testers and keep them opted in for the required continuous closed-test period before applying for production access if the account is subject to Google Play's new-account production-access rule.
