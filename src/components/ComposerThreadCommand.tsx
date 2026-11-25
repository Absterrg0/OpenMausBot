import { useEffect, useState, type Dispatch } from "react";
import type { ComposerSlashCommand } from "@/lib/composer-commands";
import { draftRevision } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import type { Action, Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { ConfirmDialog } from "./ConfirmDialog";
import { isArchived, isWorking, threadRowActions } from "./SidebarThreadRow";
import { neighbourOf, threadTabs } from "./thread-tabs";
import { showUndoToast } from "./UndoToast";

export type ThreadCommand = "archive" | "delete";

const THREAD_COMMAND_LABELS = {
  archive: "composer.command.archiveDesc",
  delete: "composer.command.deleteDesc",
} as const;

export const threadSlashCommands = (): ComposerSlashCommand[] => (["archive", "delete"] as const).map((id) =>
  ({ kind: "command", id, label: `/${id}`, description: t(THREAD_COMMAND_LABELS[id]) }));

export function typedThreadCommand(text: string): ThreadCommand | undefined {
  const match = /^\/(archive|delete)\s*$/i.exec(text);
  return match ? (match[1]!.toLowerCase() as ThreadCommand) : undefined;
}

/** Where the view goes when the open thread is archived: the bot's main thread, else the thread next to it. */
export function threadAfterArchive(bot: Bot): string | undefined {
  const main = bot.tasks?.find((task) => task.threadId === bot.mainThreadId);
  if (main && main.threadId !== bot.threadId && !isArchived(main)) return main.threadId;
  return neighbourOf(threadTabs(bot), bot.threadId);
}

function archiveAndMoveOn(bot: Bot, dispatch: Dispatch<Action>) {
  const actions = threadRowActions(bot.id, dispatch);
  const archived = { threadId: bot.threadId };
  const next = threadAfterArchive(bot);
  dispatch(next ? { type: "switchTask", botId: bot.id, threadId: next } : { type: "newTask", botId: bot.id });
  actions.onArchive(archived, Date.now());
  showUndoToast({
    text: t("composer.command.archived"),
    undo: () => {
      actions.onArchive(archived, null);
      dispatch({ type: "switchTask", botId: bot.id, threadId: archived.threadId });
    },
  });
}

/** /archive and /delete typed alone in a bot thread's composer act on that thread, as its sidebar menu does. */
export function useComposerThreadCommand({ bot, busy, draftId, text, editText, stopDictation }: {
  bot?: Bot;
  busy: boolean;
  draftId: string;
  text: string;
  editText: (text: string) => void;
  stopDictation: () => void;
}) {
  const dispatch = useStoreDispatch();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ draftId: string; revision: number }>();
  useEffect(() => setDeleting(null), [bot?.id, bot?.threadId]);
  const command = bot ? typedThreadCommand(text) : undefined;
  const task = bot?.tasks?.find((each) => each.threadId === bot.threadId);
  const working = busy || Boolean(task && isWorking(task));
  const confirmingDelete = Boolean(bot && deleting === bot.threadId);
  const error = command && working && refusal?.draftId === draftId && refusal.revision === draftRevision(draftId)
    ? t("composer.command.threadBusy") : undefined;
  const refuseWhileWorking = () => {
    if (working) setRefusal({ draftId, revision: draftRevision(draftId) });
    return working;
  };

  function submit() {
    if (!bot || !command || refuseWhileWorking()) return;
    stopDictation();
    if (command === "delete") {
      setDeleting(bot.threadId);
      return;
    }
    editText("");
    archiveAndMoveOn(bot, dispatch);
  }

  const dialog = (
    <ConfirmDialog open={confirmingDelete} title={t("task.deleteConfirm")} body={t("task.deleteBody", { title: task?.title ?? "" })}
      confirmLabel={t("task.deleteAria")} onCancel={() => setDeleting(null)}
      onConfirm={() => {
        setDeleting(null);
        if (!bot || !confirmingDelete || refuseWhileWorking()) return;
        editText("");
        threadRowActions(bot.id, dispatch).onDelete({ threadId: bot.threadId });
      }} />
  );

  return { command, submit, error, label: command && t(THREAD_COMMAND_LABELS[command]), dialog };
}
