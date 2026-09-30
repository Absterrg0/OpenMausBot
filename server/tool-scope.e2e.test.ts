import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";

async function withFixture(mode: "happy" | "hang", run: (helpers: {
  api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  control(args: string[]): Promise<any>;
  url: string;
  dataDir: string;
  dump(): Promise<any>;
}) => Promise<void>) {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: mode });
  try {
    await run({
      url: fixture.info.url, dataDir: fixture.info.dataDir,
      api: async (method, path, body, headers = {}) => {
        const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() };
      },
      control: (args) => runControlOmb([...args, "--url", fixture.info.url]),
      dump: async () => {
        await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
        const value = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
        rmSync(fixture.fixtureDumpPath, { force: true });
        return value;
      },
    });
  } finally { await fixture.close(); }
}

it("validates, saves, clears and creates owner tool selections through the isolated API", async () => {
  await withFixture("happy", async ({ api, control, dataDir }) => {
    const { bot } = await control(["new-bot", "--name", "Selected tools fixture"]);
    const path = `/api/bots/${bot.id}`;
    const scope = { allow: ["native:read", "native:read"], deny: ["mcp:notes:write"] };
    expect((await api("PATCH", path, { toolScope: scope })).body.bot.toolScope).toEqual({ allow: ["native:read"], deny: ["mcp:notes:write"] });
    for (const toolScope of [false, [], { allow: "all" }, { allow: ["read"] }, { deny: ["mcp:*:read"] }, { unrecognized: true }]) {
      expect((await api("PATCH", path, { toolScope })).status).toBe(400);
    }
    expect((await api("PATCH", path, { toolScope: { allow: [] } })).body.bot.toolScope).toEqual({ allow: [] });
    const persisted = JSON.parse(readFileSync(join(dataDir, "bots.json"), "utf8"));
    expect(persisted.find((row: { id: string }) => row.id === bot.id).toolScope).toEqual({ allow: [] });
    expect((await api("PATCH", path, { title: "Unrelated edit" })).body.bot.toolScope).toEqual({ allow: [] });
    expect((await api("PATCH", path, { toolScope: null })).body.bot).not.toHaveProperty("toolScope");
    expect((await api("PATCH", `${path}/profile`, { toolScope: scope })).status).toBe(400);
    const paired = (await api("POST", "/api/auth/pairing", { scopes: ["client"] })).body;
    const session = (await api("POST", "/api/auth/pair", { code: paired.code, label: "Scope fixture client" })).body;
    expect((await api("PATCH", path, { toolScope: { allow: [] } }, { authorization: `Bearer ${session.token}` })).status).toBe(403);
    expect((await api("PATCH", "/api/config", { newBotDefaults: { profile: { toolScope: { allow: [] } } } })).status).toBe(200);
    expect((await api("POST", "/api/bots", { name: "Inherited no tools" })).body.bot.toolScope).toEqual({ allow: [] });
    expect((await api("POST", "/api/bots", { name: "Explicit reset", settings: { toolScope: null } })).body.bot).not.toHaveProperty("toolScope");
  });
}, 60_000);

it("refuses a corrupt persisted selection after a real server restart before starting an engine", async () => {
  const fixture = await launchVerificationServer();
  let restarted: ReturnType<typeof spawn> | undefined;
  const log = openSync(fixture.info.logPath, "a", 0o600);
  try {
    const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
    const { bot } = await control(["new-bot", "--name", "Corrupt scope fixture"]) as any;
    const stopped = once(fixture.child, "close"); fixture.child.kill(); await stopped;
    const file = join(fixture.info.dataDir, "bots.json");
    const bots = JSON.parse(readFileSync(file, "utf8"));
    bots.find((row: { id: string }) => row.id === bot.id).toolScope = { allow: "all" };
    writeFileSync(file, JSON.stringify(bots));
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      env: verificationServerEnvironment(process.env, fixture.info.dataDir, Number(new URL(fixture.info.url).port)),
      stdio: ["ignore", log, log],
    });
    await expect.poll(async () => {
      if (restarted!.exitCode !== null) throw new Error("Restarted fixture exited");
      try { return (await fetch(`${fixture.info.url}/api/health`)).ok; } catch { return false; }
    }, { timeout: 15_000 }).toBe(true);
    const loaded = await fetch(`${fixture.info.url}/api/bots?messages=0`).then((response) => response.json()) as { bots: Array<{ id: string; toolScope?: unknown }> };
    expect(loaded.bots.find((row) => row.id === bot.id)?.toolScope).toEqual({ allow: "all" });
    await control(["send", "--bot", bot.id, "--text", "Must not run."]);
    await control(["wait", "--bot", bot.id, "--timeout", "30"]);
    const messages = await control(["messages", "--bot", bot.id, "--limit", "10"]);
    expect(JSON.stringify(messages)).toMatch(/tool selection is invalid/i);
    expect(existsSync(fixture.fixtureDumpPath)).toBe(false);
  } finally {
    if (restarted && restarted.exitCode === null && restarted.signalCode === null) {
      const stopped = once(restarted, "close"); restarted.kill(); await stopped;
    }
    closeSync(log);
    await fixture.close();
  }
}, 60_000);

it("refuses selection changes during direct and room turns and requires a trusted widening path", async () => {
  await withFixture("hang", async ({ api, control, dump, url }) => {
    const { bot } = await control(["new-bot", "--name", "Active scope fixture"]);
    const { bot: idle } = await control(["new-bot", "--name", "Idle scope fixture"]);
    const current = { allow: ["native:*"] };
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: current })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${idle.id}`, { toolScope: { allow: [] } })).status).toBe(200);
    await control(["send", "--bot", bot.id, "--text", "Stay active."]); await dump();
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: { allow: [] } }, { origin: url })).status).toBe(409);
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: current })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${idle.id}`, { toolScope: null })).status).toBe(409);
    expect((await api("PATCH", `/api/bots/${idle.id}`, { toolScope: { allow: ["native:read"] } }, { origin: url })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${idle.id}`, { toolScope: { allow: [] } })).status).toBe(200);
    await control(["interrupt", "--bot", bot.id]); await control(["wait", "--bot", bot.id, "--timeout", "30"]);
    const { channel } = await control(["new-channel", "--name", "Selected tools room", "--members", bot.id]);
    await control(["send-channel", "--channel", channel.id, "--text", "Stay active in this room."]); await dump();
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: { deny: ["native:bash"] } }, { origin: url })).status).toBe(409);
    await control(["interrupt", "--channel", channel.id]); await control(["wait", "--channel", channel.id, "--timeout", "30"]);
  });
}, 60_000);

it("carries the latest original tool selection into fresh direct and room MCP connections", async () => {
  await withFixture("happy", async ({ api, control, dump }) => {
    const server = { name: "notes", command: process.execPath, args: ["--experimental-strip-types", fileURLToPath(new URL("./testing/fake-mcp-server.ts", import.meta.url))], enabled: true };
    expect((await api("POST", "/api/mcp/servers", server)).status).toBe(201);
    expect((await api("PATCH", "/api/mcp/servers/notes", { enabled: true })).status).toBe(200);
    const { bot } = await control(["new-bot", "--name", "Scope dispatch fixture"]);
    const direct = { allow: ["native:*", "mcp:notes:read_notes"] };
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: direct })).status).toBe(200);
    await control(["send", "--bot", bot.id, "--text", "Reply once."]);
    const first = await dump();
    expect(JSON.parse(first.mcpConfig.mcpServers.notes.env.OMB_GATE_TOOL_SCOPE)).toEqual(direct);
    await control(["wait", "--bot", bot.id, "--timeout", "30"]);
    const roomScope = { deny: ["mcp:notes:write_notes"] };
    expect((await api("PATCH", `/api/bots/${bot.id}`, { toolScope: roomScope })).status).toBe(200);
    const { channel } = await control(["new-channel", "--name", "Scope dispatch room", "--members", bot.id]);
    await control(["send-channel", "--channel", channel.id, "--text", "Reply once in this room."]);
    const second = await dump();
    expect(second.pid).not.toBe(first.pid);
    expect(JSON.parse(second.mcpConfig.mcpServers.notes.env.OMB_GATE_TOOL_SCOPE)).toEqual(roomScope);
    await control(["wait", "--channel", channel.id, "--timeout", "30"]);
  });
}, 60_000);
