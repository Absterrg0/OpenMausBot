// The rail of places as the window's own chrome: this app's small page in a view of its own at the window's left edge,
// beside whichever place's page the window shows. Every place gets it, whatever that server runs, and no place's page
// ever reads the list of places: the rail's page is this app's own, and only main switches places.
//
// The page beside it leaves the rail its width: main tells each of its documents how wide the rail is (`rail:beside`),
// and the app's preload, which every page in the window gets, moves the page over by that much at any zoom. The rail's
// sheets (＋, the list past eight) open over the whole window: while one is open the view covers the window,
// transparent but for the sheet, and goes back to its strip when it closes.

export const CHROME_RAIL_WIDTH = 64;
export const CHROME_RAIL_PATH = "/rail";

/**
 * @param {{
 *   createView: (options: object) => any,
 *   preload: string,
 *   args: () => string[],
 *   url: () => string,
 *   wanted: () => boolean,
 *   log?: (line: string) => void,
 * }} deps `url()`: the rail's page on this app's own server; `wanted()`: whether the window has two places or more to
 * show it for (railPlaces); `args()`: the preload's arguments, as the window's own page gets them.
 */
export function createChromeRail({ createView, preload, args, url, wanted, log = () => {} }) {
  let view = null, win = null, shown = false, expanded = false;
  const alive = () => Boolean(win && !win.isDestroyed());
  const layout = () => {
    if (!view || !shown || !alive()) return;
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width: expanded ? width : Math.min(CHROME_RAIL_WIDTH, width), height });
  };
  const page = () => (alive() && !win.webContents.isDestroyed() ? win.webContents : null);
  /** The page beside the rail moves over by its width (0: it has the whole window again). */
  const tellPage = () => page()?.send("rail:beside", shown ? CHROME_RAIL_WIDTH : 0);
  const ensureView = () => {
    if (view) return view;
    view = createView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload, additionalArguments: args() } });
    view.setBackgroundColor?.("#00000000");
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    const stay = (event, target) => { if (target !== url()) event.preventDefault(); };
    contents.on("will-navigate", stay);
    contents.on("will-redirect", stay);
    contents.on("render-process-gone", () => { log("chrome rail: its page went away; loading it again"); void contents.loadURL(url()).catch(() => {}); });
    void contents.loadURL(url()).catch((error) => log(`chrome rail: ${error?.message ?? error}`));
    return view;
  };
  const rail = {
    /** The window the rail stands beside: its size moves the rail, and each of its documents gets the room again. */
    attach(next) {
      win = next;
      shown = false; expanded = false;
      win.on("resize", layout);
      // Each new document is told again, once it is ready.
      win.webContents.on("dom-ready", () => { if (shown) tellPage(); });
      win.once("closed", () => {
        if (view && !view.webContents.isDestroyed()) view.webContents.close?.({ waitForBeforeUnload: false });
        view = null; win = null; shown = false; expanded = false;
      });
      rail.refresh();
    },
    /** Shown while there are two places or more (railPlaces), hidden otherwise: the page then has the whole window. */
    refresh() {
      const on = alive() && wanted();
      if (on === shown) { layout(); return; }
      shown = on;
      if (on) {
        win.contentView.addChildView(ensureView());
        layout();
        tellPage();
      } else {
        expanded = false;
        if (view) win.contentView.removeChildView(view);
        tellPage();
      }
    },
    /** A sheet of the rail's is open: the view covers the window until it closes. */
    expand(on) {
      const was = expanded;
      expanded = on === true && shown;
      layout();
      // The keyboard goes with the sheet, and back to the page once it closes.
      if (expanded) view?.webContents.focus();
      else if (was) page()?.focus?.();
    },
    /** The rail's own page asks (never a place's page). */
    owns: (event) => Boolean(view && event?.sender === view.webContents && event.senderFrame === view.webContents.mainFrame),
    shown: () => shown,
    expanded: () => expanded,
    /** The rail's page asks for the whole window while a sheet of its own is open, and gives it back after. */
    install(ipcMain) {
      ipcMain.handle("rail:expand", (event, on) => {
        if (!rail.owns(event)) throw new Error("rail:expand is only available to the window's rail");
        rail.expand(on === true);
      });
    },
    /** Tells the rail's page something (the places changed, the skin of the page beside it). */
    send(channel, ...values) {
      if (view && !view.webContents.isDestroyed()) view.webContents.send(channel, ...values);
    },
  };
  return rail;
}
