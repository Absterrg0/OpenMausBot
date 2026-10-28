// The secure credential cards request_credential adds: the card on the conversation's visible branch, settling it,
// resuming the turn it paused, and the value a paired phone sealed for this computer. No card, message or log holds the value.
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  CREDENTIAL_TARGETS,
  credentialIsConfigured,
  isCredentialTargetId,
  isPendingCredentialRequest,
  type CredentialTargetId,
} from "../../shared/credential-request.ts";
import type { AppConfig } from "../config.ts";
import {
  PHONE_SECRET_PROTOCOL_VERSION,
  PhoneSecretError,
  assertPhoneSecretRequestMatches,
  phoneSecretOperationId,
  type PhoneSecretBridge,
  type PhoneSecretContext,
  type PhoneSecretSubmissionRegistry,
} from "../phone-secret.ts";
import type { BotLogins } from "../bot-logins.ts";
import type { BotRecord, GroupRecord, Message, Store } from "../store.ts";

export const phoneSecretEnvelopeSchema = z.object({
  version: z.literal(PHONE_SECRET_PROTOCOL_VERSION),
  threadId: z.string().regex(/^[\w-]{1,128}$/),
  keyId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  deviceId: z.string().regex(/^[\w-]{1,128}$/),
  target: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/),
  requestKey: z.string().regex(/^[\w-]{1,128}$/),
  encapsulatedKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{23,5483}$/),
}).strict();

export interface SecretCardsDeps {
  store: Pick<Store, "activePath" | "appendMessage" | "patchMessage">;
  cfg: AppConfig;
  botLogins: Pick<BotLogins, "credentialConfig">;
  phoneSecrets: Pick<PhoneSecretBridge, "provide">;
  phoneSecretSubmissions: PhoneSecretSubmissionRegistry;
  connectorThread(botId: string, threadId: string): { bot: BotRecord; group: GroupRecord | undefined } | null;
  answerCardNode(threadId: string, messageId: string, text: string): boolean;
  credentialUpdateText(label: string, outcome: "provided" | "dismissed"): string;
}

export type SecretCards = ReturnType<typeof createSecretCards>;

export function createSecretCards(deps: SecretCardsDeps) {
  const { store, cfg, botLogins, phoneSecrets, phoneSecretSubmissions, connectorThread, answerCardNode, credentialUpdateText } = deps;

  function phoneSecretSubmissionKey(threadId: string, messageId: string, requestKey: string): string {
    return `${threadId}:${messageId}:${requestKey}`;
  }

  function credentialDesktopHandoff(label: string): string {
    return `Securely provide the ${label} from OpenMausBot on your phone or computer. It is never added to chat.`;
  }

  function secretMessage(botId: string, threadId: string, messageId: string): Message | null {
    const owner = connectorThread(botId, threadId);
    if (!owner) return null;
    // Actionable only on the visible branch; in a channel only the requesting bot may bind the credential into HPKE AAD or resume its turn.
    const message = store.activePath(threadId).find((candidate) => candidate.id === messageId);
    if (owner.group && message?.from?.botId !== botId) return null;
    return message?.kind === "secret" && message.secret ? message : null;
  }

  function currentSecretState(botId: string, threadId: string, messageId: string) {
    const message = secretMessage(botId, threadId, messageId);
    if (!message?.secret) return null;
    return {
      provided: message.secret.provided === true,
      resumed: message.secret.resumed === true,
    };
  }

  function resumeSecretCard(botId: string, threadId: string, messageId: string, outcome: "provided" | "dismissed") {
    const message = secretMessage(botId, threadId, messageId);
    if (!message?.secret) return false;
    if (message.secret.resumed) return true;
    const resumed = answerCardNode(threadId, messageId, credentialUpdateText(message.secret.label, outcome));
    store.patchMessage(threadId, message.id, {
      secret: {
        ...message.secret,
        provided: outcome === "provided" ? true : message.secret.provided,
        dismissed: outcome === "dismissed" ? true : message.secret.dismissed,
        ...(resumed ? { resumed: true, error: undefined } : {}),
      },
    });
    return true;
  }

  async function provideSecretFromPhone(
    context: PhoneSecretContext,
    authenticatedDeviceId: string,
  ): Promise<{ provided: boolean; resumed: boolean }> {
    const owner = connectorThread(context.botId, context.threadId);
    const message = secretMessage(context.botId, context.threadId, context.messageId);
    if (!owner || !message?.secret) throw new PhoneSecretError("No such credential request", 404);
    if (message.secret.dismissed) throw new PhoneSecretError("This credential request was dismissed", 409);
    if (message.secret.superseded) throw new PhoneSecretError("This credential request was superseded by a newer one", 409);
    assertPhoneSecretRequestMatches(context, authenticatedDeviceId, {
      target: message.secret.target,
      requestKey: message.secret.requestKey,
    });
    const operationId = phoneSecretOperationId(context);
    if (message.secret.phoneOperationId && message.secret.phoneOperationId !== operationId) {
      throw new PhoneSecretError(
        "This credential request was already completed by another submission",
        409,
      );
    }
    // Recording the winning operation precedes completing the card, so an exact retry repairs a crash without writing the credential again.
    if (message.secret.phoneOperationId === operationId && !message.secret.provided) {
      if (!credentialIsConfigured(botLogins.credentialConfig(cfg), message.secret.target)) {
        throw new PhoneSecretError(`${message.secret.label} is no longer configured`, 409);
      }
      if (!resumeSecretCard(context.botId, context.threadId, context.messageId, "provided")) {
        throw new PhoneSecretError("This credential request is no longer available", 409);
      }
      const recovered = currentSecretState(context.botId, context.threadId, context.messageId);
      if (!recovered) throw new PhoneSecretError("This credential request is no longer available", 409);
      return recovered;
    }
    if (message.secret.provided) {
      if (message.secret.phoneOperationId !== operationId) {
        throw new PhoneSecretError(
          "This credential request was already completed by another submission",
          409,
        );
      }
      if (!credentialIsConfigured(botLogins.credentialConfig(cfg), message.secret.target)) {
        throw new PhoneSecretError(`${message.secret.label} is no longer configured`, 409);
      }
      if (!message.secret.resumed && !resumeSecretCard(
        context.botId,
        context.threadId,
        context.messageId,
        "provided",
      )) {
        throw new PhoneSecretError("This credential request is no longer available", 409);
      }
      const recovered = currentSecretState(context.botId, context.threadId, context.messageId);
      if (!recovered) throw new PhoneSecretError("This credential request is no longer available", 409);
      return recovered;
    }

    const submissionKey = phoneSecretSubmissionKey(context.threadId, context.messageId, context.requestKey);
    await phoneSecretSubmissions.run({
      cardKey: submissionKey,
      botId: context.botId,
      threadId: context.threadId,
      ...(owner.group ? { groupId: owner.group.id } : {}),
    }, operationId, async () => {
      await phoneSecrets.provide(context);
      const current = secretMessage(context.botId, context.threadId, context.messageId);
      if (!current?.secret || current.secret.requestKey !== context.requestKey) {
        throw new PhoneSecretError("This credential request is no longer available", 409);
      }
      if (current.secret.dismissed) {
        throw new PhoneSecretError("This credential request was dismissed", 409);
      }
      // The card may have been superseded during the save: completing it would leave two cards resolved.
      if (current.secret.superseded) {
        throw new PhoneSecretError("This credential request was superseded by a newer one", 409);
      }
      // Electron acknowledges only after credentials.bin and the config update both commit; keep this assertion so no handler resumes first.
      if (!credentialIsConfigured(botLogins.credentialConfig(cfg), current.secret.target)) {
        throw new PhoneSecretError(`${current.secret.label} was not saved yet`, 409);
      }
      // Persist the winning envelope id before completing the card, so a new sealed value is never reported as the saved one.
      store.patchMessage(context.threadId, current.id, {
        secret: { ...current.secret, phoneOperationId: operationId },
      });
      if (!resumeSecretCard(context.botId, context.threadId, context.messageId, "provided")) {
        throw new PhoneSecretError("This credential request is no longer available", 409);
      }
    });
    const settled = currentSecretState(context.botId, context.threadId, context.messageId);
    if (!settled) throw new PhoneSecretError("This credential request is no longer available", 409);
    return settled;
  }

  /** request_credential's card: the id is the whole authority, and a newer request supersedes the pending ones. */
  function requestCredential(from: BotRecord, fromThreadId: string, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
    const owner = connectorThread(from.id, fromThreadId);
    if (!owner) return { status: 403, body: { error: "source conversation does not belong to sender" } };
    if (!isCredentialTargetId(body.credentialId)) {
      return { status: 400, body: { error: "unsupported credential id" } };
    }
    const credentialId: CredentialTargetId = body.credentialId;
    const target = CREDENTIAL_TARGETS[credentialId];
    if (credentialIsConfigured(botLogins.credentialConfig(cfg), credentialId)) {
      return { status: 200, body: { alreadyConfigured: true, label: target.label } };
    }
    // A later request supersedes pending cards; the fresh card is appended FIRST, so a failed save leaves the prior cards actionable.
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";
    const message = store.appendMessage(fromThreadId, {
      role: "bot",
      kind: "secret",
      text: credentialDesktopHandoff(target.label),
      ...(owner.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
      secret: {
        target: credentialId,
        label: target.label,
        description: `${reason ? `${target.description} ${reason}` : target.description} ${from.name} can use it but never read it back.`,
        placeholder: target.placeholder,
        helpUrl: target.helpUrl,
        requestKey: randomUUID(),
      },
    });
    for (const prior of store.activePath(fromThreadId)) {
      if (prior.id === message.id) continue;
      if (!prior.secret || !isPendingCredentialRequest(prior, credentialId, from.id, Boolean(owner.group))) continue;
      store.patchMessage(fromThreadId, prior.id, { secret: { ...prior.secret, superseded: true } });
    }
    return { status: 201, body: { messageId: message.id, label: target.label } };
  }

  return { phoneSecretSubmissionKey, secretMessage, currentSecretState, resumeSecretCard, provideSecretFromPhone, requestCredential };
}
