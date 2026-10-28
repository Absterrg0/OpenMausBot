// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlaceLook } from "../../electron/place-look.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); vi.resetModules(); });

const look = (over: Partial<PlaceLook> = {}): PlaceLook => ({ name: "Client A", color: "teal", swatch: "green", change: "admin", ...over });

/** The page's bridge, and the card and tint as a fresh page loads them (the look is shared across the page). */
async function page(start: PlaceLook | null, answer: (swatch: string | null) => { outcome: string; look: PlaceLook | null } = (swatch) => ({ outcome: "saved", look: look({ swatch: swatch as never, color: swatch === "rose" ? "red" : null }) })) {
  vi.resetModules();
  let changed: () => void = () => {};
  const workspaces = { look: vi.fn(async () => start), color: vi.fn(async (swatch: string | null) => answer(swatch)), onChanged: vi.fn((callback: () => void) => { changed = callback; return () => {}; }) };
  Object.assign(window, { ogb: { workspaces } });
  const { setLocale } = await import("@/lib/i18n");
  setLocale("en");
  const { PlaceLookCard } = await import("./PlaceLookCard");
  const { PlaceTint } = await import("./PlaceTint");
  root = createRoot(host);
  await act(async () => { root!.render(createElement("div", null, createElement(PlaceTint), createElement(PlaceLookCard))); });
  await act(async () => { await Promise.resolve(); });
  return { workspaces, changed: () => changed() };
}
const swatch = (name: string) => host.querySelector(`[data-swatch="${name}"]`) as HTMLButtonElement;

it("the tint: a place's colour in the skin's own tone; no colour, or one this app doesn't draw, leaves the sidebar as it was", async () => {
  const { placeTint } = await import("@/lib/place-look");
  expect(placeTint("teal")).toEqual({ "--place-tint": "var(--identity-teal)" });
  expect(placeTint("orange")).toEqual({ "--place-tint": "var(--identity-orange)" });
  for (const none of [null, undefined, "", "slate", "url(x)", "teal;background:red"]) expect(placeTint(none)).toBeNull();
  await page(look({ color: null, swatch: "slate" }));
  expect(host.querySelector("[data-place-tint]")).toBeNull();
});

it("choosing a swatch saves it through main, and the tint follows at once", async () => {
  const { workspaces } = await page(look());
  expect(host.querySelector("[data-place-tint]")?.getAttribute("style")).toContain("var(--identity-teal)");
  expect(swatch("green").getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("Client A shows in this color at the top of the sidebar and on its circle at the window's left edge.");
  await act(async () => { swatch("rose").click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(workspaces.color).toHaveBeenCalledWith("rose");
  expect(swatch("rose").getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector("[data-place-tint]")?.getAttribute("style")).toContain("var(--identity-red)");
  await act(async () => { swatch("rose").click(); await Promise.resolve(); });
  expect(workspaces.color).toHaveBeenCalledTimes(1);
});

it("a team member sees the team's colour and who may change it, and their click changes nothing", async () => {
  const { workspaces } = await page(look({ name: "Acme", change: null, reason: "member" }));
  expect([...host.querySelectorAll("[data-swatch]")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(host.querySelector('[data-place-look="locked"]')?.textContent).toContain("Only its admins can change its color.");
  await act(async () => { swatch("rose").click(); await Promise.resolve(); });
  expect(workspaces.color).not.toHaveBeenCalled();
  expect(host.querySelector("[data-place-tint]")?.getAttribute("style"), "they still see it").toContain("var(--identity-teal)");
});

it("the Admin's refusal, an Admin without the route, and a failure: said plainly, and the colour stays", async () => {
  for (const [outcome, words] of [["refused", "Only its admins can change its color."], ["unsupported", "This Cloud's color can't be changed from the app yet."], ["failed", "The color wasn't saved. Try again."]] as const) {
    await act(async () => root?.unmount());
    await page(look(), () => ({ outcome, look: look() }));
    await act(async () => { swatch("rose").click(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain(words);
    expect(swatch("green").getAttribute("aria-checked")).toBe("true");
  }
});

it("this computer's own page, an older app or a browser: no card, no tint", async () => {
  await page(null);
  expect(host.innerHTML).toBe("<div></div>");
  await act(async () => root?.unmount());
  vi.resetModules();
  Object.assign(window, { ogb: { workspaces: { state: vi.fn() } } });
  const { PlaceLookCard } = await import("./PlaceLookCard");
  root = createRoot(host);
  await act(async () => { root!.render(createElement(PlaceLookCard)); });
  expect(host.innerHTML).toBe("");
});

it("main's word that the place changed (another window, the Admin): the card and tint read it again", async () => {
  const { workspaces, changed } = await page(look());
  workspaces.look.mockResolvedValueOnce(look({ color: "purple", swatch: "violet" }));
  await act(async () => { changed(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(swatch("violet").getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector("[data-place-tint]")?.getAttribute("style")).toContain("var(--identity-purple)");
});
