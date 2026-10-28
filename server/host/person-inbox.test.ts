import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import { key, MARCO, PHILIPP, session, teamInbox } from "../testing/team-inbox-fixture.ts";
import { PERSON_INBOX_FILE } from "./person-inbox.ts";

const fixtures: Array<ReturnType<typeof teamInbox>> = [];
const fixture = (options: Parameters<typeof teamInbox>[0] = {}) => { const made = teamInbox(options); fixtures.push(made); return made; };
afterEach(() => { for (const made of fixtures.splice(0)) made.close(); });

const ask = (botId: string, botName: string, threadId: string, kind: Notification["kind"] = "approval"): Notification =>
  ({ kind, botId, botName, threadId, title: `${botName} needs approval`, body: "Run: rm -rf ./build" });
const card = (requestId: string) => ({ title: "Run a command?", subtitle: "rm -rf ./build", options: ["Allow", "Deny"], requestId, tool: "Bash", requestType: "permission" as const });

describe("asks routed to a person", () => {
  it("copies an approval Marco owns into his inbox, sends the one notification from there, and answers the copy where it was asked", () => {
    const f = fixture();
    f.bots.find((bot) => bot.id === "reporter")!.tasks.push({ threadId: "rep-shared", title: "Weekly numbers" });
    const asked = f.store.appendMessage("rep-shared", { role: "bot", kind: "options", text: "Run a command?", card: card("req-1") });
    const sent = f.team.route(ask("reporter", "Reporter", "rep-shared"));
    const inbox = f.inboxOf(MARCO);
    expect(sent).toEqual({ kind: "approval", botId: "marcos-chief", botName: "Marco's Chief", threadId: inbox.threadId, title: "Reporter needs approval", body: "Run: rm -rf ./build", forPerson: key(MARCO.email) });
    const copy = f.lines(inbox.threadId)[0]!;
    expect(copy).toMatchObject({ kind: "options", card: card("req-1"), inbox: { kind: "ask", from: { name: "Reporter", botId: "reporter" }, origin: { threadId: "rep-shared", title: "Weekly numbers" } } });
    expect(f.team.inbox.answeredIn(inbox.threadId, "req-1")).toBe("rep-shared");
    expect(f.team.inbox.answeredIn(inbox.threadId, "req-other")).toBe(inbox.threadId);
    expect(f.team.route(ask("reporter", "Reporter", "rep-shared")), "the same card again is the same line").toMatchObject({ threadId: inbox.threadId });
    expect(f.lines(inbox.threadId)).toHaveLength(1);
    f.store.patchMessage("rep-shared", asked.id, { card: { ...card("req-1"), answered: "allow" } });
    expect(f.lines(inbox.threadId)[0]!.card).toMatchObject({ answered: "allow" });
    expect(f.notified).toEqual([]);
  });

  it("leaves an ask in the person's own chat where they are, an Admins' ask and anything not an ask as they are", () => {
    const f = fixture();
    const own = ask("scout", "Scout", "marco-private");
    expect(f.team.route(own)).toBe(own);
    const mainChief = { id: "nobodys", name: "Nobody's", color: "silver" as const, threadId: "n-main", tasks: [{ threadId: "n-main", title: "Nobody's" }] };
    f.bots.push(mainChief);
    const admins = ask("nobodys", "Nobody's", "n-main");
    expect(f.team.route(admins)).toBe(admins);
    const done: Notification = { kind: "done", botId: "scout", botName: "Scout", threadId: "scout-main", title: "Scout finished", body: "Done." };
    expect(f.team.route(done)).toBe(done);
    expect(f.team.inbox.home(key(MARCO.email))).not.toBeNull();
    expect(f.lines(f.inboxOf(MARCO).threadId)).toEqual([]);
  });

  it("brings a routine's report and its failures, even from the person's own chat, and labels where they came from", () => {
    const f = fixture();
    const report: Notification = { kind: "done", botId: "scout", botName: "Scout", threadId: "marco-private", title: "Scout finished", body: "Daily digest: 3 new leads." };
    const sent = f.team.route(report, { routine: true });
    const inbox = f.inboxOf(MARCO);
    expect(sent).toMatchObject({ kind: "done", threadId: inbox.threadId, forPerson: key(MARCO.email), title: "Scout finished" });
    expect(f.lines(inbox.threadId)[0]).toMatchObject({ text: "Daily digest: 3 new leads.", inbox: { kind: "result", origin: { threadId: "marco-private", title: "Marco and Scout" } } });
    f.team.route({ kind: "routine-failed", botId: "reporter", botName: "Reporter", threadId: "rep-main", title: "Reporter's routine failed", body: "Timed out" });
    expect(f.lines(inbox.threadId)[1]).toMatchObject({ inbox: { kind: "notice", from: { name: "Reporter" } } });
  });

  it("brings work handed on from Marco's chat that waits on him, though it runs in a chat of his own", () => {
    const f = fixture({ handed: { "marco-private": "mc-main" } });
    const sent = f.team.route(ask("scout", "Scout", "marco-private", "question"));
    const inbox = f.inboxOf(MARCO);
    expect(sent).toMatchObject({ kind: "question", threadId: inbox.threadId, forPerson: key(MARCO.email) });
    expect(f.lines(inbox.threadId)[0]).toMatchObject({ inbox: { kind: "ask", from: { name: "Scout" }, origin: { threadId: "marco-private" } } });
  });

  it("does nothing off a team", () => {
    const f = fixture({ team: false });
    const one = ask("reporter", "Reporter", "rep-main");
    expect(f.team.route(one)).toBe(one);
  });
});

describe("what still waits on the person", () => {
  const question = (requestId: string) => ({ title: "Your bot has a question", subtitle: "Which landing page?", options: ["Home", "Pricing"], requestId, requestType: "question" as const });
  const asked = (f: ReturnType<typeof fixture>, threadId: string, requestId: string, made: ReturnType<typeof card | typeof question> = card(requestId)) => {
    if (!f.bots.find((bot) => bot.id === "reporter")!.tasks.some((task) => task.threadId === threadId)) f.bots.find((bot) => bot.id === "reporter")!.tasks.push({ threadId, title: threadId });
    const line = f.store.appendMessage(threadId, { role: "bot", kind: "options", text: made.title, card: made });
    f.team.route(ask("reporter", "Reporter", threadId, made.requestType === "question" ? "question" : "approval"));
    return line;
  };

  it("counts an ask only while the card that asked is open where it was asked, whoever closes it there", () => {
    const f = fixture();
    const counted: number[] = [];
    const patchTask = f.store.patchTask;
    f.store.patchTask = (botId, threadId, patch) => { if (patch.unread) counted.push(f.team.inbox.openAsks(threadId)); return patchTask(botId, threadId, patch); };
    const approval = asked(f, "rep-shared", "req-1");
    const choice = asked(f, "rep-weekly", "req-2", question("req-2"));
    const inbox = f.inboxOf(MARCO).threadId;
    expect(counted, "the inbox goes out to Marco with each new ask already counted").toEqual([1, 2]);
    expect(f.team.inbox.openAsks(inbox)).toBe(2);
    expect(f.team.inbox.wire(inbox)).toEqual({ inbox: true, openAsks: 2 });
    f.store.patchMessage("rep-shared", approval.id, { card: { ...card("req-1"), answered: "allow" } });
    expect(f.team.inbox.openAsks(inbox), "approved where it was asked").toBe(1);
    expect(f.changed).toEqual([inbox]);
    f.store.patchMessage("rep-weekly", choice.id, { card: { ...question("req-2"), dismissed: true } });
    expect(f.team.inbox.openAsks(inbox), "closed without an answer").toBe(0);
    expect(f.team.inbox.wire(inbox)).toEqual({ inbox: true });
    expect(f.lines(inbox).map((row) => row.card)).toEqual([expect.objectContaining({ answered: "allow" }), expect.objectContaining({ dismissed: true })]);
    expect(f.team.inbox.wire("rep-shared"), "only the inbox says it is one").toEqual({});
  });

  it("never counts what is only news: a message, a routine's report or a failure", () => {
    const f = fixture();
    f.team.pass("scout", "philipp-private", "Marco", "Can you review the deck?");
    f.team.route({ kind: "done", botId: "scout", botName: "Scout", threadId: "marco-private", title: "Scout finished", body: "Daily digest: 3 new leads." }, { routine: true });
    f.team.route({ kind: "routine-failed", botId: "reporter", botName: "Reporter", threadId: "rep-main", title: "Reporter's routine failed", body: "Timed out" });
    const inbox = f.inboxOf(MARCO).threadId;
    expect(f.lines(inbox)).toHaveLength(3);
    expect(f.team.inbox.openAsks(inbox)).toBe(0);
  });

  it("keeps what is still open after a restart, and nothing that was settled", () => {
    const f = fixture();
    const settled = asked(f, "rep-shared", "req-1");
    asked(f, "rep-weekly", "req-2");
    f.store.patchMessage("rep-shared", settled.id, { card: { ...card("req-1"), answered: "deny", dismissed: true } });
    f.restart();
    const inbox = f.inboxOf(MARCO).threadId;
    expect(f.team.inbox.openAsks(inbox)).toBe(1);
    f.store.patchMessage("rep-weekly", f.lines("rep-weekly")[0]!.id, { card: { ...card("req-2"), answered: "allow" } });
    expect(f.team.inbox.openAsks(inbox), "the copy still follows the card after the restart").toBe(0);
    expect(f.lines(inbox)[1]!.card).toMatchObject({ answered: "allow" });
  });

  it("closes the copy of an ask whose conversation is gone, so nothing in the inbox waits on a card no one can answer", () => {
    const f = fixture();
    asked(f, "rep-shared", "req-1");
    const inbox = f.inboxOf(MARCO).threadId;
    f.deleteThread("rep-shared");
    expect(f.lines(inbox)[0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(f.team.inbox.openAsks(inbox)).toBe(0);
    expect(f.changed).toEqual([inbox]);
  });

  it("lets a message answered where it came from leave Needs you and what the Chief is told waits, through a restart", () => {
    const f = fixture();
    const reply = f.store.appendMessage("scout-main", { role: "bot", kind: "text", text: "@Marco can you confirm the Q4 numbers?", turnId: "t1" });
    f.store.patchMessage("scout-main", reply.id, { turnSucceeded: true });
    const inbox = f.inboxOf(MARCO).threadId;
    expect(f.team.needsYou(session(MARCO.email))).toEqual([expect.objectContaining({ kind: "message", from: "Scout", threadId: inbox })]);
    expect(f.team.prompt("marcos-chief", inbox, true)).toContain('Waiting on "Marco"\'s answer');
    f.said("scout-main", "Philipp here, I'll leave it to Marco.", PHILIPP);
    expect(f.team.needsYou(session(MARCO.email)), "someone else's line answers nothing for Marco").toHaveLength(1);
    f.said("scout-main", "Confirmed, the numbers are right.", MARCO);
    expect(f.team.needsYou(session(MARCO.email))).toEqual([]);
    expect(f.team.inbox.waiting(inbox)).toEqual([]);
    expect(f.team.prompt("marcos-chief", inbox, true)).not.toContain("Waiting on");
    f.restart();
    expect(f.team.needsYou(session(MARCO.email))).toEqual([]);
    expect(f.team.inbox.waiting(inbox)).toEqual([]);
  });
});

describe("the inbox itself", () => {
  it("becomes the chat the person's brief was in, and moves when they crown another Chief", () => {
    const f = fixture();
    const chief = f.bots.find((bot) => bot.id === "marcos-chief")!;
    chief.tasks.push({ threadId: "brief-chat", title: "Brief" });
    f.starters.set("brief-chat", key(MARCO.email));
    expect(f.inboxOf(MARCO)).toMatchObject({ threadId: "brief-chat" });
    expect(chief.tasks.find((task) => task.threadId === "brief-chat")!.title).toBe("Inbox");
    expect(f.team.inbox.personOf("brief-chat")).toBe(key(MARCO.email));
    chief.chiefOfStaff = false;
    f.bots.find((bot) => bot.id === "reporter")!.chiefOfStaff = true;
    expect(f.team.inbox.personOf("brief-chat")).toBeNull();
    expect(f.inboxOf(MARCO).bot.id).toBe("reporter");
    expect(JSON.parse(readFileSync(join(f.dataDir, PERSON_INBOX_FILE), "utf8")).homes[key(MARCO.email)].botId).toBe("reporter");
  });

  it("forgets a person who left, and a deleted inbox", () => {
    const f = fixture();
    f.team.pass("scout", "scout-main", "Marco", "Hi");
    f.team.inbox.forget(key(MARCO.email));
    expect(f.team.inbox.unseen(key(MARCO.email))).toEqual([]);
    expect(f.team.inbox.personOf(f.inboxOf(PHILIPP).threadId)).toBe(key(PHILIPP.email));
  });
});
