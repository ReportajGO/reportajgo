/**
 * Standalone ElevenLabs narration for the presenter clip — same voice and
 * WAV-from-PCM trick as src/generate/media/elevenlabs.ts, but with no .env
 * loader, no DB and no 400-char bulletin cap, so a full script can be read.
 *
 *   node scripts/el-tts.mjs <textFile> <outWav> [voiceId]
 *
 * eleven_v3 is the expressive model: square-bracket audio tags ([confident],
 * [excited]) are performance direction, not words, and stability must be
 * exactly 0.0 / 0.5 / 1.0 — 0.5 keeps her recognisable while letting the
 * delivery move.
 *
 * Measured on this voice reading Uzbek: ~16.5 characters per second, tags
 * excluded. So a clip capped at 15 seconds wants roughly 245 characters of
 * script — write to that, then check the real duration before generating,
 * because a sentence break costs a beat the character count does not show.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2; // signed 16-bit LE, mono

function env(name) {
  const line = readFileSync(resolve(process.cwd(), ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is not set in .env`);
  return line.slice(name.length + 1).trim();
}

export function toWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function tts(text, voiceId) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=pcm_${SAMPLE_RATE}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: env("ELEVENLABS_MODEL_ID"),
      voice_settings: { stability: 0.5, similarity_boost: 0.85, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  if (!pcm.length) throw new Error("ElevenLabs returned an empty stream");
  return { wav: toWav(pcm), seconds: pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE) };
}

if (process.argv[1]?.endsWith("el-tts.mjs")) {
  const [, , textFile, outWav, voiceArg] = process.argv;
  if (!textFile || !outWav) {
    console.error("usage: node scripts/el-tts.mjs <textFile> <outWav> [voiceId]");
    process.exit(1);
  }
  const text = readFileSync(resolve(process.cwd(), textFile), "utf8").trim();
  const voice = voiceArg || env("ELEVENLABS_VOICE_ID");
  console.log(`voice ${voice} · ${env("ELEVENLABS_MODEL_ID")} · ${text.length} chars`);
  const { wav, seconds } = await tts(text, voice);
  const out = resolve(process.cwd(), outWav);
  writeFileSync(out, wav);
  console.log(`✅ ${out} — ${seconds.toFixed(2)}s`);
}
