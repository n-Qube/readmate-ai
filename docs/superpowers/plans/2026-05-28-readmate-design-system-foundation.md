# ReadMate Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared visual foundation needed to implement the Claude mobile app and Chrome extension design in detail.

**Architecture:** Keep the existing Expo Router mobile app and MV3 React extension. Add focused mobile design tokens/components, fix mobile safe-area layout, and move the extension styling toward tokenized CSS variables without changing playback or sync behavior.

**Tech Stack:** Expo Router, React Native, TypeScript, Chrome MV3, React, Vite, CSS variables.

---

## File Structure

- Modify: `apps/mobile/src/components/mobile-design.tsx` - central mobile tokens, screen safe-area wrapper, shared controls.
- Modify: `apps/mobile/src/components/playback-bar.tsx` - align player card with the Claude system: larger artwork, icon-like controls, cleaner metadata.
- Modify: `apps/mobile/src/components/content-card.tsx` - align article/document cards with the Claude system: consistent radius, progress color, action hierarchy.
- Modify: `apps/extension/src/sidepanel/styles.css` - add extension CSS variables and map shell, panels, buttons, tabs, pills, and progress to the same visual tokens.
- Add: `docs/superpowers/plans/2026-05-28-readmate-design-system-foundation.md` - this execution plan.

## Task 1: Mobile Foundations

**Files:**
- Modify: `apps/mobile/src/components/mobile-design.tsx`

- [ ] **Step 1: Replace loose color usage with design tokens**

Update the exported `colors` object to match the Claude design intent: light blue app surface, navy primary ink, vivid blue primary action, teal progress, semantic states, and neutral borders.

- [ ] **Step 2: Add safe-area spacing to `Screen`**

Use `SafeAreaView` from `react-native-safe-area-context` around the existing `ScrollView` so content no longer collides with the status bar.

- [ ] **Step 3: Add reusable icon and media-control styles**

Add `IconCircle` and `MediaButton` components so later mobile screens can use consistent 44px tap targets instead of text-only transport controls.

- [ ] **Step 4: Verify mobile typecheck**

Run:

```bash
npm run typecheck -w apps/mobile
```

Expected: TypeScript exits with code 0.

## Task 2: Mobile Player And Cards

**Files:**
- Modify: `apps/mobile/src/components/playback-bar.tsx`
- Modify: `apps/mobile/src/components/content-card.tsx`

- [ ] **Step 1: Update player controls**

Replace transport labels such as `|<`, `-10s`, `Stop`, `+10s`, and `>|` with compact symbolic controls through the new shared `MediaButton` component while preserving accessibility labels.

- [ ] **Step 2: Update card visual hierarchy**

Keep `Play` or `Resume` as the primary card action, keep `Open` secondary, and ensure optional `Study`/delete actions do not crowd narrow mobile widths.

- [ ] **Step 3: Verify mobile typecheck**

Run:

```bash
npm run typecheck -w apps/mobile
```

Expected: TypeScript exits with code 0.

## Task 3: Extension Token Pass

**Files:**
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Step 1: Add CSS variables**

Define `--rm-bg`, `--rm-surface`, `--rm-ink`, `--rm-muted`, `--rm-blue`, `--rm-navy`, `--rm-teal`, `--rm-border`, `--rm-radius-card`, and shadow tokens in `:root`.

- [ ] **Step 2: Replace high-level hard-coded colors**

Map body, shell, header, tabs, panels, sync pills, icon buttons, and progress bars to the variables.

- [ ] **Step 3: Verify extension**

Run:

```bash
npm run typecheck -w apps/extension
npm run test -w apps/extension -- --reporter=verbose
npm run build -w apps/extension
```

Expected: all commands exit with code 0.

## Follow-Up Scope

After this foundation lands, implement the remaining Claude artboard groups in separate slices:

- Onboarding and signed-out mobile flow.
- Home resume hero and synced-device illustration.
- Library filters, dense cards, and detail route polish.
- Study dashboard, flashcards, quizzes, notes, and highlights polish.
- Sources add/upload/rss flow.
- Full player screen and background-playback handoff surfaces.
- Chrome extension component split and Learn Lite detail states.
