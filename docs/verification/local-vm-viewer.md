# Remote Local VM viewer

Build and run the isolated server/browser fixture:

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

The script pairs the browser through the real HTTP API, follows the same
status and WebSocket routes as a remote admin, and verifies:

- The built noVNC page displays the synthetic desktop's pixels.
- Paired status returns a viewer link on the app origin, without a password.
- The Keyboard panel sends text, newline, Unicode keysyms and Ctrl–Alt–Del.
- Clipboard text travels in both directions through explicit controls.
- Automatic 95% fit, fullscreen (when supported), native tooltips and the
  animated collapsible sidebar work; closed controls are inert.
- Panels use the app's shared menu motion, including reduced-motion behavior.
- The panels fit phone and short landscape viewports; dark and light screenshots
  show the built UI using the app's skin tokens.
- Reconnect opens a new working desktop connection.
- Logout closes the already-open WebSocket.

The focused server tests exercise shared, per-bot and pool target selection,
HTTP and upgrade authentication, client-scope and foreign-origin refusal,
session revocation/expiry, disconnect during inspection, target deletion,
upstream rejection/timeouts, and stripping workspace credentials from the
upstream request:

```sh
pnpm exec vitest run server/routes/local-vm-viewer.test.ts server/container-computer.test.ts server/request-auth.test.ts
```

These checks use a synthetic RFB server and Chromium. They do not claim a
real container, Tailscale TLS connection, Safari/iPhone, or native Electron
viewer acceptance. Local owner requests retain the existing direct viewer
URL and Electron cookie isolation.
