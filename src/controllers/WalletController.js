const db = require('../database/db');
const { paiseToRupees } = require('../utils/money');

class WalletController {
  async getWallet(req, res, next) {
    try {
      const { userId } = req.params;

      const wallet = await db('wallets').where({ user_id: userId }).first();

      if (!wallet) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Wallet not found for this user' },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: wallet.id,
          userId: wallet.user_id,
          withdrawableBalancePaise: parseInt(wallet.withdrawable_balance, 10),
          withdrawableBalanceRupees: paiseToRupees(wallet.withdrawable_balance),
          reservedBalancePaise: parseInt(wallet.reserved_balance, 10),
          reservedBalanceRupees: paiseToRupees(wallet.reserved_balance),
          version: wallet.version,
          createdAt: wallet.created_at,
          updatedAt: wallet.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async getLedger(req, res, next) {
    try {
      const { userId } = req.params;

      const ledger = await db('wallet_ledger_entries')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc');

      return res.status(200).json({
        success: true,
        data: ledger.map((entry) => ({
          id: entry.id,
          userId: entry.user_id,
          saleId: entry.sale_id,
          payoutId: entry.payout_id,
          entryType: entry.entry_type,
          amountPaise: parseInt(entry.amount, 10),
          amountRupees: paiseToRupees(entry.amount),
          balanceAfterPaise: parseInt(entry.balance_after, 10),
          balanceAfterRupees: paiseToRupees(entry.balance_after),
          idempotencyKey: entry.idempotency_key,
          description: entry.description,
          createdAt: entry.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WalletController();
