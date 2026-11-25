import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { getEnv } from '@/config/env';

export interface QueueMessageEnvelope {
  jobId: string;
  workspaceId: string;
  jobType: string;
  idempotencyKey: string;
  enqueuedAt: string;
}

export interface ReceivedQueueMessage {
  messageId: string;
  receiptHandle: string;
  envelope: QueueMessageEnvelope;
}

export interface JobQueueTransport {
  readonly transportName: 'sqs' | 'in-memory';
  enqueue(envelope: QueueMessageEnvelope): Promise<{ messageId: string }>;
  enqueueDeadLetter(envelope: QueueMessageEnvelope, reason: string): Promise<void>;
  receive(maxMessages: number, visibilityTimeoutSec: number): Promise<ReceivedQueueMessage[]>;
  acknowledge(receiptHandle: string): Promise<void>;
  extendVisibility(receiptHandle: string, visibilityTimeoutSec: number): Promise<void>;
}

class AwsSqsJobQueue implements JobQueueTransport {
  public readonly transportName = 'sqs' as const;
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;

  constructor(region: string, queueUrl: string, dlqUrl: string, endpointUrl?: string) {
    this.queueUrl = queueUrl;
    this.dlqUrl = dlqUrl;
    this.client = new SQSClient({
      region,
      ...(endpointUrl
        ? {
            endpoint: endpointUrl,
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
            },
          }
        : {}),
    });
  }

  async enqueue(envelope: QueueMessageEnvelope): Promise<{ messageId: string }> {
    const res = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageAttributes: {
          JobType: { DataType: 'String', StringValue: envelope.jobType },
          WorkspaceId: { DataType: 'String', StringValue: envelope.workspaceId },
          IdempotencyKey: { DataType: 'String', StringValue: envelope.idempotencyKey },
        },
      }),
    );
    return { messageId: res.MessageId ?? `sqs-${Date.now()}` };
  }

  async enqueueDeadLetter(envelope: QueueMessageEnvelope, reason: string): Promise<void> {
    if (!this.dlqUrl) return;
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: JSON.stringify({ ...envelope, deadLetterReason: reason }),
      }),
    );
  }

  async receive(
    maxMessages: number,
    visibilityTimeoutSec: number,
  ): Promise<ReceivedQueueMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(10, Math.max(1, maxMessages)),
        VisibilityTimeout: visibilityTimeoutSec,
        WaitTimeSeconds: 2,
      }),
    );
    return (res.Messages ?? [])
      .filter((m) => m.Body && m.ReceiptHandle && m.MessageId)
      .map((m) => ({
        messageId: m.MessageId!,
        receiptHandle: m.ReceiptHandle!,
        envelope: JSON.parse(m.Body!) as QueueMessageEnvelope,
      }));
  }

  async acknowledge(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async extendVisibility(receiptHandle: string, visibilityTimeoutSec: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSec,
      }),
    );
  }
}

interface InMemoryEntry {
  messageId: string;
  receiptHandle: string;
  envelope: QueueMessageEnvelope;
  visibleAtMs: number;
}

export class InMemoryJobQueue implements JobQueueTransport {
  public readonly transportName = 'in-memory' as const;
  private messages: InMemoryEntry[] = [];
  public deadLetters: Array<{ envelope: QueueMessageEnvelope; reason: string }> = [];
  private seq = 1;

  async enqueue(envelope: QueueMessageEnvelope): Promise<{ messageId: string }> {
    const id = `mem-${this.seq++}`;
    this.messages.push({
      messageId: id,
      receiptHandle: `rh-${id}`,
      envelope,
      visibleAtMs: Date.now(),
    });
    return { messageId: id };
  }

  async enqueueDeadLetter(envelope: QueueMessageEnvelope, reason: string): Promise<void> {
    this.deadLetters.push({ envelope, reason });
  }

  async receive(
    maxMessages: number,
    visibilityTimeoutSec: number,
  ): Promise<ReceivedQueueMessage[]> {
    const now = Date.now();
    const batch: ReceivedQueueMessage[] = [];
    for (const msg of this.messages) {
      if (batch.length >= maxMessages) break;
      if (msg.visibleAtMs <= now) {
        msg.visibleAtMs = now + visibilityTimeoutSec * 1000;
        batch.push({
          messageId: msg.messageId,
          receiptHandle: msg.receiptHandle,
          envelope: msg.envelope,
        });
      }
    }
    return batch;
  }

  async acknowledge(receiptHandle: string): Promise<void> {
    this.messages = this.messages.filter((m) => m.receiptHandle !== receiptHandle);
  }

  async extendVisibility(receiptHandle: string, visibilityTimeoutSec: number): Promise<void> {
    const found = this.messages.find((m) => m.receiptHandle === receiptHandle);
    if (found) {
      found.visibleAtMs = Date.now() + visibilityTimeoutSec * 1000;
    }
  }

  public clearForTesting(): void {
    this.messages = [];
    this.deadLetters = [];
  }
}

export const inMemoryJobQueue = new InMemoryJobQueue();
let customQueue: JobQueueTransport | null = null;

export function getJobQueueTransport(): JobQueueTransport {
  if (customQueue) {
    return customQueue;
  }
  const env = getEnv();
  if (env.SQS_QUEUE_URL && env.NODE_ENV !== 'test') {
    return new AwsSqsJobQueue(
      env.AWS_REGION,
      env.SQS_QUEUE_URL,
      env.SQS_DLQ_URL,
      env.SQS_ENDPOINT_URL || undefined,
    );
  }
  return inMemoryJobQueue;
}

export function setJobQueueTransportForTesting(transport: JobQueueTransport | null): void {
  customQueue = transport;
}
