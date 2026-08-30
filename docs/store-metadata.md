# ReadMate AI Store Metadata

Last updated: 2026-08-29

Use this as the source copy for Google Play Console and App Store Connect.

## App Identity

- App name: `ReadMate AI`
- iOS bundle ID: `ai.readmate.mobile`
- Android package: `ai.readmate.mobile`
- Category: Productivity
- Download price: Free, with optional ReadMate Premium auto-renewing subscriptions
- Primary language: English (U.S.)

## Short Description

Listen to articles, PDFs, and saved reading with synced progress across devices.

## Full Description

ReadMate AI helps you turn online reading into clear, natural audio. Save articles and PDFs, listen with Google Cloud Text-to-Speech, and continue from where you stopped across desktop and mobile.

Key features:

- Listen to saved articles and uploaded PDFs.
- Continue reading progress across Chrome extension and mobile.
- Choose voice and playback speed.
- Keep a synced reading history when signed in.
- Use Google Cloud Text-to-Speech voices.
- Upgrade to ReadMate Premium for natural premium audio, larger documents, and higher listening limits.

ReadMate AI is built for students, researchers, professionals, and anyone who wants to keep up with detailed reading while commuting, studying, or multitasking.

## App Store Promotional Text

Turn saved reading into natural audio and continue across desktop and mobile.

## App Store Subtitle

Listen to articles and PDFs

## Keywords

text to speech, reader, articles, PDF, accessibility, productivity, study, audio

## Privacy Policy Draft

ReadMate AI sends selected or saved text to Google Cloud Text-to-Speech only when you request audio playback. The app stores your reading history, saved documents, playback progress, and preferences so you can continue reading across devices. Authentication is handled by Clerk. App data is stored in Supabase.

ReadMate AI does not continuously record your screen, collect passwords, read hidden form fields, or capture sensitive pages by default. OCR and screen reading features require explicit user action when implemented.

Optional Premium subscriptions are purchased through the App Store or Google Play. RevenueCat receives the signed-in ReadMate account identifier and subscription/product status so Premium access can be verified and restored across the user's devices. ReadMate does not receive the user's card or bank details.

Users can delete saved reading history and uploaded documents from the app when account data management is enabled.

## Google Play Data Safety Baseline

- Data collected: user IDs, reading history, saved document metadata, uploaded document files, app preferences, playback progress.
- Data shared with service providers: authentication provider, database/storage provider, selected text-to-speech provider, AI study provider when requested, and RevenueCat for subscription entitlement verification.
- Data encrypted in transit: yes.
- Data deletion: provide in-app deletion before public launch or link support contact/privacy policy instructions.
- Purpose: app functionality, account management, and content-to-audio processing.

## App Review Notes

ReadMate AI is a reading and text-to-speech app. Users sign in, save reading material, upload PDFs, and play generated audio. The app offers optional ReadMate Premium auto-renewing subscriptions for natural premium audio, larger documents, and higher listening limits. Purchases, restoration, and subscription management use the platform store. The app does not provide unrestricted web browsing, social networking, gambling, financial services, or medical services.

Before submitting the first Premium-enabled binary, add the subscription products and localized pricing to App Store Connect and Google Play Console, connect both stores to the RevenueCat `premium` entitlement/current offering, include a paywall screenshot in review notes where requested, and verify purchase, restore, cancellation, and management with sandbox testers.

## Remaining Assets

- App icon, 1024x1024.
- Google Play feature graphic, 1024x500.
- Phone screenshots for Google Play.
- iPhone screenshots for App Store Connect.
- Optional iPad screenshots if iPad support is enabled.
