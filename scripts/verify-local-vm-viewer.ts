// Full server + built viewer + synthetic Docker/RFB, in disposable homes.
// Build first, then run with explicit OMB_AGENT_BROWSER_PATH and
// AGENT_BROWSER_EXECUTABLE_PATH if reusing installed browser binaries.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";
import { ensureUiBrowser, sessionEnv } from "./testing/control-omb-ui.ts";
import { fakeVnc } from "./testing/fake-vnc.ts";
import { BASE_IMAGE_DIGEST, CUA_DRIVER_VERSION, IMAGE, IMAGE_LAYER_VERSION } from "../server/container-computer.ts";

const run = promisify(execFile);
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
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`${fixture!.info.url}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.ok, true, `${path}: ${response.status}`);
    return response.json();
  };
  const pairing = await api("/api/auth/pairing", { scopes: ["admin", "client"] });
  const { binary, chrome } = await ensureUiBrowser(process.env);
  const env = sessionEnv({ home: scratch, session: `viewer-${process.pid}`, chrome });
  browser = { binary, env };
  const command = async (...args: string[]) => {
    const { stdout } = await run(binary, ["--json", ...args], { env, timeout: 30_000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    assert.equal(result.success, true, stdout);
    return result.data;
  };
  const evaluate = async (js: string) => (await command("eval", js)).result;
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
  const status = await evaluate("fetch('/api/local-computer').then(r=>r.json())");
  assert.equal(status.viewer_url, "/local-vm-viewer#target=shared");
  assert.equal(status.viewer_url.includes("password"), false);
  const matchingBackgrounds = "getComputedStyle(document.querySelector('#screen > div')).backgroundColor === getComputedStyle(document.querySelector('main')).backgroundColor";
  assert.equal(await evaluate(matchingBackgrounds), true);
  const desktopScreenshot = join(dirname(fixture.info.logPath), `viewer-${process.pid}-desktop.png`);
  await command("wait", "--fn", "document.getAnimations().every(a => a.playState !== 'running')");
  await command("screenshot", desktopScreenshot);
  await command("click", "#keyboard");
  await command("fill", "#text", "Hello\n世界");
  await command("click", "#send");
  assert.ok(desktop.keys.includes(72));
  assert.ok(desktop.keys.includes(0xff0d));
  assert.ok(desktop.keys.includes(0x01004e16));
  await command("click", "#ctrl-alt-del");
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
  const dockedWidth = await evaluate("document.querySelector('main').getBoundingClientRect().width");
  await command("click", "#hide-controls");
  await command("wait", "--fn", "document.querySelector('aside').getBoundingClientRect().width === 0");
  assert.ok(await evaluate("document.querySelector('main').getBoundingClientRect().width") > dockedWidth);
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
  const phoneScreenshot = join(dirname(fixture.info.logPath), `viewer-${process.pid}-phone.png`);
  await command("wait", "--fn", "document.getAnimations().every(a => a.playState !== 'running')");
  await command("screenshot", phoneScreenshot);
  assert.equal(await evaluate("(() => { const r = document.querySelector('section').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"), true);
  await evaluate("document.documentElement.dataset.skin = 'daylight'");
  await command("wait", "--fn", "getComputedStyle(document.getElementById('retry')).color === 'rgb(87, 87, 87)'");
  assert.equal(await evaluate(matchingBackgrounds), true);
  const lightScreenshot = join(dirname(fixture.info.logPath), `viewer-${process.pid}-light.png`);
  await command("screenshot", lightScreenshot);
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
  const beforeLogout = desktop.connections();
  assert.equal(await evaluate("fetch('/api/auth/session').then(r=>r.json()).then(s=>s.kind)"), "session");
  assert.equal(await evaluate("fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)"), 200);
  await command("wait", "--fn", "document.getElementById('status').textContent.includes('disconnected')");
  assert.ok(beforeLogout >= 2);
  console.log(JSON.stringify({ ok: true, checks: ["built noVNC renders RFB pixels", "paired status uses app URL", "keyboard, Unicode and Ctrl-Alt-Del", "clipboard sync without Send, including clearing", "matching desktop backgrounds in both themes", "automatic 95% fit, fullscreen and animated sidebar", "native tooltips and reduced-motion panels", "phone and landscape viewports", "reconnect", "logout closes socket"], logPath: fixture.info.logPath, screenshots: [desktopScreenshot, phoneScreenshot, lightScreenshot] }));
} finally {
  if (browser) await run(browser.binary, ["close"], { env: browser.env, timeout: 10_000 }).catch(() => {});
  await fixture?.close();
  await desktop.close();
  rmSync(scratch, { recursive: true, force: true });
}
