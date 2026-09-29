// Boat cloud computers and ElevenLabs voice included with Cloud Pro
// (docs/cloud-pro.md, "Included Boat computers and voice"). The Admin relays
// both on its own accounts, so its provider keys never reach this machine;
// each Cloud home gets its own relay tokens:
//
//   OMB_CLOUD_BOAT_URL  + OMB_CLOUD_BOAT_TOKEN   the Boat relay, ending in /api/box/v1
//   OMB_CLOUD_VOICE_URL + OMB_CLOUD_VOICE_TOKEN  the ElevenLabs relay, ending in /v1
//
// An included token is only a fallback. The person's own key (Settings, or
// BOX_TOKEN / OMB_TTS_KEY) always wins, and removing it falls back again, so
// the credential is resolved on every request, never cached. The relay knows
// only our account, so each credential goes to one place: an own key to the
// provider (OMB_BOX_API / OMB_ELEVENLABS_API when set, for dev and tests), an
// included token to its relay. An included token is never written to
// config.json, never reported to a client, and never the saved key Settings
// verifies, rotates or clears.

export const BOAT_API_DEFAULT = "https://ascii.dev/api/box/v1";
export const ELEVENLABS_API_DEFAULT = "https://api.elevenlabs.io/v1";
/** Also on WORKSPACE_CREDENTIAL_ENV (config.ts). */
export const INCLUDED_TOKEN_ENV = ["OMB_CLOUD_BOAT_TOKEN", "OMB_CLOUD_VOICE_TOKEN"] as const;

export interface ServiceCredential {
  token: string;
  /** The only base URL this token is ever sent to. */
  api: string;
  /** Cloud Pro's included token, not the person's own key. */
  included: boolean;
}

interface Included {
  boat: ServiceCredential | null;
  voice: ServiceCredential | null;
}

function includedService(url: string | undefined, token: string | undefined): ServiceCredential | null {
  const api = url?.trim().replace(/\/+$/, "");
  const secret = token?.trim();
  return api && secret ? { token: secret, api, included: true } : null;
}

const includedFrom = (env: NodeJS.ProcessEnv): Included => ({
  boat: includedService(env.OMB_CLOUD_BOAT_URL, env.OMB_CLOUD_BOAT_TOKEN),
  voice: includedService(env.OMB_CLOUD_VOICE_URL, env.OMB_CLOUD_VOICE_TOKEN),
});

let held: Included | null = null;

/** At server startup: keep the included tokens in memory and drop them from
 * the environment, as with the Cloud bootstrap secret, so nothing the server
 * starts can inherit them. Before this (tests, scripts) they are read from
 * the environment on each call. */
export function holdIncludedServices(env: NodeJS.ProcessEnv = process.env): void {
  held = includedFrom(env);
  for (const name of INCLUDED_TOKEN_ENV) delete env[name];
}

function resolve(own: string | undefined, providerApi: string, included: ServiceCredential | null): ServiceCredential | null {
  if (own) {
    // A leased computer descriptor hands the token in use back as a plain
    // token; the included one still goes only to its relay.
    if (included && own === included.token) return included;
    return { token: own, api: providerApi, included: false };
  }
  return included;
}

export const boatProviderApi = (env: NodeJS.ProcessEnv = process.env): string => env.OMB_BOX_API || BOAT_API_DEFAULT;
export const elevenLabsProviderApi = (env: NodeJS.ProcessEnv = process.env): string =>
  env.OMB_ELEVENLABS_API || ELEVENLABS_API_DEFAULT;

/** The Boat credential in use: the person's own token, else the included one. */
export function boatCredential(own: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return resolve(own, boatProviderApi(env), (held ?? includedFrom(env)).boat);
}

/** The ElevenLabs credential in use: the person's own key, else the included one. */
export function voiceCredential(own: string | undefined, env: NodeJS.ProcessEnv = process.env): ServiceCredential | null {
  return resolve(own, elevenLabsProviderApi(env), (held ?? includedFrom(env)).voice);
}
