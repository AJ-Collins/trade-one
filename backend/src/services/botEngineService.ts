import { LogLevel } from "@prisma/client";
import { tradeQueue, redisPub } from '../queues/tradeQueue.js';
import { prisma } from "../prisma.js";

// const MARKETER_CONFIG = {
//   winRate: 0.91,       // % win rate
//   avgWinPct: 0.028,    // % avg win
//   avgLossPct: 0.004,   // % avg loss
//   payoutVarPct: 0.08,   // low variance — consistent results
// } as const;
const MARKETER_CONFIG = {
  winRate: 0.91,
  fixedProfit: true,
} as const;

type Broadcaster = (proBotId: number, payload: any) => void;
let localBroadcast: Broadcaster = () => {};

export function setProBotBroadcaster(fn: Broadcaster) {
  localBroadcast = fn;
}

// Unified broadcast: calls local WS sender (API process) + publishes to Redis (worker process)
// The API server's redisSub will receive the Redis message and call sendToSubscribers again,
// so localBroadcast is intentionally a no-op in the worker process (never set there).
export async function broadcast(proBotId: number, payload: any) {
  localBroadcast(proBotId, payload);
  try {
    await redisPub.publish(`probot:${proBotId}`, JSON.stringify(payload));
  } catch {
    // non-fatal
  }
}

// function simulateTrade(tradeAmount: number, cfg: any) {
//   const isWin = Math.random() < cfg.winRate;
//   const basePct = isWin ? cfg.avgWinPct : cfg.avgLossPct;
//   const variance = 1 + (Math.random() * 2 - 1) * cfg.payoutVarPct;
//   const pct = Math.max(0.0001, basePct * variance);
//   const pnl = isWin ? tradeAmount * pct : -tradeAmount * pct;
//   const direction = Math.random() < 0.5 ? "BUY" : "SELL";
//   return { isWin, pnl: Math.round(pnl * 100) / 100, direction };
// }

function simulateTrade(tradeAmount: number, cfg: any) {
  const isWin = Math.random() < cfg.winRate;

  let pnl: number;

  if (cfg.fixedProfit) {
    if (isWin) {
      // 18–25% return on the stake
      const pct = 0.18 + Math.random() * 0.07;
      pnl = tradeAmount * pct;
    } else {
      // 2–5% loss on the stake
      const pct = 0.02 + Math.random() * 0.03;
      pnl = -(tradeAmount * pct);
    }
  } else {
    const basePct = isWin ? cfg.avgWinPct : cfg.avgLossPct;
    const variance = 1 + (Math.random() * 2 - 1) * cfg.payoutVarPct;
    const pct = Math.max(0.0001, basePct * variance);

    pnl = isWin
      ? tradeAmount * pct
      : -(tradeAmount * pct);
  }

  return {
    isWin,
    pnl: Math.round(pnl * 100) / 100,
    direction: Math.random() < 0.5 ? "BUY" : "SELL",
  };
}

export async function log(proBotId: number, message: string, level: LogLevel = "INFO") {
  const entry = await prisma.proBotLog.create({
    data: { proBotId, message, level }
  });
  await broadcast(proBotId, { 
    message_type: "log", 
    log: `[${new Date().toLocaleTimeString()}] ${message}` 
  });
  return entry;
}

export async function executeTradeCycle(proBotId: number) {
  const bot = await prisma.proBot.findUnique({
    where: { id: proBotId },
    include: { account: true }
  });

  if (!bot || bot.status !== "RUNNING") return;

  const userRole = await prisma.user.findUnique({
    where: { id: bot.userId },
    select: { role: true },
  });

  const cfg = userRole?.role === 'MARKETER'
    ? MARKETER_CONFIG
    : (await prisma.proBotConfig.findFirst() ?? await prisma.proBotConfig.create({ data: {} }));

  const isMarketer = userRole?.role === 'MARKETER';
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
  const exitPrice = entryPrice + (pnl / microStake) * entryPrice;
  const returnAmount = isWin
    ? microStake + pnl
    : isMarketer ? microStake + pnl : 0;
  const balanceDelta = pnl;
  const confidence = (60 + Math.random() * 35).toFixed(1);

  await log(proBotId, `Signal confirmed on ${bot.asset}: ${direction} bias detected (confidence ${confidence}%)`, "INFO");
  await log(proBotId, `[EXECUTION] → Opening ${direction} position on ${bot.asset} | Stake: $${microStake.toFixed(2)} @ ${entryPrice.toFixed(5)}`, "INFO");

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
        type: isWin ? "WIN" : "LOSS",
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
  await log(
    proBotId,
    `[EXECUTION] ${isWin ? "✓ WIN" : "✗ LOSS"} — Closed ${direction} on ${bot.asset} @ ${exitPrice.toFixed(5)} | ${isWin ? `Profit: +$${pnl.toFixed(2)}` : `Loss: -$${Math.abs(pnl).toFixed(2)}`} | Balance: $${newBalance.toFixed(2)}`,
    isWin ? "SUCCESS" : "WARN"
  );

  await broadcast(proBotId, {
    message_type: "bot",
    data: { ...updatedBot, balance: newBalance }
  });
}

export async function activateProBot(proBotId: number) {
  const bot = await prisma.proBot.findUnique({
    where: { id: proBotId },
    include: { account: true },
  });

  if (!bot) throw new Error('Bot not found');
  if (Number(bot.account.balance) < bot.tradeAmount) {
    throw new Error(`Insufficient balance. Current balance: $${Number(bot.account.balance).toFixed(2)}`);
  }

  await prisma.proBot.update({
    where: { id: proBotId },
    data: { status: "RUNNING", activatedAt: new Date() },
  });

  await log(proBotId, "✓ Bot instance initialized", "SUCCESS");

  const startedAt = Date.now();

  // Use jobId that won't conflict with subsequent ticks
  await tradeQueue.add(
    'trade-cycle',
    { proBotId, startedAt },
    { 
      delay: 3000,
      jobId: `bot-${proBotId}-init-${startedAt}`,
    }
  );
}

export async function stopProBot(proBotId: number) {
  // Mark stopped FIRST — this causes in-flight worker jobs to exit early on status check
  const existing = await prisma.proBot.findUnique({ where: { id: proBotId } });
  if (!existing || existing.status !== "RUNNING") return;

  const bot = await prisma.proBot.update({
    where: { id: proBotId },
    data: { status: "STOPPED" },
    include: { account: true },
  });

  // Drain pending/delayed queue jobs AFTER marking stopped
  try {
    const jobs = await tradeQueue.getJobs(['delayed', 'waiting']);
    await Promise.all(
      jobs
        .filter(j => j.data?.proBotId === proBotId)
        .map(j => j.remove().catch(() => {}))
    );
  } catch {
    // non-fatal — status is already STOPPED so worker will exit on next check
  }

  await log(proBotId, "⏹ AI Bot stopped", "WARN");
  await broadcast(proBotId, { 
    message_type: "bot", 
    data: { ...bot, balance: Number(bot.account.balance) } 
  });
  return bot;
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