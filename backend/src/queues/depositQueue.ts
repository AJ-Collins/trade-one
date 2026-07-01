import { Queue, JobsOptions } from 'bullmq';
import { redis } from '../lib/redis.js';

export const DEPOSIT_QUEUE_NAME = 'deposit-activity';

export interface DepositActivityJob {
  network: string;        // internal network key, already resolved from Alchemy's name
  activity: any;           // raw activity object from the Alchemy webhook payload
  receivedAt: number;
}

export const depositQueue = new Queue<DepositActivityJob>(DEPOSIT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 12,
    backoff: { type: 'exponential', delay: 10_000 }, // 10s, 20s, 40s ... covers 64+ confs on Polygon
    removeOnComplete: { age: 3600, count: 1000 },    // keep an hour / last 1000 for debugging
    removeOnFail: { age: 86_400 },                   // keep failed jobs a day so you can inspect/replay them
  },
});

/**
 * Enqueue a single activity for processing. Deduplicated on tx hash + log
 * index so retried Alchemy webhook deliveries (which resend the same
 * activity) don't pile up duplicate jobs in the queue itself — the DB
 * unique constraint is still the final source of truth, this is just to
 * avoid wasted queue churn.
 */
export async function enqueueDepositActivity(network: string, activity: any) {
  const dedupeId = `${activity.hash ?? 'nohash'}:${activity.logIndex ?? activity.uniqueId ?? '0'}`;
  const opts: JobsOptions = { jobId: dedupeId };
  await depositQueue.add('process-activity', { network, activity, receivedAt: Date.now() }, opts);
}