import type { CloudSwatch } from "../../electron/cloud-list.mjs";
import { cn } from "@/lib/cn";
import { CLOUD_SWATCH_LABEL, CLOUD_SWATCH_ORDER, swatchFill } from "@/lib/cloud-extra";
import { t } from "@/lib/i18n";

/** The six swatches a Cloud's colour is chosen from, as one radio group: arrow keys move the choice, Tab leaves it.
 * `value` null: none of them yet (the first one takes the focus). `offset`: the surface the ring sits on. */
export function SwatchRadios({ value, onChange, label, disabled = false, offset = "panel" }: {
  value: CloudSwatch | null; onChange: (swatch: CloudSwatch) => void; label: string; disabled?: boolean; offset?: "panel" | "card";
}) {
  const focusable = value ?? CLOUD_SWATCH_ORDER[0];
  return <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="flex flex-wrap gap-2.5">
    {CLOUD_SWATCH_ORDER.map((option) => <button key={option} type="button" role="radio" aria-checked={option === value} aria-label={t(CLOUD_SWATCH_LABEL[option])}
      title={t(CLOUD_SWATCH_LABEL[option])} data-swatch={option} disabled={disabled} onClick={() => onChange(option)}
      onKeyDown={(event) => {
        const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        const next = CLOUD_SWATCH_ORDER[(CLOUD_SWATCH_ORDER.indexOf(option) + delta + CLOUD_SWATCH_ORDER.length) % CLOUD_SWATCH_ORDER.length]!;
        onChange(next);
        (event.currentTarget.parentElement?.querySelector(`[data-swatch="${next}"]`) as HTMLElement | null)?.focus();
      }}
      tabIndex={option === focusable ? 0 : -1}
      className={cn("size-8 rounded-full border border-ink/10 transition-[box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default",
        option === value && cn("ring-2 ring-ink/70 ring-offset-2", offset === "card" ? "ring-offset-card" : "ring-offset-panel"), disabled && option !== value && "opacity-50")}
      style={{ background: swatchFill(option) }} />)}
  </div>;
}
