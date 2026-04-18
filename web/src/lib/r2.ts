import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// Cloudflare R2 is S3-compatible, so we use the AWS SDK
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || "nf-transcriptome";

export async function uploadToR2(
  key: string,
  body: Buffer | string,
  contentType: string = "application/json"
): Promise<void> {
  if (!process.env.R2_ACCOUNT_ID) {
    console.log(`[R2] Skipping upload (R2 not configured): ${key}`);
    return;
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function downloadFromR2(key: string): Promise<string | null> {
  if (!process.env.R2_ACCOUNT_ID) {
    console.log(`[R2] Skipping download (R2 not configured): ${key}`);
    return null;
  }

  try {
    const response = await r2Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );
    return (await response.Body?.transformToString()) || null;
  } catch {
    return null;
  }
}
