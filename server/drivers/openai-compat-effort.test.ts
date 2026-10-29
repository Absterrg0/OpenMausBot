import { afterEach, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";

afterEach(() => vi.unstubAllGlobals());

const models = {
  data: [
    { id: "deepseek-v4.1-flash", reasoning_effort_levels: ["low", "medium", "high"] },
    { id: "router-model", supported_parameters: ["tools", "reasoning_effort"] },
    { id: "plain-model" },
  ],
};
const reply = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

async function fixture() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models")) return Response.json(models);
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(reply, { headers: { "content-type": "text/event-stream" } });
  }));
  const instance = await OpenAICompatDriver.create({
    instanceId: "openai-compat-1", displayName: "Flatt", enabled: true,
    config: OpenAICompatDriver.decodeConfig({ url: "https://api.example.test/v1", apiKeyEnv: "K" }),
    environment: { K: "fixture-key" },
  });
  await instance.refreshModels?.();
  const turn = async (model: string, variant?: string) => {
    const events: RuntimeEvent[] = [];
    const off = instance.adapter.onEvent((event) => events.push(event));
    await instance.adapter.sendTurn({ threadId: `t-${bodies.length}`, text: "hi", model, ...(variant ? { variant } : {}) });
    await vi.waitFor(() => { if (!events.some((event) => event.type === "turn.completed")) throw new Error("running"); });
    off();
    return bodies.at(-1)!;
  };
  return { instance, turn };
}

it("offers the reasoning efforts a model advertises on /models", async () => {
  const { instance } = await fixture();
  expect(instance.adapter.capabilities.modelVariants).toBe(true);
  const variants = Object.fromEntries(instance.models.options.map((option) => [option.id, option.variants?.map((variant) => variant.id)]));
  expect(variants).toEqual({
    "deepseek-v4.1-flash": ["low", "medium", "high"],
    "router-model": ["low", "medium", "high"],
    "plain-model": undefined,
  });
  await instance.dispose();
});

it("sends the chosen effort as reasoning_effort, and nothing the model does not advertise", async () => {
  const { instance, turn } = await fixture();
  expect((await turn("deepseek-v4.1-flash", "high")).reasoning_effort).toBe("high");
  expect(await turn("deepseek-v4.1-flash")).not.toHaveProperty("reasoning_effort");
  expect(await turn("deepseek-v4.1-flash", "turbo")).not.toHaveProperty("reasoning_effort");
  expect(await turn("plain-model", "high")).not.toHaveProperty("reasoning_effort");
  await instance.dispose();
});
