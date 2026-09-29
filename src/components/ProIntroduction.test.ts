import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";
import { EMPTY_ONBOARDING } from "@/lib/onboarding";
import { withTourFinished, withTourReset } from "@/lib/guided-tour";

const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], state: {} as any, updater: null as any, streaming: {} }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: unknown) => { f.values[index] = next; }]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: vi.fn() }), useStreaming: () => ({ streaming: f.streaming }), api: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/analytics", () => ({ emailGateDone: () => false }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => f.updater }));
import { PRO_DISMISSED, ProIntroduction, ProSettingsCard, proOfferAvailable } from "./ProIntroduction";
import { api } from "@/state/store";

let storage: Map<string, string>;
let push: (value: CloudAccountState) => void;
const render = () => { f.index = 0; f.effects = []; return renderToStaticMarkup(createElement(ProIntroduction)); };
const signedOut = { status: "signed-out" } as const;
beforeEach(async () => {
  vi.clearAllMocks(); storage = new Map(); f.index = 0; f.values = []; f.updater = null; f.streaming = {};
  f.state = { connected: true, bots: [], groups: [], config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen: withTourFinished(undefined) } } };
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("window", { ogb: { cloudAccount: { state: () => Promise.resolve(signedOut), onState: (cb: typeof push) => { push = cb; return () => {}; } } } });
  render(); f.effects.forEach(effect => effect()); await Promise.resolve();
});
afterEach(() => vi.unstubAllGlobals());

it("shows the live benefits without enrolling, charging or refreshing an account", () => {
  const html = render();
  for (const text of ["Get Pro", "always-on", "Slack", "scheduled tasks", "Don’t show again"]) expect(html).toContain(text);
  expect(html).not.toContain("bg-gradient"); expect(html).not.toContain("amber-");
  expect(html).not.toContain("Coming soon"); expect(api).not.toHaveBeenCalled();
  expect(html).not.toContain('aria-modal="true"');
});
it("persists dismissal without a version and still offers Pro in Settings", async () => {
  f.index = 0;
  const card = ProIntroduction({})!;
  card.props.onDismiss(); await Promise.resolve();
  expect(storage.get(PRO_DISMISSED)).toBe("1");
  expect(api).toHaveBeenCalledWith("/api/config", { method: "PUT", body: JSON.stringify({ onboarding: { hintsSeen: [...f.state.config.onboarding.hintsSeen, PRO_DISMISSED] } }) });
  expect(render()).toBe("");
  f.values = []; f.index = 0;
  expect(render()).toBe(""); // New mount reads the saved preference.
  f.values = [signedOut]; f.index = 0;
  expect(renderToStaticMarkup(createElement(ProSettingsCard))).toContain("Get Pro");
});
it("honours workspace dismissal after browser storage is cleared and a tour is replayed", () => {
  f.state.config.onboarding.hintsSeen.push(PRO_DISMISSED);
  expect(withTourReset(f.state.config.onboarding)).toContain(PRO_DISMISSED);
  expect(render()).toBe("");
});
it.each(["appSettingsOpen", "settingsOpen", "newBotOpen", "pluginsOpen", "shortcutsOpen", "welcomeOpen", "tourOpen"])("does not interrupt %s", key => {
  f.state[key] = true; expect(render()).toBe("");
});
it("waits for onboarding, connection and busy background threads", () => {
  f.state.connected = false; expect(render()).toBe(""); f.state.connected = true;
  f.state.bots = [{ tasks: [{ busy: true }] }]; expect(render()).toBe(""); f.state.bots = [];
  f.state.config.onboarding = EMPTY_ONBOARDING; expect(render()).toBe("");
});
it("does not compete with updates", () => {
  f.updater = { status: "available" }; expect(render()).toBe("");
});
it("suppresses Pro subscribers, unknown/failed account state, and remote clients", () => {
  const pro = { status: "connected", entitlement: { plan: "pro", status: "active" } } as CloudAccountState;
  push(pro); expect(render()).toBe("");
  for (const state of [null, pro, { status: "unavailable" }, { status: "reauth-required" }, { status: "connecting" }] as Array<CloudAccountState | null>) expect(proOfferAvailable(state)).toBe(false);
  push(signedOut); window.ogb!.remoteClient = { active: true } as any; expect(render()).toBe("");
});
