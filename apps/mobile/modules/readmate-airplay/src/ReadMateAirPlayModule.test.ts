import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("expo");
});

describe("ReadMateAirPlayModule", () => {
  it("keeps app startup safe when the optional native module is unavailable", async () => {
    vi.doMock("expo", () => ({
      NativeModule: class {},
      requireOptionalNativeModule: () => null
    }));

    const output = await import("./ReadMateAirPlayModule");

    expect(() => output.showOutputPicker()).not.toThrow();
    expect(() => output.loadOutputMedia({ uri: "https://example.com/audio.mp3", title: "Example", subtitle: "" })).not.toThrow();
    expect(() => output.sendOutputCommand("play")).not.toThrow();

    const subscription = output.addOutputStateListener(() => undefined);
    expect(() => subscription.remove()).not.toThrow();
  });

  it("forwards output operations when the native module is linked", async () => {
    const nativeModule = {
      showPicker: vi.fn(),
      loadMedia: vi.fn(),
      sendCommand: vi.fn(),
      addListener: vi.fn(() => ({ remove: vi.fn() }))
    };
    vi.doMock("expo", () => ({
      NativeModule: class {},
      requireOptionalNativeModule: () => nativeModule
    }));

    const output = await import("./ReadMateAirPlayModule");
    const media = { uri: "https://example.com/audio.mp3", title: "Example", subtitle: "Article" };

    output.showOutputPicker(media);
    output.loadOutputMedia(media);
    output.sendOutputCommand("seekBy", 15);
    output.addOutputStateListener(() => undefined);

    expect(nativeModule.showPicker).toHaveBeenCalledWith(media.uri, media.title, media.subtitle, "", 0, 0);
    expect(nativeModule.loadMedia).toHaveBeenCalledWith(media.uri, media.title, media.subtitle, "", 0, 0);
    expect(nativeModule.sendCommand).toHaveBeenCalledWith("seekBy", 15);
    expect(nativeModule.addListener).toHaveBeenCalledWith("onOutputStateChanged", expect.any(Function));
  });
});
