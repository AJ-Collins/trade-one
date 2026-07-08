import { Passkey, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import speakeasy from 'speakeasy';
import bcrypt from 'bcryptjs';
import { encrypt, decrypt } from '../utils/crypto.js';
import { clearConfigCache } from '../utils/configLoader.js';
import { generateDepositAddress } from '../utils/addressGenerator.js';
import { calculateGasFee } from '../utils/gasFees.js';
import { SupportedNetwork } from '../config/networks.js';


// Canonical list of all configurable keys with metadata
export const SYSTEM_CONFIG_DEFINITIONS = [
  // EVM
  { key: 'HOT_WALLET_ADDRESS',          label: 'EVM Hot Wallet Address',          group: 'EVM',       isSensitive: false },
  { key: 'HOT_WALLET_PRIVATE_KEY',      label: 'EVM Hot Wallet Private Key',      group: 'EVM',       isSensitive: true  },
  { key: 'ETH_MAINNET_RPC',             label: 'ETH Mainnet RPC URL',             group: 'EVM',       isSensitive: false },
  { key: 'BSC_MAINNET_RPC',             label: 'BSC Mainnet RPC URL',             group: 'EVM',       isSensitive: false },
  { key: 'POLYGON_MAINNET_RPC',         label: 'Polygon Mainnet RPC URL',         group: 'EVM',       isSensitive: false },
  { key: 'ARBITRUM_MAINNET_RPC',        label: 'Arbitrum Mainnet RPC URL',        group: 'EVM',       isSensitive: false },
  // Token Contracts
  { key: 'ETH_MAINNET_USDT_CONTRACT',   label: 'ETH Mainnet USDT Contract',       group: 'CONTRACTS', isSensitive: false },
  { key: 'ETH_MAINNET_USDC_CONTRACT',   label: 'ETH Mainnet USDC Contract',       group: 'CONTRACTS', isSensitive: false },
  { key: 'BSC_MAINNET_USDT_CONTRACT',   label: 'BSC Mainnet USDT Contract',       group: 'CONTRACTS', isSensitive: false },
  { key: 'BSC_MAINNET_USDC_CONTRACT',   label: 'BSC Mainnet USDC Contract',       group: 'CONTRACTS', isSensitive: false },
  { key: 'POLYGON_USDT_CONTRACT',       label: 'Polygon USDT Contract',           group: 'CONTRACTS', isSensitive: false },
  { key: 'POLYGON_USDC_CONTRACT',       label: 'Polygon USDC Contract',           group: 'CONTRACTS', isSensitive: false },
  { key: 'ARBITRUM_USDT_CONTRACT',      label: 'Arbitrum USDT Contract',          group: 'CONTRACTS', isSensitive: false },
  { key: 'ARBITRUM_USDC_CONTRACT',      label: 'Arbitrum USDC Contract',          group: 'CONTRACTS', isSensitive: false },
  // BTC
  { key: 'HOT_WALLET_BTC_ADDRESS',      label: 'BTC Hot Wallet Address',          group: 'BTC',       isSensitive: false },
  // SOL
  { key: 'HELIUS_RPC_URL',              label: 'Helius RPC URL',                  group: 'SOL',       isSensitive: false },
  { key: 'HOT_WALLET_SOL_ADDRESS',      label: 'SOL Hot Wallet Address',          group: 'SOL',       isSensitive: false },
  // TON
  { key: 'TONCENTER_API_URL',           label: 'TONCenter API URL',               group: 'TON',       isSensitive: false },
  { key: 'TONCENTER_API_KEY',           label: 'TONCenter API Key',               group: 'TON',       isSensitive: true  },
  { key: 'HOT_WALLET_TON_ADDRESS',      label: 'TON Hot Wallet Address',          group: 'TON',       isSensitive: false },
  // TRON
  { key: 'TRON_RPC',                    label: 'Tron RPC URL',                    group: 'TRON',      isSensitive: false },
  { key: 'TRONGRID_API_KEY',            label: 'TronGrid API Key',                group: 'TRON',      isSensitive: true  },
  { key: 'HOT_WALLET_TRX_ADDRESS',      label: 'TRX Hot Wallet Address',          group: 'TRON',      isSensitive: false },
  { key: 'HOT_WALLET_TRX_PRIVATE_KEY',  label: 'TRX Hot Wallet Private Key',      group: 'TRON',      isSensitive: true  },
  // HD Wallet
  { key: 'MASTER_MNEMONIC',             label: 'Master Mnemonic (HD Wallet)',     group: 'HD_WALLET', isSensitive: true  },
  // Alchemy
  { key: 'ALCHEMY_AUTH_TOKEN',          label: 'Alchemy Auth Token',              group: 'API_KEYS',  isSensitive: true  },
  { key: 'ALCHEMY_SIGNING_KEY',         label: 'Alchemy Signing Key',             group: 'API_KEYS',  isSensitive: true  },
  { key: 'ALCHEMY_WEBHOOK_ETH_MAINNET', label: 'Alchemy Webhook — ETH Mainnet',  group: 'API_KEYS',  isSensitive: false },
  { key: 'ALCHEMY_WEBHOOK_BSC_MAINNET', label: 'Alchemy Webhook — BSC Mainnet',  group: 'API_KEYS',  isSensitive: false },
  { key: 'ALCHEMY_WEBHOOK_POLYGON',     label: 'Alchemy Webhook — Polygon',      group: 'API_KEYS',  isSensitive: false },
  { key: 'ALCHEMY_WEBHOOK_ARBITRUM',    label: 'Alchemy Webhook — Arbitrum',     group: 'API_KEYS',  isSensitive: false },
] as const;

export type SystemConfigKey = typeof SYSTEM_CONFIG_DEFINITIONS[number]['key'];

export class AdminService {
  // Passkey
  /**
   * Generates a unique AI-XXX-BOT key.
   * Returns a Promise<Passkey>
   */
  static async generatePasskey(version: string, label: string): Promise<Passkey> {
    const generateAlphanumericWithNumber = (): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 3; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      if (!/\d/.test(result)) {
        const randomPos = Math.floor(Math.random() * 3);
        const randomNum = Math.floor(Math.random() * 10);
        result = result.substring(0, randomPos) + randomNum + result.substring(randomPos + 1);
      }

      return result;
    };

    const code = `AI-${generateAlphanumericWithNumber()}-BOT`;

    try {
      return await prisma.passkey.create({
        data: { code, version, label }
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return this.generatePasskey(version, label);
      }
      throw error;
    }
  }

  static async deletePasskey(id: string) {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
        throw new Error("Invalid Passkey ID format");
    }
    return await prisma.passkey.delete({
        where: { id: numericId }
    });
    }

  static async getAllPasskeys() {
    return prisma.passkey.findMany({ include: { user: true, proBot: true } });
  }

  // Bot Configuration
  static async updateBotConfig(data: { winRate: number; avgWinPct: number; avgLossPct: number; payoutVarPct: number }) {
    return prisma.proBotConfig.upsert({
      where: { id: 1 },
      update: data,
      create: { ...data }
    });
  }

  static async getBotConfig() {
    return prisma.proBotConfig.findFirst() || prisma.proBotConfig.create({ data: {} });
  }

  static async getWithdrawalConfig() {
    return prisma.withdrawalConfig.findFirst() || prisma.withdrawalConfig.create({ data: {} });
  }

  static async updateWithdrawalConfig(data: { minWithdrawalAmount: number }) {
    return prisma.withdrawalConfig.upsert({
      where: { id: 1 },
      update: data,
      create: { ...data }
    });
  }

  static async getDashboardStats() {
    const [
      totalUsers,
      activeMarketers,
      tradesToday,
      pendingDeposits,
      pendingWithdrawals,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'MARKETER', status: 'ACTIVE' } }),
      prisma.trade.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: 'COMPLETED',
        },
      }),
      prisma.deposit.aggregate({
        where: { status: 'PENDING' },
        _sum: { usdValueAtCredit: true },
        _count: true,
      }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
    ]);

    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const yesterday = new Date(todayStart);
    yesterday.setDate(yesterday.getDate() - 1);

    const [newUsersToday, newUsersYesterday] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({
        where: { createdAt: { gte: yesterday, lt: todayStart } },
      }),
    ]);

    return {
      totalUsers,
      activeMarketers,
      tradesToday,
      pendingDepositsAmount: Number(pendingDeposits._sum.usdValueAtCredit ?? 0),
      pendingDepositsCount: pendingDeposits._count,
      pendingWithdrawals,
      newUsersToday,
      newUsersYesterday,
    };
  }

  static async getRecentActivity() {
    const [recentDeposits, recentWithdrawals, recentUsers] = await Promise.all([
      prisma.deposit.findMany({
        where: { status: { in: ['CREDITED', 'PENDING'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { email: true } } },
      }),
      prisma.withdrawal.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { email: true } } },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { email: true, createdAt: true },
      }),
    ]);

    const activity = [
      ...recentDeposits.map(d => ({
        id: d.id,
        type: 'deposit',
        user: d.user.email,
        detail: `Deposited $${Number(d.usdValueAtCredit ?? 0).toFixed(2)} via ${d.coin} (${d.network})`,
        time: d.createdAt,
      })),
      ...recentWithdrawals.map(w => ({
        id: w.id,
        type: 'withdrawal',
        user: w.user.email,
        detail: `Withdrew $${Number(w.amount).toFixed(2)} via ${w.coin}`,
        time: w.createdAt,
      })),
      ...recentUsers.map(u => ({
        id: u.email,
        type: 'signup',
        user: u.email,
        detail: 'New user registered',
        time: u.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10);

    return activity;
  }

  static async getAllUsers(search?: string) {
    return prisma.user.findMany({
      where: search ? {
        email: { contains: search, mode: 'insensitive' }
      } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        kycStatus: true,
        createdAt: true,
        accounts: {
          where: { type: 'REAL' },
          select: { balance: true, currency: true },
        },
      },
    });
  }

  static async createUser(data: {
    email: string;
    password: string;
    role: string;
    balance?: number;
  }) {
    const hashed = await bcrypt.hash(data.password, 10);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashed,
          role: data.role as any,
        },
      });

      await tx.account.create({
        data: {
          userId: user.id,
          type: 'REAL',
          balance: data.balance ?? 0,
          currency: 'USD',
        },
      });

      return user;
    });
  }

  static async updateUser(id: string, data: {
    email?: string;
    role?: string;
    balance?: number;
    password?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (data.email) updateData.email = data.email;
      if (data.role) updateData.role = data.role;
      if (data.password) updateData.password = await bcrypt.hash(data.password, 10);

      const user = await tx.user.update({
        where: { id },
        data: updateData,
      });

      if (data.balance !== undefined) {
        await tx.account.updateMany({
          where: { userId: id, type: 'REAL' },
          data: { balance: data.balance },
        });
      }

      return user;
    });
  }

  static async toggleUserStatus(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!user) throw new Error('User not found');

    return prisma.user.update({
      where: { id },
      data: { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
    });
  }

  static async deleteUser(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.proBotLog.deleteMany({
        where: { proBot: { userId: id } },
      });
      await tx.trade.deleteMany({ where: { userId: id } });
      await tx.proBot.deleteMany({ where: { userId: id } });
      await tx.passkey.deleteMany({ where: { userId: id } });
      await tx.withdrawal.deleteMany({ where: { userId: id } });
      await tx.deposit.deleteMany({ where: { userId: id } });
      await tx.depositAddress.deleteMany({ where: { userId: id } });
      await tx.account.deleteMany({ where: { userId: id } });
      await tx.auditLog.deleteMany({ where: { userId: id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: id } });
      return tx.user.delete({ where: { id } });
    });
  }

  static async getAllMarketers() {
    const marketers = await prisma.user.findMany({
      where: { role: 'MARKETER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        referralRate: true,
        createdAt: true,
        referredUsers: {
          select: { id: true },
        },
        accounts: {
          where: { type: 'REAL' },
          select: { balance: true, currency: true },
        },
        virtualWallet: {
          select: { balance: true },
        },
      },
    });

    return marketers.map(m => ({
      id: m.id,
      email: m.email,
      status: m.status,
      referralRate: Number(m.referralRate),
      referrals: m.referredUsers.length,
      earnings: Number(m.accounts[0]?.balance ?? 0),
      accountBalance: Number(m.virtualWallet?.balance ?? 0),
      currency: m.accounts[0]?.currency ?? 'USD',
      createdAt: m.createdAt,
    }));
  }

  static async getMarketerStats() {
    const [total, totalReferrals, totalEarnings] = await Promise.all([
      prisma.user.count({ where: { role: 'MARKETER' } }),
      prisma.user.count({ where: { referrerId: { not: null } } }),
      prisma.account.aggregate({
        where: {
          type: 'REAL',
          user: { role: 'MARKETER' },
        },
        _sum: { balance: true },
      }),
    ]);

    return {
      total,
      totalReferrals,
      totalEarnings: Number(totalEarnings._sum.balance ?? 0),
    };
  }

  static async updateMarketerRate(id: string, referralRate: number) {
    if (referralRate < 0 || referralRate > 100) {
      throw new Error('Referral rate must be between 0 and 100');
    }
    return prisma.user.update({
      where: { id },
      data: { referralRate },
    });
  }

  static async getAllTrades(search?: string, page = 1, limit = 10) {
    const where = search ? {
      OR: [
        { user: { email: { contains: search, mode: 'insensitive' as const } } },
        { asset: { contains: search, mode: 'insensitive' as const } },
      ],
    } : {};

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { email: true } },
        },
      }),
      prisma.trade.count({ where }),
    ]);

    return {
      trades: trades.map(t => ({
        id: t.id,
        user: t.user.email,
        asset: t.asset,
        type: t.type,
        stake: Number(t.stake),
        payout: Number(t.payout),
        profit: Number(t.profit ?? 0),
        entryPrice: Number(t.entryPrice),
        exitPrice: Number(t.exitPrice ?? 0),
        status: t.status,
        startTime: t.startTime,
        endTime: t.endTime,
        createdAt: t.createdAt,
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    };
  }

  static async getTradeStats() {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

    const [total, todayCount, winCount, volumeResult, profitResult] = await Promise.all([
      prisma.trade.count({ where: { status: 'COMPLETED' } }),
      prisma.trade.count({
        where: { status: 'COMPLETED', createdAt: { gte: todayStart } },
      }),
      prisma.trade.count({ where: { type: 'WIN', status: 'COMPLETED' } }),
      prisma.trade.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { stake: true },
      }),
      prisma.trade.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { profit: true },
      }),
    ]);

    const winRate = total > 0 ? ((winCount / total) * 100).toFixed(1) : '0.0';

    return {
      total,
      todayCount,
      winRate,
      totalVolume: Number(volumeResult._sum.stake ?? 0),
      totalProfit: Number(profitResult._sum.profit ?? 0),
    };
  }

  static async getAllDeposits(search?: string, page = 1, limit = 10) {
  const where = search ? {
    user: { email: { contains: search, mode: 'insensitive' as const } },
  } : {};

  const [deposits, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { email: true } },
        depositAddress: { select: { address: true } },
      },
    }),
    prisma.deposit.count({ where }),
  ]);

  return {
    deposits: deposits.map(d => ({
      id: d.id,
      user: d.user.email,
      coin: d.coin,
      network: d.network,
      amount: Number(d.amount),
      usdValue: Number(d.usdValueAtCredit ?? 0),
      status: d.status,
      txHash: d.txHash,
      sweptTx: d.sweptTx,
      sweptAt: d.sweptAt,
      address: d.depositAddress.address,
      creditedAt: d.creditedAt,
      createdAt: d.createdAt,
    })),
    total,
    totalPages: Math.ceil(total / limit),
    page,
  };
}

static async getDepositStats() {
  const [total, credited, pending, failed, swept, volumeResult] = await Promise.all([
    prisma.deposit.count(),
    prisma.deposit.count({ where: { status: 'CREDITED' } }),
    prisma.deposit.count({ where: { status: 'PENDING' } }),
    prisma.deposit.count({ where: { status: 'FAILED' } }),
    prisma.deposit.count({ where: { status: 'SWEPT' } }),
    prisma.deposit.aggregate({
      where: { status: { in: ['CREDITED', 'SWEPT'] } },
      _sum: { usdValueAtCredit: true },
    }),
  ]);

  return {
    total,
    credited,
    pending,
    failed,
    swept,
    totalVolume: Number(volumeResult._sum.usdValueAtCredit ?? 0),
  };
}

static async retryFailedDeposit(depositId: string) {
  const deposit = await prisma.deposit.findUnique({
    where: { id: depositId },
    include: { depositAddress: true },
  });

  if (!deposit) throw new Error('Deposit not found');
  if (deposit.status !== 'FAILED' && deposit.status !== 'PENDING') {
    throw new Error('Only FAILED or PENDING deposits can be retried');
  }

  const usdValue = Number(deposit.usdValueAtCredit ?? 0);
  if (usdValue <= 0) throw new Error('No USD value to credit — update usdValueAtCredit first');

  return prisma.$transaction([
    prisma.deposit.update({
      where: { id: depositId },
      data: { status: 'CREDITED', creditedAt: new Date() },
    }),
    prisma.account.update({
      where: { userId_type: { userId: deposit.userId, type: 'REAL' } },
      data: { balance: { increment: usdValue } },
    }),
  ]);
}

static async getAllWithdrawals(page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const [withdrawals, total] = await Promise.all([
    prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.withdrawal.count(),
  ]);

  return {
    withdrawals: withdrawals.map(w => ({
      id: w.id,
      user: w.user.email,
      userId: w.user.id,
      amount: Number(w.amount),
      coin: w.coin,
      network: w.network,
      toAddress: w.toAddress,
      status: w.status,
      txHash: w.txHash,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

static async getWithdrawalStats() {
  const [total, pending, approved, completed, rejected, volumeResult] = await Promise.all([
    prisma.withdrawal.count(),
    prisma.withdrawal.count({ where: { status: 'PENDING' } }),
    prisma.withdrawal.count({ where: { status: 'APPROVED' } }),
    prisma.withdrawal.count({ where: { status: 'COMPLETED' } }),
    prisma.withdrawal.count({ where: { status: 'REJECTED' } }),
    prisma.withdrawal.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
  ]);

  return {
    total,
    pending,
    approved,
    completed,
    rejected,
    totalVolume: Number(volumeResult._sum.amount ?? 0),
  };
}

static async updateWithdrawalStatus(withdrawalId: string, status: string, txHash?: string) {
  const updateData: any = { status };
  if (txHash) updateData.txHash = txHash;

  const withdrawal = await prisma.withdrawal.update({
    where: { id: withdrawalId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      action: 'WITHDRAWAL_STATUS_UPDATED',
      metadata: JSON.stringify({
        withdrawalId: withdrawal.id,
        status,
        txHash,
      }),
    },
  });

  return withdrawal;
}

static async getAdminProfile(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, createdAt: true },
  });
  if (!user) throw new Error('User not found');
  return user;
}

static async updateAdminProfile(id: string, data: { email?: string }) {
  try {
    return await prisma.user.update({
      where: { id },
      select: { id: true, email: true, role: true, createdAt: true },
      data: { ...(data.email && { email: data.email.toLowerCase().trim() }) },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      throw new Error('Email already in use');
    }
    throw err;
  }
}

static async updateAdminPassword(id: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { password: true } });
  if (!user) throw new Error('User not found');

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new Error('Current password is incorrect');

  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');

  const hashed = await bcrypt.hash(newPassword, 12);
  return prisma.user.update({ where: { id }, data: { password: hashed } });
}

static async manualCreditDeposit(data: {
  txHash: string;
  usdValue: number;
}) {
  const existing = await prisma.deposit.findUnique({
    where: { txHash: data.txHash },
  });
  if (existing) {
    return { alreadyCredited: true, deposit: existing };
  }

  const { ethers } = await import('ethers');

  const { getConfig } = await import('../utils/configLoader.js');

  const RPC_MAP: Record<string, string | null> = {
    eth_mainnet:      await getConfig('ETH_MAINNET_RPC'),
    bsc_mainnet:      await getConfig('BSC_MAINNET_RPC'),
    polygon_mainnet:  await getConfig('POLYGON_MAINNET_RPC'),
    arbitrum_mainnet: await getConfig('ARBITRUM_MAINNET_RPC'),
  };

  let foundTx: any = null;
  let foundNetwork: string | null = null;

  for (const [network, rpcUrl] of Object.entries(RPC_MAP)) {
    if (!rpcUrl) continue;
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const tx = await provider.getTransaction(data.txHash);
      if (tx?.to) {
        foundTx = tx;
        foundNetwork = network;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!foundTx || !foundNetwork) {
    throw new Error('Transaction not found on any supported network. Verify the tx hash is correct.');
  }

  const toAddress = foundTx.to.toLowerCase();
  const amountCrypto = parseFloat(ethers.utils.formatEther(foundTx.value));

  const depositAddr = await prisma.depositAddress.findFirst({
    where: {
      address: { equals: toAddress, mode: 'insensitive' },
      network: foundNetwork,
    },
  });

  if (!depositAddr) {
    throw new Error(
      `Address ${foundTx.to} on ${foundNetwork} is not registered in our system. This tx may belong to an external wallet.`
    );
  }

  const [deposit] = await prisma.$transaction([
    prisma.deposit.create({
      data: {
        userId: depositAddr.userId,
        depositAddressId: depositAddr.id,
        coin: depositAddr.coin,
        network: foundNetwork,
        txHash: data.txHash,
        amount: amountCrypto,
        usdValueAtCredit: data.usdValue,
        status: 'CREDITED',
        creditedAt: new Date(),
      },
    }),
    prisma.account.update({
      where: { userId_type: { userId: depositAddr.userId, type: 'REAL' } },
      data: { balance: { increment: data.usdValue } },
    }),
  ]);

  return {
    alreadyCredited: false,
    deposit,
    userId: depositAddr.userId,
    coin: depositAddr.coin,
    network: foundNetwork,
    toAddress: foundTx.to,
    amountCrypto,
    usdValue: data.usdValue,
  };
}

  /**
   * Admin-triggered deposit backfill. Processes up to 20 tx hashes on the
   * given network, credits any matched watched addresses, and creates an
   * audit trail recording which admin triggered it and what the results were.
   */
  static async backfillDeposits(
    adminId: string,
    network: SupportedNetwork,
    txHashes: string[],
  ) {
    const { backfillDepositTx } = await import('./backfillDepositService.js');

    const results: any[] = [];
    for (const txHash of txHashes) {
      try {
        const result = await backfillDepositTx(network, txHash);
        results.push(result);
      } catch (err: any) {
        results.push({ txHash, network, status: 'error', error: err.message, credits: [] });
      }
    }

    // Audit trail — who ran this backfill and what it did. Cheap insurance
    // given this path can move money.
    await prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'DEPOSIT_BACKFILL',
        metadata: JSON.stringify({ network, txHashes, results }),
      },
    });

    return results;
  }

  // System settings configs
  static async getSystemConfigs() {
    const rows = await prisma.systemConfig.findMany();
    const rowMap = new Map(rows.map(r => [r.key, r]));

    return SYSTEM_CONFIG_DEFINITIONS.map(def => {
      const row = rowMap.get(def.key);
      return {
        key:         def.key,
        label:       def.label,
        group:       def.group,
        isSensitive: def.isSensitive,
        isSet:       !!row,
        updatedAt:   row?.updatedAt ?? null,
        // Never return actual value here — UI must call reveal endpoint
      };
    });
  }

  static async revealSystemConfig(key: string): Promise<string> {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (!row) {
      // Fall back to process.env
      return process.env[key] ?? '';
    }
    return row.isSensitive ? decrypt(row.value) : row.value;
  }

  static async upsertSystemConfig(key: string, value: string): Promise<void> {
    const def = SYSTEM_CONFIG_DEFINITIONS.find(d => d.key === key);
    if (!def) throw new Error(`Unknown config key: ${key}`);

    const storedValue = def.isSensitive ? encrypt(value) : value;

    await prisma.systemConfig.upsert({
      where:  { key },
      update: { value: storedValue, isSensitive: def.isSensitive, label: def.label, group: def.group },
      create: { key, value: storedValue, isSensitive: def.isSensitive, label: def.label, group: def.group },
    });

    clearConfigCache(key);
  }

  static async upsertSystemConfigsBulk(entries: { key: string; value: string }[]): Promise<void> {
    for (const entry of entries) {
      await this.upsertSystemConfig(entry.key, entry.value);
    }
  }

  static async setup2FA(userId: string) {
    const secret = speakeasy.generateSecret({ name: 'AIScalpingPro Admin', length: 20 });
    
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret.base32 },
    });

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
    };
  }

  static async enable2FA(userId: string, totpCode: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) {
      throw new Error('Run /setup first');
    }

    const valid = speakeasy.totp.verify({
      secret:   user.twoFactorSecret,
      encoding: 'base32',
      token:    totpCode,
      window:   1,
    });

    if (!valid) throw new Error('Invalid 2FA code');

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
  }

  static async setMarketerPayout(marketerId: string, amount: number) {
    const user = await prisma.user.findUnique({ where: { id: marketerId } });
    if (!user) throw new Error('User not found');
    if (user.role !== 'MARKETER') throw new Error('User is not a marketer');

    if (amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    const newBalance = new Prisma.Decimal(amount);

    return prisma.$transaction(async (tx) => {
      const walletRows = await tx.$queryRaw<{ id: string; balance: Prisma.Decimal }[]>`
        SELECT id, balance FROM "VirtualWallet" WHERE "userId" = ${marketerId} FOR UPDATE
      `;

      let walletId = walletRows[0]?.id;
      const previousBalance = walletRows[0]?.balance ?? new Prisma.Decimal(0);

      if (!walletId) {
        const created = await tx.virtualWallet.create({
          data: { userId: marketerId, balance: new Prisma.Decimal(0) },
        });
        walletId = created.id;
      }

      const updatedWallet = await tx.virtualWallet.update({
        where: { id: walletId },
        data: { balance: newBalance },
      });

      await tx.virtualWalletTransaction.create({
        data: {
          walletId,
          type: 'CREDIT',
          amount: newBalance,
          balanceAfter: updatedWallet.balance,
          description: `Admin payout set (previous balance $${previousBalance})`,
          referenceId: marketerId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: marketerId,
          action: 'ADMIN_MARKETER_PAYOUT',
          metadata: JSON.stringify({
            amount,
            previousBalance: previousBalance.toString(),
            newWalletBalance: updatedWallet.balance.toString(),
            finalizedAt: new Date().toISOString(),
          }),
        },
      });

      return {
        walletId,
        setAmount: amount,
        previousBalance: Number(previousBalance),
        newBalance: Number(updatedWallet.balance),
      };
    });
  }
}