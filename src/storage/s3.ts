import { createHash, createHmac } from "node:crypto";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

export interface S3UploadConfig {
  region: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
}

function requireConfig(config: S3UploadConfig): Required<Pick<S3UploadConfig, "bucket" | "accessKeyId" | "secretAccessKey">> {
  if (!config.bucket) throw new Error("AWS_S3_BUCKET is required for S3 storage");
  if (!config.accessKeyId) throw new Error("AWS_ACCESS_KEY_ID is required for S3 storage");
  if (!config.secretAccessKey) throw new Error("AWS_SECRET_ACCESS_KEY is required for S3 storage");
  return {
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hex(buffer: Buffer): string {
  return buffer.toString("hex");
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function buildUrl(config: S3UploadConfig, key: string): URL {
  const { bucket } = requireConfig(config);
  const encodedKey = encodeKey(key);
  if (config.endpoint) {
    const endpoint = config.endpoint.replace(/\/+$/, "");
    const base = new URL(endpoint);
    if (config.forcePathStyle) {
      return new URL(`${base.href.replace(/\/+$/, "")}/${bucket}/${encodedKey}`);
    }
    return new URL(`${base.protocol}//${bucket}.${base.host}/${encodedKey}`);
  }
  return new URL(`https://${bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`);
}

function publicUrl(config: S3UploadConfig, key: string): string {
  const encodedKey = encodeKey(key);
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  }
  return buildUrl(config, key).toString();
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

async function s3Request(
  config: S3UploadConfig,
  method: "PUT" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<void> {
  const required = requireConfig(config);
  const url = buildUrl(config, key);
  const payloadHash = sha256(body ?? "");
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;

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
  const signature = hex(hmac(signingKey(required.secretAccessKey, dateStamp, config.region), stringToSign));

  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      authorization:
        `${ALGORITHM} Credential=${required.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    ...(body ? { body } : {}),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`S3 ${method} failed (${res.status}): ${details.slice(0, 300)}`);
  }
}

export async function putS3Object(
  config: S3UploadConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  await s3Request(config, "PUT", key, body, contentType);
  return publicUrl(config, key);
}

export async function deleteS3Object(config: S3UploadConfig, key: string): Promise<void> {
  await s3Request(config, "DELETE", key);
}
