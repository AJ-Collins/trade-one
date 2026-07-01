import { Response } from 'express';
import crypto from 'crypto';
import { RawBodyRequest } from '../middleware/rawBodyParser.js';
import { ALCHEMY_NETWORK_MAP } from '../config/networks.js';
import { enqueueDepositActivity } from '../queues/depositQueue.js';
import { getConfig } from '../utils/configLoader.js';



async function verifyAlchemySignature(req: RawBodyRequest): Promise<boolean> {
  const signature = req.headers['x-alchemy-signature'] as string | undefined;
  if (!signature) return false;

  const signingKey = await getConfig('ALCHEMY_SIGNING_KEY');
  if (!signingKey) return false;

  if (!req.rawBody) return false;

  const hmac = crypto.createHmac('sha256', signingKey).update(req.rawBody).digest('hex');
  const sigBuf  = Buffer.from(signature, 'hex');
  const hmacBuf = Buffer.from(hmac, 'hex');
  if (sigBuf.length !== hmacBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, hmacBuf);
}

/**
 * The webhook handler does the absolute minimum needed before responding:
 * verify the signature, then hand every activity off to the queue.
 * All the actual crediting logic (confirmations, contract verification,
 * price lookup, DB writes) lives in src/workers/depositWorker.ts, which
 * processes jobs with controlled concurrency and automatic retries —
 * this is what lets the system absorb bursts from many simultaneous
 * depositors without slow webhook responses or dropped DB connections.
 */
export async function handleAlchemyWebhook(req: RawBodyRequest, res: Response) {
  // Always ack fast — Alchemy retries if no 200 within 10s.
  res.status(200).json({ ok: true });

  if (!(await verifyAlchemySignature(req))) {
    console.warn('[Alchemy] Invalid webhook signature — ignoring');
    return;
  }

  const { type, event } = req.body;
  if (type !== 'ADDRESS_ACTIVITY') return;

  const activities: any[] = event?.activity ?? [];
  const alchemyNetwork: string = event?.network ?? '';
  const internalNetwork = ALCHEMY_NETWORK_MAP[alchemyNetwork];

  if (!internalNetwork) {
    console.warn(`[Alchemy] Unsupported/unknown network in webhook payload: ${alchemyNetwork}`);
    return;
  }

  for (const activity of activities) {
    if (activity.category !== 'external' && activity.category !== 'internal' && activity.category !== 'erc20' && activity.category !== 'token') {
      continue;
    }
    try {
      await enqueueDepositActivity(internalNetwork, activity);
    } catch (err: any) {
      // Queue itself (Redis) being down is the one failure mode that should be loud —
      // Alchemy's retry won't help if Redis is unreachable on every attempt.
      console.error('[Alchemy] Failed to enqueue activity:', err.message);
    }
  }
}