import { ProBotStatus } from "@prisma/client";
import { prisma } from "../prisma.js";

interface CreateBotInput {
  userId: string;
  accountId: string;
  name?: string;
  riskProfile?: string;
  tradeAmount?: number;
  tradeInterval?: number;
  asset?: string;
}

export class BotService {
  static async activateByPasskey(code: string, userId: string, accountId: string) {
    const passkeyRecord = await prisma.passkey.findUnique({
      where: { code }
    });

    if (!passkeyRecord) {
      throw new Error("Invalid activation passkey.");
    }

    let targetAccountId = accountId;
    if (!targetAccountId) {
      const defaultAccount = await prisma.account.findFirst({ where: { userId, type: "REAL" } });
      if (!defaultAccount) throw new Error("No active trade account found.");
      targetAccountId = defaultAccount.id;
    }

    return await prisma.proBot.upsert({
      where: {
        userId_version: { userId, version: passkeyRecord.version }
      },
      update: {},
      create: {
        userId,
        accountId: targetAccountId,
        version: passkeyRecord.version,
        name: `AI ScalpingPro Bot ${passkeyRecord.version}`,
        status: "IDLE"
      }
    });
  }

  static async getAllBots() {
    return prisma.proBot.findMany({
      include: {
        account: true,
        logs: { take: 5, orderBy: { createdAt: "desc" } }
      }
    });
  }

  static async getActiveBotByUserId(userId: string) {
    // Only fetch the bot + account. Trades and logs are fetched via their own
    // dedicated endpoints (/user/trades, /bot/:id/stats) — no need to over-fetch here.
    return prisma.proBot.findFirst({
      where: { userId },
      include: { account: true },
    });
  }

  static async getBotById(id: number) {
    return prisma.proBot.findUnique({
      where: { id },
      include: { account: true },
    });
  }

  static async getBotLogs(proBotId: number) {
    return prisma.proBotLog.findMany({
      where: { proBotId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  }

  static async createBot(data: CreateBotInput) {
    return prisma.proBot.create({
      data: {
        userId: data.userId,
        accountId: data.accountId,
        name: data.name ?? "AI ScalpingPro Bot",
        riskProfile: data.riskProfile ?? "balanced",
        tradeAmount: data.tradeAmount ?? 10,
        tradeInterval: data.tradeInterval ?? 60,
        asset: data.asset ?? "EUR/USD",
        status: "IDLE"
      }
    });
  }

  static async updateBotStatus(id: number, status: ProBotStatus) {
    return prisma.proBot.update({
      where: { id },
      data: { 
        status,
        activatedAt: status === "RUNNING" ? new Date() : undefined
      }
    });
  }

  static async getBotStats(id: number) {
    const bot = await prisma.proBot.findUnique({
      where: { id },
      select: {
        tradeCount: true,
        wins: true,
        profit: true,
        account: { select: { balance: true } },
      }
    });

    const winRate = bot?.tradeCount ? (bot.wins / bot.tradeCount) * 100 : 0;
    
    return {
      executions: bot?.tradeCount || 0,
      winRate: winRate.toFixed(1),
      pnl: bot?.profit || 0,
      balance: bot?.account?.balance || 0,
    };
  }

  static async updateBotSettings(id: number, settings: any) {
    return await prisma.proBot.update({
      where: { id },
      data: {
        tradeAmount: parseFloat(settings.tradeAmount),
        tradeInterval: parseInt(settings.tradeInterval),
        asset: settings.tradingAsset,
      }
    });
  }

  static async deleteBot(id: number) {
    return prisma.proBot.delete({
      where: { id }
    });
  }
}