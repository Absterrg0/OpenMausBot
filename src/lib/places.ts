import { useEffect, useState } from "react";
import type { RailPlace, RailState } from "../../electron/cloud-rail.mjs";

const NONE: RailState = { places: [], add: { cloud: false, link: false, address: false } };
let current: RailState = NONE;
let started = false;
const listeners = new Set<(state: RailState) => void>();

function bridge() {
  const workspaces = typeof window === "undefined" || window.ogb?.remoteClient?.active ? undefined : window.ogb?.workspaces;
  return workspaces?.places ? workspaces : undefined;
}

/** Main's list again (it changed, or the window came back): every rail and switcher on the page sees the same one. */
export function refreshPlaces(): Promise<void> {
  const workspaces = bridge();
  if (!workspaces?.places) return Promise.resolve();
  return workspaces.places().then((next) => {
    current = next && Array.isArray(next.places) ? next : NONE;
    for (const listener of listeners) listener(current);
  }, () => {});
}

function start() {
  if (started) return;
  started = true;
  bridge()?.onChanged?.(() => void refreshPlaces());
  window.addEventListener("focus", () => void refreshPlaces());
  void refreshPlaces();
}

/** The rail's places as main lists them for this page: none in a browser, on an older app, on a server's own page, or with
 * fewer than two places. */
export function usePlaces(): RailState {
  const [state, setState] = useState<RailState>(current);
  useEffect(() => {
    if (!bridge()) return;
    listeners.add(setState);
    start();
    setState(current);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}

/** Whether the rail shows on this page: main lists places only when there are at least two. */
export const railShown = (state: RailState): boolean => state.places.length > 0;

/** A circle's letters: the first of up to two words, so "Client A" is CA and "Acme" is A. */
export function placeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0] ?? "" : "");
  return (first(words[0]) + (words.length > 1 ? first(words[1]) : "")).toLocaleUpperCase();
}

export type { RailPlace, RailState };
