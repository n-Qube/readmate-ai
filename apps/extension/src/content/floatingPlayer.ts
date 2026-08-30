let root: HTMLDivElement | null = null;

export function showFloatingPlayer(): void {
  removeStaleFloatingPlayers();
  if (root?.isConnected) return;
  root = document.createElement("div");
  root.id = "readmate-floating-player";
  root.innerHTML = `
    <button data-action="rewind" title="Rewind 10 seconds">-10</button>
    <button data-action="play" title="Play">Play</button>
    <button data-action="pause" title="Pause">Pause</button>
    <button data-action="forward" title="Forward 10 seconds">+10</button>
    <button data-action="close" title="Close">Close</button>
  `;
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).dataset.action;
    if (!action) return;
    chrome.runtime.sendMessage({ type: "MINI_PLAYER_ACTION", action }).catch(() => undefined);
    if (action === "close") hideFloatingPlayer();
  });
  const style = document.createElement("style");
  style.textContent = `
    #readmate-floating-player {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
      font: 500 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #readmate-floating-player button {
      border: 0;
      border-radius: 999px;
      padding: 8px 10px;
      color: #0f172a;
      background: #eef2f7;
      cursor: pointer;
    }
    #readmate-floating-player button[data-action="play"] {
      color: white;
      background: #2563eb;
    }
  `;
  root.appendChild(style);
  document.documentElement.appendChild(root);
}

export function hideFloatingPlayer(): void {
  root?.remove();
  root = null;
}

function removeStaleFloatingPlayers(): void {
  const existingPlayers = Array.from(document.querySelectorAll<HTMLDivElement>("#readmate-floating-player"));
  for (const player of existingPlayers) {
    if (player !== root) player.remove();
  }
  if (root && !root.isConnected) root = null;
}
