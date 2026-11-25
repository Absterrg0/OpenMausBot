// @vitest-environment happy-dom
// The / menu in the real composer: skills can be picked anywhere in a message, built-in commands only at its start.
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";
import { newChatThreadId } from "@/state/new-chat";

const dispatch = vi.hoisted(() => vi.fn());
const layout = vi.hoisted(() => ({ phone: false }));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// The model picker in Advanced mode's footer reads a store this file does not build.
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/use-slash-skills", () => ({
  useSlashSkills: (_botId: string | undefined, _threadId: string, active: boolean) =>
    active ? [{ name: "standup", description: "Writes the weekly standup note." }, { name: "fork-release", description: "Prepares a release." }] : [],
}));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("@/lib/use-media-query", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/use-media-query")>();
  return { ...original, useMediaQuery: (query: string) => query === original.PHONE_LAYOUT && layout.phone };
});

import { Composer } from "./Composer";
import { AppUndoToast, showUndoToast } from "./UndoToast";

const bot: Bot = {
  id: "slash-bot", threadId: "slash-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [], activeLeafId: "visible-leaf",
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("the / menu in the composer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dispatch.mockClear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => root.render(createElement(Composer, { bot })));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fill(text: string, caret = text.length, draft = draftId) {
    flushSync(() => restoreComposerDraft(draft, { text, attachments: [] }));
    const input = container.querySelector("textarea")!;
    input.setSelectionRange(caret, caret);
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keyup", { key: "/", bubbles: true })));
    return input;
  }
  const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
  const labels = () => options().map((option) => option.querySelector(".truncate")?.textContent);
  const press = (input: HTMLTextAreaElement, key: string) => flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));

  it("offers the built-in commands and skills at the start of a message", () => {
    fill("/");
    expect(labels()).toEqual(["/goal", "/learn", "/setup", "/burst", "/fork", "/fork-release", "/standup"]);
  });

  it("submits a complete /fork as a fork action instead of a message", () => {
    const input = fill("/fork");
    press(input, "Enter");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "forkMessage", kind: "bot", ownerId: bot.id, threadId: bot.threadId, branchLeafId: bot.activeLeafId,
    }));
    expect(input.value).toBe("/fork");
    flushSync(() => dispatch.mock.calls[0]![0].onSuccess());
    expect(input.value).toBe("");
  });

  it("chooses the highlighted skill when it also matches a complete /fork", () => {
    const input = fill("/fork");
    press(input, "ArrowDown");
    expect(options().find((option) => option.getAttribute("aria-selected") === "true")?.textContent).toContain("/fork-release");
    press(input, "Enter");
    expect(input.value).toBe("/fork-release ");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a failed fork command in place and retries it next to the composer", () => {
    const input = fill("/fork");
    press(input, "Enter");
    expect(dispatch.mock.calls[0]![0].onError).toBeTypeOf("function");
    flushSync(() => dispatch.mock.calls[0]![0].onError("Wait for this conversation to finish."));
    const failure = container.querySelector('[role="alert"]')!;
    expect(failure.textContent).toContain("Wait for this conversation to finish.");
    expect(input.value).toBe("/fork");
    flushSync(() => failure.querySelector("button")!.click());
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(["forkMessage", "forkMessage"]);
  });

  it("completes /fo with Tab and forks on submission", () => {
    const input = fill("/fo");
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(input.value.trim()).toBe("/fork");
    expect(dispatch).not.toHaveBeenCalled();
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "forkMessage" }));
  });

  describe("/archive and /delete", () => {
    const threaded: Bot = {
      ...bot, mainThreadId: "main-thread",
      tasks: [
        { threadId: "main-thread", title: "Main", createdAt: 1 },
        { threadId: bot.threadId, title: "Release notes", createdAt: 2 },
      ],
    };
    const render = (shown: Bot) => flushSync(() => root.render(createElement(Fragment, null,
      createElement(Composer, { bot: shown }), createElement(AppUndoToast))));
    const actions = () => dispatch.mock.calls.map(([action]) => action);
    const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    const alert = () => container.querySelector('[role="alert"]')?.textContent;
    const confirmDelete = () => flushSync(() => [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === "Delete thread")!.click());
    afterEach(() => {
      showUndoToast(null);
      layout.phone = false;
    });

    it("archives the open thread, moves to the main thread, and undoes both", () => {
      render(threaded);
      const input = fill("/archive");
      press(input, "Enter");
      expect(actions()).toEqual([
        { type: "switchTask", botId: bot.id, threadId: "main-thread" },
        { type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { archivedAt: expect.any(Number) } },
      ]);
      expect(input.value).toBe("");
      render({ ...threaded, threadId: "main-thread" });
      const toast = document.body.querySelector('[role="status"]')!;
      expect(toast.textContent).toContain("Thread archived");
      dispatch.mockClear();
      flushSync(() => toast.querySelector("button")!.click());
      expect(actions()).toEqual([
        { type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { archivedAt: null } },
        { type: "switchTask", botId: bot.id, threadId: bot.threadId },
      ]);
      expect(document.body.querySelector('[role="status"]')).toBeNull();
    });

    it("are offered in a bot's thread, after /fork", () => {
      render(threaded);
      fill("/");
      expect(labels()).toEqual(["/goal", "/learn", "/setup", "/burst", "/fork", "/archive", "/delete", "/fork-release", "/standup"]);
    });

    it.each([["/arc", "/archive"], ["/del", "/delete"]])("picking %s from the menu leaves %s, which then runs on Enter", (typed, command) => {
      render(threaded);
      const input = fill(typed);
      flushSync(() => options().find((option) => option.querySelector(".truncate")?.textContent === command)!.click());
      expect(input.value).toBe(`${command} `);
      expect(dispatch).not.toHaveBeenCalled();
      press(input, "Enter");
      if (command === "/archive") expect(actions().map((action) => action.type)).toEqual(["switchTask", "updateTask"]);
      else expect(dialog()).not.toBeNull();
    });

    it("are offered in the phone layout too, where /delete still asks first", () => {
      layout.phone = true;
      render(threaded);
      fill("/");
      expect(labels()).toEqual(expect.arrayContaining(["/archive", "/delete"]));
      press(fill("/delete"), "Enter");
      expect(dispatch).not.toHaveBeenCalled();
      expect(dialog()).not.toBeNull();
    });

    it.each(["/archive", "/delete", "/fork"])("offers no %s in a blank new chat, which has no thread yet", (command) => {
      const blank = newChatThreadId(bot.id);
      render({ ...threaded, threadId: blank });
      fill("/", 1, `bot:${bot.id}:${blank}`);
      expect(labels()).toContain("/goal");
      expect(labels()).not.toContain(command);
      press(fill(command, command.length, `bot:${bot.id}:${blank}`), "Enter");
      expect(actions().some((action) => ["updateTask", "deleteTask", "forkMessage"].includes(action.type))).toBe(false);
      expect(dialog()).toBeNull();
    });

    it("opens a new thread when the archived one was the bot's only thread", () => {
      render({ ...bot, tasks: [{ threadId: bot.threadId, title: "Release notes", createdAt: 2 }] });
      press(fill("/archive"), "Enter");
      expect(actions()).toEqual([
        { type: "newTask", botId: bot.id },
        { type: "updateTask", botId: bot.id, threadId: bot.threadId, patch: { archivedAt: expect.any(Number) } },
      ]);
    });

    it("deletes the open thread only after the confirmation", () => {
      render(threaded);
      const input = fill("/delete");
      press(input, "Enter");
      expect(dispatch).not.toHaveBeenCalled();
      expect(dialog()!.textContent).toContain("“Release notes” and its conversation will be deleted.");
      confirmDelete();
      expect(actions()).toEqual([{ type: "deleteTask", botId: bot.id, threadId: bot.threadId }]);
      expect(input.value).toBe("");
    });

    it("keeps a thread that starts working while the confirmation is open", () => {
      render(threaded);
      press(fill("/delete"), "Enter");
      render({ ...threaded, busy: true });
      confirmDelete();
      expect(dispatch).not.toHaveBeenCalled();
      expect(alert()).toContain("Wait for this thread to finish, then try again.");
    });

    it("drops the confirmation when another thread opens under it, also on the way back", () => {
      render(threaded);
      press(fill("/delete"), "Enter");
      expect(dialog()).not.toBeNull();
      render({ ...threaded, threadId: "main-thread" });
      expect(dialog()).toBeNull();
      render(threaded);
      expect(dialog()).toBeNull();
    });

    it("leaves a working thread alone, says why next to the composer, and retries from there", () => {
      render({ ...threaded, busy: true });
      const input = fill("/archive");
      press(input, "Enter");
      expect(dispatch).not.toHaveBeenCalled();
      expect(alert()).toContain("Wait for this thread to finish, then try again.");
      expect(input.value).toBe("/archive");
      render(threaded);
      expect(alert()).toBeUndefined();
      press(input, "Enter");
      expect(actions().map((action) => action.type)).toEqual(["switchTask", "updateTask"]);
    });
  });

  it("offers only skills after a space later in the message, and puts the pick in place", () => {
    const input = fill("write it up with /");
    expect(labels()).toEqual(["/fork-release", "/standup"]);
    flushSync(() => options()[1]!.click());
    expect(input.value).toBe("write it up with /standup ");
  });

  it("adds no second space when text already follows the pick", () => {
    const input = fill("use /st later", "use /st".length);
    flushSync(() => options()[0]!.click());
    expect(input.value).toBe("use /standup later");
  });

  it("opens nothing inside a path or link", () => {
    fill("open notes/st");
    expect(options()).toEqual([]);
    fill("see https://x.test/");
    expect(options()).toEqual([]);
  });
});
