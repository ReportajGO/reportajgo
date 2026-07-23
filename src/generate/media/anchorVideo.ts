/**
 * News-presenter video: her photo + her cloned voice → a lip-synced clip.
 *
 * Reproduces, as code, the shot that was built by hand in the Higgsfield app
 * on 2026-07-17: a locked-off chest-up 9:16 bulletin where the only motion is
 * her delivery. That one used Seedance with an uploaded audio track; the REST
 * API exposes the same idea as Speak (/v1/speak/higgsfield), which takes the
 * image and the audio directly and is the only endpoint here that lip-syncs.
 *
 * Two hard constraints come from that endpoint, not from us:
 *   • the audio must be WAV (elevenlabs.ts returns WAV for exactly this reason)
 *   • the clip is 5, 10, or 15 seconds — there is no arbitrary duration
 */
import { HiggsfieldClient, InputImage, InputAudio, SpeakVideoQuality, SpeakDuration } from "@higgsfield/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { MediaResult } from "../../domain/types.js";
import { synthesizeSpeech } from "./elevenlabs.js";
import { saveAudio } from "./mediaStore.js";

const log = logger.child({ module: "anchor-video" });

/** Speak's fixed clip lengths, shortest first. */
const SPEAK_DURATIONS = [SpeakDuration.SHORT, SpeakDuration.MEDIUM, SpeakDuration.LONG] as const;
const MAX_SPEAK_SECONDS = SpeakDuration.LONG;

/**
 * The delivery direction. Deliberately describes only performance and framing:
 * the face comes from the photo and the words come from the audio, so anything
 * this prompt invents about her appearance fights those two inputs.
 */
export const ANCHOR_PROMPT =
  "The news anchor speaks directly to the camera, delivering a news bulletin with natural " +
  "lip movement precisely synchronized to the spoken audio. Subtle natural head movements, " +
  "blinking, and a warm professional expression. Static locked-off camera, chest-up framing. " +
  "The studio background stays steady. No text, no captions, no on-screen graphics.";

export interface AnchorVideoInput {
  /** What she says, in the post language. */
  script: string;
  /** Public URL of her reference photo. */
  imageUrl: string;
  /** Overrides ELEVENLABS_VOICE_ID for one-off tests. */
  voiceId?: string;
  /** Overrides the delivery direction. */
  prompt?: string;
  highQuality?: boolean;
}

export interface AnchorVideoResult extends MediaResult {
  /** Stored narration, kept so a failed video can be retried without paying for TTS twice. */
  audioUrl: string;
  scriptSeconds: number;
}

/**
 * Higgsfield fetches both inputs over the network, so a localhost URL — the
 * default under MEDIA_STORAGE_DRIVER=local — silently produces an unusable job.
 * Fail before spending credits instead.
 */
function assertPubliclyFetchable(url: string, label: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`${label} is not a valid URL: ${url}`);
  }
  const isLocal =
    host === "localhost" || host === "::1" || /^127\./.test(host) || /^(10|192\.168)\./.test(host);
  if (isLocal) {
    throw new Error(
      `${label} points at ${host}, which Higgsfield cannot reach (${url}). Set PUBLIC_BASE_URL ` +
        "to your public domain, or switch MEDIA_STORAGE_DRIVER=s3, so the presenter's photo and " +
        "voice are fetchable from the internet.",
    );
  }
}

/** Smallest fixed clip length that fits the narration. */
function durationFor(seconds: number): (typeof SPEAK_DURATIONS)[number] {
  const fit = SPEAK_DURATIONS.find((d) => seconds <= d);
  if (!fit) {
    throw new Error(
      `narration is ${seconds.toFixed(1)}s but Speak caps a clip at ${MAX_SPEAK_SECONDS}s. ` +
        "Shorten the script (roughly 35-40 words fits 15s) or split it across several clips.",
    );
  }
  return fit;
}

function makeClient(): HiggsfieldClient {
  const creds = env.HIGGSFIELD_CREDENTIALS;
  if (!creds || !creds.includes(":")) {
    throw new Error(
      'HIGGSFIELD_CREDENTIALS missing or malformed. Expected "KEY_ID:KEY_SECRET" from cloud.higgsfield.ai.',
    );
  }
  const [apiKey, apiSecret] = creds.split(":");
  return new HiggsfieldClient({ apiKey, apiSecret });
}

/**
 * Narrate `script` in the cloned voice, then animate `imageUrl` to it.
 * Throws on setup problems (missing keys, unreachable URLs, over-long script)
 * and returns a FAILED MediaResult when the generation itself fails.
 */
export async function renderAnchorVideo(input: AnchorVideoInput): Promise<AnchorVideoResult> {
  assertPubliclyFetchable(input.imageUrl, "The presenter photo");

  const speech = await synthesizeSpeech(input.script, input.voiceId);
  const duration = durationFor(speech.seconds);

  const stored = await saveAudio(speech.wav);
  assertPubliclyFetchable(stored.url, "The generated narration");

  const base = {
    audioUrl: stored.url,
    scriptSeconds: speech.seconds,
    provider: "higgsfield-speak",
    type: "VIDEO" as const,
    aspectRatio: "9:16" as const,
  };

  try {
    log.info({ duration, seconds: speech.seconds.toFixed(1) }, "generating presenter video");
    const jobSet = await makeClient().generate(
      "/v1/speak/higgsfield",
      {
        input_image: InputImage.fromUrl(input.imageUrl),
        input_audio: InputAudio.fromUrl(stored.url),
        prompt: input.prompt ?? ANCHOR_PROMPT,
        quality: input.highQuality ? SpeakVideoQuality.HIGH : SpeakVideoQuality.MID,
        duration,
      },
      { withPolling: true },
    );

    const url = jobSet.jobs[0]?.results?.raw.url;
    if (!jobSet.isCompleted || !url) {
      return {
        ...base,
        externalJobId: jobSet.id,
        status: "FAILED",
        error: jobSet.isCompleted ? "completed but no result url" : "generation not completed",
      };
    }
    log.info({ url, jobSetId: jobSet.id }, "presenter video ready");
    return { ...base, url, externalJobId: jobSet.id, status: "READY" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "presenter video failed");
    return { ...base, status: "FAILED", error: message };
  }
}
