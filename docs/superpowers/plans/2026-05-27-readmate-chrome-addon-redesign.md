# ReadMate Chrome Add-On Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the ReadMate AI Chrome add-on into a compact, fast companion for capture, reading, sync, and lightweight study.

**Architecture:** Keep the existing React side panel, Chrome message bridge, and backend API client. Reorganize the side-panel layout around a focused Now Reading card, compact action grid, collapsed Quick Study, capped Recent History, and compact account/settings sections. Keep full study/review workflows in mobile.

**Tech Stack:** Chrome MV3, React, Vite, TypeScript, lucide-react, existing Express backend API.

---

## File Structure

- `apps/extension/src/sidepanel/App.tsx`: restructure side-panel sections, sync/content status, Quick Study actions, capped history rendering, and confirmations.
- `apps/extension/src/sidepanel/styles.css`: compact layout, cards, buttons, history rows, thumbnails, status pills, disabled states, and accessibility-focused focus styles.
- `apps/extension/src/api/client.ts`: add lightweight Ask AI call if needed for Quick Study.
- `apps/extension/src/api/client.test.ts`: verify client calls stay backend-only and do not expose Gemini keys.

---

### Task 1: Add Compact Shell And Sync Status

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Step 1: Add sync status derivation**

Derive `Synced`, `Syncing...`, `Offline`, `Sign in required`, or `Sync failed` from auth state, current error, and active action state.

- [ ] **Step 2: Replace the hero with a compact header**

Header includes product mark, ReadMate AI, sync pill, minimize button, and close button.

- [ ] **Step 3: Verify typecheck**

Run:

```bash
npm run typecheck -w apps/extension
```

---

### Task 2: Redesign Now Reading And Primary Actions

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Step 1: Add content detection helper text**

Show article/selection/PDF/no-content style helper text based on current chunks, active chunk source type, and player status.

- [ ] **Step 2: Rebuild Now Reading card**

No content: show `Choose content to read`, muted disabled controls, and primary `Read this page`.

Loaded content: show title, source/domain, status, progress, current paragraph, time remaining, and compact player controls.

- [ ] **Step 3: Rebuild action grid**

Use compact buttons for Read page, Read selection, Upload PDF, and Save to Library. Unauthenticated actions should surface sign-in-required feedback.

---

### Task 3: Add Quick Study Lite

**Files:**
- Modify: `apps/extension/src/api/client.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/styles.css`
- Modify: `apps/extension/src/api/client.test.ts`

- [ ] **Step 1: Add Ask AI client**

Add `askDocumentQuestion(apiBaseUrl, token, documentId, question)` to call `/api/learning/:documentId/ask`.

- [ ] **Step 2: Add Quick Study section**

Collapsed by default. Actions: Summarize page, Key points, Ask AI, Save highlight placeholder, Send to Study Mode. Show short summary and key points in the add-on; keep quizzes and full review out of Chrome.

- [ ] **Step 3: Verify tests**

Run:

```bash
npm run test -w apps/extension -- client.test.ts --reporter=verbose
```

---

### Task 4: Compact Recent History

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Step 1: Cap default history**

Show latest five items by default. Add a `View all history` toggle.

- [ ] **Step 2: Add compact history rows**

Rows show optional thumbnail/source icon, title, source, progress, Resume button, and an overflow menu with Open, Clear from history, Delete from library, and Study.

- [ ] **Step 3: Confirm destructive copy**

Delete confirmation: `Delete this item from your library? This will remove it from all devices.`

Clear all confirmation: `Clear all reading history? Your saved library items will not be deleted.`

---

### Task 5: Verify And Build

**Files:**
- Modify: `docs/release-blockers.md`

- [ ] **Step 1: Run extension verification**

Run:

```bash
npm run test -w apps/extension -- --reporter=verbose
npm run typecheck -w apps/extension
npm run build -w apps/extension
```

- [ ] **Step 2: Record status**

Update docs with the Chrome add-on redesign verification result.

---

## Spec Coverage

- Sections 1-3 are covered by the compact side-panel structure.
- Sections 4-6 are covered by header, Now Reading, and primary actions.
- Sections 7-9 are covered by Quick Study Lite and clear/delete semantics.
- Sections 10-13 are covered by collapsed settings/account, sync status, content detection, and backend content saving.
- Sections 14-16 are covered by the existing upload path plus compact card/thumbnail rendering.
- Sections 17-21 are covered by CSS layout, accessibility labels, disabled states, capped history, and error/empty copy.
- Sections 22-23 are covered by verification and keeping full Study mode in mobile.
