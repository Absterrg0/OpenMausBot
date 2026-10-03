// A failed turn is stored as an activity row named "error: <what went
// wrong>", in a 1:1 chat and a room alike. The server writes every such row
// through failedTurnTool and the clients read it back through
// failedTurnCause, so the marker and the one length limit live here only.

const MARKER = "error:";

/** The longest cause a row keeps. Clients wrap the row and show it whole, so
 * this only bounds a pathological message (a provider's HTML body, a stack
 * trace); a sentence a person acts on fits, its next action included. */
export const FAILED_TURN_MAX_CHARS = 600;

export interface FailedTurnTool {
  name: string;
  ok: false;
  /** fixed by installing or signing in, not by retrying */
  setup?: boolean;
  terminal?: boolean;
  /** the installed Claude Code is too old for the model */
  claudeUpdate?: boolean;
}

/** The activity row a failed turn is stored as. */
export function failedTurnTool(
  cause: string,
  flags: { setup?: boolean; terminal?: boolean; claudeUpdate?: boolean } = {},
): FailedTurnTool {
  const words = cause.length > FAILED_TURN_MAX_CHARS ? `${cause.slice(0, FAILED_TURN_MAX_CHARS - 1)}…` : cause;
  return {
    name: `${MARKER} ${words}`,
    ok: false,
    ...(flags.setup ? { setup: true } : {}),
    ...(flags.terminal ? { terminal: true } : {}),
    ...(flags.claudeUpdate ? { claudeUpdate: true } : {}),
  };
}

/** The cause a failed-turn row carries, without its marker; null for any
 * other activity row. */
export function failedTurnCause(name: string): string | null {
  return name.startsWith(MARKER) ? name.slice(MARKER.length).trim() : null;
}
