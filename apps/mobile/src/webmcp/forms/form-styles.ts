import type { CSSProperties } from "react";

export const webMcpColors = {
  cream: "#f5f1e8",
  creamStrong: "#e6dfd1",
  paper: "#fffbf2",
  ink: "#21231e",
  muted: "#686c62",
  green: "#1f2a24",
  greenSoft: "#e7efe0",
  maroon: "#7b3f4b",
  maroonSoft: "#f0e3e5",
  amber: "#8a642d",
  amberSoft: "#f1e4c9",
  red: "#ad514d",
  redSoft: "#f1e1dd",
  border: "rgba(33, 35, 30, 0.16)",
  white: "#ffffff"
} as const;

export const fieldStackStyle: CSSProperties = {
  display: "grid",
  gap: 6
};

export const labelStyle: CSSProperties = {
  color: webMcpColors.ink,
  fontSize: 13,
  fontWeight: 750
};

export const hintStyle: CSSProperties = {
  color: webMcpColors.muted,
  fontSize: 12,
  lineHeight: 1.45,
  margin: 0
};

export const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 44,
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 10,
  background: webMcpColors.white,
  color: webMcpColors.ink,
  font: "inherit",
  fontSize: 14,
  padding: "10px 12px"
};

export const twoColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 10
};

export const noticeStyle: CSSProperties = {
  border: `1px solid rgba(123, 63, 75, 0.22)`,
  borderRadius: 10,
  background: webMcpColors.maroonSoft,
  color: webMcpColors.maroon,
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
  padding: "10px 12px"
};

export const buttonRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  paddingTop: 2
};

export const primaryButtonStyle: CSSProperties = {
  minHeight: 44,
  border: 0,
  borderRadius: 999,
  background: webMcpColors.green,
  color: webMcpColors.white,
  cursor: "pointer",
  flex: "1 1 180px",
  font: "inherit",
  fontSize: 13,
  fontWeight: 800,
  padding: "10px 16px"
};

export const secondaryButtonStyle: CSSProperties = {
  minHeight: 44,
  border: `1px solid ${webMcpColors.border}`,
  borderRadius: 999,
  background: webMcpColors.creamStrong,
  color: webMcpColors.ink,
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 750,
  padding: "10px 16px"
};

export const inlineErrorStyle: CSSProperties = {
  borderRadius: 10,
  background: webMcpColors.redSoft,
  color: webMcpColors.red,
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
  padding: "9px 11px"
};

export const formStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  scrollMarginBlock: 100,
  padding: "12px 2px 2px"
};

export const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
};
