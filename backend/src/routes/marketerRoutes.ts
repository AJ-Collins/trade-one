import { Router } from 'express';
import { loginLimiter } from '../middleware/adminOnly.js';
import { authenticate } from '../middleware/auth.js';
import { MarketerController } from '../controllers/marketerController.js';
import { adminOnly } from '../middleware/adminOnly.js';

const router = Router();

// Public auth gate
router.post('/login', loginLimiter, MarketerController.marketerLogin);
router.post('/logout', MarketerController.logout);

// Profile & Portfolio
router.get('/profile', authenticate, adminOnly("MARKETER"), MarketerController.getProfile);
router.get('/external-withdrawals', authenticate, adminOnly("MARKETER"), MarketerController.getExternalWithdrawals);

// Deposits (useDepositStore)
router.post('/deposit/initiate', authenticate, adminOnly("MARKETER"), MarketerController.initiateDeposit);
router.post('/deposit/confirm', authenticate, adminOnly("MARKETER"), MarketerController.confirmDeposit);
router.get('/deposit/history', authenticate, adminOnly("MARKETER"), MarketerController.getDepositHistory);

// Withdrawals (useWithdrawalStore)
router.post('/withdrawal/request', authenticate, adminOnly("MARKETER"), MarketerController.requestWithdrawal);
router.get('/withdrawal/history', authenticate, adminOnly("MARKETER"), MarketerController.getWithdrawalHistory);

// App Withdrawals (independent implementation)
router.post('/app-withdrawal/request', authenticate, adminOnly("MARKETER"), MarketerController.requestAppWithdrawal);
router.get('/app-withdrawal/history', authenticate, adminOnly("MARKETER"), MarketerController.getAppWithdrawalHistory);

// Consolidated Transactions (useTransactionStore)
router.get('/transactions', authenticate, adminOnly("MARKETER"), MarketerController.getTransactions);

// Referrals (useReferralStore)
router.get('/referral', authenticate, adminOnly("MARKETER"), MarketerController.getReferrals);

// Notifications/Logs (useNotificationStore)
router.get('/notifications', authenticate, adminOnly("MARKETER"), MarketerController.getNotifications);
router.post('/notifications/read/:id', authenticate, adminOnly("MARKETER"), MarketerController.markAsRead);

export default router;