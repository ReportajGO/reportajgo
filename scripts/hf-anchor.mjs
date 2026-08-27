/**
 * Build the presenter clip end-to-end on the Higgsfield account held in
 * .secrets/higgsfield-oauth.json: upload her photo + the ElevenLabs narration,
 * lip-sync them with Seedance 2.0, poll, and download the mp4.
 *
 *   node scripts/hf-anchor.mjs upload      # upload + confirm, prints media ids
 *   node scripts/hf-anchor.mjs cost   <img> <audio>
 *   node scripts/hf-anchor.mjs go     <img> <audio>
 *   node scripts/hf-anchor.mjs poll   <jobSetId>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { call, reset } from "./hf-mcp.mjs";

const IMAGE = resolve(process.cwd(), "media/malika-still.png");
// Padded to EXACTLY the requested duration. Seedance spreads whatever audio it
// is given across the whole clip, so a track shorter than `duration` comes back
// stretched — the mouth drifts further behind the voice the longer it runs.
// The reference clip that lip-synced cleanly had 14.88s of audio in a 14.92s
// video; ours had 13.28s in 14.04s, and drifted by ~0.7s.
const AUDIO = resolve(process.cwd(), "media/reportagego-uz-malika-14s.wav");
const OUT = resolve(process.cwd(), "media/reportagego-uz-malika-VIDEO2.mp4");

// Performance direction only: her face comes from the photo and the words come
// from the audio, so anything this describes about her appearance fights those.
const PROMPT =
  "The news anchor speaks directly to the camera, delivering a news bulletin with natural " +
  "lip movement precisely synchronized to the spoken audio. Subtle natural head movements, " +
  "blinking, and a warm professional expression. Static locked-off camera, chest-up framing. " +
  "The studio background stays steady. No text, no captions, no on-screen graphics.";

/** media_upload → PUT the bytes → media_confirm. Returns the media id. */
async function upload(path, filename, contentType, type) {
  const res = await call("media_upload", { filename, content_type: contentType });
  const up = res.uploads[0];
  const put = await fetch(up.upload_url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: readFileSync(path),
  });
  if (!put.ok) throw new Error(`PUT ${filename} failed: HTTP ${put.status}`);
  const confirmed = await call("media_confirm", { type, media_id: up.media_id });
  console.log(`  ${filename} → ${up.media_id} (${confirmed.results?.[0]?.status ?? "?"})`);
  return up.media_id;
}

function videoParams(imageId, audioId, extra = {}) {
  return {
    params: {
      model: "seedance_2_0",
      prompt: PROMPT,
      aspect_ratio: "9:16",
      duration: 14, // narration is 13.28s; Seedance takes whole seconds, 4-15
      resolution: "1080p",
      mode: "std",
      generate_audio: false, // keep HER track, don't let the model invent a voice
      medias: [
        { role: "start_image", value: imageId },
        { role: "audio", value: audioId },
      ],
      ...extra,
    },
  };
}

/** Pull every url-looking string out of an arbitrary response shape. */
function findUrls(node, out = []) {
  if (typeof node === "string") {
    if (/^https?:\/\/\S+\.(mp4|mov|webm)/i.test(node)) out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((n) => findUrls(n, out));
  } else if (node && typeof node === "object") {
    Object.values(node).forEach((n) => findUrls(n, out));
  }
  return out;
}

let outPath = OUT;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  const mb = (readFileSync(outPath).length / 1024 / 1024).toFixed(2);
  console.log(`\n✅ saved → ${outPath} (${mb} MB)`);
}

const [, , cmd, a, b] = process.argv;

const commands = {
  async upload() {
    console.log("uploading:");
    const img = await upload(IMAGE, "malika-still.png", "image/png", "image");
    const aud = await upload(AUDIO, basename(AUDIO), "audio/wav", "audio");
    console.log(`\nIMAGE=${img}\nAUDIO=${aud}`);
  },
  async cost() {
    console.log(JSON.stringify(await call("generate_video", videoParams(a, b, { get_cost: true })), null, 2));
  },
  async go() {
    const res = await call("generate_video", videoParams(a, b, { use_unlim: false }));
    console.log(JSON.stringify(res, null, 2));
    const urls = findUrls(res);
    if (urls.length) await download(urls[0]);
  },
  async poll() {
    if (b) outPath = resolve(process.cwd(), b);
    // raw_data carries an explicit status and a result_url that is null until
    // the job finishes. Do NOT scan the payload for any .mp4 — the params echo
    // back the INPUT video's URL, and grabbing that downloads the source clip
    // and passes it off as a finished render.
    let transient = 0;
    for (let i = 1; i <= 40; i++) {
      let res;
      try {
        res = await call("job_status", { jobId: a, sync: true, raw_data: true });
      } catch (err) {
        // The long-poll drops out with "fetch failed" / "Request timed out"
        // often enough that failing the whole run on it is pointless — the job
        // keeps rendering server-side regardless.
        if (++transient > 8) throw err;
        console.log(`[${i}] transient (${String(err.message).slice(0, 40)}…) — retrying`);
        reset(); // force a fresh MCP connection
        continue;
      }
      const raw = res?.raw_data ?? res;
      const status = String(raw?.status ?? "unknown");
      const url = raw?.result_url ?? raw?.h264_url ?? null;
      console.log(`[${i}] status=${status}${url ? " (result ready)" : ""}`);

      if (url) {
        await download(url);
        return;
      }
      if (["failed", "canceled", "cancelled", "error", "rejected"].includes(status.toLowerCase())) {
        console.log(JSON.stringify(raw, null, 2));
        throw new Error(`generation ${status}`);
      }
      if (status.toLowerCase() === "completed") {
        console.log(JSON.stringify(raw, null, 2));
        throw new Error("completed but no result_url");
      }
    }
    throw new Error("still not finished after 40 rounds");
  },
};

/**
 * Re-articulate an EXISTING clip to a new narration with Sync Lipsync 3.
 *
 * This is the one that actually lip-syncs. Seedance's `audio_references` is a
 * reference, not a driver: it yields plausible mouth motion that does not track
 * the words. The clip that reads correctly in media/ was built this way —
 * malika-base-15s.mp4 + narration → malika-news-uz-15s-LIPSYNC.mp4, which is
 * why it kept the base clip's 1440x2560 instead of a generator's 1080x1920.
 */
commands.lipsync = async function lipsync() {
  const videoPath = resolve(process.cwd(), a ?? "media/malika-base-15s.mp4");
  const audioPath = resolve(process.cwd(), b ?? "media/reportagego-uz-malika-final.wav");
  outPath = resolve(process.cwd(), "media/reportagego-uz-malika-LIPSYNC.mp4");
  console.log("uploading:");
  const vid = await upload(videoPath, basename(videoPath), "video/mp4", "video");
  const aud = await upload(audioPath, basename(audioPath), "audio/wav", "audio");

  const params = {
    model: "sync_so",
    sync_mode: "cut_off", // trim to the shorter input rather than looping the video
    medias: [
      { role: "input_video", value: vid },
      { role: "input_audio", value: aud },
    ],
  };
  // sync_so's cost estimator rejects its own generation params (422) — skip it
  // rather than block the run on a broken preflight.
  try {
    console.log("\ncost:", JSON.stringify(await call("generate_video", { params: { ...params, get_cost: true } })));
  } catch (err) {
    console.log(`\ncost: preflight unavailable (${String(err.message).slice(0, 80)}…)`);
  }

  const res = await call("generate_video", { params });
  console.log(JSON.stringify(res, null, 2));
  const id = res?.results?.[0]?.id;
  if (id) console.log(`\njob: ${id}\n  poll with: node scripts/hf-anchor.mjs poll ${id}`);
  const urls = findUrls(res);
  if (urls.length) await download(urls[0]);
};

/**
 * The recipe that actually works on this account, recovered from its own
 * generation history (11 Aug 18:22) — the run that produced the clip whose
 * lip-sync reads correctly.
 *
 * What matters, in order:
 *  1. minimax_h3 at 2K. Seedance treats audio as a vibe reference, not a
 *     driver; Sync Lipsync 3 re-articulates but smears the mouth.
 *  2. Roles `image` + `audio` — NOT `start_image`.
 *  3. A prompt that explicitly orders the lip-sync. The short performance note
 *     used for Seedance is not enough; this one names it outright.
 */
// Only the framing clause differs from the recovered original: the tight
// head-and-shoulders crop was pulled back to a medium shot on request. This is
// the wording behind media/reportagego-uz-malika-WIDE.mp4, so hf-series.mjs
// imports it rather than keeping a drifting copy.
export const MINIMAX_PROMPT =
  "Documentary footage of a real television news anchor, filmed on a broadcast camera in a medium shot " +
  "from a distance: the camera sits well back from her, she is seen from the waist up behind the news " +
  "desk, with the desk across the lower frame and open studio space visible around her head and on both " +
  "sides. She does not fill the frame. She wears a dark blazer with a slim headset microphone, seated at " +
  "a news desk in a softly lit studio. Photorealistic skin with visible pores and fine texture, natural colour in " +
  "the lips and eyes, soft studio key light with gentle falloff, shallow depth of field on an 85mm lens, " +
  "faint natural grain. She speaks the words of the audio to the lens, her lips and jaw matching the " +
  "speech exactly. Small natural movements: breath in the shoulders, a slight tilt of the head as a new " +
  "sentence begins, eyebrows lifting a little on a stressed word. She blinks softly only two or three " +
  "times in the whole shot, at the pauses between sentences. The camera is locked off and the studio " +
  "behind her stays still.";

commands.minimax = async function minimax() {
  const imagePath = resolve(process.cwd(), a ?? "media/malika-still.png");
  const audioPath = resolve(process.cwd(), b ?? "media/reportagego-uz-malika-14s.wav");
  outPath = resolve(process.cwd(), "media/reportagego-uz-malika-MINIMAX.mp4");

  console.log("uploading:");
  const img = await upload(imagePath, basename(imagePath), "image/png", "image");
  const aud = await upload(audioPath, basename(audioPath), "audio/wav", "audio");

  const params = {
    model: "minimax_h3",
    prompt: MINIMAX_PROMPT,
    aspect_ratio: "9:16",
    duration: 14, // audio is padded to exactly 14.000s
    resolution: "2K",
    // The server otherwise offers to swap this prompt for its "IN THE DARK"
    // preset and submits nothing. Decline it and generate literally.
    declined_preset_id: "24bae836-2c4a-48e0-89b6-49fcc0b21612",
    medias: [
      { role: "image", value: img },
      { role: "audio", value: aud },
    ],
  };

  try {
    console.log("\ncost:", JSON.stringify(await call("generate_video", { params: { ...params, get_cost: true } })));
  } catch (err) {
    console.log(`\ncost: preflight unavailable (${String(err.message).slice(0, 80)}…)`);
  }

  const res = await call("generate_video", { params });
  const id = res?.results?.[0]?.id;
  console.log(JSON.stringify(res?.results?.[0] ?? res, null, 2));
  if (id) console.log(`\njob: ${id}\n  poll: node scripts/hf-anchor.mjs poll ${id} media/reportagego-uz-malika-MINIMAX.mp4`);
};

// Guarded so other scripts can import MINIMAX_PROMPT without kicking off a run.
if (process.argv[1]?.endsWith("hf-anchor.mjs")) {
  const fn = commands[cmd];
  if (!fn) {
    console.error("usage: node scripts/hf-anchor.mjs upload|cost|go|poll|lipsync|minimax [args]");
    process.exit(1);
  }
  fn()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("FAILED:", err?.message ?? err);
      process.exit(1);
    });
}
