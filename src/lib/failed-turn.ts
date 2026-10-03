// A failed turn is stored as an activity row named "error: <the engine's
// words>" (server/index.ts, runtime.error), for a 1:1 chat and a room alike.
// This is the one place that turns that row into what a person reads: the
// chat row's headline (ChatView's ErrorRow, which rooms render too) and the
// sidebar preview both come from here, on the same signed-out decision.
import { offersSignIn } from "@/components/EngineSetup";
import { t } from "@/lib/i18n";
import type { Bot, InstanceInfo, Message } from "@/state/store";

type ActivityTool = NonNullable<Message["tool"]>;

/** The engine's own words, without the row's "error:" marker; null for a row
 * that is not a failed turn. */
export function failedTurnCause(name: string): string | null {
  return name.startsWith("error:") ? name.slice(6).trim() : null;
}

/** The sentence a failed turn opens with. A signed-out engine's own words are
 * an instruction for a terminal ("Please run /login") nobody here can follow,
 * so while the engine still reads signed out the row says that in plain words
 * and the sign-in card under it is the next action. Anything else keeps the
 * engine's words: they are the most precise cause there is. */
export function failedTurnHeadline(cause: string, setupEngine: InstanceInfo | undefined): string {
  return setupEngine && offersSignIn(setupEngine)
    ? t("chat.error.signedOut", { name: setupEngine.displayName })
    : cause;
}

/** The engine a bot's turns run on — what its failed-turn row is about. */
export function botEngine(bot: Bot | undefined, instances: InstanceInfo[]): InstanceInfo | undefined {
  return bot && instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
}

/** One line for a list preview: what a failed turn's row says, minus the
 * "below" a list has no room for; any other activity row its name. */
export function activityPreview(tool: ActivityTool, engine: InstanceInfo | undefined): string {
  const cause = failedTurnCause(tool.name);
  if (cause === null) return tool.name;
  return tool.setup && !tool.claudeUpdate && engine && offersSignIn(engine) ? t("sidebar.preview.signedOut", { name: engine.displayName }) : cause;
}
