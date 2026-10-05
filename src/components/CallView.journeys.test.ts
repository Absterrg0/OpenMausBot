// @vitest-environment happy-dom
// Calling a bot from a Cloud, the way a person does it, in a real page.
//
// Taking turns listens with the Mac app's own on-device speech recognition,
// so only the Mac app's page for This computer can take turns. Everywhere
// else (a browser, the Windows or Linux app, any server's page such as My
// Cloud) a one-to-one chat's call button is a Live call: no amber dot, no
// "Call unavailable" and no trip to This computer, which would leave the bot
// being called. The first Live call asks for the OpenAI key, saves it where
// the page runs (`PUT /api/config`; a server's page has no credential
// bridge), and goes straight on to the call: the microphone is asked for and
// the call bar shows. Rooms have no Live call, so a room's call button is
// only shown where taking turns can run.
//
// The desktop app's pages get the bridge the real preload builds for them
// (electron/preload.cjs: a server's page gets only its safe subset) and the
// capabilities the real builder reports (electron/capabilities.cjs).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { createElement, useReducer, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";

type Desktop = { capabilities: DesktopCapabilities; ready: boolean };
const fixture = vi.hoisted(() => ({ desktop: null as Desktop | null }));
vi.mock("./DesktopCapabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("./DesktopCapabilities")>();
  return {
    ...real,
    // null: what the page finds by itself (here a browser: no desktop bridge)
    useDesktopCapabilities: () => {
      const detected = real.useDesktopCapabilities();
      return fixture.desktop ?? detected;
    },
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

// This browser's (or app's) storage, where the picked call mode is kept.
const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
};
vi.stubGlobal("localStorage", storage);

const { CallButton } = await import("./CallView");
const { GroupCallButton } = await import("./GroupCallView");
const { LiveCallBar } = await import("./LiveCallBar");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { callMode, setCallMode } = await import("@/lib/call-mode");
const { currentCall, endCall } = await import("@/lib/call");
const { configureLiveMedia, liveMedia, resetLiveMedia } = await import("@/lib/live-call-media");

const { desktopCapabilities } = createRequire(import.meta.url)("../../electron/capabilities.cjs") as {
  desktopCapabilities(options: { platform: string; remote?: boolean; env?: Record<string, string>; homeDir?: string }): DesktopCapabilities;
};
const PRELOAD = readFileSync(join(process.cwd(), "electron", "preload.cjs"), "utf8");
const LOCAL_ORIGIN = "http://127.0.0.1:8799";
const CLOUD_ORIGIN = "https://omb-t-0123456789ab.fly.dev";

type Bridge = NonNullable<Window["ogb"]>;
/** The desktop app on `platform`, showing This computer's page or a server's
 * page (My Cloud): the bridge its preload gives that page, and what the app
 * reports the page can do. */
function desktopApp(platform: "darwin" | "win32", page: "this-computer" | "my-cloud"): { bridge: Bridge; desktop: Desktop } {
  let bridge: Bridge | undefined;
  runInNewContext(PRELOAD, {
    process: { platform, argv: [`--omb-local-origin=${LOCAL_ORIGIN}`] },
    location: { origin: page === "this-computer" ? LOCAL_ORIGIN : CLOUD_ORIGIN },
    TextEncoder,
    localStorage: { getItem: () => null },
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (_name: string, value: Bridge) => { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke: async () => undefined },
    }),
  });
  const capabilities = desktopCapabilities({ platform, remote: page === "my-cloud", env: {}, homeDir: "/Users/ada" });
  return { bridge: bridge!, desktop: { capabilities, ready: true } };
}
function open(app: { bridge: Bridge; desktop: Desktop }) {
  (window as { ogb?: Bridge }).ogb = app.bridge;
  fixture.desktop = app.desktop;
}

const ada: Bot = {
  id: "ada", threadId: "thread-ada", name: "Ada", title: "", description: "", color: "green",
  notifications: true, unread: false, messages: [], voice: "voice-1",
  modelSelection: { instanceId: "claude", model: "m" },
};
const room = {
  id: "room", threadId: "thread-room", name: "Standup", memberIds: ["ada"], defaultResponder: "everyone",
  bulletin: "", unread: false, createdAt: 1, messages: [],
} as unknown as Group;
const noKey = { configured: false, voice: "marin", readTypedReplies: true, idleMinutes: 5 };
/** The person's own Cloud: the voice comes with the plan, Live has no key yet. */
const CLOUD = { cloudHome: true, tts: { configured: true, ready: true, voice: "preset" }, live: noKey } as AppState["config"];
const THIS_COMPUTER = { tts: { configured: true, ready: true, voice: "voice-1" }, live: noKey } as AppState["config"];

function Page({ config, children }: { config: AppState["config"]; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, config, bots: [ada] });
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return createElement(BotEditorStore, { value, children });
}

let root: Root;
let container: HTMLElement;
let requests: Array<{ path: string; method: string; body: unknown }>;
let getUserMedia: ReturnType<typeof vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>>;

/** A chat with Ada: its call button, and the call bar above the composer. */
function chat(config: AppState["config"]) {
  flushSync(() => root.render(createElement(Page, {
    config,
    children: [
      createElement(CallButton, { key: "call", bot: ada, placement: "composer" }),
      createElement(LiveCallBar, { key: "bar", bot: ada }),
    ],
  })));
}
function roomHeader(config: AppState["config"]) {
  flushSync(() => root.render(createElement(Page, { config, children: createElement(GroupCallButton, { group: room, members: [ada] }) })));
}
const callButton = () => container.querySelector<HTMLButtonElement>("[data-call-button]");
const press = (element: Element | null) => {
  if (!element) throw new Error("nothing to press");
  flushSync(() => (element as HTMLElement).click());
};
const menuItems = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
const text = () => container.textContent ?? "";

/** Click the call button, paste a key, save: the Live call starts. */
async function firstLiveCall() {
  const button = callButton();
  expect(button?.getAttribute("aria-label")).toBe("Live call with Ada");
  // the ordinary call button: no amber dot, nothing to explain
  expect(button?.querySelector(".bg-warning")).toBeNull();
  press(button);
  expect(text()).toContain("Live calls use OpenAI GPT-Live");
  expect(text()).not.toContain("Call unavailable");
  const field = container.querySelector<HTMLInputElement>('input[aria-label="OpenAI API key for Live calls"]')!;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, "sk-live-test");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  flushSync(() => field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  // saved where the page runs: the Cloud keeps the key
  await vi.waitFor(() => expect(requests).toContainEqual({ path: "/api/config", method: "PUT", body: { live: { key: "sk-live-test" } } }));
  // and the call goes on: the microphone is asked for, the call bar shows
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  expect(liveMedia()).toMatchObject({ phase: "starting", botId: "ada", threadId: "thread-ada" });
  await vi.waitFor(() => expect(text()).toContain("Live with Ada"));
  expect(text()).not.toContain("Live calls use OpenAI GPT-Live");
  expect(text()).not.toContain("Choose This computer");
}

/** The arrow's menu: Take turns is there but can't be picked here; Live is the call. */
function expectTurnsDisabled(reason: string) {
  press(container.querySelector('[aria-label="Call mode"]'));
  const [turns, live] = menuItems();
  expect(turns?.textContent).toContain("Take turns");
  expect(turns?.disabled).toBe(true);
  expect(turns?.textContent).toContain(reason);
  expect(turns?.getAttribute("aria-checked")).toBe("false");
  expect(live?.textContent).toContain("Live");
  expect(live?.disabled).toBe(false);
  expect(live?.getAttribute("aria-checked")).toBe("true");
  expect(text()).not.toContain("Choose This computer");
  press(container.querySelector('[aria-label="Call mode"]'));
  expect(menuItems()).toHaveLength(0);
}

beforeEach(() => {
  // a first visit: nothing remembered in this browser or app
  vi.stubGlobal("localStorage", storage);
  setCallMode("turns");
  stored.clear();
  fixture.desktop = null;
  delete (window as { ogb?: Bridge }).ogb;
  requests = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ path, method, body });
    if (path === "/api/config" && method === "PUT") {
      return new Response(JSON.stringify({ ...CLOUD, live: { ...noKey, configured: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "not here" }), { status: 404 });
  });
  // the microphone prompt stays open: the call stays "starting"
  getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => new Promise<MediaStream>(() => {}));
  configureLiveMedia({ getUserMedia });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  resetLiveMedia();
  endCall();
  setCallMode("turns");
  fixture.desktop = null;
  delete (window as { ogb?: Bridge }).ogb;
  vi.unstubAllGlobals();
});

describe("calling a bot off the Mac", () => {
  it("in a browser on the person's Cloud, the first visit's call button is a Live call that asks for the key once and calls", async () => {
    expect(callMode()).toBe("turns");
    chat(CLOUD);
    await firstLiveCall();
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(1);
  });

  it("on My Cloud in the Mac app, the call is Live, and Take turns says it works on This computer", async () => {
    open(desktopApp("darwin", "my-cloud"));
    chat(CLOUD);
    expectTurnsDisabled("Calls where you take turns work on This computer");
    await firstLiveCall();
  });

  it("on My Cloud in the Windows app, the call is Live, and Take turns says it needs the Mac app", async () => {
    open(desktopApp("win32", "my-cloud"));
    chat(CLOUD);
    expectTurnsDisabled("Calls where you take turns need the Mac app");
    await firstLiveCall();
  });

  it("on This computer in the Mac app, Take turns stays the default and a picked mode is kept", () => {
    open(desktopApp("darwin", "this-computer"));
    chat(THIS_COMPUTER);
    expect(callButton()?.getAttribute("aria-label")).toBe("Call Ada");
    press(container.querySelector('[aria-label="Call mode"]'));
    expect(menuItems().map((item) => [item.disabled, item.getAttribute("aria-checked")])).toEqual([[false, "true"], [false, "false"]]);
    press(container.querySelector('[aria-label="Call mode"]'));

    press(callButton());
    expect(currentCall()).toBe("ada");
    expect(liveMedia().phase).toBe("idle");
    endCall();

    setCallMode("live");
    chat(THIS_COMPUTER);
    expect(callButton()?.getAttribute("aria-label")).toBe("Live call with Ada");
    setCallMode("turns");
    chat(THIS_COMPUTER);
    expect(callButton()?.getAttribute("aria-label")).toBe("Call Ada");
  });

  it("shows a room's call button only where taking turns can run: not on a Cloud", () => {
    roomHeader(CLOUD);
    expect(callButton()).toBeNull();
    open(desktopApp("darwin", "my-cloud"));
    roomHeader(CLOUD);
    expect(callButton()).toBeNull();
    open(desktopApp("win32", "my-cloud"));
    roomHeader(CLOUD);
    expect(callButton()).toBeNull();

    open(desktopApp("darwin", "this-computer"));
    roomHeader(THIS_COMPUTER);
    expect(callButton()?.getAttribute("aria-label")).toBe("Call Standup");
  });
});
