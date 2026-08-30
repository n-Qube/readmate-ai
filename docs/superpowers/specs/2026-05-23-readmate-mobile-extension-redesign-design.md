# ReadMate Mobile and Extension Redesign Design

## Goal

Make ReadMate feel like a mobile-first listening product instead of a single crowded control panel. Mobile becomes the main place for browsing, organizing, and replaying saved content. The Chrome extension stays focused on fast capture and page playback.

## Current Problems

- Mobile uses one scroll page for playback, preferences, add-content forms, saved content, and sign-out.
- Chrome side panel uses one scroll page for now playing, actions, voice settings, account, history, and future OCR.
- Content cards are text-heavy and do not communicate source, progress, or listening effort clearly.
- Saved web content does not carry enough metadata for thumbnails, author/source context, or estimated listening time.

## Product Structure

Mobile uses five tabs:

- Home: current reading state, quick resume, quick source actions, recently added content.
- Library: saved websites, PDFs, feeds, documents, filters, and rich content cards.
- History: previously played content, progress, and replay entry points.
- Sources: add website, connect RSS, upload PDF, and explain sync status.
- Settings: account, voice, speed, tone, highlighting, sync, and debug API settings.

Chrome extension uses a compact structure:

- Now Reading: current title, excerpt, progress, and playback controls.
- Capture Actions: read page, read selection, upload PDF, save/sync content.
- Secondary Details: collapsible or lower-priority account/settings/history areas.

## Metadata

Documents should support optional `thumbnailUrl`, `author`, `estimatedListeningSeconds`, and `description`. Chrome extraction should capture common Open Graph and article metadata where available. Mobile cards should use the thumbnail if present and otherwise show a source-type visual badge.

## UX Rules

- Keep one primary action per card: Play or Resume.
- Move settings out of the core listening flow.
- Keep browser capture fast and low-friction.
- Never require users to scroll through account or preferences to find saved content.
- Make progress and estimated remaining time visible in library and history.

## Implementation Scope

The first implementation pass creates tab navigation, splits existing functionality into focused screens, improves content cards, wires mobile play from cards into the player, and lightens the Chrome side panel hierarchy. Deeper server-side feed ingestion and full article-image scraping can follow after the metadata fields exist.
