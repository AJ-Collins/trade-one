import { Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { WithdrawalService } from '../services/withdrawalService.js';
import { fetchWithdrawalHistory } from '../services/withdrawalService.js';
import { AddressValidator } from '../utils/addressValidator.js';

export async function getWithdrawalConfig(req: Request, res: Response) {
  try {
    const minAmount = await WithdrawalService.getMinimumWithdrawalAmount();
    return res.json({ minimumWithdrawal: minAmount });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getFeeStatus(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const fee = await prisma.withdrawalFee.findUnique({ where: { userId } });
    return res.json({ paid: !!fee });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function payFee(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    await prisma.withdrawalFee.upsert({
      where: { userId },
      update: { status: 'PAID' },
      create: { userId, status: 'PAID', amount: 400 },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getWithdrawalHistory(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const withdrawals = await fetchWithdrawalHistory(userId);
    return res.json(withdrawals);
  } catch (err) {
    console.error('getWithdrawalHistory error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function requestWithdrawal(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const { accountId, amount, coin, network, toAddress } = req.body;

    if (!accountId || !amount || !coin || !network || !toAddress) {
      return res.status(400).json({
        error: 'Missing required fields: accountId, amount, coin, network, toAddress',
      });
    }

    const isValid = AddressValidator.validate(toAddress, coin, network);
    if (!isValid) {
      return res.status(400).json({ 
        error: `Invalid withdrawal address format for ${coin} on network '${network}'` 
      });
    }

    const withdrawal = await WithdrawalService.requestWithdrawal({
      userId,
      accountId,
      amount,
      coin,
      network,
      toAddress,
    });

    return res.status(201).json({
      success: true,
      withdrawalId: withdrawal.id,
      status: withdrawal.status,
      amount: Number(withdrawal.amount),
      message: 'Withdrawal request submitted successfully',
    });
  } catch (err: any) {
    console.error('requestWithdrawal error:', err);
    return res.status(400).json({ error: err.message });
  }
}