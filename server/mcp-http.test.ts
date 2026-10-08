// The remote MCP client against a real HTTP server on loopback.
import { afterEach, describe, expect, it } from "vitest";

import { RemoteMcpClient } from "./mcp-http.ts";
import { startFakeHttpMcp, type FakeHttpMcp } from "./testing/fake-http-mcp-server.ts";

let fake: FakeHttpMcp | undefined;
let client: RemoteMcpClient | undefined;
afterEach(async () => {
  await client?.close(); client = undefined;
  await fake?.close(); fake = undefined;
});

describe("a server's own requests to the client", () => {
  it.each(["http", "sse"] as const)("are refused at once over %s, so the call they interrupt still finishes", async (transport) => {
    fake = await startFakeHttpMcp({ transport, tools: [{ name: "ask_first", inputSchema: { type: "object" } }], askOnCall: "elicitation/create" });
    client = new RemoteMcpClient({ type: transport, url: fake.url, headers: {} });
    await client.initialize("fixture", AbortSignal.timeout(5_000));
    // without an answer the server holds the result until this deadline
    const result = await client.request("tools/call", { name: "ask_first", arguments: {} }, AbortSignal.timeout(5_000));
    expect(result).toEqual({ content: [{ type: "text", text: "remote execution recorded" }] });
    expect(fake.replies).toEqual([{ jsonrpc: "2.0", id: "server-ask-1", error: { code: -32601, message: "Method not supported by this client" } }]);
  });

  it.each(["http", "sse"] as const)("include a ping, which gets its empty answer over %s", async (transport) => {
    fake = await startFakeHttpMcp({ transport, tools: [{ name: "ask_first", inputSchema: { type: "object" } }], askOnCall: "ping" });
    client = new RemoteMcpClient({ type: transport, url: fake.url, headers: {} });
    await client.initialize("fixture", AbortSignal.timeout(5_000));
    await client.request("tools/call", { name: "ask_first", arguments: {} }, AbortSignal.timeout(5_000));
    expect(fake.replies).toEqual([{ jsonrpc: "2.0", id: "server-ask-1", result: {} }]);
  });
});
