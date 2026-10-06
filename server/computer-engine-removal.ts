// The Computer engine is gone. It ran a whole turn on Boat's own agent, which
// has no AI sign-in on a Cloud, so a bot set to it failed there. Every bot now
// keeps its own engine and uses a cloud computer as a tool. This file is the
// one place that still knows the removed engine's names, so settings saved
// before the removal can be moved off it, once, on every kind of server
// (moveOffComputerEngine in index.ts, Store.retireInstances).
import type { InstanceConfigMap } from "./contracts.ts";

/** The removed engine's driver kind ("boxAgent" was Boat's historical name). */
export const REMOVED_COMPUTER_DRIVER = "boxAgent";
/** The instance id every default fleet gave it. */
const REMOVED_COMPUTER_INSTANCE = "computer";

/** Instance ids that named the Computer engine. A saved fleet may hold the
 * default id or one of its own; an id the person reused for another engine
 * is theirs and stays. */
export function removedComputerInstanceIds(saved: InstanceConfigMap | undefined): Set<string> {
  const ids = new Set<string>();
  const reused = saved && Object.hasOwn(saved, REMOVED_COMPUTER_INSTANCE) &&
    saved[REMOVED_COMPUTER_INSTANCE]!.driver !== REMOVED_COMPUTER_DRIVER;
  if (!reused) ids.add(REMOVED_COMPUTER_INSTANCE);
  for (const [id, entry] of Object.entries(saved ?? {})) {
    if (entry.driver === REMOVED_COMPUTER_DRIVER) ids.add(id);
  }
  return ids;
}

/** A fleet without the removed engine: a saved entry for it is dropped, so
 * it is never offered and the next save leaves it off disk. */
export function withoutComputerEngine(map: InstanceConfigMap): InstanceConfigMap {
  for (const [id, entry] of Object.entries(map)) {
    if (entry.driver === REMOVED_COMPUTER_DRIVER) delete map[id];
  }
  return map;
}

/** One conversation whose engine was the removed one (Store.retireInstances). */
export interface ComputerEngineMove {
  botId: string;
  threadId: string;
  /** "bot": the bot's own engine moved, told in its open conversation;
   * "conversation": only this conversation's engine did. */
  scope: "bot" | "conversation";
  /** It works on the bot's cloud computer after the move, as it did before. */
  cloud: boolean;
  /** Its permissions went back to Ask, as on any switch to another engine. */
  askNow: boolean;
}

/** The line a moved conversation shows, in plain words. It names the removed
 * choice as people saw it in the model list ("Computer", not the panel's
 * Computer tab) and claims a cloud computer only where one is still used. */
export function computerEngineMoveText(move: Pick<ComputerEngineMove, "scope" | "cloud" | "askNow">, botName: string, engine: string): string {
  const removed = "The Computer choice in the model list was removed.";
  const head = move.scope === "bot" ? `${botName} now uses ${engine}.` : `This conversation now uses ${engine}.`;
  const place = !move.cloud ? "" : move.scope === "bot"
    ? ` ${botName} still works on its cloud computer.`
    : ` It still works on ${botName}'s cloud computer.`;
  return `${head} ${removed}${place}${move.askNow ? " Its permissions are now Ask." : ""}`;
}
