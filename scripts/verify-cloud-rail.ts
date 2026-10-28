// The rail of Clouds and its ＋ sheet in the real app, as a Cloud's page in the desktop window shows them, against a
// disposable fake-engine server; the desktop bridge's rail and add-a-Cloud answers are the preview's own fixtures.
// Run: node --experimental-strip-types scripts/verify-cloud-rail.ts [--shots <dir> [--only <view,view>]]
// With --shots it photographs each view in a light and a dark skin with a headless Chrome in a throwaway profile
// (OMB_CDP_CHROME, else the installed Google Chrome) and exits; without, it prints the preview's address and waits.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const at = process.argv.indexOf("--shots");
const shots = at === -1 ? null : resolve(process.argv[at + 1] ?? "");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt === -1 ? null : new Set((process.argv[onlyAt + 1] ?? "").split(",").filter(Boolean));
const CHROME = process.env.OMB_CDP_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Each view: its query, what must be on screen before the picture, and the window's height. */
const VIEWS: Array<{ name: string; query: string; ready: string; height?: number }> = [
  { name: "rail", query: "", ready: "[data-places-rail]" },
  { name: "rail-simple", query: "mode=simple", ready: "[data-places-rail]" },
  { name: "rail-many", query: "places=many&more=1", ready: "[data-rail-more] li" },
  { name: "add-sheet", query: "sheet=add", ready: "[data-place-add='choose']" },
  { name: "add-own-server", query: "sheet=server", ready: "[data-place-add='own-server']" },
  { name: "add-buy-cloud", query: "sheet=cloud", ready: "[data-plan-buy]", height: 900 },
  { name: "add-name-colour", query: "sheet=name", ready: "[data-cloud-add='extra-name']" },
  { name: "add-setting-up", query: "sheet=cloud&adding=setting_up", ready: "[data-cloud-add='extra-starting']" },
  { name: "rail-servers", query: "places=servers&look=teal", ready: "[data-rail-server]" },
  { name: "connect-server", query: "places=servers&sheet=connect", ready: "[data-place-add='connect-server']" },
  { name: "look-settings", query: "look=teal&settings=look", ready: "[data-place-look='admin']" },
  { name: "look-member", query: "member=1&settings=look", ready: "[data-place-look='locked']" },
];
const SKINS = [{ id: "daylight", look: "light" }, { id: "midnight", look: "dark" }];

/** One page of a headless Chrome over the DevTools protocol: navigate, wait for a selector, photograph. */
async function openChrome(profile: string) {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--use-mock-keychain",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  let port = "";
  for (let i = 0; i < 100 && !port; i++) {
    await delay(100);
    try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]!.trim(); } catch {}
  }
  if (!port) { chrome.kill(); throw new Error("Chrome did not start"); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const socket = new WebSocket(targets.find((target) => target.type === "page")!.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let next = 0;
  const waiting = new Map<number, { done: (value: any) => void; fail: (error: Error) => void }>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    const call = waiting.get(message.id);
    if (!call) return;
    waiting.delete(message.id);
    if (message.error) call.fail(new Error(message.error.message)); else call.done(message.result);
  };
  const send = (method: string, params: object = {}) => new Promise<any>((done, fail) => {
    const id = ++next;
    waiting.set(id, { done, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  return {
    async shoot(url: string, ready: string, file: string, height = 800) {
      await send("Emulation.setDeviceMetricsOverride", { width: 1280, height, deviceScaleFactor: 2, mobile: false });
      await send("Page.navigate", { url });
      const end = Date.now() + 60_000;
      const condition = `Boolean(document.querySelector(${JSON.stringify(ready)}) && document.querySelector("[data-sidebar-bot-row], [data-sidebar-hero]"))`;
      while (!(await evaluate(condition).catch(() => false))) {
        if (Date.now() > end) throw new Error(`${url}: ${ready} never showed (${await evaluate("document.querySelector('main')?.textContent?.slice(0, 120) ?? ''")})`);
        await delay(250);
      }
      await delay(900);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    close() { socket.close(); chrome.kill(); },
  };
}

const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  for (const name of ["Chief of Staff", "Research", "Inbox"]) await runControlOmb(["new-bot", "--name", name, "--url", fixture.info.url]);
  ui = await mountPreview(fixture, { entry: "/scripts/testing/rail-preview.tsx", route: "/__cloud-rail.html", title: "Isolated rail of Clouds", logLevel: "warn" });
  if (!shots) {
    console.log(JSON.stringify({ ...fixture.info, previewUrl: ui.previewUrl }, null, 2));
    await parkUntilSignal();
  } else {
    mkdirSync(shots, { recursive: true });
    const profile = mkdtempSync(join(tmpdir(), "omb-rail-chrome-"));
    const chrome = await openChrome(profile);
    try {
      for (const view of VIEWS.filter((entry) => !only || only.has(entry.name))) for (const skin of SKINS) {
        const file = join(shots, `${view.name}-${skin.look}.png`);
        await chrome.shoot(`${ui.previewUrl}?skin=${skin.id}${view.query ? `&${view.query}` : ""}`, view.ready, file, view.height);
        console.log(file);
      }
    } finally {
      chrome.close();
      await delay(500);
      rmSync(profile, { recursive: true, force: true });
    }
  }
} finally {
  await ui?.close();
  await fixture.close();
}
