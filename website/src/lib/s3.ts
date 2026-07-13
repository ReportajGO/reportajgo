import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

type S3Config = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
};

function config(): S3Config {
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket) throw new Error("AWS_S3_BUCKET is required for S3 uploads");
  if (!accessKeyId) throw new Error("AWS_ACCESS_KEY_ID is required for S3 uploads");
  if (!secretAccessKey) throw new Error("AWS_SECRET_ACCESS_KEY is required for S3 uploads");
  return {
    region: process.env.AWS_REGION || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
    publicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL || undefined,
  };
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function buildUrl(cfg: S3Config, key: string): URL {
  const encodedKey = encodeKey(key);
  if (cfg.endpoint) {
    const base = new URL(cfg.endpoint.replace(/\/+$/, ""));
    if (cfg.forcePathStyle) {
      return new URL(`${base.href.replace(/\/+$/, "")}/${cfg.bucket}/${encodedKey}`);
    }
    return new URL(`${base.protocol}//${cfg.bucket}.${base.host}/${encodedKey}`);
  }
  return new URL(`https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${encodedKey}`);
}

function publicUrl(cfg: S3Config, key: string): string {
  const encodedKey = encodeKey(key);
  if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  return buildUrl(cfg, key).toString();
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

async function s3Request(
  method: "PUT" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<void> {
  const cfg = config();
  const url = buildUrl(cfg, key);
  const payloadHash = sha256(body ?? "");
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]!.trim()}\n`)
    .join("");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp, cfg.region))
    .update(stringToSign)
    .digest("hex");
  const requestBody = body ? new Uint8Array(body) : undefined;

  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      authorization:
        `${ALGORITHM} Credential=${cfg.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    ...(requestBody ? { body: requestBody } : {}),
  });
  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`S3 ${method} failed (${res.status}): ${details.slice(0, 300)}`);
  }
}

export async function putS3Object(key: string, body: Buffer, contentType: string): Promise<string> {
  const cfg = config();
  await s3Request("PUT", key, body, contentType);
  return publicUrl(cfg, key);
}

export async function deleteS3Object(key: string): Promise<void> {
  await s3Request("DELETE", key);
}

export function keyFromPublicUrl(raw: string): string | null {
  const cfg = config();
  const cleanBase = cfg.publicBaseUrl?.replace(/\/+$/, "");
  if (cleanBase && raw.startsWith(`${cleanBase}/`)) {
    return decodeURIComponent(raw.slice(cleanBase.length + 1));
  }
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/^\/+/, "");
    if (cfg.forcePathStyle && path.startsWith(`${cfg.bucket}/`)) {
      return decodeURIComponent(path.slice(cfg.bucket.length + 1));
    }
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}
