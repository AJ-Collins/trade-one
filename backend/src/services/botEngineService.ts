import { LogLevel } from "@prisma/client";
import { tradeQueue, redisPub } from '../queues/tradeQueue.js';
import { prisma } from "../prisma.js";

const MARKETER_CONFIG = {
  winRate: 0.91,
  fixedProfit: true,
} as const;

type Broadcaster = (proBotId: number, payload: any) => void;
let localBroadcast: Broadcaster = () => {};

export function setProBotBroadcaster(fn: Broadcaster) {
  localBroadcast = fn;
}

// Unified broadcast: publishes to Redis so both the API WS process and worker process
// can relay messages to connected WebSocket clients.
export async function broadcast(proBotId: number, payload: any) {
  localBroadcast(proBotId, payload);
  try {
    await redisPub.publish(`probot:${proBotId}`, JSON.stringify(payload));
  } catch {
    // non-fatal
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async Log Buffer
// ─────────────────────────────────────────────────────────────────────────────
// Real-time terminal: logs are broadcast to Redis immediately (zero latency for UI).
// DB persistence: writes are batched and flushed every 2s via createMany (bulk insert).
// This cuts per-trade DB writes from 3–4 individual inserts down to a single batch,
// which dramatically reduces DB connection pressure under high concurrency.
// ─────────────────────────────────────────────────────────────────────────────
interface LogEntry {
  proBotId: number;
  message: string;
  level: LogLevel;
  createdAt: Date;
}

const logBuffer: LogEntry[] = [];
const LOG_FLUSH_MS = 2000;
const LOG_FLUSH_BATCH = 5000; // Increased from 100 to support 200+ concurrent bots

async function flushLogBuffer() {
  if (logBuffer.length === 0) return;
  // Flush up to 5000 logs at once to prevent memory leaks under heavy load
  const batch = logBuffer.splice(0, Math.min(logBuffer.length, LOG_FLUSH_BATCH));
  try {
    await prisma.proBotLog.createMany({ data: batch, skipDuplicates: true });
  } catch (err) {
    // Non-fatal — real-time terminal already received everything via Redis.
    console.error('[LogFlusher] Batch write failed:', (err as Error).message);
  }
}

// Background flush interval — `.unref()` so it doesn't prevent process exit
const flushInterval = setInterval(flushLogBuffer, LOG_FLUSH_MS);
if (typeof flushInterval.unref === 'function') flushInterval.unref();

// Flush remaining buffer on graceful shutdown
async function shutdownFlush() {
  clearInterval(flushInterval);
  await flushLogBuffer();
}
process.on('SIGTERM', shutdownFlush);
process.on('SIGINT', shutdownFlush);

export async function log(proBotId: number, message: string, level: LogLevel = "INFO") {
  // Buffer for async bulk DB write
  logBuffer.push({ proBotId, message, level, createdAt: new Date() });

  // Broadcast immediately for real-time terminal — fire-and-forget so trade
  // cycles aren't blocked waiting for Redis publish round-trips.
  broadcast(proBotId, {
    message_type: "log",
    log: `[${new Date().toLocaleTimeString()}] ${message}`,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// proBotConfig in-memory cache
// ─────────────────────────────────────────────────────────────────────────────
// Querying the config table on every single trade cycle is wasteful — the config
// changes very rarely. Cache it in-process and refresh every 60 seconds.
// ─────────────────────────────────────────────────────────────────────────────
let _cachedConfig: any = null;
let _configExpiry = 0;

async function getTradeConfig(): Promise<any> {
  if (_cachedConfig && Date.now() < _configExpiry) return _cachedConfig;
  _cachedConfig =
    (await prisma.proBotConfig.findFirst()) ??
    (await prisma.proBotConfig.create({ data: {} }));
  _configExpiry = Date.now() + 60_000; // Refresh every 60 seconds
  return _cachedConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade simulation
// ─────────────────────────────────────────────────────────────────────────────
function simulateTrade(tradeAmount: number, cfg: any) {
  const isWin = Math.random() < cfg.winRate;

  let pnl: number;
  if (cfg.fixedProfit) {
    if (isWin) {
      const pct = 0.18 + Math.random() * 0.07; // 18–25% return
      pnl = tradeAmount * pct;
    } else {
      const pct = 0.02 + Math.random() * 0.03; // 2–5% loss
      pnl = -(tradeAmount * pct);
    }
  } else {
    const basePct = isWin ? cfg.avgWinPct : cfg.avgLossPct;
    const variance = 1 + (Math.random() * 2 - 1) * cfg.payoutVarPct;
    const pct = Math.max(0.0001, basePct * variance);
    pnl = isWin ? tradeAmount * pct : -(tradeAmount * pct);
  }

  return {
    isWin,
    pnl: Math.round(pnl * 100) / 100,
    direction: Math.random() < 0.5 ? "BUY" : "SELL",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// executeTradeCycle — optimized
// ─────────────────────────────────────────────────────────────────────────────
// Changes vs original:
//  • Single DB read for bot + account + user.role (was two separate queries)
//  • proBotConfig uses in-memory cache (was a DB query every cycle)
//  • log() is non-blocking for DB (buffer + batch) — only Redis publish is awaited
// ─────────────────────────────────────────────────────────────────────────────
export async function executeTradeCycle(proBotId: number) {
  // Single query: bot + account + user role — eliminates the second findUnique call
  const bot = await prisma.proBot.findUnique({
    where: { id: proBotId },
    include: {
      account: true,
      user: { select: { role: true } },
    },
  });

  if (!bot || bot.status !== "RUNNING") return;

  const isMarketer = bot.user?.role === 'MARKETER';
  const cfg = isMarketer ? MARKETER_CONFIG : await getTradeConfig();

  const microStake = Math.max(1, Math.round(
    (bot.tradeAmount * (isMarketer
      ? (0.55 + Math.random() * 0.30)
      : (0.08 + Math.random() * 0.07)
    )) * 100
  ) / 100);

  const deducted = await prisma.account.updateMany({
    where: {
      id: bot.accountId,
      balance: { gte: microStake },
    },
    data: { balance: { decrement: microStake } },
  });

  if (deducted.count === 0) {
    const current = await prisma.account.findUnique({
      where: { id: bot.accountId },
      select: { balance: true },
    });
    const currentBalance = Number(current?.balance ?? 0);
    if (currentBalance < bot.tradeAmount) {
      await log(proBotId, `Balance $${currentBalance.toFixed(2)} below threshold — halting systems`, "ERROR");
      await stopProBot(proBotId);
    } else {
      await log(proBotId, `Insufficient balance for stake $${microStake.toFixed(2)} — skipping`, "WARN");
    }
    return;
  }

  const { isWin, pnl, direction } = simulateTrade(microStake, cfg);
  const entryPrice = 1 + (Math.random() - 0.5) * 0.002;
  const priceDeltaPct = pnl / microStake;
  const exitPrice = direction === "BUY"
    ? entryPrice * (1 + priceDeltaPct)
    : entryPrice * (1 - priceDeltaPct);
  
  const returnAmount = isWin
    ? microStake + pnl
    : isMarketer ? microStake + pnl : 0;
  const balanceDelta = pnl;
  const confidence = (60 + Math.random() * 35).toFixed(1);

  // Fire both pre-trade log broadcasts concurrently (Redis pubs, DB buffered)
  await Promise.all([
    log(proBotId, `Signal confirmed on ${bot.asset}: ${direction} bias detected (confidence ${confidence}%)`, "INFO"),
    log(proBotId, `[EXECUTION] → Opening ${direction} position on ${bot.asset} | Stake: $${microStake.toFixed(2)} @ ${entryPrice.toFixed(5)}`, "INFO"),
  ]);

  const [updatedBot, updatedAccount] = await prisma.$transaction([
    prisma.proBot.update({
      where: { id: proBotId },
      data: {
        tradeCount: { increment: 1 },
        wins: { increment: isWin ? 1 : 0 },
        profit: { increment: balanceDelta },
      },
    }),
    prisma.account.update({
      where: { id: bot.accountId },
      data: { balance: { increment: returnAmount } },
    }),
    prisma.trade.create({
      data: {
        userId: bot.userId,
        accountId: bot.accountId,
        proBotId: bot.id,
        asset: bot.asset,
        type: direction,
        stake: microStake,
        payout: returnAmount,
        duration: bot.tradeInterval,
        entryPrice,
        exitPrice,
        profit: balanceDelta,
        status: "COMPLETED",
        endTime: new Date(),
      },
    }),
  ]);

  const newBalance = Number(updatedAccount.balance);

  // Post-trade log + bot broadcast concurrently
  await Promise.all([
    log(
      proBotId,
      `[EXECUTION] ${isWin ? "✓ WIN" : "✗ LOSS"} — Closed ${direction} on ${bot.asset} @ ${exitPrice.toFixed(5)} | ${isWin ? `Profit: +$${pnl.toFixed(2)}` : `Loss: -$${Math.abs(pnl).toFixed(2)}`} | Balance: $${newBalance.toFixed(2)}`,
      isWin ? "SUCCESS" : "WARN"
    ),
    broadcast(proBotId, {
      message_type: "bot",
      data: { ...updatedBot, balance: newBalance },
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot lifecycle
// ─────────────────────────────────────────────────────────────────────────────
export async function activateProBot(proBotId: number) {
  const bot = await prisma.proBot.findUnique({
    where: { id: proBotId },
    include: { account: true },
  });

  if (!bot) throw new Error('Bot not found');
  if (Number(bot.account.balance) < bot.tradeAmount) {
    throw new Error(`Insufficient balance. Current balance: $${Number(bot.account.balance).toFixed(2)}`);
  }

  const updatedBot = await prisma.proBot.update({
    where: { id: proBotId },
    data: { status: 'RUNNING', activatedAt: new Date() },
  });

  await log(proBotId, '✓ Bot instance initialized', 'SUCCESS');

  const startedAt = Date.now();
  await tradeQueue.add(
    'trade-cycle',
    { proBotId, startedAt },
    {
      delay: 3000,
      jobId: `bot-${proBotId}-init-${startedAt}`,
    }
  );

  return updatedBot;
}

export async function stopProBot(proBotId: number) {
  const existing = await prisma.proBot.findUnique({ where: { id: proBotId } });
  if (!existing || existing.status !== "RUNNING") return;

  const bot = await prisma.proBot.update({
    where: { id: proBotId },
    data: { status: "STOPPED" },
    include: { account: true },
  });

  // Broadcast STOPPED status + log immediately so the frontend gets the
  // stop signal without any delay. This is the critical path.
  await Promise.all([
    log(proBotId, "⏹ AI Bot stopped", "WARN"),
    broadcast(proBotId, {
      message_type: "bot",
      data: { ...bot, balance: Number(bot.account.balance) },
    }),
  ]);

  // Drain pending/delayed queue jobs in background — fire-and-forget.
  // The worker's status check (bot.status !== 'RUNNING') is the real guard;
  // this is just cleanup to avoid stale jobs sitting in Redis.
  drainBotJobs(proBotId);

  return bot;
}

/** Background job cleanup — never blocks the HTTP response */
function drainBotJobs(proBotId: number) {
  tradeQueue.getJobs(['delayed', 'waiting'])
    .then(jobs =>
      Promise.all(
        jobs
          .filter(j => j.data?.proBotId === proBotId)
          .map(j => j.remove().catch(() => {}))
      )
    )
    .catch(() => {}); // Status already STOPPED — worker exits on next check
}

export async function resumeRunningProBots() {
  const running = await prisma.proBot.findMany({ where: { status: "RUNNING" } });
  const activeJobs = await tradeQueue.getJobs(['active', 'waiting', 'delayed']);
  const activeProBotIds = new Set(activeJobs.map(j => j.data?.proBotId).filter(Boolean));

  for (const bot of running) {
    if (activeProBotIds.has(bot.id)) continue;
    const startedAt = Date.now();
    await tradeQueue.add(
      'trade-cycle',
      { proBotId: bot.id, startedAt },
      { jobId: `bot-${bot.id}-resume-${startedAt}` }
    );
  }
}