import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { safeFetch } from "./ssrf";
import { deleteS3Object, keyFromPublicUrl, putS3Object } from "./s3";

// Where uploads land on disk and how they map to a public URL.
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PUBLIC_PREFIX = "/uploads";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export class UploadError extends Error {}

function shouldUseS3Storage(): boolean {
  return (process.env.UPLOAD_STORAGE_DRIVER || "local") === "s3";
}

function s3Key(name: string): string {
  const prefix = (process.env.AWS_S3_KEY_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Verify the file's real content matches an allowed image format by inspecting
 * its magic bytes — `file.type` alone is client-controlled and spoofable.
 */
function sniffImage(buf: Buffer): keyof typeof EXT_BY_MIME | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

/**
 * Persist an uploaded image to public/uploads with a unique name.
 * Returns the public URL (e.g. "/uploads/ab12.jpg") to store in the DB.
 */
export async function saveImage(file: File): Promise<string> {
  if (!file || file.size === 0) throw new UploadError("Empty file");
  if (file.size > MAX_BYTES) throw new UploadError("File too large (max 5 MB)");

  if (!EXT_BY_MIME[file.type]) throw new UploadError("Unsupported image type");

  const buffer = Buffer.from(await file.arrayBuffer());

  // Trust the actual bytes, not the declared MIME type.
  const realType = sniffImage(buffer);
  if (!realType) throw new UploadError("File is not a valid image");
  const ext = EXT_BY_MIME[realType];
  const name = `${randomUUID()}.${ext}`;
  if (shouldUseS3Storage()) {
    return putS3Object(s3Key(name), buffer, realType);
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  return `${PUBLIC_PREFIX}/${name}`;
}

// Agent-sourced images (real news photos / generated visuals) can be larger
// than admin uploads, so allow a higher ceiling when fetching by URL.
const MAX_URL_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Download a remote image and persist it under public/uploads, returning the
 * local public URL ("/uploads/…"). Used to re-host the AI agent's images so
 * they are served same-origin (satisfies the site CSP and works off-localhost).
 */
export async function saveImageFromUrl(url: string): Promise<string> {
  // SSRF-safe: rejects internal/loopback/link-local targets and re-checks each
  // redirect hop (the URL comes from the agent's request body).
  let res: Response;
  try {
    res = await safeFetch(url, {}, 25_000);
  } catch (e) {
    throw new UploadError(`refused image URL: ${e instanceof Error ? e.message : "blocked"}`);
  }
  if (!res.ok) throw new UploadError(`fetch image failed: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new UploadError("Empty image");
  if (buffer.length > MAX_URL_BYTES) throw new UploadError("Image too large");

  // Trust the bytes, not the URL extension or content-type header.
  const realType = sniffImage(buffer);
  if (!realType) throw new UploadError("URL did not return a supported image");
  const ext = EXT_BY_MIME[realType];
  const name = `${randomUUID()}.${ext}`;
  if (shouldUseS3Storage()) {
    return putS3Object(s3Key(name), buffer, realType);
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `${PUBLIC_PREFIX}/${name}`;
}

/** Save several images (e.g. an article gallery); returns their public URLs. */
export async function saveImages(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    if (f instanceof File && f.size > 0) urls.push(await saveImage(f));
  }
  return urls;
}

/** Best-effort removal of a previously uploaded file (ignores misses). */
export async function deleteImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  if (!url.startsWith(`${PUBLIC_PREFIX}/`) && shouldUseS3Storage()) {
    const key = keyFromPublicUrl(url);
    if (!key) return;
    try {
      await deleteS3Object(key);
    } catch {
      // best-effort cleanup
    }
    return;
  }
  if (!url.startsWith(`${PUBLIC_PREFIX}/`)) return;
  const name = path.basename(url);
  try {
    await unlink(path.join(UPLOAD_DIR, name));
  } catch {
    // file already gone — nothing to do
  }
}
