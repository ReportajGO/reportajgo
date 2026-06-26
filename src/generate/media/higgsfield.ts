import {
  HiggsfieldClient,
  InputImage,
  DoPModel,
  SoulSize,
  SoulQuality,
  BatchSize,
} from "@higgsfield/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { AspectRatio, MediaResult } from "../../domain/types.js";
import type { ImageGenRequest, MediaProvider, VideoGenRequest } from "./provider.js";

const log = logger.child({ module: "higgsfield" });

// Soul outputs are fixed resolutions, not aspect-ratio strings. Map our
// platform aspect ratios to the nearest supported Soul size.
const SOUL_SIZE_BY_RATIO: Record<AspectRatio, string> = {
  "1:1": SoulSize.SQUARE_1536x1536,
  "16:9": SoulSize.LANDSCAPE_2048x1152,
  "9:16": SoulSize.PORTRAIT_1152x2048,
  "4:5": SoulSize.MIXED_1152x1536, // nearest portrait (3:4)
};

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

export class HiggsfieldProvider implements MediaProvider {
  readonly name = "higgsfield";
  private client = makeClient();

  async generateImage(req: ImageGenRequest): Promise<MediaResult> {
    try {
      const jobSet = await this.client.generate(
        "/v1/text2image/soul",
        {
          prompt: req.prompt,
          width_and_height: SOUL_SIZE_BY_RATIO[req.aspectRatio],
          quality: SoulQuality.HD,
          batch_size: BatchSize.SINGLE,
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        { withPolling: true },
      );
      return this.toResult(jobSet, "IMAGE", req.aspectRatio);
    } catch (err) {
      return this.toError(err, "IMAGE", req.aspectRatio);
    }
  }

  async generateVideo(req: VideoGenRequest): Promise<MediaResult> {
    if (!req.sourceImageUrl) {
      // DoP is image-to-video; the pipeline generates a key image first.
      return this.toError(
        new Error("Higgsfield DoP requires a sourceImageUrl (image-to-video)."),
        "VIDEO",
        req.aspectRatio,
      );
    }
    try {
      const jobSet = await this.client.generate(
        "/v1/image2video/dop",
        {
          model: DoPModel.TURBO,
          prompt: req.prompt,
          input_images: [InputImage.fromUrl(req.sourceImageUrl)],
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        { withPolling: true },
      );
      return this.toResult(jobSet, "VIDEO", req.aspectRatio);
    } catch (err) {
      return this.toError(err, "VIDEO", req.aspectRatio);
    }
  }

  private toResult(
    jobSet: { id: string; isCompleted: boolean; jobs: { results?: { raw: { url: string } } | null }[] },
    type: "IMAGE" | "VIDEO",
    aspectRatio: AspectRatio,
  ): MediaResult {
    const url = jobSet.jobs[0]?.results?.raw.url;
    if (jobSet.isCompleted && url) {
      log.info({ type, jobSetId: jobSet.id }, "media ready");
      return { provider: this.name, type, aspectRatio, url, externalJobId: jobSet.id, status: "READY" };
    }
    return {
      provider: this.name,
      type,
      aspectRatio,
      externalJobId: jobSet.id,
      status: "FAILED",
      error: jobSet.isCompleted ? "completed but no result url" : "generation not completed",
    };
  }

  private toError(err: unknown, type: "IMAGE" | "VIDEO", aspectRatio: AspectRatio): MediaResult {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message, type }, "higgsfield generation failed");
    return { provider: this.name, type, aspectRatio, status: "FAILED", error: message };
  }
}
