import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { CHROME_RAIL_WIDTH, createChromeRail } from "./chrome-rail.mjs";

const RAIL = "http://127.0.0.1:8799/rail";

function world({ wanted = true } = {}) {
  const page = Object.assign(new EventEmitter(), { mainFrame: { id: "page-frame" }, told: [], destroyed: false,
    send(channel, value) { if (channel === "rail:beside") this.told.push(value); }, isDestroyed() { return this.destroyed; } });
  const children = [];
  const win = Object.assign(new EventEmitter(), { webContents: page, size: [1440, 900], destroyed: false,
    getContentSize() { return this.size; }, isDestroyed() { return this.destroyed; },
    contentView: { addChildView: (view) => children.push(view), removeChildView: (view) => children.splice(children.indexOf(view), 1) } });
  const made = [];
  const createView = (options) => {
    const contents = Object.assign(new EventEmitter(), { mainFrame: { id: "rail-frame" }, loaded: [], sent: [], focused: 0, closed: false, opener: null,
      loadURL(url) { this.loaded.push(url); return Promise.resolve(); }, setWindowOpenHandler(handler) { this.opener = handler; },
      send(channel, ...values) { this.sent.push([channel, ...values]); }, focus() { this.focused++; }, isDestroyed() { return this.closed; }, close() { this.closed = true; } });
    const view = { options, webContents: contents, bounds: null, background: null, setBounds(bounds) { this.bounds = bounds; }, setBackgroundColor(color) { this.background = color; } };
    made.push(view);
    return view;
  };
  const state = { wanted };
  const rail = createChromeRail({ createView, preload: "/app/preload.cjs", args: () => ["--omb-local-origin=http://127.0.0.1:8799", "--omb-company-desktop=1"], url: () => RAIL, wanted: () => state.wanted });
  return { rail, win, page, children, made, state, settle: () => new Promise((resolve) => setImmediate(resolve)) };
}

test("two places or more: the rail's own page in a view at the window's left edge, and the page beside it moves over", async () => {
  const w = world();
  w.rail.attach(w.win);
  await w.settle();
  assert.equal(w.made.length, 1);
  const [view] = w.made;
  assert.deepEqual(w.children, [view]);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: CHROME_RAIL_WIDTH, height: 900 });
  assert.equal(view.background, "#00000000", "transparent where the rail draws nothing");
  assert.deepEqual(view.webContents.loaded, [RAIL]);
  assert.deepEqual(view.options.webPreferences, { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: "/app/preload.cjs",
    additionalArguments: ["--omb-local-origin=http://127.0.0.1:8799", "--omb-company-desktop=1"] });
  assert.deepEqual(w.page.told, [CHROME_RAIL_WIDTH], "the page beside it is told how wide the rail is");
  w.win.size = [1000, 700];
  w.win.emit("resize");
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: CHROME_RAIL_WIDTH, height: 700 }, "the rail follows the window's height");
  assert.equal(w.rail.shown(), true);
});

test("a sheet of the rail's covers the whole window until it closes; only the rail's page may ask", async () => {
  const w = world();
  const handlers = new Map();
  w.rail.install({ handle: (channel, handler) => handlers.set(channel, handler) });
  w.rail.attach(w.win);
  const [view] = w.made;
  const fromRail = { sender: view.webContents, senderFrame: view.webContents.mainFrame };
  handlers.get("rail:expand")(fromRail, true);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(view.webContents.focused, 1, "the sheet takes the keyboard");
  handlers.get("rail:expand")(fromRail, false);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: CHROME_RAIL_WIDTH, height: 900 });
  for (const event of [{ sender: w.page, senderFrame: w.page.mainFrame }, { sender: view.webContents, senderFrame: { id: "an-iframe" } }, {}]) {
    assert.throws(() => handlers.get("rail:expand")(event, true), /only available to the window's rail/);
  }
  assert.equal(w.rail.owns(fromRail), true);
  assert.equal(w.rail.owns({ sender: w.page, senderFrame: w.page.mainFrame }), false, "a place's page is never the rail");
});

test("each new document beside the rail is told again; with fewer than two places the rail goes and the page has the window", async () => {
  const w = world();
  w.rail.attach(w.win);
  w.page.emit("dom-ready");
  assert.deepEqual(w.page.told, [CHROME_RAIL_WIDTH, CHROME_RAIL_WIDTH], "the next server's page moves over too");
  w.state.wanted = false;
  w.rail.refresh();
  assert.deepEqual(w.children, []);
  assert.deepEqual(w.page.told.at(-1), 0, "the room is given back");
  w.page.emit("dom-ready");
  assert.equal(w.page.told.length, 3, "a page with no rail beside it is told nothing more");
  w.rail.expand(true);
  assert.equal(w.rail.expanded(), false, "nothing to cover while there is no rail");
  w.state.wanted = true;
  w.rail.refresh();
  assert.equal(w.made.length, 1, "the same page comes back");
  assert.deepEqual(w.children, [w.made[0]]);
});

test("the rail's page stays this app's rail: no other page, no new window; the window closing closes it", async () => {
  const w = world();
  w.rail.attach(w.win);
  const contents = w.made[0].webContents;
  for (const [target, kept] of [[RAIL, true], ["https://evil.example.test/", false], ["http://127.0.0.1:8799/", false]]) {
    let prevented = false;
    contents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, target);
    assert.equal(prevented, !kept, target);
  }
  assert.deepEqual(contents.opener({ url: "https://evil.example.test/" }), { action: "deny" });
  w.win.emit("closed");
  assert.equal(contents.closed, true);
  assert.equal(w.rail.shown(), false);
});

test("nothing to show: no view is made at all", () => {
  const w = world({ wanted: false });
  w.rail.attach(w.win);
  assert.deepEqual([w.made.length, w.children.length, w.page.told.length], [0, 0, 0]);
});

/** The app's preload in a page of the window, with what the room needs of the page: its document, size and zoom. */
function pageWithPreload(origin = "https://bots.example.test", pathname = "/") {
  const listeners = new Map(), handlers = new Map();
  const head = { children: [], append(node) { this.children.push(node); node.isConnected = true; } };
  const document = { documentElement: { style: { zoom: "" } }, head, createElement: () => ({ textContent: "", isConnected: false, remove() { head.children.splice(head.children.indexOf(this), 1); this.isConnected = false; } }) };
  const frame = { zoom: 1 };
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "darwin", argv: ["--omb-local-origin=http://127.0.0.1:8799", "--omb-company-desktop=1"] },
    location: { origin, pathname }, navigator: { userActivation: { isActive: false } }, TextEncoder, localStorage: { getItem: () => null }, queueMicrotask, document,
    window: { addEventListener: (type, listener) => listeners.set(type, listener) },
    require: () => ({ webUtils: {}, webFrame: { getZoomFactor: () => frame.zoom }, contextBridge: { exposeInMainWorld() {} },
      ipcRenderer: { on: (channel, handler) => handlers.set(channel, handler), removeListener() {}, send() {}, sendSync: () => null, invoke: () => Promise.resolve() } }),
  });
  return { head, frame, root: document.documentElement, tell: (width) => handlers.get("rail:beside")({}, width), resize: () => listeners.get("resize")() };
}

test("every page beside the rail, from any server, moves over by the rail's width at any zoom, and back when it goes", () => {
  const page = pageWithPreload();
  page.tell(CHROME_RAIL_WIDTH);
  assert.equal(page.head.children.length, 1);
  assert.match(page.head.children[0].textContent, /padding-left: 64px !important/);
  page.frame.zoom = 1.25;
  page.resize();
  assert.match(page.head.children[0].textContent, /padding-left: 51\.2px !important/, "zoomed in, the same 64 points on screen");
  page.tell("9999");
  assert.match(page.head.children[0].textContent, /padding-left: 160px/, "never more than 200 points, whatever is sent");
  page.tell(0);
  assert.equal(page.head.children.length, 0, "the page has the whole window again");
});

test("the rail's own page keeps its size at any zoom of this app's page (Chromium shares a host's zoom); no other page is touched", () => {
  const rail = pageWithPreload("http://127.0.0.1:8799", "/rail");
  rail.frame.zoom = 1.25;
  rail.resize();
  assert.equal(rail.root.style.zoom, "0.8", "zoomed in, the rail takes the zoom back out");
  rail.frame.zoom = 1;
  rail.resize();
  assert.equal(rail.root.style.zoom, "");
  for (const [origin, pathname] of [["http://127.0.0.1:8799", "/"], ["https://bots.example.test", "/rail"]]) {
    const page = pageWithPreload(origin, pathname);
    page.frame.zoom = 1.25;
    page.resize();
    assert.equal(page.root.style.zoom, "", `${origin}${pathname} keeps its zoom`);
  }
});
