// depositSimulationService.ts
import prisma from '../utils/prisma.js';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { enqueueEmail } from '../queues/emailQueue.js';

export class DepositSimulationService {

  private static getNetworkDelay(network: string): number {
    const net = network.toUpperCase();
    if (net.includes('TRC20') || net.includes('TRON') || net.includes('BEP20') || net.includes('BSC') || net.includes('POLYGON') || net.includes('SOLANA')) {
      return 6000;
    }
    if (net.includes('ERC20') || net.includes('ETH')) {
      return 15000;
    }
    return 25000;
  }

  private static getSimulatedNetworkFee(network: string): number {
    const net = network.toUpperCase();
    if (net.includes('TESTNET') || net.includes('SEPOLIA')) return 0.00;
    if (net === 'ETHEREUM' || net.includes('ERC20')) return Number((Math.random() * 6.0 + 2.5).toFixed(2));
    if (net === 'BITCOIN' || net === 'BTC') return Number((Math.random() * 3.0 + 1.5).toFixed(2));
    if (net.includes('ARBITRUM') || net.includes('TON')) return Number((Math.random() * 0.3 + 0.1).toFixed(2));
    return Number((Math.random() * 0.04 + 0.01).toFixed(2));
  }

  /**
   * Deducts the deposit amount from the user's VIRTUAL WALLET (not on-chain),
   * applies a simulated gas fee, and credits the NET amount to their REAL account.
   * Fails cleanly if the virtual wallet doesn't have enough balance.
   */
  static simulateMarketerProcessing(depositId: string, network: string) {
    const delay = this.getNetworkDelay(network);
    console.log(`[DEPOSIT SIMULATION] Processing deposit ${depositId}. Settling in ${delay / 1000}s...`);

    setTimeout(async () => {
      try {
        const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });

        if (!deposit || deposit.status !== 'PENDING') {
          console.warn(`[DEPOSIT ABORTED] Deposit ${depositId} is invalid or already processed.`);
          return;
        }

        const targetAccount = await prisma.account.findFirst({
          where: { userId: deposit.userId, type: 'REAL' },
        });

        if (!targetAccount) {
          console.error(`[DEPOSIT FAILED] No REAL account found for User: ${deposit.userId}`);
          await this.markFailed(depositId, 'No REAL account found for user');
          return;
        }

        const rawAmount = new Prisma.Decimal(deposit.amount);
        const networkFee = new Prisma.Decimal(this.getSimulatedNetworkFee(network));
        const netCreditAmount = Prisma.Decimal.max(0, rawAmount.sub(networkFee));

        console.log(`[DEPOSIT SIMULATION] Gross: $${rawAmount} | ${network} Gas Fee: $${networkFee} | Net Credit: $${netCreditAmount}`);

        await prisma.$transaction(async (tx) => {
          // Lock the virtual wallet row to prevent concurrent deposits/withdrawals racing on balance
          const walletRows = await tx.$queryRaw<{ id: string; balance: Prisma.Decimal }[]>`
            SELECT id, balance FROM "VirtualWallet" WHERE "userId" = ${deposit.userId} FOR UPDATE
          `;
          const wallet = walletRows[0];

          if (!wallet) {
            throw new Error(`No virtual wallet exists for user ${deposit.userId} — cannot fund deposit`);
          }

          const walletBalance = new Prisma.Decimal(wallet.balance.toString());

          // Debit the FULL gross amount from the virtual wallet (gas fee comes out of the user's pocket)
          if (walletBalance.lessThan(rawAmount)) {
            throw new Error(
              `Insufficient virtual wallet balance. Has $${walletBalance}, needs $${rawAmount}`
            );
          }

          const updatedWallet = await tx.virtualWallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: rawAmount } },
          });

          await tx.virtualWalletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'DEBIT',
              amount: rawAmount,
              balanceAfter: updatedWallet.balance,
              description: `Deposit funding: ${deposit.coin} on ${deposit.network} (gas fee $${networkFee})`,
              referenceId: depositId,
            },
          });

          // Credit the NET amount (after gas fee) to the user's real account
          await tx.account.update({
            where: { id: targetAccount.id },
            data: { balance: { increment: netCreditAmount.toNumber() } },
          });

          // Mark deposit settled
          await tx.deposit.update({
            where: { id: depositId },
            data: {
              status: 'SWEPT',
              amount: netCreditAmount,
              usdValueAtCredit: netCreditAmount,
              creditedAt: new Date(),
              sweptAt: new Date(),
              sweptTx: `0x_sim_sweep_${crypto.randomUUID().substring(0, 8)}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: deposit.userId,
              action: 'DEPOSIT_FUNDED_FROM_VIRTUAL_WALLET',
              metadata: JSON.stringify({
                depositId,
                grossAmount: rawAmount.toString(),
                networkFee: networkFee.toString(),
                netAmountCredited: netCreditAmount.toString(),
                networkUsed: network,
                virtualWalletDebited: rawAmount.toString(),
                finalizedAt: new Date().toISOString(),
              }),
            },
          });
        });

        console.log(`[DEPOSIT SUCCESS] Settled $${netCreditAmount} for Deposit ${depositId}, debited $${rawAmount} from virtual wallet.`);

        try {
          const depositUser = await prisma.user.findUnique({
            where: { id: deposit.userId },
            select: { id: true, email: true, role: true },
          });

          if (depositUser?.role === 'MARKETER') {
            await enqueueEmail({
              type: 'REFERRER_DEPOSIT_ALERT',
              user: depositUser,
              amount: netCreditAmount.toNumber(),
              address: deposit.depositAddressId ?? '',
              txId: deposit.txHash,
            });
          }
        } catch (notifyErr) {
          console.error(`[DEPOSIT NOTIFY ERROR] depositId=${depositId}`, notifyErr);
        }

      } catch (error) {
        console.error(`[DEPOSIT CRITICAL ERROR] depositId=${depositId}`, error);
        if (error instanceof Error) {
          console.error('[ERROR MESSAGE]', error.message);
        }
        await this.markFailed(depositId, error instanceof Error ? error.message : String(error));
      }
    }, delay);
  }

  private static async markFailed(depositId: string, reason: string) {
    try {
      await prisma.deposit.update({
        where: { id: depositId },
        data: { status: 'FAILED' },
      });
      await prisma.auditLog.create({
        data: {
          action: 'DEPOSIT_FAILED',
          metadata: JSON.stringify({ depositId, reason, failedAt: new Date().toISOString() }),
        },
      });
    } catch (e) {
      console.error(`[DEPOSIT FAILED-WRITE ERROR] could not mark ${depositId} as FAILED`, e);
    }
  }
}