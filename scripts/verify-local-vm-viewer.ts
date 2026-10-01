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
  const desktopScreenshot = join(dirname(fixture.info.logPath), `viewer-${process.pid}-desktop.png`);
  await command("screenshot", desktopScreenshot);
  await command("click", "#keyboard");
  await command("fill", "#text", "Hello\n世界");
  await command("click", "#send");
  assert.ok(desktop.keys.includes(72));
  assert.ok(desktop.keys.includes(0xff0d));
  assert.ok(desktop.keys.includes(0x01004e16));
  await command("set", "viewport", "390", "844");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const phoneScreenshot = join(dirname(fixture.info.logPath), `viewer-${process.pid}-phone.png`);
  await command("screenshot", phoneScreenshot);
  nextConnection = desktop.nextConnection();
  await command("click", "#retry");
  await nextConnection;
  await command("wait", "--fn", "document.getElementById('status').textContent === 'Desktop connected'");
  const beforeLogout = desktop.connections();
  assert.equal(await evaluate("fetch('/api/auth/session').then(r=>r.json()).then(s=>s.kind)"), "session");
  assert.equal(await evaluate("fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)"), 200);
  await command("wait", "--fn", "document.getElementById('status').textContent.includes('disconnected')");
  assert.ok(beforeLogout >= 2);
  console.log(JSON.stringify({ ok: true, checks: ["built noVNC renders RFB pixels", "paired status uses app URL", "keyboard and Unicode", "phone viewport", "reconnect", "logout closes socket"], logPath: fixture.info.logPath, screenshots: [desktopScreenshot, phoneScreenshot] }));
} finally {
  if (browser) await run(browser.binary, ["close"], { env: browser.env, timeout: 10_000 }).catch(() => {});
  await fixture?.close();
  await desktop.close();
  rmSync(scratch, { recursive: true, force: true });
}
