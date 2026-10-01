# Remote Local VM viewer

Build and run the isolated server/browser fixture on Linux or macOS:

```sh
pnpm build
node --experimental-strip-types scripts/verify-local-vm-viewer.ts
```

To reuse installed browser tools, set `OMB_AGENT_BROWSER_PATH` and
`AGENT_BROWSER_EXECUTABLE_PATH` explicitly. The fixture prints its temporary
data directory and persistent server log. It launches the standard fake-engine
server, a synthetic Docker executable that can only inspect its fixture, and
an RFB desktop on a randomly allocated loopback port. Browser profiles and
server data are disposable; it never contacts the host Docker daemon or a real
desktop. Cleanup closes the owned browser, server and RFB sockets.
The synthetic Docker executable is a POSIX shebang script; this standalone
recipe does not cover Windows. It is a manual smoke command, not part of
`pnpm test` or the renderer CI job.

The fixture reuses the shared HTTP and browser helpers. Keyboard and clipboard
checks wait for received RFB events, with bounded waits. Set
`OMB_UI_EVIDENCE_DIR` to retain screenshots in a chosen directory, as in the
other renderer recipes; otherwise they stay beside the printed server log.

The script pairs the browser through the real HTTP API, follows the same
status and WebSocket routes as a remote admin, and verifies:

- The built noVNC page displays the synthetic desktop's pixels.
- Paired status returns a viewer link on the app origin, without a password.
- The Keyboard panel sends text, newline, Unicode keysyms and Ctrl–Alt–Del.
- Clipboard text arrives from the desktop; editing or clearing the field syncs
  automatically without a Send button or device clipboard permissions.
- The noVNC background matches its parent in dark and light themes.
- The Send button follows Foundry's enabled and disabled text colors.
- Automatic 95% fit, fullscreen (when supported), native tooltips and the
  animated collapsible sidebar work; closed controls are inert.
- Panels use the app's shared menu motion, including reduced-motion behavior.
- The panels fit phone and short landscape viewports; dark and light screenshots
  show the built UI using the app's skin tokens.
- Reconnect opens a new working desktop connection.
- Page exit aborts a pending connection request; a persisted-page restore
  opens a fresh connection.
- Logout closes the already-open WebSocket.

The focused server tests exercise shared, per-bot and pool target selection,
HTTP and upgrade authentication, client-scope and foreign-origin refusal,
session revocation/expiry, shutdown and revocation during inspection,
established-connection shutdown, disconnect during inspection, target deletion,
upstream rejection/timeouts, and stripping workspace credentials from the
upstream request:

```sh
pnpm exec vitest run server/routes/local-vm-viewer.test.ts server/container-computer.test.ts server/request-auth.test.ts
pnpm exec vitest run scripts/testing/verification-docs.test.ts
```

The page is built with the app; VM-controlled HTML and JavaScript never run
under the app origin. The proxy forwards only the RFB WebSocket, never workspace
cookies or tokens. Revocation closes connections immediately; expiry and target
availability are rechecked every five seconds.

These checks use a synthetic RFB server and Chromium. They do not claim a
real container, Tailscale TLS connection, Safari/iPhone, or native Electron
viewer acceptance. Local owner requests retain the existing direct viewer
URL and Electron cookie isolation.
