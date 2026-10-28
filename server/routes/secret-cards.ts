// POST /api/bots/<bot>/secret-cards/<message>/provide with a phone's sealed envelope, and .../(provided|resume|dismiss)
// with {threadId} from the app; and the agents tool's /api/internal/request-credential.
import { credentialIsConfigured, credentialResumeOutcome, isCredentialTargetId } from "../../shared/credential-request.ts";
import type { BotLogins } from "../bot-logins.ts";
import type { AppConfig } from "../config.ts";
import { phoneSecretEnvelopeSchema, type SecretCards } from "../host/secret-cards.ts";
import type { PhoneSecretSubmissionRegistry } from "../phone-secret.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface SecretCardRouteDeps {
  cards: SecretCards;
  cfg: AppConfig;
  botLogins: Pick<BotLogins, "credentialConfig">;
  phoneSecretSubmissions: Pick<PhoneSecretSubmissionRegistry, "has">;
}

export function createSecretCardRoutes(deps: SecretCardRouteDeps): RouteHandler {
  const { cfg, botLogins, phoneSecretSubmissions } = deps;
  const { secretMessage, currentSecretState, resumeSecretCard, provideSecretFromPhone, phoneSecretSubmissionKey } = deps.cards;
  return async ({ req, res, path, method, json, readBody }) => {
    let m: RegExpMatchArray | null;
    // An HPKE envelope bound to the paired device, bot, task, card and target; only the embedded Electron server holds the key to open it.
    m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/provide$/);
    if (m && method === "POST") {
      if (req.headers["x-openmausbot-companion"] !== "1") {
        return json(res, 403, { error: "Secure phone entry must come from a paired phone" });
      }
      const rawDeviceId = req.headers["x-openmausbot-companion-device"];
      const authenticatedDeviceId = Array.isArray(rawDeviceId) ? "" : String(rawDeviceId ?? "");
      if (!/^[\w-]{1,128}$/.test(authenticatedDeviceId)) {
        return json(res, 401, { error: "This paired phone could not be verified" });
      }
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const parsed = phoneSecretEnvelopeSchema.safeParse(await readBody(req, 16_384));
      if (!parsed.success || !isCredentialTargetId(parsed.data?.target)) {
        return json(res, 400, { error: "The encrypted credential request is invalid" });
      }
      const state = await provideSecretFromPhone({
        ...parsed.data,
        botId: m[1],
        messageId: m[2],
        target: parsed.data.target,
      }, authenticatedDeviceId);
      return json(res, 200, state);
    }

    // Desktop credential cards never send the credential through this route: Electron saves it to the OS-backed store first.
    m = path.match(/^\/api\/bots\/([\w-]+)\/secret-cards\/([\w-]+)\/(provided|resume|dismiss)$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const threadId = String(body.threadId ?? "");
      const message = secretMessage(m[1], threadId, m[2]);
      if (!message?.secret) return json(res, 404, { error: "no such credential request" });
      if (phoneSecretSubmissions.has(
        phoneSecretSubmissionKey(threadId, message.id, message.secret.requestKey),
      )) {
        return json(res, 409, { error: "this credential is currently being saved from a phone" });
      }
      if (m[3] === "provided") {
        if (message.secret.dismissed) return json(res, 409, { error: "this credential request was dismissed" });
        if (message.secret.superseded) return json(res, 409, { error: "this credential request was superseded by a newer one" });
        if (!credentialIsConfigured(botLogins.credentialConfig(cfg), message.secret.target)) {
          return json(res, 409, { error: `${message.secret.label} was not saved yet` });
        }
        if (!resumeSecretCard(m[1], threadId, message.id, "provided")) {
          return json(res, 409, { error: "this credential request is no longer available" });
        }
        const state = currentSecretState(m[1], threadId, message.id);
        if (!state) return json(res, 409, { error: "this credential request is no longer available" });
        return json(res, 200, state);
      }
      if (m[3] === "resume") {
        if (message.secret.superseded) return json(res, 409, { error: "this credential request was superseded by a newer one" });
        const outcome = credentialResumeOutcome(message.secret);
        if (!outcome) {
          return json(res, 409, { error: "this credential request is not ready to resume" });
        }
        if (outcome === "provided" && !credentialIsConfigured(botLogins.credentialConfig(cfg), message.secret.target)) {
          return json(res, 409, { error: `${message.secret.label} is no longer configured` });
        }
        if (!resumeSecretCard(m[1], threadId, message.id, outcome)) {
          return json(res, 409, { error: "this credential request is no longer available" });
        }
        const state = currentSecretState(m[1], threadId, message.id);
        if (!state) return json(res, 409, { error: "this credential request is no longer available" });
        return json(res, 200, { resumed: state.resumed });
      }
      if (message.secret.superseded) return json(res, 409, { error: "this credential request was superseded by a newer one" });
      if (!message.secret.provided && !resumeSecretCard(m[1], threadId, message.id, "dismissed")) {
        return json(res, 409, { error: "this credential request is no longer available" });
      }
      const state = currentSecretState(m[1], threadId, message.id);
      if (!state) return json(res, 409, { error: "this credential request is no longer available" });
      return json(res, 200, { dismissed: true, resumed: state.resumed });
    }
    return PASS;
  };
}

/** Only dispatch inside the internal capability gate, with its guarded body reader. The global route table must never
 * register this endpoint. */
export function createInternalCredentialRequestRoutes(deps: {
  readBody(): ReturnType<RouteContext["readBody"]>;
  request(body: Record<string, unknown>): { status: number; body: Record<string, unknown> };
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || path !== "/api/internal/request-credential") return PASS;
    const result = deps.request(await deps.readBody());
    return json(res, result.status, result.body);
  };
}
