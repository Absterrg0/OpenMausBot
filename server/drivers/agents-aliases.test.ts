import { describe, expect, it } from "vitest";

import { isOutboundTool } from "../../shared/outbound.ts";
import { WIDGET_SAMPLES } from "../../shared/widget-samples.ts";
import { AGENTS_ACTION_TOOLS, agentsCallIdentities, agentsCallMember } from "../../shared/agents-tool-names.ts";
import { allowsTool } from "../../shared/tool-scope.ts";
import { isReadOnlyAgentTool } from "../agent-tool-policy.ts";
import { AGENTS_TOOL_ALIASES, resolveAgentsCall } from "./agents-aliases.ts";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import type { Json } from "./agents-client.ts";
import { agentsMcp } from "./agents-mcp.ts";

const EVERYTHING = {
  OMB_BOT_ID: "bot-alias", OMB_CHIEF_OF_STAFF: "1", OMB_SKILL_AUTHORING_ENABLED: "1", OMB_SHARED_COMPUTERS_ENABLED: "1",
  OMB_VOICE_NOTES: "1", OMB_X_RESEARCH: "1", OMB_ESCALATIONS: "1", OMB_TEAM_PEOPLE: "1", OMB_MAUSBOT: "1",
};
const LISTED = new Set(availableTools(catalogProfileFromEnv(EVERYTHING)).map((tool) => tool.name));

/** One call per alias, as an earlier session or a saved skill writes it. */
const CALLS: Record<string, Json> = {
  list_triggers: { trigger_id: "t-1", include_address: true },
  list_trigger_events: { app: "Gmail", search: "new message" },
  create_trigger: { when: "webhook", name: "Leads", instructions: "Draft a reply.", webhook_event_types: ["lead"] },
  manage_trigger: { trigger_id: "t-1", action: "update", changes: { name: "Morning news", continuity: true } },
  create_room: { name: "Launch", member_bot_ids: ["bot-a"], bulletin: "Ship it." },
  memory_log: { text: "Deployed the site." },
  session_read: { thread_id: "thread-old", message_id: "message-old" },
  update_widget: { widget_id: "m7", widget: WIDGET_SAMPLES.buildStatus },
  update_html: { app_id: "m9", html: "<p>v2</p>" },
  x_user_posts: { handle: "@openmausbot", limit: 5 },
  x_post: { post: "https://x.com/openmausbot/status/123", replies: true },
  x_profile: { handle: "openmausbot" },
};

/** What a call sends to the harness, and what the model reads back. */
async function run(name: string, args: Json) {
  const sent: Array<{ path: string; body?: unknown }> = [];
  const answer = { ok: true, status: 201, body: { messageId: "m1", resultId: "t-1", now: "2026-10-29T09:00:00Z", timeZone: "UTC", triggers: [], ok: true, file: "memory/log/2026-10-29.md", line: "- 09:00 · Deployed the site.", text: "Saved." } };
  const context: ToolCallContext = {
    botId: "bot-alias", threadId: "thread-alias", depth: 0, externalRuntime: false, sharedComputers: true,
    client: {
      api: async (path, init) => { sent.push({ path, body: init?.body }); return answer.body; },
      apiResponse: async (path, init) => { sent.push({ path, body: init?.body }); return answer; },
    },
  };
  return { result: await callTool(name, args, context), sent };
}

describe("the agents tools' aliases", () => {
  it("cover every member of every action tool that is not listed under its own name, and nothing else", () => {
    const members = Object.values(AGENTS_ACTION_TOOLS).flatMap((tool) => tool.members).filter((member) => !LISTED.has(member));
    expect(Object.keys(AGENTS_TOOL_ALIASES).sort()).toEqual(members.sort());
    expect(Object.keys(CALLS).sort()).toEqual(members.sort());
    for (const [alias, { tool }] of Object.entries(AGENTS_TOOL_ALIASES)) {
      expect(LISTED.has(alias), alias).toBe(false);
      expect(LISTED.has(tool), tool).toBe(true);
    }
  });

  it.each(Object.entries(CALLS))("%s goes by its own name as a call of its action tool", (alias, args) => {
    const { name, arguments: mapped } = resolveAgentsCall(alias, args);
    expect(name).toBe(AGENTS_TOOL_ALIASES[alias]!.tool);
    expect(agentsCallMember(name, mapped)).toBe(alias);
    expect(agentsCallIdentities(name, mapped)).toEqual(agentsCallIdentities(alias, args));
  });

  it.each(Object.entries(CALLS))("%s runs exactly as the same call to its action tool", async (alias, args) => {
    const direct = resolveAgentsCall(alias, args);
    expect(direct.name).not.toBe(alias);
    const viaAlias = await run(alias, args);
    expect(viaAlias.sent.length, alias).toBeGreaterThan(0);
    expect(viaAlias).toEqual(await run(direct.name, direct.arguments));
  });

  it("keep refusing what the name refused, rather than doing something else", async () => {
    expect((await run("update_widget", { widget: WIDGET_SAMPLES.buildStatus })).result).toEqual({ text: "widget_id: is required, the id show_widget returned.", isError: true });
    expect((await run("update_html", { html: "<p>x</p>" })).result).toEqual({ text: "app_id: is required, the id show_html returned.", isError: true });
    expect((await run("session_read", { thread_id: "thread-old" })).result.text).toContain("needs both thread_id and message_id");
    const created = await run("manage_trigger", { trigger_id: "t-1", action: "create", changes: { name: "A", instructions: "B", when: "webhook" } });
    expect(created.result.isError).toBe(true);
    expect(created.sent).toEqual([]);
  });

  it("run only where the action tool is listed, as the proxy's unknown-tool check sees them", async () => {
    const call = (env: Record<string, string>, name: string) => agentsMcp({ ...EVERYTHING, OMB_HARNESS_URL: "http://127.0.0.1:9", ...env })(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: CALLS[name] } } as Json,
    );
    expect(await call({ OMB_CHIEF_OF_STAFF: "0" }, "create_room")).toMatchObject({ error: { code: -32602, message: "Unknown tool: create_room" } });
    expect(await call({ OMB_MEMORY_ENABLED: "0" }, "memory_log")).toMatchObject({ error: { message: "Unknown tool: memory_log" } });
    expect(await call({ OMB_X_RESEARCH: "0" }, "x_profile")).toMatchObject({ error: { message: "Unknown tool: x_profile" } });
    const reached = await call({}, "create_room") as { result?: { isError: boolean } };
    expect(reached.result?.isError).toBe(true);
  });
});

describe("the agents action tools", () => {
  const READS = new Set(["list_triggers", "list_trigger_events", "session_search", "session_read", "x_search", "x_user_posts", "x_post", "x_profile"]);

  it.each(Object.entries(AGENTS_ACTION_TOOLS))("%s does only what reads the same: all reads or all changes, none outbound", (tool, { members }) => {
    const reads = members.map((member) => READS.has(member));
    expect(new Set(reads).size, members.join(", ")).toBe(1);
    if (isReadOnlyAgentTool(tool)) expect(reads[0], tool).toBe(true);
    for (const name of [tool, ...members]) {
      for (const prefix of ["", "mcp__agents__", "agents__", "agents_"]) expect(isOutboundTool(`${prefix}${name}`), `${prefix}${name}`).toBe(false);
    }
  });
});

describe("a tool selection over the agents action tools", () => {
  const tool = (name: string) => ({ kind: "mcp" as const, server: "agents", name });

  it("keeps a selector written with an action's own name meaning just those calls", () => {
    const noCreate = { deny: ["mcp:agents:create_trigger"] };
    expect(allowsTool(noCreate, tool("trigger"))).toBe(true);
    expect(allowsTool(noCreate, tool("trigger"), { action: "create" })).toBe(false);
    expect(allowsTool(noCreate, tool("trigger"), { action: "pause", trigger_id: "t-1" })).toBe(true);
    expect(allowsTool(noCreate, tool("create_trigger"), {})).toBe(false);
    const onlyCreate = { allow: ["mcp:agents:create_trigger"] };
    expect(allowsTool(onlyCreate, tool("trigger"))).toBe(true);
    expect(allowsTool(onlyCreate, tool("trigger"), { action: "create" })).toBe(true);
    expect(allowsTool(onlyCreate, tool("trigger"), { action: "delete" })).toBe(false);
    expect(allowsTool(onlyCreate, tool("trigger_info"))).toBe(false);
    const noLog = { deny: ["mcp:agents:memory_log"] };
    expect(allowsTool(noLog, tool("memory_update"), { action: "append" })).toBe(true);
    expect(allowsTool(noLog, tool("memory_update"), { action: "log" })).toBe(false);
    expect(allowsTool({ allow: ["mcp:agents:memory_update"] }, tool("memory_update"), { action: "log" })).toBe(false);
    expect(allowsTool({ allow: ["mcp:agents:update_widget"] }, tool("show_widget"), { widget: {} })).toBe(false);
    expect(allowsTool({ allow: ["mcp:agents:update_widget"] }, tool("show_widget"), { widget_id: "m1", widget: {} })).toBe(true);
  });

  it("lets the action tool's own name cover all it does, and a deny of it refuse every alias", () => {
    const noTriggers = { deny: ["mcp:agents:trigger"] };
    expect(allowsTool(noTriggers, tool("trigger"))).toBe(false);
    for (const name of ["create_trigger", "manage_trigger"]) expect(allowsTool(noTriggers, tool(name), {}), name).toBe(false);
    expect(allowsTool({ allow: ["mcp:agents:trigger_info"] }, tool("list_trigger_events"), {})).toBe(true);
    expect(allowsTool({ allow: ["mcp:agents:*"] }, tool("trigger"), { action: "create" })).toBe(true);
    expect(allowsTool({ allow: ["mcp:agents:trigger"] }, tool("trigger_info"))).toBe(false);
  });
});
