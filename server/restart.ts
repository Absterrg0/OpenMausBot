// "Start me again": the one exit code a server uses to ask its launcher for
// a fresh start. A server exits with it after a copied workspace's restore
// commits (Copy this computer here, docs/copy-workspace.md), and startup then
// installs the restore before anything else loads. Every launcher in this
// repo honours it with serverExitAction:
//
//   - `openmausbot serve` (cli.ts serveUntilStopped), which systemd, launchd,
//     fleet and a terminal all run;
//   - the container image's launcher (server-launcher.ts);
//   - the OMB Cloud home's launcher (cloud-home-start.ts);
//   - the desktop app's supervisor, which starts its server again after any
//     exit (electron/server-supervisor.mjs).
//
// Anything else that runs `node dist-server/index.js` directly stays down;
// the committed restore installs at its next start.
export const RESTART_EXIT_CODE = 75;
/** Restarts in a row before a launcher gives up: a loop, not a restore. */
export const MAX_RESTARTS = 5;
/** A run that stayed up this long was not part of a loop. */
export const STABLE_RUN_MS = 60_000;

/** What a launcher does when its server exits: start it again only when it
 * asked to, and only a few times in a row. */
export function serverExitAction(code: number | null, stopping: boolean, restarts: number): "restart" | "stop" {
  return !stopping && code === RESTART_EXIT_CODE && restarts < MAX_RESTARTS ? "restart" : "stop";
}

/** The restarts-in-a-row count once a run of `ranMs` has ended. */
export function restartsAfter(restarts: number, ranMs: number): number {
  return ranMs >= STABLE_RUN_MS ? 0 : restarts;
}
