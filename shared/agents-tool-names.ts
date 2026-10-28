// The agents tools that each do several things, and the name each of their calls goes by: its member name. A tool
// selection and the call path read a call by that name, so a selector or a skill naming a member means exactly those
// calls. Every member reads the same as the tool it belongs to (all read-only, or all changing).
type Args = Record<string, unknown>;

const given = (args: Args, key: string) => args[key] !== undefined && args[key] !== null;

export interface AgentsActionTool {
  /** Every member, the tool's own name first when its plain calls keep it. */
  members: readonly string[];
  member(args: Args): string;
}

export const AGENTS_ACTION_TOOLS: Readonly<Record<string, AgentsActionTool>> = {
  trigger_info: { members: ["list_triggers", "list_trigger_events"], member: (args) => args.action === "events" ? "list_trigger_events" : "list_triggers" },
  trigger: { members: ["create_trigger", "manage_trigger"], member: (args) => args.action === "create" ? "create_trigger" : "manage_trigger" },
  manage_room: { members: ["manage_room", "create_room"], member: (args) => args.action === "create" ? "create_room" : "manage_room" },
  memory_update: { members: ["memory_update", "memory_log"], member: (args) => args.action === "log" ? "memory_log" : "memory_update" },
  session_search: { members: ["session_search", "session_read"], member: (args) => given(args, "thread_id") || given(args, "message_id") ? "session_read" : "session_search" },
  show_widget: { members: ["show_widget", "update_widget"], member: (args) => given(args, "widget_id") ? "update_widget" : "show_widget" },
  show_html: { members: ["show_html", "update_html"], member: (args) => given(args, "app_id") ? "update_html" : "show_html" },
  x_search: {
    members: ["x_search", "x_user_posts", "x_post", "x_profile"],
    member: (args) => args.action === "user_posts" ? "x_user_posts" : args.action === "post" ? "x_post" : args.action === "profile" ? "x_profile" : "x_search",
  },
};

const OWNER_OF_MEMBER = new Map(Object.entries(AGENTS_ACTION_TOOLS).flatMap(([tool, { members }]) => members.map((member) => [member, tool] as const)));

function record(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The member name a call to `tool` with `args` goes by; the tool's own name when it does one thing. */
export function agentsCallMember(tool: string, args: unknown): string {
  const action = Object.hasOwn(AGENTS_ACTION_TOOLS, tool) ? AGENTS_ACTION_TOOLS[tool] : undefined;
  return action ? action.member(record(args) ? args : {}) : tool;
}

/** The action tool `name` is a member of, if any. */
export function agentsActionToolOf(name: string): string | undefined {
  return OWNER_OF_MEMBER.get(name);
}

/** The names that identify an agents call in a tool selection: its member name, and its tool's name when that is not
 * itself a member. With no arguments (a tool being listed) one set per call the tool can make. */
export function agentsCallIdentities(name: string, args?: unknown): string[][] {
  const tool = agentsActionToolOf(name) ?? name;
  const action = Object.hasOwn(AGENTS_ACTION_TOOLS, tool) ? AGENTS_ACTION_TOOLS[tool] : undefined;
  if (!action) return [[name]];
  const named = (member: string) => action.members.includes(tool) ? [member] : [tool, member];
  if (name !== tool) return [named(name)];
  return args === undefined ? action.members.map(named) : [named(action.member(record(args) ? args : {}))];
}
