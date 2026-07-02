import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { Coin } from '@prisma/client';
import { LoginInput, AuthResponse, UserDTO } from '../types/auth.types';
import { DepositSimulationService } from './depositSimulationService.js';
import { getOrCreateDepositAddress } from './depositService.js';
import { WithdrawalSimulationService } from './withdrawalSimulationService.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Critical Configuration Error: JWT_SECRET environment variable is missing.');
}

// 1. Define compile-time safe database return shapes using Prisma's type utilities
type DBUserWithRelations = Prisma.UserGetPayload<{
  include: { accounts: true };
}>;

/**
 * Data Transfer Object (DTO) to sanitize and transform database payloads 
 * securely before transmitting data to the client application layer.
 */
function toUserDTO(user: DBUserWithRelations): UserDTO {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    referralRate: Number(user.referralRate),
    kycStatus: user.kycStatus,
    idDocument: user.idDocument ?? null,
    createdAt: user.createdAt,
    accounts: (user.accounts ?? []).map((acc) => ({
      id: acc.id,
      type: acc.type,
      balance: Number(acc.balance),
      currency: acc.currency,
      createdAt: acc.createdAt,
    })),
  };
}

export class MarketerService {
    /**
     * Authenticates only MARKETER role users.
     */
    static async marketerLogin(credentials: LoginInput): Promise<AuthResponse> {
    const { email, password } = credentials;

    const user = await prisma.user.findUnique({
        where: { email },
        include: { accounts: true },
    });

    if (!user) throw new Error('INVALID_CREDENTIALS');
    if (user.status === 'SUSPENDED') throw new Error('ACCOUNT_SUSPENDED');
    if (user.role !== 'MARKETER') throw new Error('INSUFFICIENT_ROLE');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new Error('INVALID_CREDENTIALS');

    const token = jwt.sign(
        { userId: user.id, role: user.role },
        JWT_SECRET!,
        { expiresIn: '7d' }
    );

    return { user: toUserDTO(user), token };
    }

    static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user) throw new Error('User not found');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      accounts: user.accounts.map(a => ({ ...a, balance: Number(a.balance) }))
    };
  }

  static async getExternalWithdrawals(userId: string) {
    const virtualWallet = await prisma.virtualWallet.findUnique({
      where: { userId },
      select: { balance: true },
    });

    return { totalWithdrawals: Number(virtualWallet?.balance ?? 0) };
  }

  static async initiateDeposit(userId: string, currency: string, network: string, amount: number) {
    const result = await getOrCreateDepositAddress(userId, currency, network);

    const deposit = await prisma.deposit.create({
      data: {
        userId,
        depositAddressId: result.depositAddressId,
        coin: currency as Coin,
        network,
        txHash: `SIM_${userId}_${Date.now()}`,
        amount: new Prisma.Decimal(amount),
        usdValueAtCredit: new Prisma.Decimal(amount),
        status: 'PENDING',  // ← PENDING, not CREDITED
      },
    });

    DepositSimulationService.simulateMarketerProcessing(deposit.id, network);

    return {
      depositId: deposit.id,
      address: result.address,
      coin: result.coin,
      network: result.network,
      amount,
      qrData: result.address,
    };
  }

  // AFTER — confirmDeposit receives the real txHash from the app and THEN triggers simulation
  static async confirmDeposit(userId: string, body: any) {
    const addr = await prisma.depositAddress.findUnique({
      where: { userId_coin_network: { userId, coin: body.currency as Coin, network: body.network } },
    });
    if (!addr) throw new Error('No deposit address found for this coin/network.');

    // txHash comes from the real transaction the user broadcast from the mobile app
    if (!body.txHash) throw new Error('Transaction hash is required to confirm deposit.');

    const deposit = await prisma.deposit.create({
      data: {
        userId,
        depositAddressId: addr.id,
        coin: body.currency as Coin,
        network: body.network,
        txHash: body.txHash,   // real txHash from the app
        amount: body.amount,
        status: 'PENDING',
      },
    });

    // NOW trigger simulation — only fires because user actually sent from the app
    DepositSimulationService.simulateMarketerProcessing(deposit.id, body.network);

    return { depositId: deposit.id };
  }

  static async getDepositHistory(userId: string) {
    const list = await prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return list.map(d => ({
      id: d.id,
      currency: d.coin,
      amount: Number(d.amount),
      network: d.network,
      txHash: d.txHash,
      status: d.status,
      createdAt: d.createdAt.toISOString()
    }));
  }

  static async requestWithdrawal(userId: string, body: any) {
    const account = await prisma.account.findFirst({
      where: { userId, currency: 'USD' }
    });
    if (!account || Number(account.balance) < body.amount) {
      throw new Error('Insufficient balance');
    }

    // Capture the created withdrawal to get its ID
    let withdrawal: any;
    await prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: account.id },
        data: { balance: { decrement: body.amount } }
      });
      withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          accountId: account.id,
          amount: body.amount,
          coin: body.currency as Coin,
          network: body.network,
          toAddress: body.destinationAddress,
          status: 'PENDING'
        }
      });
    });

    // ← Now fire the simulation
    WithdrawalSimulationService.simulateMarketerProcessing(
      withdrawal.id,
      body.network
    );
  }

  static async getWithdrawalHistory(userId: string) {
    const list = await prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return list.map(w => ({
      id: w.id,
      currency: w.coin,
      amount: Number(w.amount),
      destinationAddress: w.toAddress,
      network: w.network,
      status: w.status,
      txHash: w.txHash ?? undefined,
      createdAt: w.createdAt.toISOString()
    }));
  }

  static async getTransactions(userId: string) {
    const [deposits, withdrawals] = await prisma.$transaction([
      prisma.deposit.findMany({ where: { userId } }),
      prisma.withdrawal.findMany({ where: { userId } })
    ]);

    const txs = [
      ...deposits.map(d => ({ id: d.id, type: 'DEPOSIT', amount: Number(d.amount), asset: d.coin, status: d.status, date: d.createdAt })),
      ...withdrawals.map(w => ({ id: w.id, type: 'WITHDRAWAL', amount: Number(w.amount), asset: w.coin, status: w.status, date: w.createdAt }))
    ];

    return txs.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  static async getReferrals(userId: string) {
    const referredUsers = await prisma.user.findMany({
      where: { referrerId: userId },
      include: { deposits: true }
    });

    const transformedReferrals = referredUsers.map(u => {
      const depositsByCurrency: Record<string, number> = {};
      u.deposits.forEach(d => {
        depositsByCurrency[d.coin] = (depositsByCurrency[d.coin] || 0) + Number(d.amount);
      });

      return {
        id: u.id,
        name: u.email.split('@')[0],
        joinedAt: u.createdAt.toISOString(),
        depositCount: u.deposits.length,
        depositsByCurrency
      };
    });

    return {
      referralCode: userId.substring(0, 8).toUpperCase(),
      referralLink: `https://aiscalpingpro.com/register?ref=${userId.substring(0, 8).toUpperCase()}`,
      totalReferred: referredUsers.length,
      referrals: transformedReferrals
    };
  }

  static async getNotifications(userId: string) {
    const auditLogs = await prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return {
      notifications: auditLogs.map(log => ({
        id: log.id,
        message: log.action,
        isRead: log.metadata === 'READ',
        createdAt: log.createdAt.toISOString()
      })),
      unreadCount: auditLogs.filter(log => log.metadata !== 'READ').length
    };
  }

  static async markAsRead(id: string) {
    await prisma.auditLog.update({
      where: { id },
      data: { metadata: 'READ' }
    });
  }
}