const express = require('express');
const router = express.Router();

// Controllers
const UserController = require('../controllers/UserController');
const BrandController = require('../controllers/BrandController');
const SaleController = require('../controllers/SaleController');
const PayoutController = require('../controllers/PayoutController');
const WalletController = require('../controllers/WalletController');
const WithdrawalController = require('../controllers/WithdrawalController');
const WebhookController = require('../controllers/WebhookController');

// Validation Middlewares
const {
  validateUser,
  validateBrand,
  validateSale,
  validateWithdrawal,
  validateWebhook,
} = require('../middleware/validate');

// Users
router.post('/users', validateUser, UserController.createUser);
router.get('/users/:userId', UserController.getUser);

// Brands
router.post('/brands', validateBrand, BrandController.createBrand);

// Sales
router.post('/sales', validateSale, SaleController.createSale);
router.get('/sales', SaleController.getSales);
router.get('/sales/:saleId', SaleController.getSaleById);
router.get('/users/:userId/sales', SaleController.getUserSales);

// Advance Payouts
router.post('/admin/advance-payouts/run', PayoutController.runAdvancePayouts);
router.get('/admin/advance-payouts', PayoutController.getAdvancePayouts);

// Reconciliation
router.post('/admin/sales/:saleId/reconcile', SaleController.reconcileSale);
router.post('/admin/reconciliations/batch', SaleController.reconcileBatch);

// Wallet
router.get('/users/:userId/wallet', WalletController.getWallet);
router.get('/users/:userId/wallet/ledger', WalletController.getLedger);

// Withdrawals
router.post(
  '/users/:userId/withdrawals',
  validateWithdrawal,
  WithdrawalController.createWithdrawal
);
router.get('/users/:userId/withdrawals', WithdrawalController.getUserWithdrawals);
router.get('/withdrawals/:withdrawalId', WithdrawalController.getWithdrawalById);

// Webhook
router.post('/webhooks/payout-provider', validateWebhook, WebhookController.handleWebhook);

module.exports = router;
