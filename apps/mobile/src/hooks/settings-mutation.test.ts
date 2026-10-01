import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { UserSettings } from "../types";
import { settingsMutationOptions, type EditableSettings } from "./settings-mutation";

const base: UserSettings = {
  userId: "user_1",
  updatedAt: "2026-09-24T00:00:00.000Z",
  provider: "gemini-lite",
  voice: "Kore",
  speed: 1,
  targetLanguage: "en",
  autoScroll: true,
  highlightMode: "paragraph",
  preferredContentTypes: ["webpage"],
  articlesPerFeed: 10
};

function editable(voice: string): EditableSettings {
  const { userId: _userId, updatedAt: _updatedAt, ...rest } = base;
  return { ...rest, voice };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const client = new QueryClient();
  client.setQueryData(["settings"], base);
  const pending = new Map<string, ReturnType<typeof deferred<UserSettings>>>();
  const save = (next: EditableSettings) => {
    const request = deferred<UserSettings>();
    pending.set(next.voice, request);
    return request.promise;
  };
  const voices: string[] = [];
  client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.query.queryKey[0] === "settings") {
      const voice = (event.query.state.data as UserSettings | undefined)?.voice;
      if (voice && voices.at(-1) !== voice) voices.push(voice);
    }
  });
  const mutate = (voice: string) => new MutationObserver(client, settingsMutationOptions(client, save)).mutate(editable(voice)).catch(() => undefined);
  const reply = (voice: string, updatedAt = "2026-09-24T01:00:00.000Z") => pending.get(voice)!.resolve({ ...base, voice, updatedAt });
  return { client, pending, voices, mutate, reply };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("settingsMutationOptions", () => {
  it("does not flip back to an older voice when its save finishes after a newer choice", async () => {
    const { client, voices, mutate, reply } = setup();
    const first = mutate("Aoede");
    await flush();
    const second = mutate("Charon");
    await flush();

    reply("Aoede");
    await first;
    reply("Charon");
    await second;

    expect(voices).toEqual(["Aoede", "Charon"]);
    expect(client.getQueryData<UserSettings>(["settings"])?.voice).toBe("Charon");
  });

  it("applies the server reply for a single save", async () => {
    const { client, mutate, reply } = setup();
    const save = mutate("Aoede");
    await flush();
    reply("Aoede", "2026-09-24T02:00:00.000Z");
    await save;

    expect(client.getQueryData<UserSettings>(["settings"])?.updatedAt).toBe("2026-09-24T02:00:00.000Z");
  });

  it("keeps the newer choice when an older save fails", async () => {
    const { client, pending, voices, mutate, reply } = setup();
    const first = mutate("Aoede");
    await flush();
    const second = mutate("Charon");
    await flush();

    pending.get("Aoede")!.reject(new Error("offline"));
    await first;
    reply("Charon");
    await second;

    expect(voices).toEqual(["Aoede", "Charon"]);
    expect(client.getQueryData<UserSettings>(["settings"])?.voice).toBe("Charon");
  });

  it("restores the previous settings when the only save fails", async () => {
    const { client, pending, mutate } = setup();
    const save = mutate("Aoede");
    await flush();
    pending.get("Aoede")!.reject(new Error("offline"));
    await save;

    expect(client.getQueryData<UserSettings>(["settings"])?.voice).toBe("Kore");
  });
});
