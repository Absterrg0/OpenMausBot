// What the person hears when an engine reaches its usage limit: once per bot for each stretch the engine is limited,
// never once per refused turn. A stretch ends when its reset time passes, or when the engine works again. When the
// engine named no reset, the stretch lasts UNNAMED_STRETCH_MS after its last refusal: longer than the hour the engine is
// then held, so the try after that hour, refused again, is the same stretch.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import { resetClock } from "./limit-failover.ts";
import { UNNAMED_LIMIT_MS } from "./limit-resets.ts";

type Told = Record<string, number>;

/** How long a limit that named no reset counts as one stretch after its last refusal. */
export const UNNAMED_STRETCH_MS = 3 * UNNAMED_LIMIT_MS;

export interface LimitNoticeFacts {
  /** The limited engine's name, as the person knows it: "Codex". */
  engine: string;
  bot: string;
  /** When the limit resets, when the engine said. */
  resetsAt?: number;
  /** The AI that carries on meanwhile, or none. */
  backup?: string;
  /** Claude's extra usage credits ran out: only that model is limited. */
  credits?: boolean;
}

/** "Codex reached its limit until 14:00, so Kai is using Claude meanwhile." */
export function limitNoticeText(facts: LimitNoticeFacts, timeZone?: string): string {
  const until = facts.resetsAt ? ` until ${resetClock(facts.resetsAt, timeZone)}` : "";
  const what = facts.credits ? `${facts.engine}'s extra usage credits are used up` : `${facts.engine} reached its limit${until}`;
  if (facts.backup) return `${what}, so ${facts.bot} is using ${facts.backup} meanwhile.`;
  return facts.resetsAt && !facts.credits
    ? `${what}, so ${facts.bot} waits until then: no other AI you have set up can take over.`
    : `${what}, so ${facts.bot} waits: no other AI you have set up can take over.`;
}

export class LimitNotices {
  private readonly file: string;
  private readonly now: () => number;
  private told: Told;

  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      this.told = raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, number] => Number.isFinite(entry[1])))
        : {};
    } catch {
      this.told = {};
    }
  }

  /** True the first time in this stretch of `engine`'s limit for `botId`; the stretch then lasts until `resetsAt`. */
  first(botId: string, engine: string, resetsAt?: number): boolean {
    const key = `${botId}\u0000${engine}`, now = this.now();
    const until = resetsAt && resetsAt > now ? resetsAt : now + UNNAMED_STRETCH_MS;
    const known = this.told[key];
    this.told = Object.fromEntries(Object.entries(this.told).filter(([, end]) => end > now));
    this.told[key] = Math.max(known && known > now ? known : 0, until);
    this.save();
    return !(known && known > now);
  }

  /** The engine works again for this bot: its next limit is a new stretch. */
  ended(botId: string, engine: string): void {
    const key = `${botId}\u0000${engine}`;
    if (!(key in this.told)) return;
    delete this.told[key];
    this.save();
  }

  private save(): void {
    try { writeFileAtomic(this.file, JSON.stringify(this.told), { mode: 0o600 }); } catch {}
  }
}
