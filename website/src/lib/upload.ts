import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

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

  await mkdir(UPLOAD_DIR, { recursive: true });

  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  return `${PUBLIC_PREFIX}/${name}`;
}

/** Best-effort removal of a previously uploaded file (ignores misses). */
export async function deleteImage(url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith(`${PUBLIC_PREFIX}/`)) return;
  const name = path.basename(url);
  try {
    await unlink(path.join(UPLOAD_DIR, name));
  } catch {
    // file already gone — nothing to do
  }
}
