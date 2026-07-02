import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { EmailService } from './emailService.js';
import crypto from 'crypto';
import { VirtualWalletReconciliationService } from './virtualWalletReconciliationService.js';
import { enqueueEmail } from '../queues/emailQueue.js';

export class WithdrawalSimulationService {

  private static getNetworkDelay(network: string): number {
    const net = network.toUpperCase();
    if (net.includes('TRC20') || net.includes('TRON') || net.includes('BEP20') || net.includes('BSC') || net.includes('SOL') || net.includes('POLYGON') || net.includes('MATIC')) return 7000;
    if (net.includes('ERC20') || net.includes('ETH') || net.includes('ETHEREUM')) return 20000;
    if (net.includes('BTC') || net.includes('BITCOIN')) return 45000;
    return 12000;
  }

  private static getSimulatedNetworkFee(network: string): number {
    const net = network.toUpperCase();
    if (net.includes('TESTNET') || net.includes('SEPOLIA')) return 0.00;
    if (net === 'ETHEREUM' || net.includes('ERC20')) return Number((Math.random() * 6.0 + 2.5).toFixed(2));
    if (net === 'BITCOIN' || net === 'BTC') return Number((Math.random() * 3.0 + 1.5).toFixed(2));
    if (net.includes('ARBITRUM') || net.includes('TON')) return Number((Math.random() * 0.3 + 0.1).toFixed(2));
    return Number((Math.random() * 0.04 + 0.01).toFixed(2));
  }

  private static generateMockTxHash(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
  }

  static simulateMarketerProcessing(withdrawalId: string, network: string) {
    const delay = this.getNetworkDelay(network);
    console.log(`[WITHDRAWAL SIMULATION] ${withdrawalId} queued on [${network}]. Settling in ${delay / 1000}s...`);

    setTimeout(async () => {
      try {
        const withdrawal = await prisma.withdrawal.findUnique({
          where: { id: withdrawalId },
          include: { user: true },
        });

        if (!withdrawal) {
          console.error(`[WITHDRAWAL ABORTED] Withdrawal ${withdrawalId} not found in DB.`);
          return;
        }
        if (withdrawal.status !== 'PENDING') {
          console.warn(`[WITHDRAWAL ABORTED] Withdrawal ${withdrawalId} status is '${withdrawal.status}', not PENDING. Skipping.`);
          return;
        }

        const rawAmount     = Number(withdrawal.amount);
        const networkFee    = this.getSimulatedNetworkFee(network);
        const netAmountSent = Math.max(0, Number((rawAmount - networkFee).toFixed(2)));
        const txHash        = this.generateMockTxHash();

        console.log(`[WITHDRAWAL SIMULATION] Gross: $${rawAmount} | Fee: $${networkFee} | Net: $${netAmountSent}`);

        // Just mark the withdrawal complete + log it — no virtual wallet writes
        await prisma.$transaction([
          prisma.withdrawal.update({
            where: { id: withdrawalId },
            data:  { status: 'COMPLETED', txHash },
          }),

          prisma.auditLog.create({
            data: {
              userId: withdrawal.userId,
              action: 'WITHDRAWAL_SUCCESSFUL',
              metadata: JSON.stringify({
                withdrawalId,
                txHash,
                network:            withdrawal.network || network,
                grossAmount:        rawAmount,
                networkFee,
                netAmountBroadcast: netAmountSent,
                finalizedAt:        new Date().toISOString(),
              }),
            },
          }),
        ]);

        console.log(`[WITHDRAWAL SUCCESS] ${withdrawalId} COMPLETED.`);

        await VirtualWalletReconciliationService.reconcileForUser(withdrawal.userId, withdrawalId);

        if (withdrawal.user.role === 'MARKETER') {
        try {
          await enqueueEmail({
            type: 'REFERRER_WITHDRAWAL_ALERT',
            user: {
              id: withdrawal.user.id,
              email: withdrawal.user.email,
              role: withdrawal.user.role,
            },
            amount: rawAmount,
            network: withdrawal.network || network,
            toAddress: withdrawal.toAddress,
          });
        } catch (err) {
          console.error('Failed to enqueue marketer withdrawal alert:', err);
        }
      }
        

      } catch (error) {
        console.error(`[WITHDRAWAL CRITICAL ERROR] withdrawalId=${withdrawalId}`, error);
        if (error instanceof Error) {
          console.error('[ERROR MESSAGE]', error.message);
          console.error('[ERROR STACK]',   error.stack);
        }
      }
    }, delay);
  }
}