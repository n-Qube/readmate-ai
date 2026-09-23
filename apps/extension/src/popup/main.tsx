import React from "react";
import { createRoot } from "react-dom/client";
import { BookOpen, FileText, Headphones, Library, Mic2, Sparkles } from "lucide-react";
import "../sidepanel/styles.css";
import { ReadMateLogo } from "../shared/ReadMateLogo";
import { sendToActiveTab } from "../shared/messages";
import { createSidePanelRoute, SIDE_PANEL_ROUTE_KEY, type SidePanelTab } from "../sidepanel/sidepanelRoute";
import { getActiveTabPreview, type PopupTabPreview } from "./tabPreview";

function Popup() {
  const [tabPreview, setTabPreview] = React.useState<PopupTabPreview>({
    domain: "Current tab",
    initial: "R",
    readable: true,
    title: "Preparing reader"
  });
  const [openingPanel, setOpeningPanel] = React.useState<SidePanelTab | null>(null);
  const [panelError, setPanelError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getActiveTabPreview().then(setTabPreview).catch(() => {
      setTabPreview({
        domain: "Chrome page",
        initial: "R",
        readable: false,
        title: "Open a readable web page"
      });
    });
  }, []);

  async function send(type: "READ_CURRENT_PAGE" | "READ_SELECTION") {
    await sendToActiveTab({ type });
    window.close();
  }

  async function openSidePanel(tab: SidePanelTab) {
    try {
      setOpeningPanel(tab);
      setPanelError(null);
      await chrome.storage.local.set({ [SIDE_PANEL_ROUTE_KEY]: createSidePanelRoute(tab) });
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        await chrome.sidePanel.open({ tabId: activeTab.id });
      } else {
        await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      }
      window.close();
    } catch {
      await chrome.storage.local.remove(SIDE_PANEL_ROUTE_KEY).catch(() => undefined);
      setPanelError(`ReadMate could not open ${tab === "library" ? "Library" : tab === "learn" ? "Learn" : "the reader"}. Try the side-panel button in Chrome.`);
      setOpeningPanel(null);
    }
  }

  return (
    <main className="shell popup-shell">
      <header className="addon-header popup-addon-header">
        <div className="brand">
          <ReadMateLogo />
          <div>
            <h1>ReadMate</h1>
            <p>Read, listen, and learn</p>
          </div>
        </div>
        <span className="sync-pill">Ready</span>
      </header>

      <nav className="tab-bar popup-tab-bar" aria-label="ReadMate sections">
        <button className="tab-item active" type="button" disabled={openingPanel !== null} onClick={() => void openSidePanel("read")}>
          <Headphones />
          <span>Read</span>
        </button>
        <button className="tab-item" type="button" disabled={openingPanel !== null} onClick={() => void openSidePanel("learn")}>
          <Sparkles />
          <span>{openingPanel === "learn" ? "Opening…" : "Learn"}</span>
        </button>
        <button className="tab-item" type="button" disabled={openingPanel !== null} onClick={() => void openSidePanel("library")}>
          <Library />
          <span>{openingPanel === "library" ? "Opening…" : "Library"}</span>
        </button>
      </nav>

      {panelError ? <p className="error popup-error" role="alert">{panelError}</p> : null}

      <section className="panel smart-detect popup-smart-detect">
        <div className="detect-ready-label">
          <span className="detect-ready-dot" />
          Current tab · {tabPreview.readable ? "Ready to read" : "Unsupported"}
        </div>
        <div className="detect-article-row">
          {tabPreview.faviconUrl ? (
            <img className="detect-favicon-lg" src={tabPreview.faviconUrl} alt="" />
          ) : (
            <div className="detect-favicon-fallback">{tabPreview.initial}</div>
          )}
          <div className="detect-article-meta">
            <h2 className="detect-title">{tabPreview.title}</h2>
            <div className="detect-source">
              <span className="detect-domain">{tabPreview.domain}</span>
            </div>
          </div>
        </div>
        <button className="read-cta" disabled={!tabPreview.readable} onClick={() => send("READ_CURRENT_PAGE")}>
          <BookOpen />
          Read this page aloud
        </button>
        <div className="secondary-action-row">
          <button type="button" disabled={!tabPreview.readable} onClick={() => send("READ_SELECTION")}>
            <Mic2 />
            Selection
          </button>
          <button type="button" title="Upload a PDF in the side panel" disabled={openingPanel !== null} onClick={() => void openSidePanel("read")}>
            <FileText />
            PDF
          </button>
          <button type="button" title="Save this page from the side panel" disabled={openingPanel !== null} onClick={() => void openSidePanel("read")}>
            <Library />
            Save
          </button>
        </div>
      </section>

      <aside className="panel power-tip-card popup-power-tip">
        <div className="power-tip-icon">
          <Sparkles />
        </div>
        <p className="power-tip-text">Open the side panel for study cards, summaries, history, and settings.</p>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
