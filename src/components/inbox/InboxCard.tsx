// On a Team Cloud, in the person's inbox chat: one card that keeps what waits on them in view. It sits under the newest
// line that needed them and updates in place: how many need them and how many are news, the newest few that need them
// with their answers right there, and the way into the whole inbox. With nothing open it shrinks to one line.
import { useEffect, useState } from "react";
import { Check, CornerUpLeft, Inbox, X } from "lucide-react";
import type { InboxRow, InboxView } from "../../../shared/inbox";
import { t } from "@/lib/i18n";
import { openInbox, readInboxRow, useInboxView } from "@/state/inbox";
import { inboxPrimary, INBOX_SECONDARY } from "./InboxReading";
import { InboxRowItem } from "./InboxRow";
import { askOf, CARD_ROWS, choiceResponse, choicesOf, rowsIn, tabCounts } from "./inbox-view";
import { useInboxActions } from "./use-inbox-actions";

/** Most choices a question shows as buttons on the card; one with more opens in the inbox. */
const CARD_CHOICES = 3;

/** The card goes under one line of the inbox conversation only: the line the inbox says it sits under. */
export function InboxCardSlot({ threadId, messageId }: { threadId: string; messageId: string }) {
  const view = useInboxView();
  if (!view || view.threadId !== threadId || view.anchor !== messageId) return null;
  return <InboxCard view={view} />;
}

function Answers({ row, view }: { row: InboxRow; view: InboxView }) {
  const { answer, colorOf } = useInboxActions(view);
  const ask = askOf(row);
  const choices = choicesOf(row);
  const reading = () => { readInboxRow(row); openInbox({ reading: row.id }); };
  if (ask === "approval") {
    return (
      <>
        <button type="button" data-inbox-action="allow" onClick={() => answer(row, { behavior: "allow" })} {...inboxPrimary(colorOf(row))}><Check size={14} aria-hidden="true" />{t("approval.action.allowOnce")}</button>
        <button type="button" data-inbox-action="deny" onClick={() => answer(row, { behavior: "deny" })} className={INBOX_SECONDARY}><X size={14} aria-hidden="true" />{t("approval.action.deny")}</button>
      </>
    );
  }
  return (
    <>
      {choices.length > 0 && choices.length <= CARD_CHOICES && choices.map((choice) => (
        <button key={choice} type="button" data-inbox-choice={choice} onClick={() => answer(row, choiceResponse(row, choice))} className={INBOX_SECONDARY}>{choice}</button>
      ))}
      <button type="button" data-inbox-action="reply" onClick={reading} className={INBOX_SECONDARY}><CornerUpLeft size={14} aria-hidden="true" />{t("chat.reply")}</button>
    </>
  );
}

export function InboxCard({ view }: { view: InboxView }) {
  const { run } = useInboxActions(view);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const counts = tabCounts(view);
  const rows = rowsIn(view, "needs-you").slice(0, CARD_ROWS);
  const openRow = (row: InboxRow) => { readInboxRow(row); openInbox({ reading: row.id }); };
  const openAll = () => openInbox({ tab: counts["needs-you"] ? "needs-you" : "info" });
  if (!rows.length) {
    return (
      <section data-inbox-card="caught-up" aria-label={t("inbox.card.caughtUp")} className="my-1 flex w-full max-w-[min(38rem,100%)] items-center gap-2 rounded-xl border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] text-ink-secondary">
        <Check size={14} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate">{t("inbox.card.caughtUp")}{counts.info > 0 && ` · ${t("inbox.card.forInfo", { count: counts.info })}`}</span>
        <button type="button" onClick={openAll} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{t("inbox.card.open")}</button>
      </section>
    );
  }
  return (
    <section data-inbox-card="open" aria-label={t("inbox.card.summary", { needs: counts["needs-you"], info: counts.info })}
      className="my-1 w-full max-w-[min(38rem,100%)] overflow-hidden rounded-2xl border border-hairline/50 bg-panel">
      <header className="flex items-center gap-2 border-b border-hairline/40 px-3 py-2">
        <Inbox size={15} aria-hidden="true" className="shrink-0 text-warning" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{t("inbox.card.summary", { needs: counts["needs-you"], info: counts.info })}</span>
        <button type="button" onClick={openAll} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{t("inbox.card.open")}</button>
      </header>
      {rows.map((row) => (
        <div key={row.id} className="border-b border-hairline/20 last:border-b-0">
          <InboxRowItem row={row} now={now} onOpen={openRow} onAction={run} inCard />
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2 pl-[2.375rem]"><Answers row={row} view={view} /></div>
        </div>
      ))}
    </section>
  );
}
