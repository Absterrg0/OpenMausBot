// Full server + built viewer + synthetic Docker/RFB, in disposable homes.
// Build first, then run with explicit OMB_AGENT_BROWSER_PATH and
// AGENT_BROWSER_EXECUTABLE_PATH if reusing installed browser binaries.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./testing/control-omb-ui.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";
import { fakeVnc } from "./testing/fake-vnc.ts";
import { BASE_IMAGE_DIGEST, CUA_DRIVER_VERSION, IMAGE, IMAGE_LAYER_VERSION } from "../server/container-computer.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "omb-viewer-fixture-"));
const bin = join(scratch, "bin");
mkdirSync(bin);
mkdirSync(join(scratch, "tmp"));
const desktop = await fakeVnc();
let fixture: VerificationServer | undefined;
let browser: { binary: string; env: NodeJS.ProcessEnv } | undefined;
try {
  // This executable answers only read-only inspection. No command can reach
  // the machine's real Docker installation, even during fixture startup.
  writeFileSync(join(bin, "docker"), `#!${process.execPath}
const args = process.argv.slice(2);
const labels = ${JSON.stringify({ "com.openmausbot.local-vm": "1", "com.openmausbot.cua-driver": CUA_DRIVER_VERSION, "com.openmausbot.cua-base": BASE_IMAGE_DIGEST, "com.openmausbot.image-layer": IMAGE_LAYER_VERSION, "com.openmausbot.workspace": "1" })};
let result;
if (args[0] === 'info') result = 'fixture';
else if (args[0] === 'image' && args[1] === 'inspect') result = [{Id:'sha256:fixture',Config:{Labels:labels}}];
else if (args[0] === 'inspect' && args[1] === 'openmausbot-computer') result = [{
  Config:{Image:${JSON.stringify(IMAGE)},Labels:labels,Env:['VNC_PW=fixture-password']},
  State:{Running:true},Image:'sha256:fixture',
  HostConfig:{PortBindings:{'6901/tcp':[{HostIp:'127.0.0.1',HostPort:'${desktop.port}'}]}},
  NetworkSettings:{Ports:{'6901/tcp':[{HostIp:'127.0.0.1',HostPort:'${desktop.port}'}]}}
}];
else if (args[0] === 'ps') result = '';
else process.exit(1);
process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
`, { mode: 0o700 });
  fixture = await launchVerificationServer(process.env, undefined, {
    binDir: bin, host: "ssh://127.0.0.1:1", sshKey: join(scratch, "unused-key"), staticDir: join(root, "dist"),
  });
  console.log(JSON.stringify(fixture.info));
  const api = fixtureApi(fixture.info.url);
  const pairing = await api("POST", "/api/auth/pairing", { scopes: ["admin", "client"] });
  const { binary, chrome } = await ensureUiBrowser(process.env);
  const env = sessionEnv({ home: scratch, session: `viewer-${process.pid}`, chrome });
  browser = { binary, env };
  const command = (...args: string[]) => agentBrowser(binary, env, args);
  const evaluate = async <T = unknown>(js: string) => (await command("eval", js)).result as T;
  await command("open", `${fixture.info.url}/local-vm-viewer#target=shared`);
  // Pair through the actual HTTP endpoint in this disposable browser. The
  // resulting cookie forces both status and upgrades through session auth.
  assert.equal(await evaluate(`(async () => (await fetch('/api/auth/pair', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:${JSON.stringify(pairing.code)},cookie:true,label:'Viewer fixture'})})).status)()`), 200);
  let nextConnection = desktop.nextConnection();
  await command("click", "#retry");
  await nextConnection;
  await command("wait", "--fn", "document.getElementById('status').textContent === 'Desktop connected'");
  assert.equal(await evaluate("document.querySelector('canvas').width"), 16);
  await command("wait", "--fn", "document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[0] === 255");
  assert.equal(await evaluate("document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[0]"), 255);
  const status = await evaluate<{ viewer_url: string }>("fetch('/api/local-computer').then(r=>r.json())");
  assert.equal(status.viewer_url, "/local-vm-viewer#target=shared");
  assert.equal(status.viewer_url.includes("password"), false);
  const matchingBackgrounds = "getComputedStyle(document.querySelector('#screen > div')).backgroundColor === getComputedStyle(document.querySelector('main')).backgroundColor";
  assert.equal(await evaluate(matchingBackgrounds), true);
  const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR ? resolve(root, process.env.OMB_UI_EVIDENCE_DIR) : dirname(fixture.info.logPath);
  mkdirSync(evidenceDir, { recursive: true });
  const desktopScreenshot = join(evidenceDir, `viewer-${process.pid}-desktop.png`);
  await command("wait", "--fn", "document.getAnimations().every(a => a.playState !== 'running')");
  await command("screenshot", desktopScreenshot);
  await command("click", "#keyboard");
  await command("fill", "#text", "Hello\n世界");
  await command("click", "#send");
  await desktop.untilKey(0x0100754c);
  assert.ok(desktop.keys.includes(72));
  assert.ok(desktop.keys.includes(0xff0d));
  assert.ok(desktop.keys.includes(0x01004e16));
  await command("click", "#ctrl-alt-del");
  await desktop.untilKey(0xffff);
  assert.ok(desktop.keys.includes(0xffff));
  await command("click", "#clipboard");
  desktop.sendClipboard("From the desktop");
  await command("wait", "--fn", "document.getElementById('clipboard-text').value === 'From the desktop'");
  assert.equal(await evaluate("document.getElementById('send') === null"), true);
  let nextClipboard = desktop.nextClipboard();
  await command("fill", "#clipboard-text", "To the desktop");
  assert.deepEqual(await nextClipboard, ["To the desktop"]);
  nextClipboard = desktop.nextClipboard();
  await command("press", "Control+a");
  await command("press", "Backspace");
  assert.deepEqual(await nextClipboard, [""]);
  // Editing this field syncs automatically; device clipboard permissions are never requested.
  await command("click", "#clipboard");
  assert.equal(await evaluate("document.getElementById('fit') === null"), true);
  assert.equal(await evaluate("(() => { const r = document.getElementById('screen').getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(); return r.width / m.width > .94 && r.width / m.width < .96 && r.height / m.height > .94 && r.height / m.height < .96; })()"), true);
  assert.equal(await evaluate("document.getElementById('keyboard').title"), "Keyboard");
  assert.equal(await evaluate("document.querySelector('link[rel=license]').getAttribute('href')"), "/licenses/novnc/NOTICE.txt");
  const dockedWidth = await evaluate<number>("document.querySelector('main').getBoundingClientRect().width");
  await command("click", "#hide-controls");
  await command("wait", "--fn", "document.querySelector('aside').getBoundingClientRect().width === 0");
  assert.ok(await evaluate<number>("document.querySelector('main').getBoundingClientRect().width") > dockedWidth);
  assert.equal(await evaluate("document.querySelector('aside').inert"), true);
  await command("click", "#show-controls");
  await command("wait", "--fn", "document.querySelector('aside').getBoundingClientRect().width === 72");
  if (await evaluate("document.fullscreenEnabled")) {
    await command("click", "#fullscreen");
    await command("wait", "--fn", "Boolean(document.fullscreenElement)");
    await command("click", "#fullscreen");
    await command("wait", "--fn", "!document.fullscreenElement");
  }
  await command("set", "viewport", "390", "844");
  await command("click", "#keyboard");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const phoneScreenshot = join(evidenceDir, `viewer-${process.pid}-phone.png`);
  await command("wait", "--fn", "document.getAnimations().every(a => a.playState !== 'running')");
  await command("screenshot", phoneScreenshot);
  assert.equal(await evaluate("(() => { const r = document.querySelector('section').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  await evaluate("document.documentElement.dataset.skin = 'daylight'");
  await command("wait", "--fn", "getComputedStyle(document.getElementById('retry')).color === 'rgb(87, 87, 87)'");
  assert.equal(await evaluate(matchingBackgrounds), true);
  const lightScreenshot = join(evidenceDir, `viewer-${process.pid}-light.png`);
  await command("screenshot", lightScreenshot);
  // Match the shared skin rules for both enabled and disabled accent buttons.
  await evaluate("document.documentElement.dataset.skin = 'foundry'");
  await command("wait", "--fn", "getComputedStyle(document.getElementById('send')).color === 'rgb(176, 166, 150)'");
  await command("fill", "#text", "Foundry preview");
  await command("wait", "--fn", "getComputedStyle(document.getElementById('send')).color === 'rgb(28, 21, 12)'");
  const foundryScreenshot = join(evidenceDir, `viewer-${process.pid}-foundry.png`);
  await command("screenshot", foundryScreenshot);
  // A short landscape viewport must keep both the dock and panel scrollable.
  await command("set", "viewport", "844", "390");
  assert.equal(await evaluate("document.documentElement.scrollHeight <= innerHeight && document.querySelector('section').getBoundingClientRect().height <= innerHeight"), true);
  assert.equal(await evaluate("(async () => { document.getElementById('keyboard').click(); await new Promise(requestAnimationFrame); const p = document.querySelector('section'); return !p || p.inert; })()"), true);
  await command("wait", "--fn", "!document.querySelector('section')");
  // Reuse the app's reduced-motion path and verify that a closed panel leaves
  // no focusable controls behind, including during its normal animated exit.
  await evaluate("document.documentElement.dataset.reducedMotion = 'true'");
  await command("click", "#keyboard");
  await command("click", "#keyboard");
  await command("wait", "--fn", "!document.querySelector('section')");
  nextConnection = desktop.nextConnection();
  await command("click", "#retry");
  await nextConnection;
  await command("wait", "--fn", "document.getElementById('status').textContent === 'Desktop connected'");
  // Leaving while the credentials request is in flight must abort it. A
  // persisted-page restore must then establish a fresh connection.
  await evaluate(`(() => {
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
      if (input !== '/api/local-computer/viewer/shared') return fetch(input, init);
      window.fetch = fetch;
      window.viewerSignal = init.signal;
      const response = await fetch(input, init);
      await new Promise(resolve => { window.releaseViewerRequest = resolve; });
      return response;
    };
  })()`);
  await command("click", "#retry");
  await command("wait", "--fn", "typeof window.releaseViewerRequest === 'function'");
  assert.equal(await evaluate("(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})); return window.viewerSignal.aborted; })()"), true);
  await evaluate("window.releaseViewerRequest()");
  nextConnection = desktop.nextConnection();
  await evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))");
  await nextConnection;
  await command("wait", "--fn", "document.getElementById('status').textContent === 'Desktop connected'");
  const beforeLogout = desktop.connections();
  assert.equal(await evaluate("fetch('/api/auth/session').then(r=>r.json()).then(s=>s.kind)"), "session");
  assert.equal(await evaluate("fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)"), 200);
  await command("wait", "--fn", "document.getElementById('status').textContent.includes('disconnected')");
  assert.ok(beforeLogout >= 2);
  console.log(JSON.stringify({ ok: true, checks: ["built noVNC renders RFB pixels", "paired status uses app URL", "keyboard, Unicode and Ctrl-Alt-Del", "clipboard sync without Send, including clearing", "matching desktop backgrounds in both themes", "Foundry accent text", "automatic 95% fit, fullscreen and animated sidebar", "native tooltips and reduced-motion panels", "phone and landscape viewports", "reconnect", "page exit aborts pending connection and restore reconnects", "logout closes socket"], logPath: fixture.info.logPath, screenshots: [desktopScreenshot, phoneScreenshot, lightScreenshot, foundryScreenshot] }));
} finally {
  if (browser) await agentBrowser(browser.binary, browser.env, ["close"], 10_000).catch(() => {});
  await fixture?.close();
  await desktop.close();
  rmSync(scratch, { recursive: true, force: true });
}
