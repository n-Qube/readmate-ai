import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

export type AppIconName =
  | "airplayaudio"
  | "arrow.down.to.line"
  | "arrow.up"
  | "backward.end.fill"
  | "forward.end.fill"
  | "bookmark"
  | "books.vertical"
  | "calendar"
  | "checkmark"
  | "checkmark.circle.fill"
  | "circle"
  | "chevron.down"
  | "chevron.left"
  | "chevron.right"
  | "doc.text"
  | "ellipsis"
  | "exclamationmark.triangle"
  | "gearshape"
  | "globe"
  | "graduationcap"
  | "headphones"
  | "house"
  | "info.circle"
  | "line.3.horizontal"
  | "list.bullet"
  | "magnifyingglass"
  | "pause.fill"
  | "pencil"
  | "play.fill"
  | "plus"
  | "questionmark.circle"
  | "quote.bubble"
  | "rectangle.stack"
  | "speaker.wave.2.fill"
  | "star.fill"
  | "stop.fill"
  | "sparkles"
  | "cloud"
  | "textformat"
  | "trash"
  | "xmark"
  | "waveform"
  | "arrow.counterclockwise"
  | "arrow.clockwise";

const materialNames: Record<AppIconName, ComponentProps<typeof MaterialIcons>["name"]> = {
  airplayaudio: "cast",
  "arrow.down.to.line": "file-download",
  "arrow.up": "arrow-upward",
  "backward.end.fill": "skip-previous",
  "forward.end.fill": "skip-next",
  bookmark: "bookmark-border",
  "books.vertical": "library-books",
  calendar: "calendar-today",
  checkmark: "check",
  "checkmark.circle.fill": "check-circle",
  circle: "radio-button-unchecked",
  "chevron.down": "keyboard-arrow-down",
  "chevron.left": "chevron-left",
  "chevron.right": "chevron-right",
  "doc.text": "description",
  ellipsis: "more-horiz",
  "exclamationmark.triangle": "warning-amber",
  gearshape: "settings",
  globe: "language",
  graduationcap: "school",
  headphones: "headphones",
  house: "home",
  "info.circle": "info-outline",
  "line.3.horizontal": "menu",
  "list.bullet": "format-list-bulleted",
  magnifyingglass: "search",
  "pause.fill": "pause",
  pencil: "edit",
  "play.fill": "play-arrow",
  plus: "add",
  "questionmark.circle": "help-outline",
  "quote.bubble": "format-quote",
  "rectangle.stack": "style",
  "speaker.wave.2.fill": "volume-up",
  "star.fill": "star",
  "stop.fill": "stop",
  sparkles: "auto-awesome",
  cloud: "cloud-queue",
  textformat: "text-fields",
  trash: "delete-outline",
  xmark: "close",
  waveform: "graphic-eq",
  "arrow.counterclockwise": "replay-10",
  "arrow.clockwise": "forward-10"
};

export function AppIcon({
  name,
  size = 20,
  color = "#21231e",
  weight = "regular",
  style
}: {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  weight?: "regular" | "medium" | "semibold" | "bold";
  style?: StyleProp<ViewStyle>;
}) {
  if (process.env.EXPO_OS === "ios") {
    return (
      <SymbolView
        name={name as SFSymbol}
        tintColor={color}
        size={size}
        weight={weight}
        resizeMode="scaleAspectFit"
        style={[{ width: size, height: size }, style]}
      />
    );
  }

  return <MaterialIcons name={materialNames[name]} size={size} color={color} style={style as ComponentProps<typeof MaterialIcons>["style"]} />;
}
