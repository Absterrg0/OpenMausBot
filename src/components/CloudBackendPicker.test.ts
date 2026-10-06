// Boat and a self-hosted VPS follow one rule (shared/cloud-computer.ts): an
// engine that can use a computer can use either. The Computer engine, which
// could run only on Boat, is gone, so neither backend is offered or refused
// on its own, and no copy sends anyone to Boat to get around an engine.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import { CloudBackendPicker } from "./CloudBackendPicker";

describe("the cloud backend picker", () => {
  it.each(["box", "vps"] as const)("offers both backends whichever is chosen (%s)", (value) => {
    const markup = renderToStaticMarkup(createElement(CloudBackendPicker, { value, onChange: () => {} }));
    expect(markup).toContain("Boat");
    expect(markup).toContain("Self-hosted VPS");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toMatch(/ACP model provider/);
  });

  it("leaves no message that tells someone to switch backends for an engine", () => {
    expect(Object.keys(en)).not.toContain("computer.err.vpsEngine");
    expect(Object.values(en).filter((value) => /switch the cloud backend to Boat/i.test(value))).toEqual([]);
  });
});
