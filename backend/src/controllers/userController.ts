import { Request, Response } from 'express';
import { UserService } from '../services/userService.js';
import { WithdrawalService } from '../services/withdrawalService.js';
import { AccountBalanceDTO } from '../types/auth.types';
import { AuthRequest } from "../middleware/auth";
import { truncateString, clampPageAndLimit } from '../utils/validators.js';

export class UserController {
  static async getAccountBalance(req: Request, res: Response<AccountBalanceDTO | { message: string }>) {
    try {
      const userId = req.user!.id;
      const data = await UserService.fetchAccountBalance(userId);
      return res.json(data);
    } catch (err: any) {
      if (err.message === 'Account not found') {
        return res.status(404).json({ message: err.message });
      }
      console.error('getAccountBalance error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async updatePassword(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'All password fields are required' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'New passwords do not match' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }

      await UserService.updatePassword(userId, currentPassword, newPassword);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  }

  static async getWithdrawalHistory(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const withdrawals = await WithdrawalService.getWithdrawalHistory(userId, limit);
      return res.json({ withdrawals });
    } catch (err: any) {
      console.error('getWithdrawalHistory error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async requestWithdrawal(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { accountId, amount, coin, network, toAddress } = req.body;

      if (!accountId || !amount || !coin || !network || !toAddress) {
        return res.status(400).json({ error: 'accountId, amount, coin, network, and toAddress are required' });
      }

      // Throws if ineligible (KYC not verified, admin role, etc.)
      await WithdrawalService.validateWithdrawalEligibility(userId);

      const withdrawal = await WithdrawalService.requestWithdrawal({
        userId,
        accountId,
        amount,
        coin,
        network,
        toAddress,
      });

      return res.status(201).json({ withdrawal });
    } catch (err: any) {
      console.error('requestWithdrawal error:', err);
      return res.status(400).json({ error: err.message || 'Failed to request withdrawal' });
    }
  }

  static async getUserTrades(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const search = truncateString(req.query.search as string, 100);
      const { page, limit } = clampPageAndLimit(req.query.page as string, req.query.limit as string);
      
      const result = await UserService.getUserTrades(userId, search || undefined, page, limit);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}