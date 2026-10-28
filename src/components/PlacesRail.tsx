// The rail at the window's left edge once a person has two places or more: one circle per Cloud, team's Cloud or server,
// the place on screen marked, ⋯ for the rest past eight, ＋ last. Main lists the places and opens one by its id; the rail
// never names an address.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Laptop, MoreHorizontal, Plus, Search, Server } from "lucide-react";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { cloudColor, cloudColorFill } from "@/lib/cloud-look";
import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/memory";
import { useAdvancedMode } from "@/lib/interface-mode";
import { placeInitials, railShown, usePlaces, type RailPlace } from "@/lib/places";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { MENU_ROW, MENU_SHEET } from "./menu-recipe";
import { PlaceAddSheet } from "./PlaceAddSheet";

/** Circles before ⋯ opens the searchable list of every place. */
export const RAIL_SHOWN = 8;
const CIRCLE = 38;

/** A circle's words for its tooltip and a screen reader: the place, and what it is doing now. A server of the person's
 * own that signed in with their account says so, whether it is online, and why there is nothing to open when it is only
 * reachable on its own network. */
export function placeLabel(place: RailPlace, now = Date.now()): string {
  const name = place.kind === "computer" ? t("rail.thisComputer") : place.server ? t("rail.ownServer", { name: place.name }) : place.name;
  if (place.waiting) return t("rail.waiting", { name });
  if (place.progress !== undefined) return t("rail.settingUp", { name });
  if (place.attention) return t("rail.attention", { name });
  const status = place.offline
    ? place.lastSeenAt ? t("rail.lastSeen", { name, when: localizedRelativeTime(place.lastSeenAt, activeLocale(), now) }) : t("rail.offline", { name })
    : place.pairs ? t("rail.notConnected", { name }) : name;
  return [status, place.update && t("rail.update", place.update), place.ownNetwork && t("rail.ownNetwork")].filter(Boolean).join(" · ");
}

/** Whether a circle does anything: opens its place, or, for a server of the person's own not connected yet, shows how
 * to connect it (only where a pairing link can be pasted). */
export const placeActs = (place: RailPlace, canPair: boolean): boolean => place.opens || (place.pairs === true && canPair);

/** The circles before ⋯: every place up to RAIL_SHOWN; past that the first ones, with the place on screen always among them. */
export function shownPlaces(places: RailPlace[], limit = RAIL_SHOWN): RailPlace[] {
  if (places.length <= limit) return places;
  const first = places.slice(0, limit - 1), active = places.find((place) => place.active);
  return [...first, active && !first.includes(active) ? active : places[limit - 1]!];
}

/** Places whose name has every word typed, in the rail's order. */
export function matchingPlaces(places: RailPlace[], query: string): RailPlace[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return places.filter((place) => {
    const name = (place.kind === "computer" ? t("rail.thisComputer") : place.name).toLocaleLowerCase();
    return words.every((word) => name.includes(word));
  });
}

function ProgressRing({ value = 0, waiting = false }: { value?: number; waiting?: boolean }) {
  const box = CIRCLE + 8, radius = box / 2 - 1.5, around = 2 * Math.PI * radius;
  const shown = waiting ? 0.28 : Math.max(0.06, Math.min(1, value));
  return <svg aria-hidden="true" data-rail-ring={waiting ? "waiting" : Math.round(value * 100)} width={box} height={box} viewBox={`0 0 ${box} ${box}`}
    className={cn("pointer-events-none absolute -left-1 -top-1 -rotate-90", waiting && "animate-spin [animation-duration:2.4s] motion-reduce:animate-none")}>
    <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="var(--color-hairline)" strokeWidth={2} />
    <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinecap="round" strokeDasharray={`${shown * around} ${around}`}
      className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none" />
  </svg>;
}

export function PlaceMark({ place, size = CIRCLE }: { place: RailPlace; size?: number }) {
  const color = cloudColor(place.color);
  return <span aria-hidden="true" data-rail-offline={place.offline ? "" : undefined}
    className={cn("grid shrink-0 place-items-center rounded-full font-semibold leading-none", color ? "text-white" : "bg-raised text-ink", place.offline && "opacity-55 grayscale")}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...(color ? { background: cloudColorFill(color) } : {}) }}>
    {place.kind === "computer" ? <Laptop size={Math.round(size * 0.46)} strokeWidth={1.75} /> : placeInitials(place.name)}
  </span>;
}

function PlaceCircle({ place, calm, canPair, onOpen }: { place: RailPlace; calm: boolean; canPair: boolean; onOpen: (place: RailPlace) => void }) {
  const label = placeLabel(place), acts = placeActs(place, canPair);
  return <button type="button" aria-label={label} title={label} aria-current={place.active ? "page" : undefined} aria-disabled={acts ? undefined : true}
    data-rail-place={place.id} data-rail-kind={place.kind} onClick={() => { if (acts && !place.active) onOpen(place); }}
    className={cn("relative shrink-0 rounded-full transition-[box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
      place.active ? cn("ring-2 ring-offset-2 ring-offset-panel", calm ? "ring-ink/45" : "ring-ink/75")
        : acts ? "hover:ring-2 hover:ring-ink/15 hover:ring-offset-2 hover:ring-offset-panel" : cn("cursor-default", !place.offline && "opacity-75"))}>
    <PlaceMark place={place} />
    {place.progress !== undefined && <ProgressRing value={place.progress} waiting={place.waiting === true} />}
    {place.attention && <span aria-hidden="true" data-rail-dot className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-panel bg-danger" />}
    {place.update && !place.attention && <span aria-hidden="true" data-rail-update className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-panel bg-accent" />}
    {place.server && <span aria-hidden="true" data-rail-server className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border border-hairline bg-panel text-ink-secondary">
      <Server size={9} strokeWidth={2.25} />
    </span>}
  </button>;
}

/** Every place, searchable: ⋯ once there are more than RAIL_SHOWN. */
function MorePlaces({ places, canPair, onOpen, onClose }: { places: RailPlace[]; canPair: boolean; onOpen: (place: RailPlace) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const found = matchingPlaces(places, query);
  return <div role="dialog" aria-label={t("rail.search")} data-rail-more className={cn("absolute bottom-0 left-full z-50 ml-2 w-64", MENU_SHEET)}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <label className="flex h-8 items-center gap-2 rounded-md bg-ink/[0.05] px-2">
      <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("rail.search")} aria-label={t("rail.search")}
        onKeyDown={(event) => { if (event.key === "Enter" && found[0] && placeActs(found[0], canPair)) { onOpen(found[0]); onClose(); } }}
        className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary" />
    </label>
    <ul className="max-h-72 overflow-y-auto">
      {found.map((place) => <li key={place.id}>
        <button type="button" disabled={!placeActs(place, canPair)} aria-current={place.active ? "page" : undefined} onClick={() => { onOpen(place); onClose(); }} className={cn(MENU_ROW, "h-9")}>
          <PlaceMark place={place} size={22} />
          <span className="min-w-0 flex-1 truncate">{placeLabel(place)}</span>
        </button>
      </li>)}
    </ul>
    {found.length === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-tertiary">{t("rail.noMatch")}</p>}
  </div>;
}

export function PlacesRail() {
  const state = usePlaces();
  const calm = !useAdvancedMode();
  const { capabilities } = useDesktopCapabilities();
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const away = (event: MouseEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMore(false); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [more]);
  if (!railShown(state)) return null;
  const bridge = window.ogb?.workspaces;
  const open = (place: RailPlace) => {
    if (!place.opens) { if (place.pairs) setConnecting(place.name); return; }
    track("rail_place_opened", { kind: place.kind });
    void bridge?.open?.(place.id).catch(() => {});
  };
  const macInset = capabilities.windowChrome === "mac-inset";
  const draggable = macInset || capabilities.windowChrome === "win-caption";
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline style.
  const drag = draggable ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const noDrag = draggable ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;
  const shown = shownPlaces(state.places);
  const canPair = state.add.link || state.add.address, canAdd = state.add.cloud || canPair;
  return <nav aria-label={t("rail.label")} data-places-rail style={drag}
    className={cn("relative hidden w-16 shrink-0 flex-col items-center bg-panel md:flex", calm ? "border-r border-ink/[0.04]" : "border-r border-hairline/50")}>
    {/* The macOS traffic lights sit over the rail's top; nothing here takes a click before they end. */}
    <div aria-hidden="true" className={macInset ? "h-[52px] shrink-0" : "h-3 shrink-0"} />
    <ul className="flex min-h-0 flex-col items-center gap-2.5 overflow-y-auto px-1 py-1" style={noDrag}>
      {shown.map((place) => <li key={place.id} className="flex"><PlaceCircle place={place} calm={calm} canPair={canPair} onOpen={open} /></li>)}
    </ul>
    <div className="relative mt-2.5 flex flex-col items-center gap-2.5 pb-3" style={noDrag} ref={moreRef}>
      {state.places.length > RAIL_SHOWN && <button type="button" aria-label={t("rail.more", { count: state.places.length })} title={t("rail.more", { count: state.places.length })}
        aria-haspopup="dialog" aria-expanded={more} data-rail-more-button onClick={() => setMore(!more)}
        className="grid size-[38px] place-items-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-expanded:bg-ink/[0.06]">
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>}
      {more && <MorePlaces places={state.places} canPair={canPair} onOpen={open} onClose={() => setMore(false)} />}
      {canAdd && <button type="button" aria-label={t("rail.add")} title={t("rail.add")} aria-haspopup="dialog" data-rail-add onClick={() => { track("rail_add", { step: "opened" }); setAdding(true); }}
        className="grid size-[38px] place-items-center rounded-full border border-dashed border-ink/25 text-ink-secondary hover:border-ink/40 hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        <Plus size={18} aria-hidden="true" />
      </button>}
    </div>
    {adding && <PlaceAddSheet choices={state.add} onClose={() => setAdding(false)} />}
    {connecting !== null && <PlaceAddSheet choices={state.add} connect={{ name: connecting }} onClose={() => setConnecting(null)} />}
  </nav>;
}
