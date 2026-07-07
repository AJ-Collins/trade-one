import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getWithdrawalHistory, requestWithdrawal, getWithdrawalConfig, getFeeStatus, payFee } from '../controllers/withrawController.js';
import { KYCController } from '../controllers/kycController.js';

const router = Router();

router.use(authenticate);

router.get('/config', getWithdrawalConfig);
router.get('/fee-status', getFeeStatus);
router.post('/pay-fee', payFee);
router.post('/request', requestWithdrawal);
router.get('/history', getWithdrawalHistory);
router.get('/kyc/history', KYCController.getKYCSubmissionHistory);

export default router;