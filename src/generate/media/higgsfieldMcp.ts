import { logger } from "../../config/logger.js";
import { mcpCallTool } from "../../integrations/higgsfield/mcpClient.js";
import type { AspectRatio, MediaResult } from "../../domain/types.js";
import type { ImageGenRequest, MediaProvider, VideoGenRequest } from "./provider.js";

const log = logger.child({ module: "higgsfield-mcp-provider" });

const IMAGE_MODEL = "soul_2";
const MAX_POLLS = 20;
const POLL_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Soul tends to hallucinate captions/signage. Strongly forbid any rendered text
// since the headline is composited separately.
const NO_TEXT =
  "Absolutely no text, no letters, no words, no captions, no subtitles, no signage, " +
  "no labels, no watermark, no logos anywhere in the image. Clean photographic scene only.";

interface GenSubmit {
  results?: { id?: string }[];
  id?: string;
}
interface JobStatus {
  generation?: {
    status?: string;
    results?: { rawUrl?: string; raw_url?: string; minUrl?: string };
  };
  status?: string;
  results?: { rawUrl?: string; raw_url?: string };
}

/**
 * Image generation through the Higgsfield **MCP** (OAuth/refresh-token auth),
 * which draws from the app/subscription credit wallet — unlike the API provider.
 * Submits a job, then polls job_status until the image is ready.
 */
export class HiggsfieldMcpProvider implements MediaProvider {
  readonly name = "higgsfield-mcp";

  async generateImage(req: ImageGenRequest): Promise<MediaResult> {
    try {
      const submit = (await mcpCallTool("generate_image", {
        params: {
          model: IMAGE_MODEL,
          prompt: `${req.prompt} ${NO_TEXT}`,
          aspect_ratio: req.aspectRatio,
          count: 1,
        },
      })) as GenSubmit;

      const jobId = submit.results?.[0]?.id ?? submit.id;
      if (!jobId) throw new Error("generate_image returned no job id");

      const url = await this.poll(jobId);
      log.info({ jobId }, "higgsfield MCP image ready");
      return {
        provider: this.name,
        type: "IMAGE",
        aspectRatio: req.aspectRatio,
        url,
        externalJobId: jobId,
        status: "READY",
      };
    } catch (err) {
      return this.toError(err, req.aspectRatio);
    }
  }

  /** Poll job_status (server waits up to ~25s with sync) until terminal. */
  private async poll(jobId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const js = (await mcpCallTool("job_status", { jobId, sync: true })) as JobStatus;
      const gen = js.generation ?? js;
      const status = gen.status;
      if (status === "completed") {
        const url = gen.results?.rawUrl ?? gen.results?.raw_url;
        if (!url) throw new Error("job completed but no image url");
        return url;
      }
      if (status && status !== "pending" && status !== "in_progress" && status !== "queued") {
        throw new Error(`job ${status}`);
      }
      await sleep(POLL_DELAY_MS);
    }
    throw new Error("image generation timed out");
  }

  async generateVideo(req: VideoGenRequest): Promise<MediaResult> {
    return {
      provider: this.name,
      type: "VIDEO",
      aspectRatio: req.aspectRatio,
      status: "FAILED",
      error: "video generation via Higgsfield MCP is not wired yet",
    };
  }

  private toError(err: unknown, aspectRatio: AspectRatio): MediaResult {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "higgsfield MCP image generation failed");
    return { provider: this.name, type: "IMAGE", aspectRatio, status: "FAILED", error: message };
  }
}
