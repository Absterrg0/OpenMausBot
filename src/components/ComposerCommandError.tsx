import { t } from "@/lib/i18n";

export function ComposerCommandError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10">
        {t("chat.retry")}
      </button>
    </div>
  );
}
