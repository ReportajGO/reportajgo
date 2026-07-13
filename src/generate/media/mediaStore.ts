import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { putS3Object } from "../../storage/s3.js";

/** Absolute path to the directory generated media is written to. */
export const MEDIA_ROOT = isAbsolute(env.MEDIA_DIR)
  ? env.MEDIA_DIR
  : resolve(process.cwd(), env.MEDIA_DIR);

export interface StoredAsset {
  /** Publicly servable URL (served by the dashboard under /media). */
  url: string;
  /** Absolute path on disk. */
  path: string;
  filename: string;
}

function extFor(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

/**
 * Persist an image to the media directory and return a URL the dashboard
 * (and, with a public PUBLIC_BASE_URL, social platforms) can fetch.
 * Accepts a base64 string or a raw image Buffer.
 */
export async function saveImage(
  data: string | Buffer,
  mimeType = "image/png",
): Promise<StoredAsset> {
  const filename = `${randomUUID()}.${extFor(mimeType)}`;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "base64");

  if (env.MEDIA_STORAGE_DRIVER === "s3") {
    const prefix = env.AWS_S3_KEY_PREFIX.replace(/^\/+|\/+$/g, "");
    const key = prefix ? `${prefix}/${filename}` : filename;
    const url = await putS3Object(
      {
        region: env.AWS_REGION,
        bucket: env.AWS_S3_BUCKET,
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        endpoint: env.AWS_S3_ENDPOINT,
        forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE,
        publicBaseUrl: env.AWS_S3_PUBLIC_BASE_URL,
      },
      key,
      bytes,
      mimeType,
    );
    return { url, path: `s3://${env.AWS_S3_BUCKET}/${key}`, filename };
  }

  await mkdir(MEDIA_ROOT, { recursive: true });
  const path = join(MEDIA_ROOT, filename);
  await writeFile(path, bytes);
  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  return { url: `${base}/media/${filename}`, path, filename };
}
