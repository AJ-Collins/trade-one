import { prisma } from '../prisma.js';
import { Prisma } from '@prisma/client';
import { WithdrawalSimulationService } from './withdrawalSimulationService.js';
import { calculateGasFee } from '../utils/gasFees.js';
import { enqueueEmail } from '../queues/emailQueue.js';

const MINIMUM_WITHDRAWAL = new Prisma.Decimal(500);

export class WithdrawalService {
  static async validateWithdrawalEligibility(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, kycStatus: true },
    });

    if (!user) throw new Error('User not found');
    if (user.role === 'ADMIN') throw new Error('Admins cannot withdraw');

    if (user.role === 'MARKETER') {
      return { eligible: true, requiresKYC: false };
    }

    if (user.kycStatus !== 'VERIFIED') {
      throw new Error(
        `KYC verification required. Current status: ${user.kycStatus}. Submit KYC documents to proceed.`
      );
    }

    return { eligible: true, requiresKYC: true };
  }

  static async requestWithdrawal(data: {
    userId: string;
    accountId: string;
    amount: Prisma.Decimal | string;
    coin: string;
    network: string;
    toAddress: string;
  }) {
    const amount = new Prisma.Decimal(data.amount);

    if (amount.lessThan(MINIMUM_WITHDRAWAL)) {
      throw new Error(`Minimum withdrawal amount is $${MINIMUM_WITHDRAWAL}`);
    }

    const [user, account] = await Promise.all([
      prisma.user.findUnique({
        where: { id: data.userId },
        select: { role: true, kycStatus: true, referrerId: true },
      }),
      prisma.account.findUnique({
        where: { id: data.accountId },
        select: { userId: true, balance: true },
      }),
    ]);

    if (!user) throw new Error('User not found');
    if (!account) throw new Error('Account not found');
    if (account.userId !== data.userId) throw new Error('Account does not belong to user');

    const balance = new Prisma.Decimal(account.balance);
    const gasFee = user.role === 'MARKETER' ? calculateGasFee(data.network) : new Prisma.Decimal(0);
    const netAmount = amount.sub(gasFee); 
    const totalDeducted = amount;

    if (netAmount.lessThanOrEqualTo(0)) {
      throw new Error(`Amount too small to cover gas fee of $${gasFee}`);
    }

    if (balance.lessThan(totalDeducted)) {
      throw new Error(`Insufficient balance. Available: $${balance}`);
    }

    if (user.role === 'USER' && user.kycStatus !== 'VERIFIED') {
      if (user.kycStatus === 'PENDING') {
        throw new Error('Your identity verification is currently under review. Document approval typically takes 24 to 48 hours.');
      }
      if (user.kycStatus === 'REJECTED') {
        throw new Error('Your previous identity documentation was rejected. Please re-submit valid credentials via profile management.');
      }
      throw new Error('Identity verification required. Please submit standard KYC documentation to enable global withdrawals.');
    }

    const latestKYC = user.role === 'USER'
      ? await prisma.kYCVerification.findFirst({
          where: { userId: data.userId, status: 'VERIFIED' },
          orderBy: { reviewedAt: 'desc' },
        })
      : null;

      const [withdrawal] = await prisma.$transaction([
      prisma.withdrawal.create({
        data: {
          userId: data.userId,
          accountId: data.accountId,
          amount: netAmount,
          coin: data.coin as any,
          network: data.network,
          toAddress: data.toAddress,
          kycVerificationId: latestKYC?.id,
          status: 'PENDING',
        },
        include: {
          user: { select: { email: true } },
          account: { select: { balance: true } },
        },
      }),
      prisma.account.update({
        where: { id: data.accountId },
        data: {
          balance: { decrement: totalDeducted.toNumber() },
        },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: 'WITHDRAWAL_REQUESTED',
        metadata: JSON.stringify({
          withdrawalId: withdrawal.id,
          requestedAmount: amount.toString(),
          gasFee: gasFee.toString(),
          netAmount: netAmount.toString(),  
          toAddress: withdrawal.toAddress,
        }),
      },
    });

    if (user.role === 'MARKETER') {
      WithdrawalSimulationService.simulateMarketerProcessing(withdrawal.id, data.network);
    }

    return withdrawal;
  }

  static async getWithdrawalHistory(userId: string, limit = 20) {
    return prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        coin: true,
        network: true,
        amount: true,
        toAddress: true,
        status: true,
        txHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });
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
          account: { select: { balance: true } },
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

  static async updateWithdrawalStatus(
    withdrawalId: string,
    status: string,
    txHash?: string
  ) {
    const updateData: any = { status };
    if (txHash) updateData.txHash = txHash;

    const withdrawal = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        userId: withdrawal.userId,
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
}

export async function fetchWithdrawalHistory(userId: string) {
  return WithdrawalService.getWithdrawalHistory(userId);
}