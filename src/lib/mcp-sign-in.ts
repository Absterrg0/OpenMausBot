// Signing in to a URL MCP server from the desktop: the server starts the
// sign-in and listens for the browser's return on this machine; the app
// opens the sign-in page, offers paste-back for another computer, and polls.

export type McpSignInPhase = "waiting" | "succeeded" | "failed" | "cancelled" | "expired";

export interface McpSignInStatus {
  phase: McpSignInPhase;
  flowId: string | null;
  authorizationUrl: string | null;
  expiresAt?: string;
  message?: string;
}

interface Deps {
  api: (path: string, init?: { method?: string; body?: string }) => Promise<any>;
  open: (url: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onStarted?: (status: McpSignInStatus, complete: (result: McpSignInStatus) => void) => void;
}

const POLL_MS = 1_500;

/** Only an https page may be opened as a sign-in link. */
export function mcpSignInLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Start a sign-in for `name`, open its page, and resolve when it ends.
 * A start the server refuses (a server without OAuth, another owner's flow)
 * rejects with the server's message. */
export async function runMcpSignIn(name: string, deps: Deps): Promise<McpSignInStatus> {
  const base = `/api/mcp/servers/${encodeURIComponent(name)}/sign-in`;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = (await deps.api(base, { method: "POST" })).auth as McpSignInStatus;
  if (started.phase !== "waiting") return started;
  const cancel = () => started.flowId
    ? deps.api(`${base}/${started.flowId}`, { method: "DELETE" }).catch(() => undefined)
    : Promise.resolve();
  const link = mcpSignInLink(started.authorizationUrl);
  if (!link || !started.flowId) {
    await cancel();
    return { ...started, phase: "failed", authorizationUrl: null };
  }
  if (deps.signal?.aborted) {
    await cancel();
    return { ...started, phase: "cancelled", authorizationUrl: null };
  }
  let complete!: (result: McpSignInStatus) => void;
  const completed = new Promise<McpSignInStatus>((resolve) => {
    complete = (result) => { if (result.phase !== "waiting") resolve(result); };
  });
  deps.onStarted?.(started, complete);
  try { await deps.open(link); }
  catch { /* The waiting UI also offers an explicit Open sign-in page button. */ }
  let status = started;
  while (status.phase === "waiting") {
    // A pasted callback already returns the final status. Do not make the
    // form wait for another poll (or leave it waiting after clearing input).
    const submitted = await Promise.race([completed, sleep(POLL_MS).then(() => null)]);
    if (submitted) return submitted;
    if (deps.signal?.aborted) {
      await cancel();
      return { ...status, phase: "cancelled", authorizationUrl: null };
    }
    try {
      status = await Promise.race([
        completed,
        deps.api(`${base}/${started.flowId}`).then((response) => response.auth as McpSignInStatus),
      ]);
    } catch {
      return { ...status, phase: "expired", authorizationUrl: null };
    }
  }
  return status;
}

/** Send the callback as a JSON body, never as a query parameter or a fetch target. */
export async function completeMcpSignIn(name: string, flowId: string, callbackUrl: string, api: Deps["api"]): Promise<McpSignInStatus> {
  const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/sign-in/${encodeURIComponent(flowId)}`, {
    method: "POST", body: JSON.stringify({ callbackUrl: callbackUrl.trim() }),
  });
  return result.auth as McpSignInStatus;
}
