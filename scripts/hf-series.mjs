/**
 * Render a multi-minute presenter read as a series of MiniMax H3 clips.
 *
 * H3 tops out at 15 seconds, so scripts/split-narration.mjs cuts the narration
 * on its own pauses and this drives one generation per piece — same still, same
 * WIDE prompt as media/reportagego-uz-malika-WIDE.mp4, so the clips cut together
 * as one take. Each clip keeps the audio the model was driven with, which is
 * what stays in sync; a clip comes back a few frames longer than requested, so
 * re-laying the original narration over the join would drift.
 *
 *   node scripts/hf-series.mjs cost            # price one clip, spend nothing
 *   node scripts/hf-series.mjs go              # upload + submit all segments
 *   node scripts/hf-series.mjs poll            # download whatever has finished
 *   node scripts/hf-series.mjs stitch          # concat into the final mp4
 *
 * State lives in media/segments/jobs.json so poll can resume after a crash.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { call, reset } from "./hf-mcp.mjs";
import { MINIMAX_PROMPT } from "./hf-anchor.mjs";

const SEG_DIR = resolve(process.cwd(), "media/segments");
const PLAN_FILE = resolve(SEG_DIR, "segments.json");
const JOBS_FILE = resolve(SEG_DIR, "jobs.json");
const IMAGE = resolve(process.cwd(), "media/malika-still.png");
const FINAL = resolve(process.cwd(), "media/reportagego-uz-malika-FULL.mp4");

const plan = () => JSON.parse(readFileSync(PLAN_FILE, "utf8")).plan;
const jobs = () => (existsSync(JOBS_FILE) ? JSON.parse(readFileSync(JOBS_FILE, "utf8")) : {});
const saveJobs = (j) => writeFileSync(JOBS_FILE, JSON.stringify(j, null, 2));
const clipPath = (i) => resolve(SEG_DIR, `clip-${String(i).padStart(2, "0")}.mp4`);

/** media_upload → PUT the bytes → media_confirm. Returns the media id. */
async function upload(path, contentType, type) {
  const filename = basename(path);
  const res = await call("media_upload", { filename, content_type: contentType });
  const up = res.uploads[0];
  const put = await fetch(up.upload_url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: readFileSync(path),
  });
  if (!put.ok) throw new Error(`PUT ${filename} failed: HTTP ${put.status}`);
  await call("media_confirm", { type, media_id: up.media_id });
  return up.media_id;
}

function params(imageId, audioId, duration, extra = {}) {
  return {
    model: "minimax_h3",
    prompt: MINIMAX_PROMPT,
    aspect_ratio: "9:16",
    duration,
    resolution: "2K",
    // Without this the server offers to swap the prompt for its "IN THE DARK"
    // preset and submits nothing.
    declined_preset_id: "24bae836-2c4a-48e0-89b6-49fcc0b21612",
    medias: [
      { role: "image", value: imageId },
      { role: "audio", value: audioId },
    ],
    ...extra,
  };
}

const commands = {
  /** Price a single clip so the whole series can be costed before spending. */
  async cost() {
    const [first] = plan();
    console.log("balance:", JSON.stringify(await call("balance", {})));
    const img = await upload(IMAGE, "image/png", "image");
    const aud = await upload(resolve(process.cwd(), first.file), "audio/wav", "audio");
    const res = await call("generate_video", { params: params(img, aud, first.duration, { get_cost: true }) });
    console.log(`\ncost of clip 1 (${first.duration}s):`, JSON.stringify(res));
    console.log(`series is ${plan().length} clips`);
  },

  async go() {
    const state = jobs();
    console.log("uploading her photo …");
    const img = state.image ?? (await upload(IMAGE, "image/png", "image"));
    state.image = img;
    state.clips ??= {};
    saveJobs(state);

    for (const seg of plan()) {
      if (state.clips[seg.index]?.jobId) {
        console.log(`seg ${seg.index}: already submitted (${state.clips[seg.index].jobId})`);
        continue;
      }
      const aud = await upload(resolve(process.cwd(), seg.file), "audio/wav", "audio");
      const res = await call("generate_video", { params: params(img, aud, seg.duration) });
      const jobId = res?.results?.[0]?.id;
      if (!jobId) throw new Error(`seg ${seg.index}: no job id in ${JSON.stringify(res).slice(0, 300)}`);
      state.clips[seg.index] = { jobId, duration: seg.duration, audio: aud };
      saveJobs(state);
      console.log(`seg ${seg.index} (${seg.duration}s) → ${jobId}`);
    }
    console.log(`\nsubmitted. poll with: node scripts/hf-series.mjs poll`);
  },

  /**
   * Poll every outstanding job until each has a result_url, then download it.
   * Only raw_data.result_url counts — the params echo back the INPUT media urls,
   * so scanning the payload for any .mp4 downloads a source file instead.
   */
  async poll() {
    const state = jobs();
    const pending = () =>
      Object.entries(state.clips ?? {}).filter(([i]) => !existsSync(clipPath(i)));

    let transient = 0;
    for (let round = 1; round <= 120 && pending().length; round++) {
      for (const [i, clip] of pending()) {
        let res;
        try {
          res = await call("job_status", { jobId: clip.jobId, sync: false, raw_data: true });
        } catch (err) {
          if (++transient > 20) throw err;
          console.log(`[${round}] seg ${i}: transient (${String(err.message).slice(0, 40)}…)`);
          reset();
          continue;
        }
        const raw = res?.raw_data ?? res;
        const status = String(raw?.status ?? "unknown").toLowerCase();
        const url = raw?.result_url ?? raw?.h264_url ?? null;

        if (url) {
          const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
          writeFileSync(clipPath(i), buf);
          console.log(`[${round}] seg ${i}: ✅ ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
        } else if (["failed", "canceled", "cancelled", "error", "rejected"].includes(status)) {
          throw new Error(`seg ${i} ${status}: ${JSON.stringify(raw).slice(0, 300)}`);
        } else {
          console.log(`[${round}] seg ${i}: ${status}`);
        }
      }
      if (pending().length) await new Promise((r) => setTimeout(r, 15_000));
    }
    const left = pending();
    if (left.length) throw new Error(`still rendering: segments ${left.map(([i]) => i).join(", ")}`);
    console.log("\nall clips downloaded — stitch with: node scripts/hf-series.mjs stitch");
  },

  /** Concat the clips in order. Re-encoded, not stream-copied: the clips come
   *  back with their own timebases and a copy-concat drifts the audio. */
  async stitch() {
    const files = plan().map((s) => clipPath(s.index));
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length) throw new Error(`missing clips: ${missing.map(basename).join(", ")}`);

    const list = resolve(SEG_DIR, "concat.txt");
    writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    execFileSync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
       "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", FINAL],
      { stdio: "inherit" },
    );
    const probe = spawnSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FINAL], { encoding: "utf8" });
    console.log(`\n✅ ${FINAL} — ${Number(probe.stdout).toFixed(2)}s`);
  },
};

const fn = commands[process.argv[2]];
if (!fn) {
  console.error("usage: node scripts/hf-series.mjs cost|go|poll|stitch");
  process.exit(1);
}
fn()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err?.message ?? err);
    process.exit(1);
  });
