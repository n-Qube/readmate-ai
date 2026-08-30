export function ReadMateLogo({ size = "default" }: { size?: "default" | "large" }) {
  const source = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("icons/icon-128.png")
    : "/icons/icon-128.png";

  return (
    <img className={`brand-mark ${size === "large" ? "brand-mark-large" : ""}`} src={source} alt="" aria-hidden="true" />
  );
}
