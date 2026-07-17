const WithdrawalService = require('../services/WithdrawalService');
const db = require('../database/db');
const { rupeesToPaise, paiseToRupees } = require('../utils/money');

class WithdrawalController {
  async createWithdrawal(req, res, next) {
    try {
      const { userId } = req.params;
      const { amount, retryOfWithdrawalId, simulateStatus = 'success' } = req.body;
      const idempotencyKey = req.headers['idempotency-key'];

      // Convert rupees amount to paise
      const amountPaise = rupeesToPaise(amount);

      const result = await WithdrawalService.requestWithdrawal({
        userId,
        amount: amountPaise,
        idempotencyKey,
        retryOfWithdrawalId,
        simulateStatus,
      });

      const statusCode = result.duplicate ? 200 : 201;

      return res.status(statusCode).json({
        success: true,
        data: {
          withdrawalRequest: {
            id: result.withdrawalRequest.id,
            userId: result.withdrawalRequest.user_id,
            amountPaise: parseInt(result.withdrawalRequest.amount, 10),
            amountRupees: paiseToRupees(result.withdrawalRequest.amount),
            status: result.withdrawalRequest.status,
            requestedAt: result.withdrawalRequest.requested_at,
            completedAt: result.withdrawalRequest.completed_at,
            retryOfWithdrawalId: result.withdrawalRequest.retry_of_withdrawal_id,
            idempotencyKey: result.withdrawalRequest.idempotency_key,
          },
          payout: result.payout
            ? {
                id: result.payout.id,
                status: result.payout.status,
                providerReference: result.payout.provider_reference,
                failureReason: result.payout.failure_reason,
              }
            : null,
        },
        message: result.duplicate
          ? 'Duplicate request (idempotent response)'
          : 'Withdrawal initiated successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  async getUserWithdrawals(req, res, next) {
    try {
      const { userId } = req.params;
      const withdrawals = await db('withdrawal_requests')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc');

      return res.status(200).json({
        success: true,
        data: withdrawals.map((w) => ({
          id: w.id,
          userId: w.user_id,
          amountPaise: parseInt(w.amount, 10),
          amountRupees: paiseToRupees(w.amount),
          status: w.status,
          requestedAt: w.requested_at,
          completedAt: w.completed_at,
          retryOfWithdrawalId: w.retry_of_withdrawal_id,
          idempotencyKey: w.idempotency_key,
        })),
      });
    } catch (err) {
      next(err);
    }
  }

  async getWithdrawalById(req, res, next) {
    try {
      const { withdrawalId } = req.params;
      const withdrawal = await db('withdrawal_requests').where({ id: withdrawalId }).first();

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Withdrawal request not found' },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: withdrawal.id,
          userId: withdrawal.user_id,
          amountPaise: parseInt(withdrawal.amount, 10),
          amountRupees: paiseToRupees(withdrawal.amount),
          status: withdrawal.status,
          requestedAt: withdrawal.requested_at,
          completedAt: withdrawal.completed_at,
          retryOfWithdrawalId: withdrawal.retry_of_withdrawal_id,
          idempotencyKey: withdrawal.idempotency_key,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WithdrawalController();
