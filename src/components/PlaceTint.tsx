import type { CSSProperties } from "react";
import { placeTint, usePlaceLook } from "@/lib/place-look";

/** The place's colour, faint, across the top of the sidebar and under everything there, so people can tell their
 * places apart at a glance. Without a colour there is none, and the sidebar looks as it always did. */
export function PlaceTint() {
  const tint = placeTint(usePlaceLook()?.color);
  return tint ? <div aria-hidden="true" data-place-tint className="place-tint pointer-events-none absolute inset-x-0 top-0" style={tint as CSSProperties} /> : null;
}
