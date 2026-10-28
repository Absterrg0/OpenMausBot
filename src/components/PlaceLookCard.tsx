import { useState } from "react";
import type { CloudSwatch } from "../../electron/cloud-list.mjs";
import type { PlaceColorOutcome } from "../../electron/place-look.mjs";
import { t } from "@/lib/i18n";
import { choosePlaceColor, usePlaceLook } from "@/lib/place-look";
import { Card } from "./SettingsPrimitives";
import { SwatchRadios } from "./SwatchRadios";

/** The colour of the place on screen, where it is changed, in the six swatches the rail's circles use: a Cloud's is
 * the Admin's, so every app of theirs follows. A team member sees it and who may change it. Nothing on this computer's
 * own page, which has no colour. */
export function PlaceLookCard() {
  const look = usePlaceLook();
  const [pending, setPending] = useState<CloudSwatch | null>(null);
  const [outcome, setOutcome] = useState<PlaceColorOutcome | null>(null);
  if (!look) return null;
  const locked = look.change === null;
  const choose = (swatch: CloudSwatch) => {
    if (locked || pending || swatch === look.swatch) return;
    setPending(swatch); setOutcome(null);
    void choosePlaceColor(swatch).then((answer) => { setPending(null); setOutcome(answer); });
  };
  const note = look.reason === "member" || outcome === "refused" ? t("placeLook.member") : look.reason === "signed-out" ? t("placeLook.signedOut")
    : outcome === "unsupported" ? t("placeLook.unsupported") : null;
  return <Card title={t("placeLook.title")} subtitle={t("placeLook.sub", { name: look.name })}>
    <div data-place-look={look.change ?? "locked"} className="flex flex-col gap-3">
      <SwatchRadios value={pending ?? look.swatch} onChange={choose} label={t("placeLook.aria", { name: look.name })} disabled={locked} offset="card" />
      {note && <p className="text-[13px] text-ink-secondary">{note}</p>}
      {outcome === "failed" && <p role="alert" className="text-[13px] text-danger">{t("placeLook.failed")}</p>}
    </div>
  </Card>;
}
