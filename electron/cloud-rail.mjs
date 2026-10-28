// The rail of places at the left of the window (the renderer's PlacesRail) and its ＋: main builds the list, says who
// may read it, and does what a circle or ＋ asks through main's own switch and dialogs.
//
// Security: the list carries names, colours and states, never an address, and goes only to this app's own page and to
// pages of Clouds MausBot runs that the verified session lists (the person's own Clouds and their teams' Clouds). A
// server the person connected by hand, or a Cloud on a server of their own, runs a page anyone may have written, so it
// would learn the names of the person's other places; it gets none, and the native Server menu stays its switcher. A
// circle names a saved place by its id; main opens only an id it listed itself.
import environments from "./environments.cjs";
import { cleanCloudListName, CLOUD_SWATCHES, cloudSetupProgress, olderRelease, otherOwnClouds, ownCloud, signedInServers, stepProgress, swatchColor } from "./cloud-list.mjs";
import { machineSetup } from "./cloud-home.mjs";

export const RAIL_MIN_PLACES = 2;
const PENDING = "pending:";
const SIGNED_IN = "signed-in:";

/** A server or computer of the person's own that signed in with their account, as its circle says it: online while the
 * Admin heard from it in the last few minutes, else offline since when it was last seen; and an older release than the
 * newest one, while the Admin names that (`latest`; none while it doesn't follow releases). */
const serverState = (listed, latest = null) => ({ server: true, ...(listed.status !== "ready" ? { offline: true } : {}), ...(listed.lastSeenAt ? { lastSeenAt: listed.lastSeenAt } : {}),
  ...(listed.version && latest && olderRelease(listed.version, latest) ? { update: { version: listed.version, latest } } : {}) });

/** A Cloud's address is one MausBot runs for this person: My Cloud (`mine`), or a Cloud the verified session lists on
 * MausBot Cloud. Without the session's list of Clouds (an older Admin), a team's Cloud it lists, all of which MausBot runs. */
export function hostedCloudOrigin(origin, { state, mine = null }) {
  if (typeof origin !== "string" || !origin) return false;
  if (origin === mine) return true;
  const connected = state?.status === "connected" ? state : null;
  if (!connected) return false;
  if (Array.isArray(connected.clouds)) return connected.clouds.some(cloud => cloud.origin === origin && cloud.runsOn === "cloud");
  return (connected.teams ?? []).some(team => team?.machine?.origin === origin);
}

const machineProgress = machine => {
  const setup = machineSetup(machine);
  return setup ? stepProgress(setup.step) : null;
};

/** One saved place as a circle: what it is, its colour and how it is doing, from the session's word for it. */
function circle(entry, { activeId, mine, state }) {
  const connected = state?.status === "connected" ? state : null;
  const listed = connected?.clouds?.find(cloud => cloud.origin === entry.origin) ?? null;
  const kind = entry.origin === mine || entry.home || entry.cloud ? "cloud" : entry.team ? "team" : "server";
  const team = entry.team ? connected?.teams?.find(candidate => candidate?.id === entry.team.id) ?? null : null;
  const machine = entry.origin === mine ? connected?.machine ?? null : team?.machine ?? null;
  const progress = listed ? cloudSetupProgress(listed) : machineProgress(machine);
  const problem = listed ? listed.status === "payment_problem" && listed.role === "owner" : entry.origin === mine && machine?.status === "payment-problem";
  const color = environments.ENTRY_COLORS.includes(entry.color) ? entry.color : listed ? swatchColor(listed.color) : null;
  return { id: entry.id, name: entry.name, color, kind, opens: true, ...(entry.id === activeId ? { active: true } : {}),
    ...(progress !== null ? { progress } : {}), ...(problem ? { attention: true } : {}), ...(listed?.managed === false ? serverState(listed, connected?.latestVersion ?? null) : {}) };
}

/**
 * The circles, in the Server menu's order: This computer while it is a place (before the move made My Cloud home, `home`
 * null), My Cloud, the person's other Clouds and their teams' Clouds in the session's order, then servers saved by hand.
 * A server of theirs that signed in with their account comes next: one saved here already is that saved place (online
 * or not), one not connected to this app yet shows how to connect it, and one only reachable on its own network has
 * nothing to open. A Cloud of theirs the Admin is still making (no address yet) is there too, not yet to open. Fewer
 * than RAIL_MIN_PLACES places besides this computer: no rail at all, the window as it was.
 * @param {{ saved: { environments: any[], activeId: string }, home?: string | null, mine?: string | null, state?: any }} input
 */
export function railPlaces({ saved, home = null, mine = null, state = null }) {
  const connected = state?.status === "connected" ? state : null;
  const clouds = Array.isArray(connected?.clouds) ? connected.clouds : [];
  const order = entry => { const at = clouds.findIndex(cloud => cloud.origin === entry.origin); return at === -1 ? clouds.length : at; };
  const rank = entry => (entry.origin === mine || entry.home ? 0 : environments.listedPlace(entry) ? 1 : 2);
  const remote = saved.environments.filter(entry => entry.kind !== "local" && entry.origin)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || order(a.entry) - order(b.entry) || a.index - b.index)
    .map(({ entry }) => circle(entry, { activeId: saved.activeId, mine, state: connected }));
  const making = otherOwnClouds(clouds).filter(cloud => !cloud.origin && ["checkout", "setting_up"].includes(cloud.status))
    .map(cloud => ({ id: `${PENDING}${cloud.id}`, name: cloud.name, color: swatchColor(cloud.color), kind: "cloud", opens: false, progress: cloudSetupProgress(cloud) ?? 0,
      ...(cloud.status === "checkout" ? { waiting: true } : {}) }));
  const savedOrigins = new Set(saved.environments.map(entry => entry.origin).filter(Boolean));
  const servers = signedInServers(clouds).filter(cloud => !cloud.origin || !savedOrigins.has(cloud.origin))
    .map(cloud => ({ id: `${SIGNED_IN}${cloud.id}`, name: cloud.name, color: swatchColor(cloud.color), kind: "server", opens: false,
      ...(cloud.origin ? { pairs: true } : { ownNetwork: true }), ...serverState(cloud, connected?.latestVersion ?? null) }));
  const places = [...remote, ...servers, ...making];
  if (places.length < RAIL_MIN_PLACES) return [];
  return home ? places : [{ id: environments.LOCAL_ID, name: "This computer", color: null, kind: "computer", opens: true, ...(saved.activeId === environments.LOCAL_ID ? { active: true } : {}) }, ...places];
}

/** What buying another Cloud looks like from a page: no account, address or checkout page, only what the sheet says. */
export function addCloudView(state, offer) {
  const connected = state?.status === "connected" ? state : null;
  if (!connected) return { signedIn: false };
  const clouds = Array.isArray(connected.clouds) ? connected.clouds : null;
  const owned = clouds ? clouds.filter(ownCloud) : [];
  const has = Boolean(connected.machine) || owned.length > 0;
  const home = clouds?.find(cloud => cloud.primary) ?? null;
  const adding = connected.adding ?? null, listed = adding ? clouds?.find(cloud => cloud.id === adding.cloudId) ?? null : null;
  const status = !listed || listed.status === "checkout" ? "checkout" : ["ready", "offline"].includes(listed.status) && listed.origin ? "ready"
    : listed.status === "setting_up" || listed.status === "ready" ? "setting_up" : "problem";
  return {
    signedIn: true, hasCloud: has, supported: Boolean(clouds),
    canAdd: Boolean(clouds) && connected.addCloud?.canAdd !== false,
    ...(connected.addCloud?.canAdd === false ? { blocked: connected.addCloud.blocked } : {}),
    offer: offer ?? null, count: Math.max(owned.length, has ? 1 : 0),
    ...(home ? { home: { name: home.name, color: swatchColor(home.color) } } : {}),
    ...(adding ? { adding: { name: adding.name, color: adding.color, tier: adding.tier, startedAt: adding.startedAt, status,
      ...(listed && cloudSetupProgress(listed) !== null ? { progress: cloudSetupProgress(listed) } : {}), ...(adding.link ? { link: true } : {}), ...(adding.done ? { done: true } : {}) } } : {}),
  };
}

/**
 * "“{name}” is ready", once per Cloud this app bought, unless its sheet shows it in the focused window; a click opens it.
 */
export function createAddedCloudNotice({ Notification, focused, sheetOpen, open, shown = () => {} }) {
  const announced = new Set();
  return state => {
    const adding = state?.status === "connected" ? state.adding : null;
    const listed = adding && !adding.done ? state.clouds?.find(cloud => cloud.id === adding.cloudId) ?? null : null;
    if (!listed || !["ready", "offline"].includes(listed.status) || !listed.origin || announced.has(adding.cloudId)) return false;
    announced.add(adding.cloudId);
    if ((focused() && sheetOpen()) || !Notification.isSupported()) return false;
    const note = new Notification({ title: `“${listed.name}” is ready`, body: "Click to open it." });
    note.on("click", () => open(adding.cloudId));
    note.show();
    shown();
    return true;
  };
}

const plain = value => (typeof value === "string" ? value : "");
const CHOICES = Object.freeze(["cloud", "link", "address"]);

/**
 * The rail's and ＋'s channels, each behind main's window guard (`guard`) and allowed only on a page `trusted` vouches
 * for (this app's own, or a hosted Cloud's). `places()` is railPlaces' list now; `open(id)` main's own switch; `add`
 * the ＋ sheet's fixed actions; `account()` the MausBot Cloud sign-in.
 */
export function installCloudRail({ ipcMain, guard, trusted, places, open, add, account, clipboard, openCloud, window }) {
  let sheetOpen = false, sent = "";
  const allowed = (channel, handler) => guard((event, ...args) => {
    if (!trusted(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(event, ...args);
  });
  const handle = (channel, handler) => ipcMain.handle(channel, allowed(channel, handler));
  const view = async () => addCloudView(account()?.state() ?? null, account() ? await account().offer().catch(() => null) : null);
  ipcMain.handle("workspaces:places", guard((event) => (trusted(event) ? { places: places(), add: add.choices() } : { places: [], add: { cloud: false, link: false, address: false } })));
  handle("workspaces:open", (_event, id) => {
    const place = places().find(entry => entry.id === plain(id) && entry.opens);
    if (!place) throw new Error("That place isn't here any more.");
    return open(place.id);
  });
  handle("workspaces:add", (_event, choice) => {
    if (!CHOICES.includes(choice) || !add.choices()[choice]) throw new Error("That isn't something to add here.");
    return add.run(choice);
  });
  handle("cloud-add:state", () => view());
  handle("cloud-add:start", async (_event, tier, name, color) => {
    const client = account();
    if (!client) throw new Error("Sign in to MausBot Cloud first.");
    const plans = (await client.offer().catch(() => null))?.plans ?? [];
    const cleanName = cleanCloudListName(plain(name)), swatch = CLOUD_SWATCHES.includes(color) ? color : null;
    if (!plans.some(plan => plan.tier === plain(tier)) || !cleanName) throw new Error("Choose a plan and a name to continue.");
    const result = await client.addCloud({ tier: plain(tier), interval: "month", name: cleanName, color: swatch });
    return result.outcome === "blocked" ? { outcome: "blocked", blocked: result.blocked } : { outcome: result.outcome };
  });
  handle("cloud-add:reopen", () => account()?.reopenAdd() ?? false);
  handle("cloud-add:copy-link", () => {
    const url = account()?.addLink() ?? null;
    if (url) clipboard.writeText(url);
    return Boolean(url);
  });
  handle("cloud-add:open", async () => {
    const adding = account()?.state().adding;
    if (!adding) throw new Error("There is no new Cloud to open.");
    await openCloud(adding.cloudId);
    account()?.addDone();
  });
  handle("cloud-add:interest", () => account()?.interest("another_cloud"));
  handle("cloud-add:sheet", (event, on) => {
    sheetOpen = on === true;
    const page = event?.sender;
    if (sheetOpen && typeof page?.once === "function") for (const done of ["did-navigate", "destroyed"]) page.once(done, () => { sheetOpen = false; });
  });
  return {
    sheetOpen: () => sheetOpen,
    /** The places or the sign-in changed: the page that shows the rail reads it again (a signal only, never the list). */
    changed() {
      const key = JSON.stringify([places(), add.choices(), account()?.state().adding ?? null, account()?.state().addCloud ?? null]);
      if (key === sent) return;
      sent = key;
      const win = window();
      if (win && !win.isDestroyed()) win.webContents.send("workspaces:changed");
    },
  };
}
