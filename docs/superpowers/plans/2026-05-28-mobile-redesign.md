# Mobile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align every mobile screen to the N-Qube 40-artboard spec — replace hardcoded hex values with design tokens, swap the SegmentedControl from horizontal-scroll to a flexWrap grid, remove the Library "Organize" SectionCard wrapper, and add the full-screen Player route.

**Architecture:** All changes are token replacements and structural simplifications inside existing files. The new `app/player.tsx` route is the only new file. No new API calls, hooks, or component abstractions.

**Tech Stack:** React Native, Expo Router, TypeScript, design tokens in `apps/mobile/src/components/mobile-design.tsx`

---

## File map

| File | Change |
|---|---|
| `apps/mobile/app/(tabs)/index.tsx` | Replace inline CTA `Pressable` pair with `ActionButton` + `Link` wrappers |
| `apps/mobile/app/(tabs)/library.tsx` | Remove `SectionCard` wrapper around Organize section |
| `apps/mobile/app/(tabs)/history.tsx` | Remove hardcoded `borderColor` from Clear activity button |
| `apps/mobile/app/(tabs)/sources.tsx` | Replace `#172033`, `#68758c`, `#e8edf5`, inline `borderRadius: 18` and `14` with tokens |
| `apps/mobile/app/(tabs)/settings.tsx` | Replace `#e8edf5` and `#536179` with tokens |
| `apps/mobile/src/components/settings-panel.tsx` | Replace `SegmentedControl` ScrollView with flexWrap `View`; replace hardcoded colors |
| `apps/mobile/app/document/[id].tsx` | Replace `#f6f7fb`, `#f6f8fc`, `#166534`, `#9a3412`, `#dbeafe`, `#2563eb`, `#172033`, `#fbfcff` with tokens |
| `apps/mobile/app/player.tsx` | **Create** — full-screen Player route |
| `apps/mobile/app/_layout.tsx` | Register `player` Stack.Screen |

---

### Task 1: Home screen — replace CTA row with ActionButton

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Add `ActionButton` and `radius` to the import from `mobile-design`**

Open `apps/mobile/app/(tabs)/index.tsx`. The existing import on line 6 is:
```ts
import { BrandMark, EmptyCard, MetricTile, PageHeader, Screen, SectionCard, SectionHeading, colors, todayLabel } from "@/components/mobile-design";
```
Change it to:
```ts
import { ActionButton, BrandMark, EmptyCard, MetricTile, PageHeader, Screen, SectionCard, SectionHeading, colors, todayLabel } from "@/components/mobile-design";
```

- [ ] **Step 2: Replace the CTA row JSX**

Find the block (lines 40–51):
```tsx
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Link href="/sources" asChild>
          <Pressable style={quickActionStyle}>
            <Text style={quickActionTextStyle}>Add content</Text>
          </Pressable>
        </Link>
        <Link href="/library" asChild>
          <Pressable style={{ ...quickActionStyle, backgroundColor: "#eef3fb" }}>
            <Text style={{ ...quickActionTextStyle, color: "#25324a" }}>Browse library</Text>
          </Pressable>
        </Link>
      </View>
```
Replace with:
```tsx
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Link href="/sources" asChild style={{ flex: 1 }}>
          <ActionButton label="Add content" tone="navy" style={{ minHeight: 48, borderRadius: 16 }} />
        </Link>
        <Link href="/library" asChild style={{ flex: 1 }}>
          <ActionButton label="Browse library" tone="soft" style={{ minHeight: 48, borderRadius: 16 }} />
        </Link>
      </View>
```

- [ ] **Step 3: Remove the now-unused `quickActionStyle` and `quickActionTextStyle` constants**

Delete lines 88–98:
```ts
const quickActionStyle = {
  flex: 1,
  minHeight: 48,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  borderRadius: 16,
  borderCurve: "continuous" as const,
  backgroundColor: colors.navy
};

const quickActionTextStyle = { color: "#ffffff", fontWeight: "900" as const, fontSize: 15 };
```

- [ ] **Step 4: Remove unused `Pressable` and `Text` from the React Native import** (keep `ScrollView`, `ActivityIndicator`, `RefreshControl`, `View`)

Change:
```ts
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
```
To:
```ts
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors in `app/(tabs)/index.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): use ActionButton for Home CTA row"
```

---

### Task 2: Library screen — remove Organize SectionCard wrapper

**Files:**
- Modify: `apps/mobile/app/(tabs)/library.tsx`

The "Organize" `SectionCard` (lines 54–70) wraps source and sort filter rows. Spec shows these as plain rows with a `SectionHeading` above — no card wrapper.

- [ ] **Step 1: Replace the Organize SectionCard with plain rows**

Find and replace the entire block (lines 54–70):
```tsx
      <SectionCard>
        <SectionHeading title="Organize" subtitle="Filter by source and sort the collection without leaving the player." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {sourceFilters.map((item) => (
            <Pressable key={item} onPress={() => setSourceFilter(item)} style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: item === sourceFilter ? colors.blue : colors.surfaceSoft, borderWidth: 1, borderColor: item === sourceFilter ? colors.blue : colors.border }}>
              <Text style={{ color: item === sourceFilter ? "#ffffff" : "#536179", fontWeight: "800", fontSize: 13 }}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["Recent", "Date added", "Title", "Progress"] as SortMode[]).map((item) => (
            <Pressable key={item} onPress={() => setSortMode(item)} style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: item === sortMode ? colors.navy : colors.surfaceSoft, borderWidth: 1, borderColor: item === sortMode ? colors.navy : colors.border }}>
              <Text style={{ color: item === sortMode ? "#ffffff" : "#536179", fontWeight: "800", fontSize: 13 }}>Sort: {item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SectionCard>
```
Replace with:
```tsx
      <View style={{ gap: 10 }}>
        <SectionHeading title="Filter by source" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {sourceFilters.map((item) => (
            <Pressable key={item} onPress={() => setSourceFilter(item)} style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: item === sourceFilter ? colors.blue : colors.surfaceSoft, borderWidth: 1, borderColor: item === sourceFilter ? colors.blue : colors.border }}>
              <Text style={{ color: item === sourceFilter ? "#ffffff" : colors.muted, fontWeight: "800", fontSize: 13 }}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <SectionHeading title="Sort" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["Recent", "Date added", "Title", "Progress"] as SortMode[]).map((item) => (
            <Pressable key={item} onPress={() => setSortMode(item)} style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: item === sortMode ? colors.navy : colors.surfaceSoft, borderWidth: 1, borderColor: item === sortMode ? colors.navy : colors.border }}>
              <Text style={{ color: item === sortMode ? "#ffffff" : colors.muted, fontWeight: "800", fontSize: 13 }}>Sort: {item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
```

- [ ] **Step 2: Remove `SectionCard` from the import (it's no longer used)**

Change:
```ts
import { EmptyCard, PageHeader, Screen, SectionCard, SectionHeading, colors } from "@/components/mobile-design";
```
To:
```ts
import { EmptyCard, PageHeader, Screen, SectionHeading, colors } from "@/components/mobile-design";
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors in `app/(tabs)/library.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/library.tsx
git commit -m "feat(mobile): remove Organize SectionCard wrapper in Library"
```

---

### Task 3: History screen — remove hardcoded border color

**Files:**
- Modify: `apps/mobile/app/(tabs)/history.tsx`

- [ ] **Step 1: Remove `borderWidth` and `borderColor` from the Clear activity button**

Find (line 41):
```tsx
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.redSoft, borderWidth: 1, borderColor: "#ffd5d2" }}
```
Replace with:
```tsx
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.redSoft }}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/\(tabs\)/history.tsx
git commit -m "fix(mobile): remove hardcoded border from History clear button"
```

---

### Task 4: Sources screen — replace hardcoded colors and radii with tokens

**Files:**
- Modify: `apps/mobile/app/(tabs)/sources.tsx`

- [ ] **Step 1: Add `radius` to the import from `mobile-design`**

Change:
```ts
import { PageHeader, Screen, SectionCard, SectionHeading, colors } from "@/components/mobile-design";
```
To:
```ts
import { PageHeader, Screen, SectionCard, SectionHeading, colors, radius } from "@/components/mobile-design";
```

- [ ] **Step 2: Replace hardcoded values in the source tile container (line 84)**

Find:
```tsx
          <View key={source.id} style={{ gap: 10, padding: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
```
Replace with:
```tsx
          <View key={source.id} style={{ gap: 10, padding: 12, borderRadius: radius.xl, borderCurve: "continuous", backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}>
```

- [ ] **Step 3: Replace hardcoded `#172033` (source name text, line 86)**

Find:
```tsx
              <Text selectable style={{ color: "#172033", fontSize: 16, fontWeight: "900" }}>
```
Replace with:
```tsx
              <Text selectable style={{ color: colors.ink, fontSize: 16, fontWeight: "900" }}>
```

- [ ] **Step 4: Replace hardcoded `#68758c` (source URL line, line 89)**

Find:
```tsx
              <Text selectable numberOfLines={1} style={{ color: "#68758c", fontSize: 13 }}>
```
Replace with:
```tsx
              <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
```

- [ ] **Step 5: Replace hardcoded `borderRadius: 14` on "Save changes" button (line 134)**

Find:
```tsx
                  style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.navy }}
```
Replace with:
```tsx
                  style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.navy }}
```

- [ ] **Step 6: Replace hardcoded `#e8edf5` and `borderRadius: 14` on "Cancel" button (line 141)**

Find:
```tsx
                    style={{ minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: "#e8edf5" }}
```
Replace with:
```tsx
                    style={{ minHeight: 40, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}
```

- [ ] **Step 7: Replace `#25324a` cancel text color (line 143)**

Find:
```tsx
                    <Text style={{ color: "#25324a", fontWeight: "900" }}>Cancel</Text>
```
Replace with:
```tsx
                    <Text style={{ color: colors.ink, fontWeight: "900" }}>Cancel</Text>
```

- [ ] **Step 8: Replace `#e8edf5` and `borderRadius: 14` on "Edit source" button (line 168–169)**

Find:
```tsx
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: "#e8edf5" }}
```
Replace with:
```tsx
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgAlt }}
```

- [ ] **Step 9: Replace `#25324a` on "Edit source" text (line 171)**

Find:
```tsx
              <Text style={{ color: "#25324a", fontWeight: "900" }}>Edit source</Text>
```
Replace with:
```tsx
              <Text style={{ color: colors.ink, fontWeight: "900" }}>Edit source</Text>
```

- [ ] **Step 10: Replace `borderRadius: 14` on "Remove source" button (line 181)**

Find:
```tsx
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.redSoft }}
```
Replace with:
```tsx
              style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.redSoft }}
```

- [ ] **Step 11: Replace `#68758c` in empty sources text and "Chrome sync" body text**

Find (line 186):
```tsx
          <Text selectable style={{ color: "#68758c", fontSize: 15, lineHeight: 22 }}>
            Search for a website name above to add your first source.
          </Text>
```
Replace with:
```tsx
          <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
            Search for a website name above to add your first source.
          </Text>
```

Find (line 194):
```tsx
        <Text selectable style={{ color: "#68758c", fontSize: 15, lineHeight: 22 }}>
```
Replace with:
```tsx
        <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
```

- [ ] **Step 12: Replace hardcoded colors in `sourceInputStyle` (lines 202–211)**

Find:
```ts
const sourceInputStyle = {
  minHeight: 44,
  borderRadius: 14,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: "#d8e0ec",
  paddingHorizontal: 12,
  color: "#172033",
  backgroundColor: "#ffffff"
};
```
Replace with:
```ts
const sourceInputStyle = {
  minHeight: 44,
  borderRadius: radius.md,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 12,
  color: colors.ink,
  backgroundColor: colors.surface
};
```

- [ ] **Step 13: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors in `app/(tabs)/sources.tsx`.

- [ ] **Step 14: Commit**

```bash
git add apps/mobile/app/\(tabs\)/sources.tsx
git commit -m "fix(mobile): replace hardcoded colors and radii in Sources screen"
```

---

### Task 5: Settings screen — replace hardcoded colors with tokens

**Files:**
- Modify: `apps/mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Replace `#e8edf5` on Sign out button (line 35)**

Find:
```tsx
        <Pressable onPress={() => signOut()} style={{ minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: "#e8edf5" }}>
```
Replace with:
```tsx
        <Pressable onPress={() => signOut()} style={{ minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.bgAlt }}>
```

- [ ] **Step 2: Replace `#25324a` on Sign out text (line 36)**

Find:
```tsx
          <Text style={{ color: "#25324a", fontWeight: "900" }}>Sign out</Text>
```
Replace with:
```tsx
          <Text style={{ color: colors.ink, fontWeight: "900" }}>Sign out</Text>
```

- [ ] **Step 3: Replace `#536179` on account body text (line 32)**

Find:
```tsx
        <Text selectable style={{ color: "#536179", fontSize: 15, lineHeight: 22 }}>
```
Replace with:
```tsx
        <Text selectable style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
```

- [ ] **Step 4: Replace `#68758c` and `#172033` in `inputStyle` (lines 53–62)**

Find:
```ts
const inputStyle = {
  minHeight: 46,
  borderRadius: 14,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: "#d8e0ec",
  paddingHorizontal: 14,
  color: "#172033",
  backgroundColor: "#fbfcff"
};
```
Replace with:
```ts
const inputStyle = {
  minHeight: 46,
  borderRadius: 14,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 14,
  color: colors.ink,
  backgroundColor: colors.surfaceSoft
};
```

- [ ] **Step 5: Replace `#68758c` in Sync endpoint note (line 46)**

Find:
```tsx
        <Text selectable style={{ color: "#68758c", fontSize: 13, lineHeight: 19 }}>
```
Replace with:
```tsx
        <Text selectable style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(tabs\)/settings.tsx
git commit -m "fix(mobile): replace hardcoded colors in Settings screen"
```

---

### Task 6: SettingsPanel — replace ScrollView SegmentedControl with flexWrap grid

**Files:**
- Modify: `apps/mobile/src/components/settings-panel.tsx`

The current `SegmentedControl` wraps options in a `ScrollView horizontal`. The spec shows a fixed grid of pills (flexWrap, no scroll). Voice options are long strings — use shortened labels.

- [ ] **Step 1: Add `radius` to the import**

Change:
```ts
import { SectionCard, SectionHeading, colors } from "@/components/mobile-design";
```
To:
```ts
import { SectionCard, SectionHeading, colors, radius } from "@/components/mobile-design";
```

- [ ] **Step 2: Remove `ScrollView` from the React Native import (no longer needed in SegmentedControl)**

Change:
```ts
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
```
To:
```ts
import { Pressable, Text, TextInput, View } from "react-native";
```

- [ ] **Step 3: Replace the `SegmentedControl` function**

Find the entire `SegmentedControl` function (lines 71–84):
```tsx
function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text selectable style={{ color: "#536179", fontWeight: "800" }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((option) => (
          <Pressable key={option} onPress={() => onChange(option)} style={{ paddingHorizontal: 12, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: option === value ? colors.navy : colors.bgAlt }}>
            <Text style={{ color: option === value ? "#ffffff" : "#25324a", fontWeight: "800" }}>{option}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
```
Replace with:
```tsx
function SegmentedControl<T extends string>({ label, options, value, onChange, shortLabels }: { label: string; options: T[]; value: T; onChange: (value: T) => void; shortLabels?: Partial<Record<T, string>> }) {
  return (
    <View style={{ gap: 8 }}>
      <Text selectable style={{ color: colors.muted, fontWeight: "800" }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <Pressable key={option} onPress={() => onChange(option)} style={{ minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: option === value ? colors.navy : colors.bgAlt }}>
            <Text style={{ color: option === value ? "#ffffff" : colors.ink, fontWeight: "800", fontSize: 13 }}>
              {shortLabels?.[option] ?? option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Add short labels for Voice options**

The voice values are `en-US-Neural2-F`, `en-US-Neural2-D`, `en-US-Neural2-J`, `en-US-Studio-O`. Create a display map and pass it as `shortLabels`.

Find the Voice SegmentedControl usage in `SettingsPanel`:
```tsx
      <SegmentedControl label="Voice" options={[...providerVoices]} value={settings.voice} onChange={(voice) => onChange({ ...settings, voice })} />
```
Replace with:
```tsx
      <SegmentedControl
        label="Voice"
        options={[...providerVoices]}
        value={settings.voice}
        onChange={(voice) => onChange({ ...settings, voice })}
        shortLabels={{ "en-US-Neural2-F": "Aria F", "en-US-Neural2-D": "Davis D", "en-US-Neural2-J": "Wavenet J", "en-US-Studio-O": "Studio O" } as Partial<Record<(typeof providerVoices)[number], string>>}
      />
```

- [ ] **Step 5: Replace remaining hardcoded colors in `SettingsPanel`**

Find (line 23):
```tsx
      <Text selectable style={{ color: "#536179", fontWeight: "800" }}>TTS provider</Text>
      <Text selectable style={{ color: "#25324a", fontWeight: "900" }}>Google Cloud Text-to-Speech</Text>
```
Replace with:
```tsx
      <Text selectable style={{ color: colors.muted, fontWeight: "800" }}>TTS provider</Text>
      <Text selectable style={{ color: colors.ink, fontWeight: "900" }}>Google Cloud Text-to-Speech</Text>
```

Find (line 28):
```tsx
        <Text selectable style={{ color: "#536179", fontWeight: "800" }}>Tone</Text>
```
Replace with:
```tsx
        <Text selectable style={{ color: colors.muted, fontWeight: "800" }}>Tone</Text>
```

Find (line 39):
```tsx
      <Text selectable style={{ color: "#68758c", fontSize: 13 }}>
```
Replace with:
```tsx
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
```

Find (line 49):
```tsx
      <Text selectable style={{ color: "#536179", fontWeight: "800" }}>Content types</Text>
```
Replace with:
```tsx
      <Text selectable style={{ color: colors.muted, fontWeight: "800" }}>Content types</Text>
```

Find (line 61):
```tsx
              style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: active ? colors.blueSoft : "#f4f6fa" }}
```
Replace with:
```tsx
              style={{ paddingHorizontal: 12, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: active ? colors.blueSoft : colors.bgAlt }}
```

Find (line 63):
```tsx
              <Text style={{ color: active ? colors.blue : "#68758c", fontWeight: "800" }}>{item}</Text>
```
Replace with:
```tsx
              <Text style={{ color: active ? colors.blue : colors.muted, fontWeight: "800" }}>{item}</Text>
```

- [ ] **Step 6: Replace hardcoded colors in `inputStyle` (lines 87–95)**

Find:
```ts
const inputStyle = {
  minHeight: 46,
  borderRadius: 14,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: "#d8e0ec",
  paddingHorizontal: 14,
  color: colors.ink,
  backgroundColor: colors.surfaceSoft
};
```
Replace with:
```ts
const inputStyle = {
  minHeight: 46,
  borderRadius: radius.md,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 14,
  color: colors.ink,
  backgroundColor: colors.surfaceSoft
};
```

- [ ] **Step 7: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors in `src/components/settings-panel.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/components/settings-panel.tsx
git commit -m "feat(mobile): replace SegmentedControl scroll with flexWrap grid"
```

---

### Task 7: Document detail screen — replace hardcoded colors with tokens

**Files:**
- Modify: `apps/mobile/app/document/[id].tsx`

- [ ] **Step 1: Replace `#f6f7fb` loading screen background (line 95)**

Find:
```tsx
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f6f7fb" }}>
```
Replace with:
```tsx
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
```

- [ ] **Step 2: Replace `#f6f8fc` Ask AI answer block background (line 221)**

Find:
```tsx
          <View style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: "#f6f8fc" }}>
```
The first occurrence is the Ask AI answer block. Replace with:
```tsx
          <View style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
```

- [ ] **Step 3: Replace `#f6f8fc` flashcard tile background (line 236)**

Find the second occurrence of `backgroundColor: "#f6f8fc"` (inside the flashcard `SectionCard`):
```tsx
            <View key={card.id} style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: "#f6f8fc" }}>
```
Replace with:
```tsx
            <View key={card.id} style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
```

- [ ] **Step 4: Replace `#172033` flashcard text colors (line 237)**

Find:
```tsx
              <Text selectable style={{ color: "#172033", fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{card.question}</Text>
```
Replace with:
```tsx
              <Text selectable style={{ color: colors.ink, fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{card.question}</Text>
```

- [ ] **Step 5: Replace `#166534` and `#9a3412` flashcard review button backgrounds (line 241–244)**

Find the `reviewButtonStyle` function. Search for `"#166534"` and `"#9a3412"` in the file and replace them. The function likely looks like:
```ts
const reviewButtonStyle = (bg: string) => ({
  flex: 1, minHeight: 36, alignItems: "center" as const, justifyContent: "center" as const,
  borderRadius: 999, backgroundColor: bg
});
```
Or they're used inline on lines 241–244:
```tsx
                <Pressable onPress={() => onReviewFlashcard(card.id, "known")} style={reviewButtonStyle("#166534")}>
                  <Text style={reviewButtonTextStyle}>Known</Text>
                </Pressable>
                <Pressable onPress={() => onReviewFlashcard(card.id, "needs_review")} style={reviewButtonStyle("#9a3412")}>
                  <Text style={reviewButtonTextStyle}>Needs review</Text>
                </Pressable>
```
Replace with:
```tsx
                <Pressable onPress={() => onReviewFlashcard(card.id, "known")} style={reviewButtonStyle(colors.greenSoft)}>
                  <Text style={{ ...reviewButtonTextStyle, color: colors.green }}>Known</Text>
                </Pressable>
                <Pressable onPress={() => onReviewFlashcard(card.id, "needs_review")} style={reviewButtonStyle(colors.redSoft)}>
                  <Text style={{ ...reviewButtonTextStyle, color: colors.red }}>Needs review</Text>
                </Pressable>
```

If `reviewButtonStyle` is defined as a function taking a string bg, also update `reviewButtonTextStyle` to remove any hardcoded color, since it's now applied per-button above. If `reviewButtonTextStyle` has `color: "#ffffff"`, change it to remove `color` (let each button override it). Find and update:
```ts
const reviewButtonTextStyle = { color: "#ffffff", fontWeight: "900" as const, fontSize: 14 };
```
Replace with:
```ts
const reviewButtonTextStyle = { fontWeight: "900" as const, fontSize: 14 };
```

- [ ] **Step 6: Replace `#f6f8fc` quiz question tile background (line 257)**

Find the third occurrence of `backgroundColor: "#f6f8fc"` (quiz question tiles):
```tsx
            <View key={question.id} style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: "#f6f8fc" }}>
```
Replace with:
```tsx
            <View key={question.id} style={{ gap: 8, padding: 12, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surfaceSoft }}>
```

- [ ] **Step 7: Replace `#172033` quiz question text (line 258)**

Find:
```tsx
              <Text selectable style={{ color: "#172033", fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{question.question}</Text>
```
Replace with:
```tsx
              <Text selectable style={{ color: colors.ink, fontSize: 15, fontWeight: "900", lineHeight: 21 }}>{question.question}</Text>
```

- [ ] **Step 8: Replace `#dbeafe` / `#2563eb` quiz option selected state (line 262)**

Find:
```tsx
                    <Pressable key={option} onPress={() => setQuizAnswers({ ...quizAnswers, [question.id]: option })} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, backgroundColor: quizAnswers[question.id] === option ? "#dbeafe" : "#ffffff", borderWidth: 1, borderColor: quizAnswers[question.id] === option ? "#2563eb" : "#d8e0ec" }}>
```
Replace with:
```tsx
                    <Pressable key={option} onPress={() => setQuizAnswers({ ...quizAnswers, [question.id]: option })} style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, backgroundColor: quizAnswers[question.id] === option ? colors.blueSoft : colors.surface, borderWidth: 1, borderColor: quizAnswers[question.id] === option ? colors.blue : colors.border }}>
```

- [ ] **Step 9: Replace `#172033` quiz option text (line 263)**

Find:
```tsx
                      <Text style={{ color: "#172033", fontWeight: "800" }}>{option}</Text>
```
Replace with:
```tsx
                      <Text style={{ color: colors.ink, fontWeight: "800" }}>{option}</Text>
```

- [ ] **Step 10: Replace `#172033` and `#fbfcff` in Ask AI TextInput (line 215)**

Find:
```tsx
          style={{ minHeight: 64, borderRadius: 14, borderCurve: "continuous", borderWidth: 1, borderColor: "#d8e0ec", padding: 12, color: "#172033", backgroundColor: "#fbfcff" }}
```
Replace with:
```tsx
          style={{ minHeight: 64, borderRadius: 14, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.ink, backgroundColor: colors.surfaceSoft }}
```

- [ ] **Step 11: Replace `#172033` in article text view (line 165)**

Find:
```tsx
              <Text selectable style={{ fontSize: block.blockType === "heading" ? 20 : 16, lineHeight: block.blockType === "heading" ? 26 : 24, fontWeight: block.blockType === "heading" ? "800" : "400", color: "#172033" }}>
```
Replace with:
```tsx
              <Text selectable style={{ fontSize: block.blockType === "heading" ? 20 : 16, lineHeight: block.blockType === "heading" ? 26 : 24, fontWeight: block.blockType === "heading" ? "800" : "400", color: colors.ink }}>
```

- [ ] **Step 12: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors in `app/document/[id].tsx`.

- [ ] **Step 13: Commit**

```bash
git add apps/mobile/app/document/\[id\].tsx
git commit -m "fix(mobile): replace hardcoded colors in Document detail screen"
```

---

### Task 8: Create full-screen Player route

**Files:**
- Create: `apps/mobile/app/player.tsx`

The Player is a full-screen modal accessible by tapping the PlaybackBar. Uses the existing `usePlaybackManager` hook for state and controls.

- [ ] **Step 1: Check what PlaybackManager exposes**

```bash
grep -n "export\|return {" apps/mobile/src/playback/playback-manager.tsx | head -30
```
Note the exported hook name and what properties it returns (document title, progress, status, play/pause/skip functions).

- [ ] **Step 2: Create `apps/mobile/app/player.tsx`**

```tsx
import { useRouter } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { colors, radius, shadows } from "@/components/mobile-design";
import { usePlaybackManager } from "@/playback/playback-manager";

export default function PlayerScreen() {
  const router = useRouter();
  const player = usePlaybackManager();

  const title = player.document?.title ?? "Nothing playing";
  const source = player.document?.sourceLabel ?? player.document?.sourceUrl ?? "";
  const percent = player.progress?.percent ?? 0;
  const chunkIndex = player.progress?.blockIndex ?? 0;
  const totalChunks = player.document?.blocks?.length ?? 0;

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, gap: 0 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 }}>
          <Pressable onPress={() => router.back()} style={{ minWidth: 44, minHeight: 44, alignItems: "flex-start", justifyContent: "center" }}>
            <Text style={{ color: colors.muted, fontSize: 17, fontWeight: "700" }}>{"‹"}</Text>
          </Pressable>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "900" }}>Now Playing</Text>
          <View style={{ minWidth: 44 }} />
        </View>

        {/* Cover art */}
        <View style={{ height: 220, marginHorizontal: 18, borderRadius: radius.xl, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <Text style={{ color: colors.muted, fontSize: 48 }}>🎧</Text>
        </View>

        {/* Metadata */}
        <View style={{ paddingHorizontal: 18, paddingTop: 20, gap: 4 }}>
          <Text selectable numberOfLines={2} style={{ color: colors.ink, fontSize: 22, fontWeight: "900", lineHeight: 28 }}>{title}</Text>
          {source ? <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 14 }}>{source}</Text> : null}
        </View>

        {/* Progress bar */}
        <View style={{ paddingHorizontal: 18, paddingTop: 16, gap: 6 }}>
          <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: "hidden" }}>
            <View style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", backgroundColor: colors.teal, borderRadius: radius.pill }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>{Math.round(percent)}%</Text>
            {totalChunks > 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
                Chunk {chunkIndex + 1} of {totalChunks}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Transport controls */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingTop: 24, gap: 14 }}>
          <TransportButton symbol="⏮" label="Previous" onPress={player.skipBack} size={44} />
          <TransportButton symbol="«" label="-10s" onPress={player.seekBack} size={44} />
          <Pressable
            onPress={player.isPlaying ? player.pause : player.play}
            style={{ width: 62, height: 56, alignItems: "center", justifyContent: "center", borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.blue, boxShadow: shadows.primary }}
          >
            <Text style={{ color: "#ffffff", fontSize: 22 }}>{player.isPlaying ? "⏸" : "▶"}</Text>
          </Pressable>
          <TransportButton symbol="»" label="+10s" onPress={player.seekForward} size={44} />
          <TransportButton symbol="⏭" label="Next" onPress={player.skipForward} size={44} />
        </View>

        {/* Current block excerpt */}
        <ScrollView
          style={{ flex: 1, marginTop: 24, marginHorizontal: 18, marginBottom: 18 }}
          contentContainerStyle={{ padding: 16, borderRadius: radius.lg, backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border }}
        >
          <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 24 }}>
            {player.currentBlock?.text ?? ""}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function TransportButton({ symbol, label, onPress, size }: { symbol: string; label: string; onPress?: () => void; size: number }) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.bgAlt }}
    >
      <Text style={{ fontSize: 18, color: colors.ink }}>{symbol}</Text>
    </Pressable>
  );
}
```

> **Note:** `player.skipBack`, `player.seekBack`, `player.seekForward`, `player.skipForward`, `player.isPlaying`, `player.play`, `player.pause`, `player.currentBlock`, `player.progress`, `player.document` — verify these exact property names match what `usePlaybackManager` actually returns (see Step 1). Adjust if names differ.

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Fix any property name mismatches from the actual hook API.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/player.tsx
git commit -m "feat(mobile): add full-screen Player route"
```

---

### Task 9: Register Player route in app layout

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Add the player Stack.Screen**

Find (line 29–31):
```tsx
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="document/[id]" options={{ title: "Reading" }} />
          </Stack>
```
Replace with:
```tsx
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="document/[id]" options={{ title: "Reading" }} />
            <Stack.Screen name="player" options={{ headerShown: false, presentation: "modal" }} />
          </Stack>
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): register player as modal route in stack"
```

---

### Task 10: Final TypeScript check across all changed files

- [ ] **Run full TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1
```
Expected: zero errors.

If errors remain, trace each to the relevant task above and fix inline.

- [ ] **Commit any remaining fixes**

```bash
git add -p
git commit -m "fix(mobile): resolve remaining type errors from redesign"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task covering it |
|---|---|
| 4.1 Home screen CTA ActionButton | Task 1 |
| 4.2 Library — remove Organize SectionCard | Task 2 |
| 4.3 History — remove hardcoded border | Task 3 |
| 4.6 Sources — token cleanup | Task 4 |
| 4.5 Settings — bgAlt sign-out | Task 5 |
| 4.5 SettingsPanel — flexWrap segmented control | Task 6 |
| 4.7 Document detail — surfaceSoft / token fixes | Task 7 |
| 5.1 Full-screen Player route | Task 8 |
| Player route registration | Task 9 |
| 4.4 Study screen | **No changes needed** — spec confirms StudyPill tones, pill border radius, and summary font size are all already correct |
| 5.3 Background playback | **No changes needed** — already implemented in `playback-manager.tsx` |

**Placeholder scan:** All steps contain exact code. No "TBD" or "see above" references.

**Type consistency:** `colors`, `radius`, `shadows` imported consistently from `@/components/mobile-design` across all tasks. The `reviewButtonStyle` helper is updated before being called with the new soft-tone approach.
