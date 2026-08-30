# ReadMate AI — Redesign Spec
_Component-first implementation of the 40-artboard N-Qube design system_

---

## 1. Scope

Bring every screen in the **mobile app** (React Native / Expo) and **Chrome extension** (React + CSS) into pixel-level alignment with the existing 40-artboard design file. No new features. No new routes. Fix the gaps between the spec and the code.

---

## 2. Design Tokens (source of truth)

All values come from the design system artboards 37–40. These are already partially in both codebases; any divergence in the extension must be corrected.

### 2.1 Colour palette

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#f4f8ff` | Page / screen background |
| `bgAlt` | `#edf4ff` | Secondary background, ghost buttons |
| `surface` | `#ffffff` | Cards, panels |
| `surfaceSoft` | `#f8fbff` | Input backgrounds, inner tiles |
| `border` | `#dbe7f6` | Card borders |
| `ink` | `#0f172a` | Headings, primary text |
| `text` | `#1f2a44` | Body text |
| `muted` | `#64748b` | Secondary text |
| `faint` | `#8a98ad` | Labels, metadata |
| `navy` | `#101827` | Primary CTA bg, PlayerCard bg, active tabs |
| `blue` | `#2f6df6` | Accent, primary buttons, active player |
| `blueSoft` | `#e9f1ff` | Blue-toned soft backgrounds |
| `indigo` | `#6757f5` | Brand gradient end |
| `teal` | `#11b5a5` | Progress bars, synced indicator |
| `tealSoft` | `#ddfaf6` | Teal soft backgrounds |
| `green` | `#15805a` | Success, component labels, synced pill |
| `greenSoft` | `#e6f7ee` | Success backgrounds |
| `amber` | `#a96800` | Warning |
| `amberSoft` | `#fff2cf` | Warning backgrounds |
| `red` | `#b42318` | Error, danger |
| `redSoft` | `#fff0ef` | Error backgrounds |

### 2.2 Border radius

| Token | Value | Usage |
|---|---|---|
| `sm` | 8px | Small chips, menu items |
| `md` | 14px | **Card radius** — the primary card/panel radius |
| `lg` | 18px | Input fields, control tiles |
| `xl` | 24px | Large cards, content cards |
| `pill` | 999px | Pills, progress bars, round buttons |

> **Critical fix:** Extension `styles.css` currently uses `--rm-radius-card: 8px`. Must be `14px` to match spec.

### 2.3 Typography

| Scale | Size | Weight | Usage |
|---|---|---|---|
| Display | 34px | 900 | Page headers (`PageHeader` title) |
| Title | 22px | 900 | Card titles (ContentCard large) |
| Heading | 20px | 900 | `SectionHeading` |
| Body Large | 17px | 900 | ContentCard compact title, PlaybackBar title |
| Body | 15px | 400–700 | Standard body text |
| Label | 13px | 700–900 | Metadata, source lines |
| Caption | 12px | 800–900 | Pills, filter tags |
| Micro | 11px | 900 | Uppercase labels, EYEBROW text |

Font: **Inter** (extension) / system `-apple-system` with identical weight ladder (mobile).

### 2.4 Shadows

```
card:     0 8px 24px rgba(20, 42, 82, 0.05)
elevated: 0 16px 34px rgba(20, 42, 82, 0.10)
primary:  0 10px 22px rgba(47, 109, 246, 0.30)   ← blue CTA shadow
```

### 2.5 Spacing scale

4 · 8 · 12 · 14 · 16 · 18 · 24 · 32px. Gap between stacked cards: **10px** (extension), **18px** (mobile screen).

---

## 3. Phase 1 — Extension design system fixes

### 3.1 `styles.css` token corrections

Change these specific values:
- `--rm-radius-card`: `8px` → `14px`
- `--rm-radius-control`: `7px` → `10px`
- `--rm-shadow-card`: keep, verify matches spec
- `--rm-border`: keep `rgba(15, 23, 42, 0.10)` — correct

### 3.2 Extension PlayerCard (`.now-reading` panel)

**Current:** White card with inline layout, status badge top-right, excerpt text below.

**Spec (artboard 23):** Full-width **navy** (`#101827`) card with:
- Cover art / placeholder at left (80×80, radius 12px, dark bg)
- Title (white, 17px/900), source line (muted-on-dark, 13px)
- Teal progress bar (6px height, full width, radius pill)
- `% complete · chunk N of N · X:XX left` row in faint-on-dark below bar
- Current block text excerpt inside a dark-surface-soft tile (opacity 12% white bg, radius 12px)
- 6-button transport row centred: |< · -10 · ▶/⏸ · □ · +10 · >|
  - Play/pause: 56×48px blue rounded rect with primary shadow
  - Other controls: 44×44px soft circle on dark

**CSS class rename:** `.now-reading` → `.player-card` with `background: var(--rm-navy)` and `color: #fff`.

### 3.3 Action tiles (`.action-grid`)

**Current:** 2×2 grid, primary tiles navy, secondary tiles bgAlt.

**Spec (artboard 24):** Same 2×2 grid but:
- All 4 tiles: 48px min-height (up from 42px)
- Icons: 18px Lucide icons — already correct
- Primary (Read page, Upload PDF): navy bg, white text
- Secondary (Read selection, Save): bgAlt bg, ink text
- Border radius: `var(--rm-radius-card)` = 14px (currently 8px — fixed by token)

### 3.4 Learning cards (`.learning-card`)

**Current:** Article with h3 + p. Missing the green component-type label.

**Spec (artboard 26–28):**
- `.component-label` green uppercase tag (10px, weight 900, `#15805a`) already exists in CSS — just ensure it renders above h3 in every card variant ✓ (already in JSX — just verify)
- `.preview-card` inner tiles: add `border: 1px solid var(--rm-border)` (currently just background)
- `.action-card .component-actions`: 2×2 grid — already correct

### 3.5 History rows (`.history-row`)

**Current:** Thumb + title button + Resume pill + overflow menu. Thumb is 38×38, green bg for initial.

**Spec (artboard 29):** Same structure but:
- Thumb border-radius: 10px (currently `var(--rm-radius-card)` — will be 14px after token fix, which is too large for 38px thumb — **set explicitly to 10px**)
- Progress `%` shown in source-line after `·`
- Overflow menu popover: add a visual divider line before the Danger "Delete from library" button (`border-top: 1px solid var(--rm-border)`)

### 3.6 Settings tab rows

**Current:** Plain `<label>` stacks with nested `<select>` or `<input>` elements.

**Spec (artboard 31–32):** Each setting is a `.settings-row` tile (surfaceSoft bg, 12px font, label left / value right). Already implemented for Sync status. Apply same `.settings-row` treatment to:
- TTS provider (read-only value)
- Voice (replace raw `<select>` with a styled `.settings-select` that matches the spec's dark select style)
- Speed (same)
- Tone (replace raw `<input>` with styled input, label above)
- Auto-scroll toggle → `.settings-row` with toggle on right
- Highlight mode → `.settings-row` with select on right

---

## 4. Phase 2 — Mobile screen polish

### 4.1 Home screen (`app/(tabs)/index.tsx`)

**Current:** PageHeader → "Now reading" label → PlaybackBar → 2-button row → SectionCard metrics → "Recently added" list.

**Spec (artboard 7):** Same order. Specific fixes:
- "Now reading" uppercase label: already `colors.muted`, `fontSize: 12`, `fontWeight: '900'`, `textTransform: 'uppercase'` ✓
- CTA row: Replace inline `quickActionStyle` objects with `ActionButton` component. "Add content" = `tone="navy"`, "Browse library" = `tone="soft"`. Height 48px, radius 16px.
- Metrics `SectionCard`: add `elevated` prop (already exists). Gap between MetricTile items: 10px ✓
- "Recently added" heading: use `SectionHeading` ✓. Gap above list: 12px ✓.

### 4.2 Library screen (`app/(tabs)/library.tsx`)

**Current:** PageHeader → PlaybackBar → filter row → Organize SectionCard → document list.

**Spec (artboard 8):**
- Filter pill row: active pill uses `colors.navy` bg + white text ✓ (already correct)
- Source filter pills: active uses `colors.blue` bg ✓
- Sort pills: active uses `colors.navy` bg ✓
- "Organize" SectionCard: remove this wrapper — source + sort filters should appear as two plain horizontal scroll rows with a `SectionHeading` above, not inside a SectionCard. The SectionCard adds unnecessary nesting.
- Document cards: full `ContentCard` (not compact) with `showStudyAction` ✓

### 4.3 History screen (`app/(tabs)/history.tsx`)

**Current state: largely correct.** PageHeader → danger "Clear recent activity" button → PlaybackBar → metrics SectionCard (Items · Completed · Saved time) → compact ContentCard list.

**Spec alignment:** No structural changes needed. The compact ContentCard already shows cover/placeholder + title + source + progress bar + Resume/Clear buttons. One fix: the "Clear recent activity" Pressable uses a hardcoded `#ffd5d2` border colour — replace with `colors.border` (the spec uses just the redSoft background with no visible border).

### 4.4 Study screen (`app/(tabs)/study.tsx`)

**Current:** Metrics SectionCard → review filter row → LearningCard list.

**Spec (artboard 10–11):**
- Metrics SectionCard: 2 rows of 3 MetricTile ✓
- `LearningCard` study pills (Key points, Flashcards, Quiz): current `StudyPill` uses a simple view. Spec shows these as a 3-column row with the count large (16px/900) and label below (11px/800). This is close but the active tone should be `blue` for non-zero. Fix: `backgroundColor: value ? colors.blueSoft : '#f3f5f9'`, `color: value ? colors.blue : '#68758c'` ✓ already correct.
- "Continue learning" button: spec uses `borderRadius: radius.pill`, current code uses `borderRadius: 999` ✓ same thing.
- `LearningCard` summary text: `numberOfLines={3}` ✓, font size 14/lineHeight 21 ✓.

### 4.5 Settings screen (`app/(tabs)/settings.tsx`)

**Current state:** PageHeader → Account SectionCard (BrandMark + email + Sign out) → SettingsPanel → Sync endpoint SectionCard. Structure is correct.

**Spec alignment:**
- Account SectionCard: already uses `elevated` prop ✓. Sign out button uses `#e8edf5` — replace with `colors.bgAlt`.
- `SettingsPanel` in `settings-panel.tsx`: replace horizontal-scroll `SegmentedControl` with a 3-column fixed toggle for Voice (show short labels: "Aria F", "Davis D", "Wavenet J", "Studio O") and Speed (0.75 · 1 · 1.25 · 1.5 · 2). If options exceed 3, use a 2-row grid of pills (no scroll). Min height 38px, navy active state ✓.
- Sync endpoint SectionCard: display-only input, keep as-is.

### 4.6 Sources screen (`app/(tabs)/sources.tsx`)

**Current state:** PageHeader → SourceForm → "Subscribed sources" SectionCard → "Chrome sync" SectionCard.

**Spec alignment:**
- Source tiles inside "Subscribed sources" use hardcoded colours (`#172033`, `#68758c`) — replace with `colors.ink`, `colors.muted`.
- Source tile container uses `borderRadius: 18` inline — replace with `radius.xl` (24).
- Topic pill horizontal scroll: active uses `colors.navy` ✓, inactive needs `borderColor: colors.border` not hardcoded.
- "Edit source" / "Remove source" / "Save changes" / "Cancel" buttons: replace `borderRadius: 14` inline with `radius.lg`; "Remove source" uses `colors.redSoft` bg ✓.
- The "Chrome sync" SectionCard body text uses `#68758c` — replace with `colors.muted`.

### 4.7 Document detail screen (`app/document/[id].tsx`)

**Current state:** Comprehensive — has DocumentStudyHeader, PlaybackBar, StudyDepthControls, StudyModeSwitcher (pill scroll), LearningSections, LearningActions (Ask AI, Flashcard review, Quiz), NotesAndHighlightsSection, Article text view.

**Spec alignment:**
- Inner card backgrounds use `#f6f8fc` — replace with `colors.surfaceSoft` (`#f8fbff`).
- Flashcard review buttons use hardcoded `#166534` (green) and `#9a3412` (red/orange) — replace with `colors.green` and `colors.red` bg, `colors.greenSoft` and `colors.redSoft` for softer version.
- Quiz option selected state: hardcoded `#dbeafe` / `#2563eb` — replace with `colors.blueSoft` / `colors.blue`.
- `StudyModeSwitcher`: `Pill` components in horizontal scroll — spec shows this as a top-level chip tab bar (same as `Pill` component, already correct shape).
- `StudyDepthControls` CountControl: increment button uses `colors.blue` bg ✓, decrement uses `#eef2f7` — replace with `colors.bgAlt`.
- Ask AI answer block: uses `#f6f8fc` bg — replace with `colors.surfaceSoft`.
- `DocumentStudyHeader`: hardcoded `#f6f7fb` loading screen bg — replace with `colors.bg`.

---

## 5. Phase 3 — New screens

### 5.1 Full-screen Player (new route: `app/player.tsx`)

A dedicated full-screen player accessible by tapping the PlaybackBar. Shows:
- Large cover art (full-width, 260px height, rounded bottom corners only)
- Document title (34px/900), source + speed + voice metadata line
- Teal progress bar (full width, 8px)
- Time row: elapsed left, % centre, remaining right
- 5-button transport: |< · -10 · ▶/⏸(62×56 blue) · +10 · >|
- Speed/voice quick-toggle row below transport
- Current block text in a scrolling surfaceSoft card
- `SafeAreaView` with `edges={['top','left','right','bottom']}`

### 5.2 Document learning view (within `app/document/[id].tsx`)

Tab bar at top of document: **Listen · Summary · Key Points · Flashcards · Quiz**. Each tab shows the relevant section. "Listen" tab = PlaybackBar + block text scroll. Other tabs = learning cards matching extension Learn tab spec.

### 5.3 Background Playback (artboards 20–22)

Configure `expo-av` audio mode for background playback:
```ts
Audio.setAudioModeAsync({
  staysActiveInBackground: true,
  playsInSilentModeIOS: true,
})
```
Add lock-screen metadata via `expo-av` `updatePlaybackStatus`. No new screen — this is a playback manager change.

---

## 6. Extension floating player (`floatingPlayer.ts`)

The content script injects a mini-player pill at the bottom of every page when reading is active. Spec shows:
- Fixed position, bottom: 20px, right: 20px
- Navy pill (border-radius: 999px, padding: 8px 14px 8px 10px)
- Cover/icon 32×32, title truncated, status dot, Play/Pause button, Minimize button
- Shadow: `0 8px 24px rgba(0,0,0,0.28)`
- Fades in when player starts, fades out on stop or minimize

---

## 7. Implementation order

1. Extension `styles.css` token corrections (border-radius, shadows)
2. Extension PlayerCard rebuild (`.now-reading` → navy card)
3. Extension action tiles, history rows, settings rows
4. Extension learning card border + action grid
5. Mobile `ActionButton` CTA row on Home screen
6. Mobile Library screen — remove Organize SectionCard wrapper
7. Mobile History + Sources + Settings screens — read then align
8. Mobile Document detail screen — read then add learning tab bar
9. Mobile full-screen Player route
10. Mobile background playback audio mode config
11. Extension floating player pill

---

## 8. Out of scope

- No new API endpoints
- No design changes (strictly implement the spec)
- No new authentication flows
- No new icon additions beyond the 48 already in the spec
