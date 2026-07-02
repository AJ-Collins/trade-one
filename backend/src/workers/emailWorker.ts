// src/workers/emailWorker.ts
import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../queues/emailQueue.js';
import { EmailService } from '../services/emailService.js';

const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job) => {
    switch (job.data.type) {
      case 'REFERRER_WITHDRAWAL_ALERT':
        await EmailService.sendReferrerWithdrawalAlert(
          job.data.user,
          job.data.amount,
          job.data.network,
          job.data.toAddress
        );
        break;

      case 'REFERRER_DEPOSIT_ALERT':
        await EmailService.sendReferrerDepositAlert(
          job.data.user,
          job.data.amount,
          job.data.address,
          job.data.txId
        );
        break;

      default:
        console.warn(`Unknown email job type: ${(job.data as any).type}`);
    }
  },
  { connection: redis, concurrency: 5 }
);

worker.on('completed', (job) => console.log(`Email job ${job.id} sent`));
worker.on('failed', (job, err) => console.error(`Email job ${job?.id} failed:`, err.message));

export default worker;