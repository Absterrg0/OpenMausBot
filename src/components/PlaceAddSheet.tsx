// ＋ at the end of the rail: one sheet, two choices. Buy a Cloud (the buying sheet: another Cloud right here, or the
// first one on this computer's own sheet) or add a server of the person's own through today's pairing link.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Cloud, Copy, Server, X } from "lucide-react";
import type { RailAddChoices } from "../../electron/cloud-rail.mjs";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AddCloudFlow } from "./cloud-buy/AddCloudFlow";
import { BackLink, Heading } from "./cloud-buy/parts";

/** The commands a server of the person's own runs to be reached from this app. */
export const OWN_SERVER_INSTALL = "npx openmausbot start";
export const OWN_SERVER_PAIR = "npx openmausbot pair --label \"My desktop\"";

export interface OwnServerStep { key: string; title: LocaleKey; detail: LocaleKey; command?: string }
/** What a server of the person's own takes, step by step. `managed`: one command from MausBot Cloud that installs and
 * connects it by itself; without it, today's install, then its pairing link pasted here. `installed`: it runs
 * OpenMausBot already (it signed in with the person's account), so only its pairing link is left. */
export function ownServerSteps(managed: { command: string } | null = null, { installed = false }: { installed?: boolean } = {}): OwnServerStep[] {
  if (managed) return [{ key: "install", title: "rail.step1", detail: "rail.step1Sub", command: managed.command }];
  const steps: OwnServerStep[] = [
    { key: "install", title: "rail.step1", detail: "rail.step1Sub", command: OWN_SERVER_INSTALL },
    { key: "pair", title: "rail.step2", detail: "rail.step2Sub", command: OWN_SERVER_PAIR },
    { key: "connect", title: "rail.step3", detail: "rail.step3Sub" },
  ];
  return installed ? steps.filter((step) => step.key !== "install") : steps;
}

function Command({ text }: { text: string }) {
  const { state, copy } = useCopyFeedback(text);
  return <div className="mt-2 flex items-center gap-2 rounded-lg border border-hairline bg-app py-1.5 pe-1.5 ps-3">
    <code data-own-server-command className="min-w-0 flex-1 select-all break-words font-mono text-[13px] text-ink">{text}</code>
    <button type="button" onClick={copy} className="ui-button inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-[12px]">
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {t(state === "copied" ? "rail.copied" : "rail.copy")}
    </button>
  </div>;
}

/** Install OpenMausBot there, open its pairing window, paste its link: the pasted link and the typed address are main's
 * own Connect dialogs, as the Server menu opens them. `connect`: a server of theirs that signed in with their account,
 * not connected to this app yet. */
export function OwnServerSteps({ choices, onBack, onChoose, managed = null, connect = null }: {
  choices: RailAddChoices; onBack: (() => void) | null; onChoose: (choice: "link" | "address") => void; managed?: { command: string } | null; connect?: { name: string } | null;
}) {
  const steps = ownServerSteps(managed, { installed: Boolean(connect) });
  return <div data-place-add={connect ? "connect-server" : "own-server"} className="flex flex-col gap-4 px-[30px] pb-[26px] pt-7">
    {onBack && <div><BackLink label={t("rail.back")} onClick={onBack} /></div>}
    <Heading title={connect ? t("rail.connectTitle", { name: connect.name }) : t("rail.own")} sub={t(connect ? "rail.connectLede" : "rail.ownLede")} />
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => <li key={step.key} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3">
        <span aria-hidden="true" className="grid size-[26px] place-items-center rounded-full bg-accent/12 text-[13px] font-semibold text-accent-text">{index + 1}</span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink">{t(step.title)}</p>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t(step.detail)}</p>
          {step.command && <Command text={step.command} />}
          {step.key === "connect" && <div className="mt-2.5 flex flex-wrap gap-2">
            {choices.link && <button type="button" data-autofocus className="ui-button ui-button-primary" onClick={() => onChoose("link")}>{t("rail.paste")}</button>}
            {choices.address && <button type="button" className="ui-button" onClick={() => onChoose("address")}>{t("rail.address")}</button>}
          </div>}
        </div>
      </li>)}
    </ol>
  </div>;
}

function Choice({ icon, title, sub, onClick, kind }: { icon: ReactNode; title: string; sub: string; onClick: () => void; kind: string }) {
  return <button type="button" data-place-add-choice={kind} onClick={onClick}
    className="flex min-w-0 flex-1 flex-col items-start gap-2 rounded-2xl border border-hairline bg-card p-5 text-start transition-colors hover:border-accent/60 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
    <span aria-hidden="true" className="grid size-9 place-items-center rounded-[10px] bg-accent/12 text-accent-text">{icon}</span>
    <span className="text-[15px] font-semibold text-ink">{title}</span>
    <span className="text-[13px] leading-snug text-ink-secondary">{sub}</span>
  </button>;
}

const FOCUSABLE = "button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([tabindex='-1']), [href], [tabindex='0']";

/** The sheet over the app, like the buying sheet's: Escape and Close close it, Tab stays in it, focus goes back after. */
export function RailSheet({ wide = false, focusKey, onClose, children }: { wide?: boolean; focusKey: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!controls.length) return;
      event.preventDefault();
      const at = controls.indexOf(document.activeElement as HTMLElement);
      controls[at === -1 ? 0 : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]!.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (opener?.isConnected) opener.focus(); };
  }, [onClose]);
  useEffect(() => {
    if (sheet.current?.contains(document.activeElement) && document.activeElement !== sheet.current) return;
    (sheet.current?.querySelector<HTMLElement>("[data-autofocus]") ?? sheet.current?.querySelector<HTMLElement>("#cloud-add-title"))?.focus();
  }, [focusKey]);
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby="cloud-add-title" data-place-add-sheet tabIndex={-1}
      className={cn("animate-pop-in relative max-h-full w-full overflow-y-auto overscroll-contain rounded-2xl border border-hairline/70 bg-panel shadow-2xl outline-none", wide ? "max-w-[900px]" : "max-w-[560px]")}>
      <button type="button" onClick={onClose} aria-label={t("cloudAdd.close")} className="ui-icon-button absolute end-3.5 top-3.5 z-10"><X size={18} /></button>
      {children}
    </div>
  </div>;
}

export function PlaceAddSheet({ choices, connect = null, onClose }: { choices: RailAddChoices; connect?: { name: string } | null; onClose: () => void }) {
  const server = choices.link || choices.address;
  const [view, setView] = useState<"choose" | "cloud" | "server">(connect ? "server" : choices.cloud && server ? "choose" : choices.cloud ? "cloud" : "server");
  const [wide, setWide] = useState(false);
  const workspaces = window.ogb?.workspaces;
  const choose = (choice: "cloud" | "link" | "address") => {
    track("rail_add", { step: choice });
    onClose();
    void workspaces?.add?.(choice).catch(() => {});
  };
  return <RailSheet wide={view === "cloud" && wide} focusKey={view} onClose={onClose}>
    {view === "choose" && <div data-place-add="choose" className="flex flex-col gap-5 px-[30px] pb-[26px] pt-7">
      <Heading title={t("rail.add")} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Choice kind="cloud" icon={<Cloud size={19} />} title={t("rail.buy")} sub={t("rail.buySub")} onClick={() => setView("cloud")} />
        <Choice kind="server" icon={<Server size={19} />} title={t("rail.own")} sub={t("rail.ownSub")} onClick={() => setView("server")} />
      </div>
    </div>}
    {view === "server" && <OwnServerSteps choices={choices} onBack={choices.cloud && !connect ? () => setView("choose") : null} onChoose={choose} connect={connect} />}
    {view === "cloud" && <AddCloudFlow onClose={onClose} onFirstCloud={() => choose("cloud")} onWide={setWide} onBack={server ? () => setView("choose") : null} />}
  </RailSheet>;
}
