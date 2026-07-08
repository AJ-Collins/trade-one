import { Request, Response } from 'express';
import speakeasy from 'speakeasy';
import { prisma } from "../prisma.js";
import { AdminService } from '../services/adminService.js';
import { isValidUUID, validateTxHash, truncateString, clampPageAndLimit } from '../utils/validators.js';
import { SupportedNetwork } from '../config/networks.js';

export class AdminController {
  static async generatePasskey(req: Request, res: Response) {
    try {
      const { version, label } = req.body;
      const key = await AdminService.generatePasskey(version || "v2.1", label);
      res.status(201).json(key);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async deletePasskey(req: Request, res: Response) {
    try {
        const id = req.params.id;
        
        if (!id) {
        return res.status(400).json({ error: "ID is missing" });
        }

        await AdminService.deletePasskey(id);
        res.status(200).json({ message: "Passkey deleted" });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
    }

  static async listPasskeys(req: Request, res: Response) {
    const keys = await AdminService.getAllPasskeys();
    res.json(keys);
  }

  static async updateConfig(req: Request, res: Response) {
    try {
      const config = await AdminService.updateBotConfig(req.body);
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async getConfig(req: Request, res: Response) {
    const config = await AdminService.getBotConfig();
    res.json(config);
  }

  static async getWithdrawalConfig(req: Request, res: Response) {
    try {
      const config = await AdminService.getWithdrawalConfig();
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async updateWithdrawalConfig(req: Request, res: Response) {
    try {
      const config = await AdminService.updateWithdrawalConfig(req.body);
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async getDashboardStats(req: Request, res: Response) {
    try {
      const stats = await AdminService.getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async getRecentActivity(req: Request, res: Response) {
    try {
      const activity = await AdminService.getRecentActivity();
      res.json(activity);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async getUsers(req: Request, res: Response) {
    try {
      const search = truncateString(req.query.search as string, 100);
      const users = await AdminService.getAllUsers(search || undefined);
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async createUser(req: Request, res: Response) {
    try {
      const { email, password, role, balance } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      const user = await AdminService.createUser({ email, password, role: role || 'USER', balance });
      res.status(201).json(user);
    } catch (e: any) {
      const status = e.code === 'P2002' ? 409 : 500;
      res.status(status).json({ error: e.code === 'P2002' ? 'Email already exists' : e.message });
    }
  }

  static async updateUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!isValidUUID(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const { email, role, balance, password } = req.body;
      const user = await AdminService.updateUser(id, { email, role, balance, password });
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async toggleUserStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!isValidUUID(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      const user = await AdminService.toggleUserStatus(id);
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async deleteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!isValidUUID(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }
      await AdminService.deleteUser(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async getMarketers(req: Request, res: Response) {
  try {
    const marketers = await AdminService.getAllMarketers();
    res.json(marketers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getMarketerStats(req: Request, res: Response) {
  try {
    const stats = await AdminService.getMarketerStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async updateMarketerRate(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { referralRate } = req.body;
    if (referralRate === undefined) {
      return res.status(400).json({ error: 'referralRate is required' });
    }
    const marketer = await AdminService.updateMarketerRate(id, Number(referralRate));
    res.json(marketer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getTrades(req: Request, res: Response) {
  try {
    const search = truncateString(req.query.search as string, 100);
    const { page, limit } = clampPageAndLimit(req.query.page as string, req.query.limit as string);
    const result = await AdminService.getAllTrades(search || undefined, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getTradeStats(req: Request, res: Response) {
  try {
    const stats = await AdminService.getTradeStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getDeposits(req: Request, res: Response) {
  try {
    const search = truncateString(req.query.search as string, 100);
    const { page, limit } = clampPageAndLimit(req.query.page as string, req.query.limit as string);
    const result = await AdminService.getAllDeposits(search || undefined, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getDepositStats(req: Request, res: Response) {
  try {
    const stats = await AdminService.getDepositStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async retryDeposit(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const result = await AdminService.retryFailedDeposit(id);
    res.json({ success: true, result });
  } catch (e: any) {
    const status = e.message.includes('not found') ? 404
      : e.message.includes('Only') ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
}

static async getProfile(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const profile = await AdminService.getAdminProfile(userId);
    res.json(profile);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async updateProfile(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const updated = await AdminService.updateAdminProfile(userId, { email });
    res.json(updated);
  } catch (e: any) {
    const status = e.message.includes('already in use') ? 409 : 500;
    res.status(status).json({ error: e.message });
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

    await AdminService.updateAdminPassword(userId, currentPassword, newPassword);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}

static async getWithdrawals(req: Request, res: Response) {
  try {
    const { page, limit } = clampPageAndLimit(req.query.page as string, req.query.limit as string);
    const result = await AdminService.getAllWithdrawals(page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async getWithdrawalStats(req: Request, res: Response) {
  try {
    const stats = await AdminService.getWithdrawalStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

static async updateWithdrawalStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, txHash } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = await AdminService.updateWithdrawalStatus(id, status, txHash);
    res.json({ success: true, withdrawal: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

 static async manualCreditDeposit(req: Request, res: Response) {
    try {
      const { txHash, usdValue } = req.body;

      if (!txHash || typeof txHash !== 'string') {
        return res.status(400).json({ error: 'txHash is required' });
      }

      if (usdValue === undefined || usdValue === null || isNaN(Number(usdValue)) || Number(usdValue) <= 0) {
        return res.status(400).json({ error: 'usdValue must be a positive number' });
      }

      const result = await AdminService.manualCreditDeposit({
        txHash,
        usdValue: Number(usdValue),
      });

      if (result.alreadyCredited) {
        return res.status(200).json({
          message: 'Deposit was already credited previously',
          deposit: result.deposit,
        });
      }

      return res.status(201).json({
        message: 'Deposit credited successfully',
        ...result,
      });
    } catch (err: any) {
      console.error('manualCreditDeposit error:', err);
      return res.status(400).json({ error: err.message || 'Failed to credit deposit' });
    }
  }

  /**
   * POST /admin/deposits/backfill
   * Body: { network: string, txHashes: string[] }
   * Replays deposit tx(s) through receipt parsing → watched-address matching → crediting.
   * Idempotent — already-credited txs are reported as 'already_credited'.
   */
  static async backfillDeposits(req: Request, res: Response) {
    try {
      const { network, txHashes } = req.body;

      if (!network || typeof network !== 'string') {
        return res.status(400).json({ error: 'network is required' });
      }
      if (!Array.isArray(txHashes) || txHashes.length === 0) {
        return res.status(400).json({ error: 'txHashes[] is required and must not be empty' });
      }
      if (txHashes.length > 20) {
        return res.status(400).json({ error: 'Max 20 tx hashes per request' });
      }

      const adminId = req.user!.id;
      const results = await AdminService.backfillDeposits(adminId, network as SupportedNetwork, txHashes);

      res.json({ results });
    } catch (err: any) {
      console.error('backfillDeposits error:', err);
      res.status(500).json({ error: err.message || 'Backfill failed' });
    }
  }

  // System settings configs
  /**
   * GET /admin/system/settings
   * Returns all config keys with metadata but NO actual values.
   */
  static async getSystemSettings(req: Request, res: Response) {
    try {
      const settings = await AdminService.getSystemConfigs();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * POST /admin/system/settings/reveal
   * Body: { key: string, totpCode: string }
   * Returns the plaintext value of a single config key, after 2FA check.
   */
  static async revealSystemSetting(req: Request, res: Response) {
    try {
      const { key, totpCode } = req.body;
      if (!key || !totpCode) {
        return res.status(400).json({ error: 'key and totpCode are required' });
      }

      // req.user is attached by authenticate middleware
      const admin = await prisma.user.findUnique({ where: { id: (req as any).user.id } });
      if (!admin?.twoFactorEnabled || !admin.twoFactorSecret) {
        return res.status(403).json({ error: '2FA is not enabled on this account. Enable it in your profile first.' });
      }

      const valid = speakeasy.totp.verify({
        secret:   admin.twoFactorSecret,
        encoding: 'base32',
        token:    totpCode,
        window:   1,
      });

      if (!valid) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }

      const value = await AdminService.revealSystemConfig(key);
      res.json({ key, value });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  /**
   * PUT /admin/system/settings
   * Body: { entries: [{ key, value }], totpCode: string }
   * Saves one or many config values, after 2FA check.
   */
  static async updateSystemSettings(req: Request, res: Response) {
    try {
      const { entries, totpCode } = req.body;

      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array is required' });
      }
      if (!totpCode) {
        return res.status(400).json({ error: 'totpCode is required' });
      }

      const admin = await prisma.user.findUnique({ where: { id: (req as any).user.id } });
      if (!admin?.twoFactorEnabled || !admin.twoFactorSecret) {
        return res.status(403).json({ error: '2FA is not enabled on this account. Enable it in your profile first.' });
      }

      const valid = speakeasy.totp.verify({
        secret:   admin.twoFactorSecret,
        encoding: 'base32',
        token:    totpCode,
        window:   1,
      });

      if (!valid) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }

      await AdminService.upsertSystemConfigsBulk(entries);
      res.json({ success: true, message: `${entries.length} setting(s) saved.` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async setup2FA(req: Request, res: Response) {
    try {
      const result = await AdminService.setup2FA((req as any).user.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  static async enable2FA(req: Request, res: Response) {
    try {
      const { totpCode } = req.body;
      if (!totpCode) return res.status(400).json({ error: 'totpCode is required' });
      await AdminService.enable2FA((req as any).user.id, totpCode);
      res.json({ success: true, message: '2FA enabled successfully' });
    } catch (e: any) {
      const status = e.message.includes('Invalid') ? 401 : 400;
      res.status(status).json({ error: e.message });
    }
  }

  static async setMarketerPayout(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { amount } = req.body;

      if (amount === undefined || isNaN(Number(amount)) || Number(amount) <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      const result = await AdminService.setMarketerPayout(id, Number(amount));
      res.json({ success: true, withdrawal: result });
    } catch (e: any) {
      const status = e.message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: e.message });
    }
  }
}