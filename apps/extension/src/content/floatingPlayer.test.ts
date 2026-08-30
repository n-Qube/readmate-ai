import { beforeEach, describe, expect, it } from "vitest";
import { showFloatingPlayer } from "./floatingPlayer";

describe("showFloatingPlayer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("replaces stale floating players left by older content script injections", () => {
    document.body.innerHTML = `
      <div id="readmate-floating-player"></div>
      <div id="readmate-floating-player"></div>
    `;

    showFloatingPlayer();

    expect(document.querySelectorAll("#readmate-floating-player")).toHaveLength(1);
    expect(document.querySelector("#readmate-floating-player")?.textContent).toContain("Play");
  });
});
