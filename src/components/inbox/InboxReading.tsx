// One line of the inbox read in full inside the panel: who it is from, what about, when and where it came from, all of
// it, then its answer: the ask's own buttons, the question's choices or a reply, and the way back to the list.
import { useState } from "react";
import { ArrowLeft, Check, ExternalLink, Send, X } from "lucide-react";
import type { InboxRow, InboxView } from "../../../shared/inbox";
import { botButton } from "@/lib/bot-button";
import type { MausColor } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { readInboxLine, replyToInboxRow } from "@/state/inbox";
import { InboxSender } from "../InboxLine";
import { QuestionCard } from "../QuestionCard";
import { threadUpdatedLabel } from "../SidebarThreadRow";
import { askOf, choiceResponse, choicesOf, closeResponse, subjectOf } from "./inbox-view";
import { useInboxActions } from "./use-inbox-actions";

export const INBOX_BUTTON = "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
/** Allow, in the colour of the bot the line is from. */
export const inboxPrimary = (color: MausColor | undefined) => botButton(color, INBOX_BUTTON, "bg-accent text-accent-ink hover:bg-accent/90");
export const INBOX_SECONDARY = `${INBOX_BUTTON} bg-raised text-ink hover:bg-inset`;

/** The line as the chat shows it, so a question answers here with the very card it asks with in the chat. */
const asMessage = (row: InboxRow): Message => ({ id: row.id, role: "bot", kind: "options", text: row.text, at: row.at, card: row.card } as Message);

function settledLabel(row: InboxRow): string {
  if (row.kind !== "ask") return t("common.done");
  const answered = row.card?.answered;
  if (answered === "allow") return t("approval.status.allowed");
  if (answered === "deny") return t("approval.status.denied");
  return answered === "answer" && !row.card?.dismissed ? t("question.status.answered") : t("question.status.closed");
}

export function InboxReading({ view, row, now }: { view: InboxView; row: InboxRow; now: number }) {
  const { answer, openInChat, run, colorOf } = useInboxActions(view);
  const primary = inboxPrimary(colorOf(row));
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const ask = askOf(row);
  const choices = choicesOf(row);
  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      if (ask === "question") answer(row, { behavior: "answer", message: text.trim() });
      else await replyToInboxRow(view, row, text.trim());
      setReply("");
    } finally {
      setSending(false);
    }
  };
  const canReply = ask === "question" ? !row.card?.questionRequest : row.tab === "info" && row.replies === true;
  return (
    <article data-inbox-reading={row.id} aria-label={`${row.from.name} · ${subjectOf(row)}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-2 border-b border-hairline/40 px-3 py-2.5">
        <button type="button" onClick={() => readInboxLine(null)} aria-label={t("inbox.action.back")} title={t("inbox.action.back")}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <span className="mt-0.5 shrink-0" aria-hidden="true"><InboxSender from={row.from} size={28} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{row.from.name}</span>
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-tertiary">{threadUpdatedLabel(row.at, now)}</span>
          </div>
          <div className="truncate text-[13px] text-ink">{subjectOf(row)}</div>
          {(row.origin || row.via) && (
            <div className="truncate text-[12px] text-ink-tertiary">
              {row.via && t("inbox.via", { name: row.via.name })}{row.via && row.origin && " · "}{row.origin && t("inbox.in", { title: row.origin.title })}
            </div>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">{row.text}</p>
        {row.card?.subtitle && row.card.subtitle !== row.text && <p className="whitespace-pre-wrap break-words rounded-lg bg-inset px-3 py-2 font-mono text-[12px] text-ink-secondary">{row.card.subtitle}</p>}
        {row.answers?.map((given) => (
          <p key={given.at} className="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] text-ink-secondary">
            <span className="block text-[11px] font-medium text-ink-tertiary">{t(given.by === "assistant" ? "inbox.assistantAnswered" : "inbox.youReplied")}</span>
            <span className="whitespace-pre-wrap break-words">{given.text}</span>
          </p>
        ))}
        {row.tab === "done" && <p className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><Check size={14} aria-hidden="true" />{settledLabel(row)}</p>}
        {ask === "question" && row.card?.questionRequest && view.threadId && <QuestionCard threadId={view.threadId} bot={{ name: row.from.name, color: colorOf(row) }} message={asMessage(row)} />}
        {ask === "review" && <p className="text-[13px] text-ink-secondary">{t("inbox.reviewInChat")}</p>}
      </div>
      <footer className="space-y-2 border-t border-hairline/40 px-3 py-2.5">
        {(ask === "approval" || choices.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ask === "approval" ? (
              <>
                <button type="button" data-inbox-action="allow" onClick={() => answer(row, { behavior: "allow" })} {...primary}><Check size={14} aria-hidden="true" />{t("approval.action.allowOnce")}</button>
                <button type="button" data-inbox-action="deny" onClick={() => answer(row, { behavior: "deny" })} className={INBOX_SECONDARY}><X size={14} aria-hidden="true" />{t("approval.action.deny")}</button>
              </>
            ) : !row.card?.questionRequest && choices.map((choice) => (
              <button key={choice} type="button" data-inbox-choice={choice} onClick={() => answer(row, choiceResponse(row, choice))} className={INBOX_SECONDARY}>{choice}</button>
            ))}
          </div>
        )}
        {canReply && (
          <form className="flex items-end gap-1.5" onSubmit={(event) => { event.preventDefault(); void send(reply); }}>
            <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} aria-label={t("inbox.reply.placeholder")} placeholder={t("inbox.reply.placeholder")}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(reply); } }}
              className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-hairline/50 bg-panel px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-accent/60 focus:outline-none" />
            <button type="submit" disabled={!reply.trim() || sending} aria-label={t("chat.send")} title={t("chat.send")}
              {...botButton(colorOf(row), "flex size-9 shrink-0 items-center justify-center rounded-full", "bg-accent text-accent-ink disabled:opacity-50")}>
              <Send size={15} aria-hidden="true" />
            </button>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {ask === "question" && <button type="button" data-inbox-action="close" onClick={() => answer(row, closeResponse(row))} className={INBOX_SECONDARY}>{t("common.done")}</button>}
          {row.tab === "info" && <button type="button" data-inbox-action="done" onClick={() => { run(row, "done"); readInboxLine(null); }} className={INBOX_SECONDARY}><Check size={14} aria-hidden="true" />{t("common.done")}</button>}
          <button type="button" data-inbox-action="open" onClick={() => openInChat(row)} className={INBOX_SECONDARY}><ExternalLink size={14} aria-hidden="true" />{t("inbox.action.openInChat")}</button>
        </div>
      </footer>
    </article>
  );
}
