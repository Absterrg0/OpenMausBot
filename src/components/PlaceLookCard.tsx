import { useState } from "react";
import type { CloudSwatch } from "../../electron/cloud-list.mjs";
import type { PlaceColorOutcome } from "../../electron/place-look.mjs";
import { t } from "@/lib/i18n";
import { choosePlaceColor, usePlaceLook } from "@/lib/place-look";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore } from "@/state/store";
import { PlacePicture } from "./PlacePicture";
import { Card } from "./SettingsPrimitives";
import { SwatchRadios } from "./SwatchRadios";

/** The look of the place on screen, where it is changed: its colour, in the six swatches the rail's circles use (a
 * Cloud's is the Admin's, so every app of theirs follows), and next to it a banner picture, kept on the place's own
 * server for everyone there. A team member sees both and who may change them. This computer's own page has no colour,
 * so there only the picture. */
export function PlaceLookCard() {
  const look = usePlaceLook();
  const { state } = useStore();
  const admin = useOwnerOrAdmin() === true;
  const [pending, setPending] = useState<CloudSwatch | null>(null);
  const [outcome, setOutcome] = useState<PlaceColorOutcome | null>(null);
  const picture = <PlacePicture banner={state.config?.workspaceBanner ?? null} canChange={admin} />;
  if (!look) return <Card title={t("placeLook.picture")} subtitle={t("placeLook.pictureSub")}>{picture}</Card>;
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
      <div className="mt-1 flex flex-col gap-2 border-t border-hairline/50 pt-4">
        <div>
          <p className="text-[14px] font-medium text-ink">{t("placeLook.picture")}</p>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t("placeLook.pictureSub")}</p>
        </div>
        {picture}
      </div>
    </div>
  </Card>;
}
