/**
 * Cut a long narration into presenter-clip-sized pieces.
 *
 * MiniMax H3 renders 4-15 seconds, so a 100-second script has to become a
 * sequence of clips. Cutting on a clock would chop words in half, so the cuts
 * land in the middle of the pauses ffmpeg's silencedetect finds, and each piece
 * is padded with silence to a whole number of seconds — the generator spreads
 * whatever audio it gets across the full requested duration, so a piece shorter
 * than its `duration` comes back stretched and the mouth drifts behind the voice.
 *
 *   node scripts/split-narration.mjs media/narration-reportajgo-uz-FULL.wav
 *
 * Writes media/segments/seg-NN.wav plus segments.json (the render plan).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX = 14.0; // hard ceiling per clip, one second under the model's 15
const MIN = 4.0; // the model's floor

const input = resolve(process.cwd(), process.argv[2] ?? "media/narration-reportajgo-uz-FULL.wav");
const outDir = resolve(process.cwd(), "media/segments");
mkdirSync(outDir, { recursive: true });

const ffprobe = (args) => execFileSync("ffprobe", args, { encoding: "utf8" }).trim();
const total = Number(
  ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]),
);

// silencedetect reports on stderr and the run exits 0, so execFileSync's return
// value (stdout) is empty — spawnSync is the one that hands back both streams.
const probe = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-nostats", "-i", input, "-af", "silencedetect=n=-38dB:d=0.20", "-f", "null", "-"],
  { encoding: "utf8" },
);
const log = probe.stderr ?? "";
if (!log.includes("silence_start")) throw new Error("silencedetect found no pauses to cut on");

/** Candidate cut points: the middle of every detected pause. */
const cuts = [];
const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
  const mid = (starts[i] + ends[i]) / 2;
  if (mid > MIN && mid < total - 1) cuts.push(mid);
}
cuts.sort((a, b) => a - b);

/** Walk forward taking the latest pause that still fits inside MAX. */
const bounds = [0];
while (total - bounds[bounds.length - 1] > MAX) {
  const from = bounds[bounds.length - 1];
  const fit = cuts.filter((c) => c > from + MIN && c <= from + MAX);
  if (!fit.length) throw new Error(`no pause to cut on between ${from.toFixed(2)}s and ${(from + MAX).toFixed(2)}s`);
  bounds.push(fit[fit.length - 1]);
}
bounds.push(total);

const plan = [];
for (let i = 0; i < bounds.length - 1; i++) {
  const start = bounds[i];
  const speech = bounds[i + 1] - start;
  const duration = Math.max(MIN, Math.ceil(speech)); // whole seconds for the generator
  const name = `seg-${String(i + 1).padStart(2, "0")}.wav`;
  const out = resolve(outDir, name);
  // apad + atrim: cut the piece, then top it up with digital silence so the file
  // is exactly `duration` long.
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(start), "-t", String(speech), "-i", input,
    "-af", `apad,atrim=0:${duration},asetpts=N/SR/TB`,
    "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", out,
  ]);
  plan.push({ index: i + 1, file: `media/segments/${name}`, start: +start.toFixed(3), speech: +speech.toFixed(3), duration });
  console.log(`${name}  ${start.toFixed(2)}s → ${(start + speech).toFixed(2)}s  (${speech.toFixed(2)}s speech, padded to ${duration}s)`);
}

writeFileSync(resolve(outDir, "segments.json"), JSON.stringify({ source: process.argv[2], total, plan }, null, 2));
console.log(`\n${plan.length} clips · ${plan.reduce((s, p) => s + p.duration, 0)}s of video for ${total.toFixed(2)}s of speech`);
