/**
 * ElevenLabs text-to-speech for the news presenter's cloned voice.
 *
 * Returns WAV, not MP3, on purpose: Higgsfield's Speak endpoint accepts WAV
 * only. We ask ElevenLabs for raw PCM and add the container ourselves rather
 * than shelling out to ffmpeg — the worker image has no ffmpeg, and a WAV
 * header over signed 16-bit LE PCM is 44 deterministic bytes.
 */
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: "elevenlabs" });

const API_BASE = "https://api.elevenlabs.io/v1";
// ElevenLabs PCM output is always signed 16-bit little-endian, single channel.
const PCM_SAMPLE_RATE = 24_000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_CHANNELS = 1;
const BYTES_PER_SAMPLE = (PCM_BITS_PER_SAMPLE / 8) * PCM_CHANNELS;
const WAV_HEADER_BYTES = 44;

export interface SpeechResult {
  /** WAV bytes, ready to store and hand to Higgsfield Speak. */
  wav: Buffer;
  /** Exact duration, derived from the PCM length (no probing needed). */
  seconds: number;
}

/** Wrap raw PCM in a minimal RIFF/WAVE container. */
function toWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const byteRate = PCM_SAMPLE_RATE * BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4); // file size minus the first 8 bytes
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Synthesize `text` in the configured cloned voice.
 *
 * @param text  What the presenter says, in the post language (Uzbek by default).
 * @param voiceId  Overrides ELEVENLABS_VOICE_ID for one-off tests.
 */
export async function synthesizeSpeech(text: string, voiceId?: string): Promise<SpeechResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("nothing to synthesize: the narration text is empty");

  const key = env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. The presenter's voice is a private clone in your " +
        "ElevenLabs account, so only your key can reach it.",
    );
  }
  const voice = voiceId || env.ELEVENLABS_VOICE_ID;
  if (!voice) throw new Error("ELEVENLABS_VOICE_ID is not set (the cloned presenter voice).");

  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_${PCM_SAMPLE_RATE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: trimmed, model_id: env.ELEVENLABS_MODEL_ID }),
  });

  if (!res.ok) {
    // ElevenLabs puts the useful part (quota, unknown voice, bad model) in the body.
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  const pcm = Buffer.from(await res.arrayBuffer());
  if (pcm.length === 0) throw new Error("ElevenLabs returned an empty audio stream");

  const seconds = pcm.length / (PCM_SAMPLE_RATE * BYTES_PER_SAMPLE);
  log.info({ voice, model: env.ELEVENLABS_MODEL_ID, seconds: seconds.toFixed(1) }, "speech synthesized");
  return { wav: toWav(pcm), seconds };
}
