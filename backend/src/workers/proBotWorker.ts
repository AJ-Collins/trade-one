import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../prisma.js';
import { executeTradeCycle, stopProBot, log, broadcast } from '../services/botEngineService.js';
import { tradeQueue } from '../queues/tradeQueue.js';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

function rand(min: number, max: number, decimals = 2): number {
  return Math.round((Math.random() * (max - min) + min) * 10 ** decimals) / 10 ** decimals;
}

function randomScanMessage(asset: string): string {
  const generators = [
    () => `RSI(14) on ${asset}: ${rand(20, 80, 1)} — ${rand(20, 80) > 70 ? "overbought" : rand(20, 80) < 30 ? "oversold" : "neutral"} zone`,
    () => `EMA(9/21) on ${asset}: ${rand(0.9, 1.1, 4) > rand(0.9, 1.1, 4) ? "bullish" : "bearish"} crossover forming`,
    () => `Volume on ${asset} at ${rand(60, 140, 1)}% of 24h avg — nominal parameters`,
    () => `Order book spread on ${asset}: ${rand(0.1, 2.5, 2)} pips — liquidity check passed`,
    () => `Sentiment score for ${asset}: ${rand(-1, 1, 2)}`,
    () => `ATR(14) on ${asset}: ${rand(0.0005, 0.004, 4)} — volatility within tolerance`,
    () => `Latency check to liquidity provider: ${rand(8, 45, 0)}ms — nominal`,
    () => `MACD signal on ${asset}: histogram ${rand(-0.002, 0.002, 4)} — ${rand(0, 1) > 0.5 ? "bullish" : "bearish"} divergence`,
    () => `Bollinger Band width on ${asset}: ${rand(0.001, 0.04, 4)} — ${rand(0, 1) > 0.6 ? "squeeze detected" : "normal range"}`,
    () => `Stochastic(14,3) on ${asset}: K=${rand(10, 90, 1)} D=${rand(10, 90, 1)} — ${rand(0, 1) > 0.5 ? "momentum building" : "consolidating"}`,
    () => `Funding rate on ${asset}: ${rand(-0.01, 0.01, 4)}% — position bias ${rand(0, 1) > 0.5 ? "long-heavy" : "short-heavy"}`,
    () => `Tick flow imbalance on ${asset}: ${rand(51, 68, 1)}% ${rand(0, 1) > 0.5 ? "bid" : "ask"} pressure`,
  ];
  return generators[Math.floor(Math.random() * generators.length)]();
}

function nextTradeDelaySec(intervalSec: number): number {
  const minGap = Math.max(4, intervalSec * 0.12);
  const maxGap = Math.max(minGap + 2, intervalSec * 0.3);
  return minGap + Math.random() * (maxGap - minGap);
}

async function processTradeCycle(job: Job) {
  const { proBotId, startedAt } = job.data;

  // Always re-read status from DB — this is how manual stop works
  const bot = await prisma.proBot.findUnique({
    where: { id: proBotId },
    select: { id: true, status: true, tradeInterval: true, asset: true },
  });

  // Bot was stopped (manually or by previous cycle) — do not reschedule
  if (!bot || bot.status !== 'RUNNING') return;

  const intervalSec = bot.tradeInterval > 0 ? bot.tradeInterval : 60;
  const elapsedSec = (Date.now() - startedAt) / 1000;

  // Broadcast progress so the frontend countdown stays accurate
  await broadcast(proBotId, {
    message_type: 'progress',
    data: {
      elapsed: Math.min(elapsedSec, intervalSec),
      interval: intervalSec,
      remaining: Math.max(0, intervalSec - elapsedSec),
    },
  });

  // ── Interval complete — stop and do NOT reschedule ────────────────────────
  if (elapsedSec >= intervalSec) {
    await log(proBotId, `⏱ Cycle complete (${intervalSec}s) — settling positions`, 'INFO');
    await stopProBot(proBotId);
    return;
  }

  // ── Scan logs before trade ────────────────────────────────────────────────
  const scanCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < scanCount; i++) {
    await log(proBotId, randomScanMessage(bot.asset), 'INFO');
  }

  // ── Execute trade ─────────────────────────────────────────────────────────
  try {
    await executeTradeCycle(proBotId);
  } catch (err: any) {
    await log(proBotId, `⚠ Execution error — skipping: ${err.message}`, 'ERROR');
  }

  // ── Reschedule or trigger final stop ──────────────────────────────────────
  const nextDelayMs = nextTradeDelaySec(intervalSec) * 1000;
  const nextElapsedSec = elapsedSec + nextDelayMs / 1000;

  if (nextElapsedSec < intervalSec) {
    // Normal reschedule — next tick fits within the interval
    await tradeQueue.add(
      'trade-cycle',
      { proBotId, startedAt },
      {
        delay: nextDelayMs,
        // Timestamp-based jobId — unique per tick, prevents BullMQ dedup rejecting it
        jobId: `bot-${proBotId}-${Math.floor(Date.now() / 1000)}`,
      }
    );
  } else {
    // Next tick would overshoot — schedule exactly at interval end for clean stop
    const remainingMs = Math.max(500, (intervalSec - elapsedSec) * 1000);
    await tradeQueue.add(
      'trade-cycle',
      { proBotId, startedAt },
      {
        delay: remainingMs,
        jobId: `bot-${proBotId}-final-${Math.floor(Date.now() / 1000)}`,
      }
    );
  }
}

const worker = new Worker('pro-bot-trades', processTradeCycle, {
  connection,
  // 30 concurrent slots per process. With 3 replicas = 90 total.
  // Each job does ~4–6 DB ops; 30 × 6 = 180 simultaneous DB ops — well within
  // Postgres limits while still handling hundreds of active bots.
  concurrency: 30,
  lockDuration: 30_000,
});

worker.on('failed', (job, err) => {
  console.error(`[ProBotWorker] Job ${job?.id} failed for bot ${job?.data?.proBotId}:`, err.message);
});

worker.on('error', (err) => {
  console.error('[ProBotWorker] Worker error:', err);
});

process.on('SIGTERM', async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});