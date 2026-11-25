import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '@/config/env';

export interface ArtifactStorage {
  putJsonArtifact(key: string, data: unknown): Promise<string>;
  getJsonArtifact<T>(key: string): Promise<T | null>;
}

class AwsS3ArtifactStorage implements ArtifactStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(region: string, bucket: string, endpointUrl?: string) {
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      ...(endpointUrl
        ? {
            endpoint: endpointUrl,
            forcePathStyle: true,
          }
        : {}),
    });
  }

  async putJsonArtifact(key: string, data: unknown): Promise<string> {
    const body = JSON.stringify(data);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async getJsonArtifact<T>(key: string): Promise<T | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const text = await res.Body?.transformToString('utf8');
      return text ? (JSON.parse(text) as T) : null;
    } catch {
      return null;
    }
  }
}

class InMemoryArtifactStorage implements ArtifactStorage {
  private readonly store = new Map<string, string>();

  async putJsonArtifact(key: string, data: unknown): Promise<string> {
    this.store.set(key, JSON.stringify(data));
    return `local-artifact://${key}`;
  }

  async getJsonArtifact<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  public clearForTesting(): void {
    this.store.clear();
  }
}

export const inMemoryArtifactStorage = new InMemoryArtifactStorage();

export function getArtifactStorage(): ArtifactStorage {
  const env = getEnv();
  if (env.S3_ARTIFACTS_BUCKET && env.NODE_ENV !== 'test') {
    return new AwsS3ArtifactStorage(
      env.AWS_REGION,
      env.S3_ARTIFACTS_BUCKET,
      env.S3_ENDPOINT_URL || undefined,
    );
  }
  return inMemoryArtifactStorage;
}
