# ReadMate Mobile and Extension Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split ReadMate into focused mobile tabs and a lighter Chrome extension panel while preserving playback and sync.

**Architecture:** Mobile moves from a single `index` route to Expo Router tabs backed by reusable hooks and components. Chrome remains a side-panel React app, but the visual hierarchy changes so reading and capture actions are primary and settings/history are secondary.

**Tech Stack:** Expo Router, React Native, React Query, Clerk, Chrome extension React/Vite, Express API, Prisma.

---

### Task 1: Shared Mobile Data and UI Components

**Files:**
- Create: `apps/mobile/src/hooks/use-reading-library.ts`
- Create: `apps/mobile/src/components/content-card.tsx`
- Modify: `apps/mobile/src/components/document-card.tsx`

- [ ] Create a reusable hook that loads documents and settings through Clerk and React Query.
- [ ] Replace the old document card with a richer content card showing source type, title, source, progress, estimated time, voice, and Play/Open actions.
- [ ] Run `npm run typecheck -w apps/mobile`.

### Task 2: Mobile Tab Navigation

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/app/(tabs)/library.tsx`
- Create: `apps/mobile/app/(tabs)/history.tsx`
- Create: `apps/mobile/app/(tabs)/sources.tsx`
- Create: `apps/mobile/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] Add native bottom tabs for Home, Library, History, Sources, and Settings.
- [ ] Move playback and recent content to Home.
- [ ] Move saved content browsing and filters to Library.
- [ ] Move add URL/RSS/PDF forms to Sources.
- [ ] Move account and voice preferences to Settings.
- [ ] Run `npm run typecheck -w apps/mobile`.

### Task 3: Metadata Support

**Files:**
- Modify: `apps/mobile/src/types.ts`
- Modify: `apps/extension/src/shared/types.ts`
- Modify: `apps/extension/src/content/textExtraction.ts`
- Modify: `apps/extension/src/api/client.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/routes/documents.ts`

- [ ] Add optional thumbnail, author, description, and estimated listening seconds fields to the shared document model.
- [ ] Capture common web metadata in the extension.
- [ ] Persist metadata through document sync.
- [ ] Run `npm run typecheck -w apps/api`, `npm run typecheck -w apps/extension`, and `npm run typecheck -w apps/mobile`.

### Task 4: Chrome Side Panel Polish

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] Reduce the hero and keep Now Reading visible.
- [ ] Group page capture actions together.
- [ ] Move account, voice settings, and history into lower-priority compact sections.
- [ ] Keep synced history replay working.
- [ ] Run `npm run build -w apps/extension` and `npm run test -w apps/extension`.

### Task 5: Verification

**Files:**
- No source files.

- [ ] Run `npm run typecheck --workspaces --if-present`.
- [ ] Run `npm test --workspaces --if-present`.
- [ ] Start the mobile app with Expo and inspect tab navigation.
- [ ] Reload the Chrome unpacked extension build and verify side-panel actions.
