import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudAccountBridge, CloudAccountState } from "../../electron/cloud-account.mjs";
import { setLocale } from "@/lib/i18n";
const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = initial; return [f.values[index], (next: unknown) => { f.values[index] = next; }]; },
  useRef: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = { current: initial }; return f.values[index]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
import { CloudAccountSettings } from "./CloudAccountSettings";
type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] { if (!isValidElement(value)) return []; const node = value as Node; return [node, ...Children.toArray(node.props.children).flatMap(nodes)]; }
function render() { f.index = 0; f.effects = []; let tree: ReactNode; function Capture() { tree = CloudAccountSettings(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture)); return { html, nodes: nodes(tree) }; }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const click = (label: string) => { const button = render().nodes.find(node => node.type === "button" && node.props.children === label); expect(button).toBeTruthy(); button!.props.onClick!(); };
let bridge: CloudAccountBridge, push: (state: CloudAccountState) => void;
const free: CloudAccountState = { status: "connected", account: { id: "fixture", email: "person@example.test" }, entitlement: { plan: "free", status: "inactive", expiresAt: null, version: 0 } };
beforeEach(() => {
  f.values = []; f.index = 0; f.effects = []; push = () => {};
  bridge = { state: vi.fn().mockResolvedValue({ status: "signed-out" }), begin: vi.fn().mockResolvedValue({ status: "connecting" }),
    reopen: vi.fn().mockResolvedValue({ status: "connecting" }), cancel: vi.fn().mockResolvedValue({ status: "signed-out" }),
    refresh: vi.fn().mockResolvedValue(free), signOut: vi.fn().mockResolvedValue({ status: "signed-out" }), openDashboard: vi.fn().mockResolvedValue(free),
    onState: vi.fn(callback => { push = callback; return () => {}; }) };
  vi.stubGlobal("window", { ogb: { cloudAccount: bridge } }); vi.stubGlobal("fetch", vi.fn()); setLocale("en");
});
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });
async function ready(state: CloudAccountState = { status: "signed-out" }) { vi.mocked(bridge.state).mockResolvedValueOnce(state); render(); const cleanup = f.effects[0](); await flush(); return cleanup; }
it("loads optional account state without enrollment/network and delegates sign-in without arguments", async () => {
  await ready(); expect(bridge.begin).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(render().html).toContain("Free local use"); expect(render().html).toContain("separate from organization sign-in");
  click("Sign in to OMB Cloud"); await flush(); expect(bridge.begin).toHaveBeenCalledExactlyOnceWith();
});
it("checkout opens the dashboard but only a verified native update displays Pro; unavailable/revoked states remove it", async () => {
  await ready(free); click("Get Pro in your browser"); await flush(); expect(bridge.openDashboard).toHaveBeenCalledExactlyOnceWith();
  expect(render().html).not.toContain("Pro active");
  push({ ...free, entitlement: { plan: "pro", status: "active", expiresAt: null, version: 1 } }); expect(render().html).toContain("Pro active");
  push({ status: "unavailable" }); expect(render().html).not.toContain("Pro active");
  push({ status: "reauth-required" }); expect(render().html).not.toContain("Pro active");
});
it("sign-out requires confirmation and preserves local and organization wording", async () => {
  await ready(free); click("Sign out of OMB Cloud"); expect(bridge.signOut).not.toHaveBeenCalled();
  expect(render().html).toContain("does not cancel your subscription"); click("Keep signed in"); expect(bridge.signOut).not.toHaveBeenCalled();
  click("Sign out of OMB Cloud"); click("Sign out of OMB Cloud"); await flush(); expect(bridge.signOut).toHaveBeenCalledExactlyOnceWith();
  expect(render().html).toContain("Sign in to OMB Cloud"); expect(fetch).not.toHaveBeenCalled();
});
it("never accesses account bridge from remote companion pages", async () => {
  vi.stubGlobal("window", { ogb: { cloudAccount: bridge, remoteClient: { active: true } } }); render(); f.effects[0](); await flush();
  expect(bridge.state).not.toHaveBeenCalled(); expect(bridge.onState).not.toHaveBeenCalled(); expect(render().html).toContain("local desktop app");
});
it("a late initial snapshot cannot replace a newer revoked state", async () => {
  let resolve!: (state: CloudAccountState) => void; vi.mocked(bridge.state).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(); f.effects[0](); push({ status: "reauth-required" }); resolve(free); await flush(); expect(render().html).toContain("expired or was revoked");
});
