import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import type { InstanceConfigMap } from "../contracts.ts";
import { UNNAMED_LIMIT_MS } from "../limit-resets.ts";
import { MODEL_HOLD_MS, createLimitTakeover, type LimitTakeoverDeps, type TakeoverEngine } from "./limit-takeover.ts";

const NOW = Date.parse("2026-10-27T10:00:00Z");
const HOUR = 3_600_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const TOOLS = { agentsMcp: true, customMcp: true, composioMcp: true } as unknown as TakeoverEngine["capabilities"];

function engine(instanceId: string, driverKind: string, models: string[], extra: Partial<TakeoverEngine> = {}): TakeoverEngine {
  return {
    instanceId, driverKind,
    snapshot: { state: "available", authenticated: true },
    models: { default: models[0]!, options: models.map((id) => ({ id, label: id })) },
    capabilities: TOOLS,
    ...extra,
  };
}

const CLAUDE = engine("claude", "claudeAgent", ["claude-opus-5-5", "claude-sonnet-5"]);
const CODEX = engine("codex", "codex", ["gpt-6", "gpt-6-mini"]);
const GO = engine("opencode", "opencode", ["go-default"]);
const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode Go" };
const on = (instanceId: string, model: string): ModelSelection => ({ instanceId, model });
const KAI = { id: "kai", name: "Kai" };

function takeover(overrides: Partial<LimitTakeoverDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-limit-takeover-"));
  dirs.push(dir);
  const now = { at: NOW };
  const told: Array<{ bot: string; text: string }> = [];
  const record = vi.fn();
  const instance = createLimitTakeover({
    file: join(dir, "limit-notices.json"),
    engines: () => [CLAUDE, CODEX, GO],
    configs: () => ({}),
    context: {},
    blockedUntil: () => null,
    chosen: () => [],
    engineName: (id) => NAMES[id] ?? id,
    tell: (bot, text) => { told.push({ bot: bot.name, text }); },
    record,
    now: () => now.at,
    ...overrides,
  });
  return { instance, told, record, now };
}

describe("which AI carries on while one is limited", () => {
  it("never picks an AI that bills each use by itself, only as a backup the person chose", () => {
    const apiClaude = engine("claude-api", "claudeAgent", ["claude-opus-5-5"], { access: "api" });
    const keyedClaude = engine("claude-key", "claudeAgent", ["claude-opus-5-5"]);
    const keyed = { "claude-key": { environment: { ANTHROPIC_API_KEY: "sk-ant-fixture" } } } as unknown as InstanceConfigMap;
    expect(takeover({ engines: () => [CODEX, apiClaude] }).instance.backups("kai", on("codex", "gpt-6"))).toEqual([]);
    expect(takeover({ engines: () => [CODEX, keyedClaude], configs: () => keyed }).instance.backups("kai", on("codex", "gpt-6"))).toEqual([]);
    expect(takeover({ engines: () => [CODEX, apiClaude, GO] }).instance.backups("kai", on("codex", "gpt-6"))).toEqual([on("opencode", "go-default")]);
    expect(takeover({ engines: () => [CODEX, apiClaude], chosen: () => [on("claude-api", "claude-opus-5-5")] }).instance.backups("kai", on("codex", "gpt-6")))
      .toEqual([on("claude-api", "claude-opus-5-5")]);
  });

  it("takes the backups the person chose first, then the AI a new bot would get, and never the limited AI", () => {
    const { instance } = takeover({ chosen: () => [on("opencode", "go-default"), on("codex", "gpt-6-mini")] });
    expect(instance.backups("kai", on("codex", "gpt-6"))).toEqual([on("opencode", "go-default"), on("claude", "claude-opus-5-5")]);
    expect(takeover().instance.backups("kai", on("codex", "gpt-6"))).toEqual([on("claude", "claude-opus-5-5")]);
  });

  it("for one model's own limit tries that AI's default model first, and never the limited model", () => {
    const { instance } = takeover();
    expect(instance.backups("kai", on("claude", "claude-sonnet-5"), "model")).toEqual([on("claude", "claude-opus-5-5"), on("codex", "gpt-6")]);
    expect(instance.backups("kai", on("claude", "claude-opus-5-5"), "credits")).toEqual([on("codex", "gpt-6")]);
  });

  it("leaves out an AI that is signed out, held by its own limit, short of this AI's tools, or another sign-in to the same plan", () => {
    const signedOut = engine("claude", "claudeAgent", ["claude-opus-5-5"], { snapshot: { state: "available", authenticated: false } });
    expect(takeover({ engines: () => [signedOut, CODEX] }).instance.backups("kai", on("codex", "gpt-6"))).toEqual([]);
    expect(takeover({ blockedUntil: (id) => (id === "claude" ? NOW + HOUR : null) }).instance.backups("kai", on("codex", "gpt-6")))
      .toEqual([on("opencode", "go-default")]);
    const fewerTools = engine("claude", "claudeAgent", ["claude-opus-5-5"], { capabilities: { agentsMcp: true } as unknown as TakeoverEngine["capabilities"] });
    expect(takeover({ engines: () => [fewerTools, CODEX] }).instance.backups("kai", on("codex", "gpt-6"))).toEqual([]);
    const secondCodex = engine("codex-2", "codex", ["gpt-6"]);
    expect(takeover({ engines: () => [CODEX, secondCodex], chosen: () => [on("codex-2", "gpt-6")] }).instance.backups("kai", on("codex", "gpt-6")),
      "never another sign-in to the same plan").toEqual([]);
    const keyed = { "codex-2": { environment: { OPENAI_API_KEY: "sk-test" } } } as unknown as InstanceConfigMap;
    expect(takeover({ engines: () => [CODEX, secondCodex], configs: () => keyed, chosen: () => [on("codex-2", "gpt-6")] }).instance.backups("kai", on("codex", "gpt-6")),
      "a pay-per-use key on the same AI is fine as a backup the person chose").toEqual([on("codex-2", "gpt-6")]);
  });

  it("has none for an AI it doesn't know", () => {
    expect(takeover().instance.backups("kai", on("gone", "m"))).toEqual([]);
  });
});

describe("a model's own limit", () => {
  const error = (limit: "model" | "credits" | "engine", limitResetsAt?: number) => ({
    eventId: "e", provider: "claudeAgent", createdAt: new Date(NOW).toISOString(), threadId: "t1",
    type: "runtime.error", message: "limit", limit, ...(limitResetsAt ? { limitResetsAt } : {}),
  }) as RuntimeEvent;

  it("holds that model alone until the reset it named, at most six hours, an hour when it named none, and not once it works", () => {
    const { instance, now } = takeover();
    instance.noteRuntimeEvent(on("claude", "claude-opus-5-5"), error("model", NOW + 2 * HOUR));
    expect(instance.modelHeld(on("claude", "claude-opus-5-5"))).toEqual({ until: NOW + 2 * HOUR, resetsAt: NOW + 2 * HOUR, scope: "model" });
    expect(instance.modelHeld(on("claude", "claude-sonnet-5")), "the AI's other models still work").toBeNull();
    instance.noteRuntimeEvent(on("claude", "claude-opus-5-5"), error("model", NOW + 50 * HOUR));
    expect(instance.modelHeld(on("claude", "claude-opus-5-5")), "tried again after six hours, the named reset kept")
      .toEqual({ until: NOW + MODEL_HOLD_MS, resetsAt: NOW + 50 * HOUR, scope: "model" });
    instance.holdModel(on("claude", "claude-sonnet-5"), "credits");
    expect(instance.modelHeld(on("claude", "claude-sonnet-5"))).toEqual({ until: NOW + UNNAMED_LIMIT_MS, scope: "credits" });
    instance.noteRuntimeEvent(on("codex", "gpt-6"), error("engine"));
    expect(instance.modelHeld(on("codex", "gpt-6")), "an engine's own limit is the reset clock's to hold").toBeNull();
    expect(instance.backups("kai", on("codex", "gpt-6")), "a held model carries on nothing").toEqual([on("opencode", "go-default")]);

    instance.worked("kai", on("claude", "claude-opus-5-5"));
    expect(instance.modelHeld(on("claude", "claude-opus-5-5"))).toBeNull();
    now.at = NOW + UNNAMED_LIMIT_MS + 1;
    expect(instance.modelHeld(on("claude", "claude-sonnet-5"))).toBeNull();
  });
});

describe("what the person hears", () => {
  it("says once per bot for each stretch of a limit what carries on, and again once a turn on that AI worked", () => {
    const { instance, told } = takeover();
    const resetsAt = NOW + 4 * HOUR;
    instance.tell(KAI, on("codex", "gpt-6"), { resetsAt, scope: "engine", backup: on("claude", "claude-opus-5-5") });
    instance.tell(KAI, on("codex", "gpt-6"), { resetsAt, scope: "engine", backup: on("claude", "claude-opus-5-5") });
    instance.tell({ id: "rosa", name: "Rosa" }, on("codex", "gpt-6"), { resetsAt });
    expect(told.map((entry) => entry.bot)).toEqual(["Kai", "Rosa"]);
    expect(told[0]!.text).toMatch(/^Codex reached its limit until .+, so Kai is using Claude meanwhile\.$/);
    expect(told[1]!.text).toMatch(/^Codex reached its limit until .+, so Rosa waits until then: no other AI you have set up can take over\.$/);
    instance.worked("kai", on("codex", "gpt-6"));
    instance.tell(KAI, on("codex", "gpt-6"), { resetsAt, backup: on("claude", "claude-opus-5-5") });
    expect(told).toHaveLength(3);
  });

  it("names the model for a model's own limit, and the same AI's other model when that carries on", () => {
    const { instance, told } = takeover();
    instance.tell(KAI, on("claude", "claude-sonnet-5"), { scope: "credits", backup: on("claude", "claude-opus-5-5") });
    instance.tell(KAI, on("claude", "claude-opus-5-5"), { scope: "model", backup: on("codex", "gpt-6") });
    expect(told.map((entry) => entry.text)).toEqual([
      "Claude claude-sonnet-5's extra usage credits are used up, so Kai is using Claude claude-opus-5-5 meanwhile.",
      "Claude claude-opus-5-5 reached its limit, so Kai is using Codex meanwhile.",
    ]);
  });

  it("files one incident per bot for each stretch of a limit, apart from the person's notice", () => {
    const { instance, told } = takeover();
    const resetsAt = NOW + 4 * HOUR;
    instance.tell(KAI, on("codex", "gpt-6"), { resetsAt });
    expect(instance.firstIncident("kai", on("codex", "gpt-6"), "engine", resetsAt), "the notice is not the incident").toBe(true);
    expect(instance.firstIncident("kai", on("codex", "gpt-6"), "engine", resetsAt)).toBe(false);
    expect(instance.firstIncident("rosa", on("codex", "gpt-6"), "engine", resetsAt)).toBe(true);
    expect(instance.firstIncident("kai", on("claude", "claude-opus-5-5"), "model"), "another limit is another stretch").toBe(true);
    instance.worked("kai", on("codex", "gpt-6"));
    expect(instance.firstIncident("kai", on("codex", "gpt-6"), "engine", resetsAt), "a new stretch once it worked").toBe(true);
    expect(told).toHaveLength(1);
  });

  it("records a conversation that moved, so it goes back once the limit resets", () => {
    const { instance, record } = takeover();
    instance.moved("kai", "t1", on("codex", "gpt-6"), on("claude", "claude-opus-5-5"), NOW + HOUR);
    instance.moved("kai", "t2", on("codex", "gpt-6"), on("claude", "claude-opus-5-5"));
    expect(record.mock.calls.map(([failover]) => failover)).toEqual([
      { botId: "kai", threadId: "t1", from: on("codex", "gpt-6"), to: on("claude", "claude-opus-5-5"), resetsAt: NOW + HOUR, at: NOW },
      { botId: "kai", threadId: "t2", from: on("codex", "gpt-6"), to: on("claude", "claude-opus-5-5"), resetsAt: null, at: NOW },
    ]);
  });
});
