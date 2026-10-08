// A stdio facade for selected HTTP/SSE MCP servers. Configuration stays in
// private environment data; stdout contains only protocol frames.
//
// A driver whose engine cannot search tools on its own also sets
// OMB_REMOTE_MCP_DIRECTORY. Then a big catalog is searched instead of listed
// (mcp-directory.ts): tools/list answers search_tools, describe_tool and
// call_tool, the upstream catalog is read once per process and again after
// the server says it changed, and a small catalog still passes through. The
// same setting carries the bot's tool selection, so search, describe and
// call_tool only ever see the tools the bot may use.
import { createInterface } from "node:readline";
import { allowsTool, parseToolScope, type ToolScope } from "../shared/tool-scope.ts";

import type { ValidateFunction } from "ajv";
import {
  CALL_TOOL,
  DESCRIBE_TOOL,
  INSTRUCTIONS_CHARS,
  SEARCH_TOOL,
  SELECTION_EXCLUDES,
  ToolDirectory,
  bounded,
  searchesCatalog,
  type CatalogTool,
  type DirectoryContext,
} from "./mcp-directory.ts";
import { MAX_REMOTE_MCP_BYTES, REMOTE_MCP_CONFIG_ENV, RemoteMcpClient, remoteMcpSpec } from "./mcp-http.ts";
import { lenientToolValidator, schemaProblems } from "./mcp-schema-validator.ts";

type Json = Record<string, unknown>;
function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requestKey(id: unknown): string | undefined {
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id)) ? `${typeof id}:${id}` : undefined;
}
function send(frame: unknown): void { process.stdout.write(`${JSON.stringify(frame)}\n`); }
function error(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id: requestKey(id) ? id : null, error: { code, message } });
}
function fail(message: string): never {
  process.stderr.write(`mcp-remote-proxy: ${message}\n`);
  process.exit(1);
}

/** A refusal of our own: its words carry nothing remote, so they are relayed. */
class Refusal extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const SETTINGS = ["OMB_REMOTE_MCP_SERVER", "OMB_REMOTE_MCP_DIRECTORY"];
/** Codex hands every MCP child one shared environment, so a mount there
 * names its own private record (`--config-env NAME`) holding the same
 * settings. Either way they leave this process's environment once read. */
function privateSettings(): Record<string, string | undefined> {
  if (process.argv.length === 2) {
    const settings = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));
    for (const name of SETTINGS) delete process.env[name];
    return settings;
  }
  const key = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== "--config-env" || !key || !REMOTE_MCP_CONFIG_ENV.test(key)) return {};
  const raw = process.env[key];
  delete process.env[key];
  try {
    const value: unknown = JSON.parse(raw ?? "");
    if (isRecord(value) && Object.entries(value).every(([name, setting]) => SETTINGS.includes(name) && typeof setting === "string")) {
      return value as Record<string, string>;
    }
  } catch { /* invalid private config */ }
  return {};
}

const settings = privateSettings();
let spec;
try { spec = remoteMcpSpec(JSON.parse(settings.OMB_REMOTE_MCP_SERVER ?? "")); } catch { /* invalid private config */ }
if (!spec) fail("invalid remote MCP configuration");

/** The directory's settings: which server this is (the name tool selections
 * use) and the bot's selection. Present but invalid never becomes a proxy
 * without them: a selection that cannot be read must not widen to all. */
function directorySettings(raw: string | undefined): { server: string; scope: ToolScope | undefined } | undefined {
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value) && typeof value.name === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value.name)
      && Object.keys(value).every((key) => key === "name" || key === "toolScope")) {
      const parsed = parseToolScope(value.toolScope);
      if (parsed.ok) return { server: value.name, scope: parsed.scope };
    }
  } catch { /* reported below */ }
  return fail("invalid tool directory configuration");
}
const directory = directorySettings(settings.OMB_REMOTE_MCP_DIRECTORY);
const allowed = (name: string) => !directory?.scope || allowsTool(directory.scope, { kind: "mcp", server: directory.server, name });

// ── the directory (only with OMB_REMOTE_MCP_DIRECTORY) ──

/** The bot's part of the upstream catalog, and whether it is searched. */
interface Catalog { tools: ToolDirectory; searched: boolean }
const CATALOG_PAGES = 100;
const CATALOG_MS = 120_000;
let catalog: Catalog | undefined;
let loading: Promise<Catalog> | undefined;
let generation = 0;
/** Once searched, always searched in this process: the engine was handed
 * call_tool, and a tool it found must stay reachable through it. */
let searching = false;
const context: DirectoryContext = { server: directory?.server ?? "" };

const closed = new AbortController();
const client = new RemoteMcpClient(spec, {
  maxBytes: MAX_REMOTE_MCP_BYTES,
  onNotification: (message) => {
    // The catalog changed upstream: read it again on the next request.
    if (directory && message.method === "notifications/tools/list_changed") {
      generation += 1;
      catalog = undefined;
      loading = undefined;
    }
    send(message);
  },
});
const pending = new Map<string, AbortController>();
const tasks = new Set<Promise<void>>();
let initialized = false;
let closing = false;

/** Every page of the upstream catalog, read under its own deadline so a
 * cancelled first request does not cancel it for the next one. */
async function readCatalog(): Promise<CatalogTool[]> {
  const signal = AbortSignal.any([closed.signal, AbortSignal.timeout(CATALOG_MS)]);
  const tools: CatalogTool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < CATALOG_PAGES; page += 1) {
    const result = await client.request("tools/list", cursor === undefined ? {} : { cursor }, signal);
    if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("invalid tool catalog");
    for (const tool of result.tools) {
      if (isRecord(tool) && typeof tool.name === "string" && tool.name.trim()) tools.push(tool as CatalogTool);
    }
    const next = result.nextCursor;
    if (next === undefined || next === null || next === "") return tools;
    if (typeof next !== "string" || cursors.has(next)) throw new Error("invalid catalog cursor");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("tool catalog has too many pages");
}

/** One forgiving validator per tool definition (lenientToolValidator), or
 * null where there is none worth running. The server enforces its own
 * schema either way: a tool without a validator, or one whose validator
 * throws (a schema that refers to itself forever), is called unchecked. */
const validators = new WeakMap<CatalogTool, ValidateFunction | null>();
function argumentProblems(tool: CatalogTool, args: Json): string[] | undefined {
  let validate = validators.get(tool);
  if (validate === undefined) {
    validate = lenientToolValidator(tool.inputSchema);
    validators.set(tool, validate);
  }
  if (!validate) return undefined;
  try { return validate(args) ? undefined : schemaProblems(validate.errors); }
  catch { return undefined; }
}

/** Settles with `promise`, or rejects when this request's own signal fires. */
function raced<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function currentCatalog(signal: AbortSignal): Promise<Catalog> {
  if (catalog) return Promise.resolve(catalog);
  if (!loading) {
    const started = generation;
    const read = readCatalog().then((upstream) => {
      const tools = new ToolDirectory(upstream.filter((tool) => allowed(tool.name)), {
        withheld: upstream.filter((tool) => !allowed(tool.name)).map((tool) => tool.name),
        check: argumentProblems,
      });
      searching ||= searchesCatalog(tools.tools);
      const built = { tools, searched: searching };
      if (generation === started) catalog = built;
      return built;
    });
    loading = read;
    void read.catch(() => {}).finally(() => { if (loading === read) loading = undefined; });
  }
  return raced(loading, signal);
}

async function callTool(params: unknown, signal: AbortSignal): Promise<unknown> {
  if (!isRecord(params) || typeof params.name !== "string" || (params.arguments !== undefined && !isRecord(params.arguments))) {
    throw new Refusal(-32602, "Invalid tool call");
  }
  // With the directory on these names always mean the directory: a catalog
  // that uses one of them itself is searched, never listed.
  if (params.name === SEARCH_TOOL) return (await currentCatalog(signal)).tools.search(params.arguments);
  if (params.name === DESCRIBE_TOOL) return (await currentCatalog(signal)).tools.describe(params.arguments);
  if (params.name === CALL_TOOL) {
    const call = (await currentCatalog(signal)).tools.call(params.arguments);
    if ("answer" in call) return call.answer;
    // The catalog holds only selected tools; checked again all the same.
    if (!allowed(call.name)) return { content: [{ type: "text", text: SELECTION_EXCLUDES }], isError: true };
    return client.request("tools/call", { ...(isRecord(params._meta) ? { _meta: params._meta } : {}), name: call.name, arguments: call.arguments }, signal);
  }
  // A tool listed while the catalog was small stays callable by its name.
  if (!allowed(params.name)) throw new Refusal(-32602, SELECTION_EXCLUDES);
  return client.request("tools/call", params, signal);
}

async function directed(message: Json, signal: AbortSignal): Promise<unknown> {
  if (message.method === "initialize") {
    const result = await client.initialize("OpenMausBot tool proxy", signal);
    if (!isRecord(result)) return result;
    const info = isRecord(result.serverInfo) ? result.serverInfo : {};
    const title = typeof info.title === "string" ? info.title : typeof info.name === "string" ? info.name : undefined;
    if (title) context.title = title;
    if (typeof result.instructions !== "string") return result;
    context.instructions = result.instructions;
    return { ...result, instructions: bounded(result.instructions, INSTRUCTIONS_CHARS) };
  }
  if (message.method === "tools/list") {
    // One page holds everything; a cursor is one this proxy never gave.
    if (isRecord(message.params) && message.params.cursor !== undefined) throw new Refusal(-32602, "Invalid cursor");
    const { tools, searched } = await currentCatalog(signal);
    return { tools: searched ? tools.listed(context) : tools.tools };
  }
  if (message.method === "tools/call") return callTool(message.params, signal);
  return client.request(message.method as string, message.params, signal);
}

async function handle(message: Json): Promise<void> {
  const id = requestKey(message.id);
  if (typeof message.method !== "string" || message.jsonrpc !== "2.0") {
    error(message.id, -32600, "Invalid JSON-RPC request");
    return;
  }
  if (message.method === "notifications/cancelled") {
    const key = isRecord(message.params) ? requestKey(message.params.requestId) : undefined;
    if (key) pending.get(key)?.abort();
    return;
  }
  if (!id) {
    // initialize() has already sent this once with its negotiated version.
    if (message.method === "notifications/initialized" && initialized) return;
    try { await client.notify(message.method, message.params, AbortSignal.timeout(30_000)); }
    catch { /* notifications have no reply and must not print remote details */ }
    return;
  }
  if (pending.has(id)) { error(message.id, -32600, "Duplicate request ID"); return; }
  const controller = new AbortController();
  pending.set(id, controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(message.method === "tools/call" ? 120_000 : 30_000)]);
  try {
    const result = directory
      ? await directed(message, signal)
      : message.method === "initialize"
        ? await client.initialize("OpenMausBot tool proxy", signal)
        : await client.request(message.method, message.params, signal);
    if (message.method === "initialize") initialized = true;
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (failure) {
    // Remote errors may contain URLs or header values. Do not relay their text.
    if (failure instanceof Refusal) error(message.id, failure.code, failure.message);
    else error(message.id, signal.aborted ? -32800 : -32603, signal.aborted ? "MCP request cancelled" : "Remote MCP request failed");
  } finally { pending.delete(id); }
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (closing || !line.trim()) return;
  let value: unknown;
  try { value = JSON.parse(line); } catch { error(null, -32700, "Invalid JSON-RPC frame"); return; }
  if (!isRecord(value)) { error(null, -32600, "Invalid JSON-RPC frame"); return; }
  const task = handle(value);
  tasks.add(task);
  void task.finally(() => tasks.delete(task));
});
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  input.close();
  for (const controller of pending.values()) controller.abort();
  closed.abort();
  await Promise.allSettled(tasks);
  await client.close();
  process.exit(0);
}
input.on("close", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
