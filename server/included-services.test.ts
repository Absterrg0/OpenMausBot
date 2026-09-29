// Which credential a Boat or ElevenLabs request uses, and where it may go.
// The relays know only the Admin's accounts: an own key must never reach
// them, and the included token must never reach the providers.
import { afterEach, describe, expect, it, vi } from "vitest";

import { boatCredential, voiceCredential } from "./included-services.ts";

const RELAY_BOAT = "https://cloud.example.test/api/cloud/services/boat/api/box/v1";
const RELAY_VOICE = "https://cloud.example.test/api/cloud/services/voice/v1";
const cloud = {
  OMB_CLOUD_BOAT_URL: RELAY_BOAT,
  OMB_CLOUD_BOAT_TOKEN: "box_omb_included",
  OMB_CLOUD_VOICE_URL: RELAY_VOICE,
  OMB_CLOUD_VOICE_TOKEN: "omb_voice_included",
};

describe("Boat credential", () => {
  it("falls back to the included token, sent only to the relay, when there is no own key", () => {
    expect(boatCredential(undefined, cloud)).toEqual({ token: "box_omb_included", api: RELAY_BOAT, included: true });
    expect(boatCredential("", cloud)).toEqual({ token: "box_omb_included", api: RELAY_BOAT, included: true });
  });

  it("uses the person's own key, sent only to Boat, whenever there is one", () => {
    expect(boatCredential("box_own", cloud)).toEqual({ token: "box_own", api: "https://ascii.dev/api/box/v1", included: false });
    // OMB_BOX_API keeps pointing own keys at a stub for dev and tests.
    expect(boatCredential("box_own", { ...cloud, OMB_BOX_API: "http://127.0.0.1:9/api/box/v1" }))
      .toEqual({ token: "box_own", api: "http://127.0.0.1:9/api/box/v1", included: false });
  });

  it("sends the included token only to the relay even when it comes back as a plain token", () => {
    // A leased computer descriptor carries the token in use back to boat.ts.
    expect(boatCredential("box_omb_included", { ...cloud, OMB_BOX_API: "http://127.0.0.1:9/api/box/v1" }))
      .toEqual({ token: "box_omb_included", api: RELAY_BOAT, included: true });
  });

  it("is included only when both the relay URL and the token are set", () => {
    expect(boatCredential(undefined, {})).toBeNull();
    expect(boatCredential(undefined, { OMB_CLOUD_BOAT_TOKEN: "box_omb_included" })).toBeNull();
    expect(boatCredential(undefined, { OMB_CLOUD_BOAT_URL: RELAY_BOAT })).toBeNull();
    expect(boatCredential(undefined, { OMB_CLOUD_BOAT_URL: `${RELAY_BOAT}/`, OMB_CLOUD_BOAT_TOKEN: " box_omb_included " }))
      .toEqual({ token: "box_omb_included", api: RELAY_BOAT, included: true });
  });
});

describe("ElevenLabs credential", () => {
  it("falls back to the included token, sent only to the relay, when there is no own key", () => {
    expect(voiceCredential(undefined, cloud)).toEqual({ token: "omb_voice_included", api: RELAY_VOICE, included: true });
    expect(voiceCredential(undefined, { OMB_CLOUD_VOICE_TOKEN: "omb_voice_included" })).toBeNull();
  });

  it("uses the person's own key, sent only to ElevenLabs", () => {
    expect(voiceCredential("sk-own", cloud)).toEqual({ token: "sk-own", api: "https://api.elevenlabs.io/v1", included: false });
    expect(voiceCredential("sk-own", { ...cloud, OMB_ELEVENLABS_API: "http://127.0.0.1:9/v1" }))
      .toEqual({ token: "sk-own", api: "http://127.0.0.1:9/v1", included: false });
  });

  it("never mixes the two services' tokens", () => {
    expect(voiceCredential("box_omb_included", cloud)).toMatchObject({ api: "https://api.elevenlabs.io/v1", included: false });
    expect(boatCredential(undefined, { OMB_CLOUD_VOICE_URL: RELAY_VOICE, OMB_CLOUD_VOICE_TOKEN: "omb_voice_included" })).toBeNull();
  });
});

describe("holdIncludedServices", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps the tokens in memory and removes them from the environment, so nothing started later inherits them", async () => {
    for (const [name, value] of Object.entries(cloud)) vi.stubEnv(name, value);
    // A fresh module: the hold is process-wide state.
    vi.resetModules();
    const services = await import("./included-services.ts");
    services.holdIncludedServices();
    expect(process.env.OMB_CLOUD_BOAT_TOKEN).toBeUndefined();
    expect(process.env.OMB_CLOUD_VOICE_TOKEN).toBeUndefined();
    // The URLs are not secrets and stay.
    expect(process.env.OMB_CLOUD_BOAT_URL).toBe(RELAY_BOAT);
    expect(services.boatCredential(undefined)).toEqual({ token: "box_omb_included", api: RELAY_BOAT, included: true });
    expect(services.voiceCredential(undefined)).toEqual({ token: "omb_voice_included", api: RELAY_VOICE, included: true });
    // The person's own key still wins, and still goes only to the provider.
    expect(services.boatCredential("box_own")).toMatchObject({ token: "box_own", included: false });
    expect(services.voiceCredential("sk-own")).toMatchObject({ token: "sk-own", included: false });
  });
});
