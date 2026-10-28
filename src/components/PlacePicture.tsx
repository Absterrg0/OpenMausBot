import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { BANNER_ACCEPT, bannerSrc, prepareBanner, removeBanner, uploadBanner, type BannerProblem, type BannerSummary } from "@/lib/place-banner";

const PROBLEM: Readonly<Record<BannerProblem | "animated" | "failed", LocaleKey>> = {
  format: "placeLook.imageFormat", read: "placeLook.imageRead", size: "placeLook.imageSize", animated: "placeLook.imageMoving", failed: "placeLook.imageFailed",
};

/** The workspace's banner picture, next to its colour: choose one (shrunk and cleaned here, checked again by the
 * server), change it, or remove it. Whoever may change this workspace's settings may; everyone else sees it. */
export function PlacePicture({ banner, canChange }: { banner: BannerSummary | null; canChange: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<LocaleKey | null>(null);
  const src = bannerSrc(banner);
  const run = async (work: () => Promise<{ ok: true } | { ok: false; problem: keyof typeof PROBLEM }>) => {
    setBusy(true); setProblem(null);
    const answer = await Promise.resolve().then(work).catch(() => ({ ok: false as const, problem: "failed" as const }));
    setBusy(false);
    if (!answer.ok) setProblem(PROBLEM[answer.problem]);
  };
  const chosen = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file || !canChange) return;
    void run(async () => {
      const prepared = await prepareBanner(file);
      return prepared.ok ? uploadBanner(prepared.blob) : prepared;
    });
  };
  return <div data-place-picture={src ? "set" : "none"} className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2.5">
      {src && <img src={src} alt={t("placeLook.currentImage")} className="h-10 w-24 rounded-md border border-ink/10 object-cover" />}
      <button type="button" className="ui-button" disabled={!canChange || busy} onClick={() => input.current?.click()}>
        {busy ? t("placeLook.imageSaving") : t(src ? "placeLook.changeImage" : "placeLook.useImage")}
      </button>
      {src && <button type="button" className={cn("ui-button")} disabled={!canChange || busy} onClick={() => void run(removeBanner)}>{t("placeLook.removeImage")}</button>}
      <input ref={input} type="file" accept={BANNER_ACCEPT} hidden data-place-picture-input onChange={(event) => chosen(event.target.files?.[0])} />
    </div>
    {!canChange && <p className="text-[13px] text-ink-secondary">{t("placeLook.imageAdmins")}</p>}
    {problem && <p role="alert" className="text-[13px] text-danger">{t(problem)}</p>}
  </div>;
}
