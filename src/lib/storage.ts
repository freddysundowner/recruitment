import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * File storage behind two functions. Local disk by default (simplest for a single-agency install);
 * set STORAGE_DRIVER=s3 for AWS S3, Cloudflare R2, or MinIO on your own server.
 * Keys are namespaced per agency. Files are never served from a public path: see /files/[id].
 */
export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export const MAX_BYTES = 8 * 1024 * 1024;

const usingS3 = () => process.env.STORAGE_DRIVER === "s3";
const root = () => resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./storage");

let s3: S3Client | undefined;
function client() {
  s3 ??= new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" }
      : undefined,
  });
  return s3;
}
const bucket = () => {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
};

export async function putFile(tenantId: string, bytes: Buffer, contentType = "application/octet-stream"): Promise<string> {
  const key = `${tenantId}/${randomUUID()}`;
  if (usingS3()) {
    await client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === "true" ? "AES256" : undefined }));
    return key;
  }
  const path = join(root(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (usingS3()) {
    const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
  const path = resolve(root(), key);
  if (!path.startsWith(root())) throw new Error("Invalid file key");
  return readFile(path);
}

export async function deleteFile(key: string): Promise<void> {
  if (key === "seed/none") return;
  if (usingS3()) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    return;
  }
  const path = resolve(root(), key);
  if (!path.startsWith(root())) throw new Error("Invalid file key");
  await rm(path, { force: true });
}
