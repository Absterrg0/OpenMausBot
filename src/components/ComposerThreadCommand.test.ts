import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";
import { threadAfterArchive, typedThreadCommand } from "./ComposerThreadCommand";

const bot = (threadId: string, mainThreadId?: string): Bot => ({
  id: "b", threadId, mainThreadId, name: "Atlas", title: "", description: "", color: "blue",
  notifications: false, unread: false, busy: false, messages: [], modelSelection: { instanceId: "i", model: "m" },
  tasks: [
    { threadId: "main", title: "Main", createdAt: 1, updatedAt: 1 },
    { threadId: "side", title: "Side", createdAt: 2, updatedAt: 2 },
  ],
});

describe("composer thread commands", () => {
  it("knows /archive and /delete typed alone, in any case", () => {
    expect(typedThreadCommand("/archive")).toBe("archive");
    expect(typedThreadCommand("/Delete  ")).toBe("delete");
    expect(typedThreadCommand("/archive this one")).toBeUndefined();
    expect(typedThreadCommand("please /delete")).toBeUndefined();
  });

  it("moves to the main thread, or to the next thread when the main one is archived", () => {
    expect(threadAfterArchive(bot("side", "main"))).toBe("main");
    expect(threadAfterArchive(bot("main", "main"))).toBe("side");
  });
});
