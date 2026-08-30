# Extension Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Chrome extension sidepanel UI to the N-Qube design spec — correct border radius tokens, rebuild the player card as a navy card, and polish history rows, settings rows, and learning card borders.

**Architecture:** All changes are in two files: `styles.css` (visual tokens + new class definitions) and `App.tsx` (JSX structure for the player card and settings rows). No new components, no new state, no API changes.

**Tech Stack:** React 18, TypeScript, CSS custom properties, Lucide icons, Vitest (existing test suite)

---

## File map

| File | Change |
|---|---|
| `apps/extension/src/sidepanel/styles.css` | Token corrections + new `.player-card` block |
| `apps/extension/src/sidepanel/App.tsx` | Replace `.now-reading` JSX with `.player-card`; rebuild settings rows |

---

### Task 1: Correct CSS tokens

**Files:**
- Modify: `apps/extension/src/sidepanel/styles.css:20-21`

- [ ] **Open `apps/extension/src/sidepanel/styles.css` and change lines 20–21:**

```css
/* BEFORE */
--rm-radius-card: 8px;
--rm-radius-control: 7px;

/* AFTER */
--rm-radius-card: 14px;
--rm-radius-control: 10px;
```

- [ ] **Fix `.thumb` explicit radius (line ~880) — set to 10px so 38px thumbnails look right:**

```css
.thumb {
  display: flex;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 10px;          /* explicit — not var(--rm-radius-card) */
  background: var(--rm-green-soft);
  color: var(--rm-green);
  font-size: 13px;
  font-weight: 900;
}
```

- [ ] **Run the extension test suite to confirm nothing broke:**

```bash
cd apps/extension && npm test
```

Expected: all tests pass (no CSS-touching tests, but confirms no TS errors).

- [ ] **Build the extension:**

```bash
cd apps/extension && npm run build
```

Expected: exits 0, `dist/` updated.

- [ ] **Commit:**

```bash
git add apps/extension/src/sidepanel/styles.css
git commit -m "fix(extension): correct card radius 8→14px, control radius 7→10px"
```

---

### Task 2: Add player-card CSS classes

**Files:**
- Modify: `apps/extension/src/sidepanel/styles.css` (append after `.now-reading` block, around line 293)

- [ ] **Replace the `.now-reading` block and add the full `.player-card` class set. Find the existing `.now-reading` rule (around line 292) and replace it plus all related rules with:**

```css
/* ── Player card (navy, full-width) ─────────────────────────── */
.player-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--rm-radius-card);
  background: var(--rm-navy);
  color: #ffffff;
  box-shadow: var(--rm-shadow-elevated);
}

.player-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.player-thumb {
  display: flex;
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-size: 20px;
  font-weight: 900;
}

.player-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.player-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.player-label {
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.player-title {
  overflow: hidden;
  margin: 0;
  color: #ffffff;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.player-source {
  overflow: hidden;
  margin: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-status-pill {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  font-weight: 800;
}

.player-status-pill.status-playing {
  background: rgba(17, 181, 165, 0.25);
  color: #5df5e8;
}

.player-status-pill.status-paused,
.player-status-pill.status-idle {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.6);
}

.player-status-pill.status-ended {
  background: rgba(21, 128, 90, 0.3);
  color: #6ee7b7;
}

.player-progress {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
}

.player-progress div {
  height: 100%;
  border-radius: inherit;
  background: var(--rm-teal);
}

.player-time-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.42);
  font-size: 11px;
}

.player-excerpt {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  line-height: 1.5;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

/* Controls on dark player card */
.player-card .controls button {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.80);
}

.player-card .controls button:disabled {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.25);
  opacity: 1;
}

.player-card .controls .primary {
  background: var(--rm-blue);
  color: #ffffff;
  box-shadow: 0 8px 18px rgba(47, 109, 246, 0.35);
}

.player-card .controls-muted button {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.25);
}
```

- [ ] **Delete the now-redundant `.now-reading`, `.now-reading-top`, `.now-copy`, `.source-line` (inside now-reading), `.excerpt`, `.progress`, `.meta-row` rules** that were only used by the old player card. Keep `.source-line` and `.excerpt` if used elsewhere in the file (search before deleting).

```bash
grep -n "now-reading\|now-copy\|\.excerpt\|\.progress\b" apps/extension/src/sidepanel/styles.css
```

Remove only those that are exclusively used by the old player section.

- [ ] **Build:**

```bash
cd apps/extension && npm run build
```

Expected: exits 0.

- [ ] **Commit:**

```bash
git add apps/extension/src/sidepanel/styles.css
git commit -m "feat(extension): add player-card CSS — navy card, teal progress, dark controls"
```

---

### Task 3: Rebuild player card JSX in App.tsx

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:976-1019`

- [ ] **Find the `activeTab === "read"` branch in `App.tsx`. Locate the `<section className="panel current now-reading">` block. Replace it entirely with the new player card:**

```tsx
{activeTab === "read" && (
  <section className="tab-pane" aria-label="Read">
    <section className="player-card">
      <div className="player-card-top">
        <div className="player-thumb" aria-hidden="true">
          {activeHistoryDocument?.thumbnailUrl || activeHistoryDocument?.coverImageUrl
            ? <img src={activeHistoryDocument.thumbnailUrl ?? activeHistoryDocument.coverImageUrl} alt="" />
            : <span>{contentTypeInitial(currentChunk?.sourceType ?? activeHistoryDocument?.sourceType)}</span>}
        </div>
        <div className="player-meta">
          <span className="player-label">Now reading</span>
          <h2 className="player-title">{currentTitle}</h2>
          <p className="player-source">{currentSource ?? "No source selected"} · {statusLabel(player.status)}</p>
        </div>
        <span className={`player-status-pill status-${player.status}`}>{statusLabel(player.status)}</span>
      </div>

      <div className="player-progress">
        <div style={{ width: `${Math.max(0, Math.min(100, currentProgress))}%` }} />
      </div>

      <div className="player-time-row">
        <span>{Math.round(currentProgress)}%</span>
        <span>{chunkLabel}</span>
        <span>{remainingLabel}</span>
      </div>

      {hasLoadedContent && currentExcerpt ? (
        <p className="player-excerpt">{currentExcerpt}</p>
      ) : null}

      <div className={`controls ${hasLoadedContent ? "" : "controls-muted"}`} aria-label="Playback controls">
        <button disabled={!hasLoadedContent} onClick={() => setPlayer((state) => playerReducer(state, { type: "PREVIOUS_CHUNK" }))} title="Previous paragraph" aria-label="Previous paragraph"><SkipBack /></button>
        <button disabled={!hasLoadedContent} onClick={() => seek(-10)} title="Back 10 seconds" aria-label="Back 10 seconds"><Rewind /></button>
        {player.status === "playing" ? (
          <button disabled={!hasLoadedContent} className="primary play-toggle" onClick={pause} title="Pause" aria-label="Pause"><Pause /></button>
        ) : (
          <button disabled={!hasLoadedContent} className="primary play-toggle" onClick={playCurrentChunk} title="Play" aria-label="Play"><Play /></button>
        )}
        <button disabled={!hasLoadedContent} onClick={stop} title="Stop" aria-label="Stop"><Square /></button>
        <button disabled={!hasLoadedContent} onClick={() => seek(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds"><FastForward /></button>
        <button disabled={!hasLoadedContent} onClick={() => setPlayer((state) => playerReducer(state, { type: "NEXT_CHUNK", totalChunks: chunks.length }))} title="Next paragraph" aria-label="Next paragraph"><SkipForward /></button>
      </div>
    </section>

    <section className="panel action-panel" aria-label="Primary actions">
      <div className="action-grid">
        <button className="action-tile primary-action" disabled={activeAction !== null} onClick={readCurrentPage}><FileText /> <span>Read page</span></button>
        <button className="action-tile" disabled={activeAction !== null} onClick={readSelection}><Mic2 /> <span>Read selection</span></button>
        <label className={`action-tile upload ${activeAction !== null ? "disabled" : ""}`}><Upload /> <span>Upload PDF</span><input type="file" accept="application/pdf" disabled={activeAction !== null} onChange={(event) => handlePdf(event.target.files?.[0])} /></label>
        <button className="action-tile" disabled={activeAction !== null} onClick={saveCurrentPage}><Library /> <span>{activeHistoryDocument ? "Saved" : "Save"}</span></button>
      </div>
      <p className="helper-text">{activeHistoryDocument ? "This item is synced. Continue on mobile from Library or Study." : "Select text first to use Read selection, or save the page to sync it with mobile."}</p>
    </section>
  </section>
)}
```

- [ ] **Run tests:**

```bash
cd apps/extension && npm test
```

Expected: all pass.

- [ ] **Build:**

```bash
cd apps/extension && npm run build
```

- [ ] **Commit:**

```bash
git add apps/extension/src/sidepanel/App.tsx
git commit -m "feat(extension): rebuild Read tab with navy player card"
```

---

### Task 4: Polish history rows and overflow menu

**Files:**
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Find `.menu-popover button.danger` (around line 956) and add a top border to visually separate the danger action from safe actions:**

```css
.menu-popover button.danger {
  color: var(--rm-red);
  border-top: 1px solid var(--rm-border);
  margin-top: 2px;
  padding-top: 4px;
}
```

- [ ] **Find `.action-tile` (around line 406) and increase min-height to 48px:**

```css
.action-tile {
  display: inline-flex;
  min-height: 48px;       /* was 42px */
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: var(--rm-radius-card);
  background: var(--rm-bg-alt);
  color: var(--rm-ink);
  font-size: 13px;
  font-weight: 800;
}
```

- [ ] **Build and commit:**

```bash
cd apps/extension && npm run build
git add apps/extension/src/sidepanel/styles.css
git commit -m "fix(extension): overflow menu danger divider, action tile 48px"
```

---

### Task 5: Settings tab — rebuild as row tiles

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:1131-1173`
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Add a `.settings-select` CSS class** (a styled select that works on dark-ish surfaceSoft):

```css
.settings-select {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius-control);
  background: var(--rm-surface);
  color: var(--rm-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
```

- [ ] **Replace the Voice, Speed, Tone, and Reading settings sections in `App.tsx` with `.settings-row` tiles.** Find the `activeTab === "settings"` branch and replace the Voice and Reading `<section className="panel">` blocks:

```tsx
{activeTab === "settings" && (
  <section className="tab-pane settings-pane" aria-label="Settings">
    <section className="panel">
      <div className="settings-section-title"><Settings size={18} /><h2>Account and sync</h2></div>
      <div className="profile-row">
        {auth.isSignedIn && UserButton ? <UserButton /> : null}
        <p className="muted">{auth.isSignedIn ? `Signed in as ${auth.userName}. Chrome and mobile sync through your secure ReadMate session.` : "Sign in from the ReadMate account screen to sync Chrome with mobile."}</p>
      </div>
      <div className="settings-row">
        <span>Sync status</span>
        <strong>{syncState.label}</strong>
      </div>
      {auth.isSignedIn && <button className="ghost" onClick={async () => {
        if (clerk?.signOut) await clerk.signOut();
        await clearManualSession();
        setAuth({ isSignedIn: false, token: null, userName: "Anonymous reader" });
      }}><LogOut size={16} /> Sign out</button>}
    </section>

    <section className="panel">
      <h2>Voice</h2>
      <div className="settings-row">
        <span>Provider</span>
        <strong>Google Cloud TTS</strong>
      </div>
      <div className="settings-row">
        <span>Voice</span>
        <select className="settings-select" value={settings.voice} onChange={(event) => updateSettings({ ...settings, voice: event.target.value })}>
          {voicesForProvider(settings.ttsProvider).map((voice) => <option key={voice} value={voice}>{VOICE_LABELS[voice] ?? voice}</option>)}
        </select>
      </div>
      <div className="settings-row">
        <span>Speed</span>
        <select className="settings-select" value={settings.speed} onChange={(event) => updateSettings({ ...settings, speed: Number(event.target.value) })}>
          {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
        </select>
      </div>
      <div className="settings-row">
        <span>Tone</span>
        <input
          style={{ maxWidth: 160 }}
          value={settings.instructions}
          onChange={(event) => updateSettings({ ...settings, instructions: event.target.value })}
        />
      </div>
    </section>

    <section className="panel">
      <h2>Reading</h2>
      <div className="settings-row">
        <span>Auto-scroll</span>
        <input type="checkbox" checked={settings.autoScroll} onChange={(event) => updateSettings({ ...settings, autoScroll: event.target.checked })} />
      </div>
      <div className="settings-row">
        <span>Highlight</span>
        <select className="settings-select" value={settings.highlightMode} onChange={(event) => updateSettings({ ...settings, highlightMode: event.target.value as ExtensionSettings["highlightMode"] })}>
          <option>paragraph</option>
          <option>sentence</option>
          <option>none</option>
        </select>
      </div>
      <div className="settings-row">
        <span>API URL</span>
        <input value={settings.apiBaseUrl} onChange={(event) => updateSettings({ ...settings, apiBaseUrl: event.target.value })} style={{ maxWidth: 160, fontSize: 11 }} />
      </div>
    </section>

    <section className="panel ocr">
      <h2>Read screen text</h2>
      <p className="muted">Phase 2 will use explicit screenshot or tab capture plus OCR. ReadMate AI will not continuously record your screen.</p>
      <button disabled>Request capture permission</button>
    </section>
  </section>
)}
```

- [ ] **Run tests:**

```bash
cd apps/extension && npm test
```

- [ ] **Build:**

```bash
cd apps/extension && npm run build
```

- [ ] **Commit:**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/styles.css
git commit -m "feat(extension): settings tab row-tile layout, settings-select style"
```

---

### Task 6: Learning card preview borders

**Files:**
- Modify: `apps/extension/src/sidepanel/styles.css`

- [ ] **Find `.preview-card` (around line 777) and add a border:**

```css
.preview-card {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid var(--rm-border);     /* add this line */
  border-radius: var(--rm-radius-card);
  background: var(--rm-surface-soft);
}
```

- [ ] **Build and run full test suite:**

```bash
cd apps/extension && npm run build && npm test
```

Expected: build exits 0, all tests pass.

- [ ] **Commit:**

```bash
git add apps/extension/src/sidepanel/styles.css
git commit -m "fix(extension): preview-card border, complete extension design pass"
```

---

### Task 7: TypeScript typecheck

**Files:** None (verification only)

- [ ] **Run TypeScript check across the extension:**

```bash
cd apps/extension && npm run typecheck
```

Expected: no errors. If there are errors from the JSX changes in Task 3 or 5, fix them before proceeding.

- [ ] **Commit any typecheck fixes with:**

```bash
git commit -m "fix(extension): typecheck corrections after redesign"
```
