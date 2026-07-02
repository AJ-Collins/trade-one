import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const EMAIL_QUEUE_NAME = 'email-notifications';

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export type EmailJobData =
  | {
      type: 'REFERRER_WITHDRAWAL_ALERT';
      user: any;
      amount: number;
      network: string;
      toAddress: string;
    }
  | {
      type: 'REFERRER_DEPOSIT_ALERT';
      user: any;
      amount: number;
      address: string;
      txId: string;
    };

export async function enqueueEmail(data: EmailJobData) {
  return emailQueue.add(data.type, data, {
    jobId: `${data.type}-${(data as any).user?.id}-${Date.now()}`,
  });
}