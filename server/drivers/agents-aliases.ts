// Member names of the agents action tools (shared/agents-tool-names.ts) still answer as calls: an engine session that
// saw them, a saved skill or memory, or an external runtime may use one. Each runs as that same call to its action tool,
// with the same checks and result; none is listed.
import type { Json } from "./agents-client.ts";

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** An id the call must carry to mean an update: empty when it was left out, so the tool refuses rather than creates. */
const required = (args: Json, key: string): Json => ({ ...args, [key]: args[key] ?? "" });

export const AGENTS_TOOL_ALIASES: Readonly<Record<string, { tool: string; args: (args: Json) => Json }>> = {
  list_triggers: { tool: "trigger_info", args: (args) => ({ ...args, action: "list" }) },
  list_trigger_events: { tool: "trigger_info", args: (args) => ({ ...args, action: "events" }) },
  create_trigger: { tool: "trigger", args: (args) => ({ ...args, action: "create" }) },
  manage_trigger: {
    tool: "trigger",
    args: ({ changes, ...args }) => ({ ...(record(changes) ? changes : {}), ...args, action: args.action === "create" ? undefined : args.action }),
  },
  create_room: { tool: "manage_room", args: (args) => ({ ...args, action: "create" }) },
  memory_log: { tool: "memory_update", args: (args) => ({ ...args, action: "log" }) },
  session_read: { tool: "session_search", args: (args) => required(required(args, "thread_id"), "message_id") },
  update_widget: { tool: "show_widget", args: (args) => required(args, "widget_id") },
  update_html: { tool: "show_html", args: (args) => required(args, "app_id") },
  x_user_posts: { tool: "x_search", args: (args) => ({ ...args, action: "user_posts" }) },
  x_post: { tool: "x_search", args: (args) => ({ ...args, action: "post" }) },
  x_profile: { tool: "x_search", args: (args) => ({ ...args, action: "profile" }) },
};

/** The tool a call runs and its arguments: an alias as its action tool's call, any other name as it came. */
export function resolveAgentsCall(name: string, args: Json): { name: string; arguments: Json } {
  const alias = Object.hasOwn(AGENTS_TOOL_ALIASES, name) ? AGENTS_TOOL_ALIASES[name] : undefined;
  return alias ? { name: alias.tool, arguments: alias.args(args) } : { name, arguments: args };
}
