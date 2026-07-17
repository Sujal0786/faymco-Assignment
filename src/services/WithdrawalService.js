const db = require('../database/db');
const WalletService = require('./WalletService');
const MockPayoutGateway = require('./MockPayoutGateway');

class WithdrawalService {
  /**
   * Initiates a manual user withdrawal request.
   * Enforces available-balance validation, 24-hour withdrawal limits, immediate-retry rules,
   * idempotency, and transactional row-level locking.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {number} params.amount - in paise
   * @param {string} params.idempotencyKey
   * @param {string} [params.retryOfWithdrawalId] - Reference to a terminally failed withdrawal
   * @param {string} [params.simulateStatus='success'] - Gateway simulation status
   * @returns {Promise<Object>} The withdrawal request and payout details
   */
  async requestWithdrawal({
    userId,
    amount,
    idempotencyKey,
    retryOfWithdrawalId = null,
    simulateStatus = 'success',
  }) {
    if (amount <= 0 || !Number.isInteger(amount)) {
      const err = new Error('Withdrawal amount must be a positive integer paise value');
      err.statusCode = 400;
      throw err;
    }

    return await db.transaction(async (trx) => {
      // 1. Enforce Idempotency: Check if this idempotency key was already processed
      const existingRequest = await trx('withdrawal_requests')
        .where({ idempotency_key: idempotencyKey })
        .first();

      if (existingRequest) {
        const associatedPayout = await trx('payouts')
          .where({ idempotency_key: `payout_withdrawal_${existingRequest.id}` })
          .first();
        return {
          withdrawalRequest: existingRequest,
          payout: associatedPayout,
          duplicate: true,
        };
      }

      // 2. Lock the user's wallet to protect against concurrent withdrawals
      const wallet = await WalletService.getWalletWithLock(userId, trx);
      const currentWithdrawable = BigInt(wallet.withdrawable_balance);

      if (currentWithdrawable < BigInt(amount)) {
        const err = new Error(
          `Insufficient funds: Withdrawable balance is ${currentWithdrawable} paise, but requested to withdraw ${amount} paise`
        );
        err.statusCode = 422;
        err.code = 'INSUFFICIENT_FUNDS';
        throw err;
      }

      // 3. Evaluate 24-Hour Restriction & Retry Bypass
      let isRetryValid = false;

      if (retryOfWithdrawalId) {
        // Query the referenced failed withdrawal
        const failedRequest = await trx('withdrawal_requests')
          .where({ id: retryOfWithdrawalId, user_id: userId })
          .first();

        if (!failedRequest) {
          const err = new Error('Referenced withdrawal request for retry was not found');
          err.statusCode = 404;
          throw err;
        }

        // Validate that the referenced withdrawal is in a terminal failure state
        if (!['failed', 'cancelled', 'rejected'].includes(failedRequest.status)) {
          const err = new Error(
            `Cannot retry: Referenced withdrawal has status ${failedRequest.status} (not failed, cancelled, or rejected)`
          );
          err.statusCode = 400;
          throw err;
        }

        // Check if this failed withdrawal has already been retried
        const alreadyRetried = await trx('withdrawal_requests')
          .where({ retry_of_withdrawal_id: retryOfWithdrawalId })
          .first();

        if (alreadyRetried) {
          const err = new Error('Referenced failed withdrawal has already been retried once');
          err.statusCode = 400;
          throw err;
        }

        // Enforce retry amount limit (must be <= failed withdrawal amount)
        const failedAmount = BigInt(failedRequest.amount);
        if (BigInt(amount) > failedAmount) {
          const err = new Error(
            `Retry amount (${amount} paise) exceeds the original failed amount (${failedRequest.amount} paise)`
          );
          err.statusCode = 400;
          throw err;
        }

        isRetryValid = true;
      }

      // If this is NOT a valid retry, enforce the normal 24-hour limit
      if (!isRetryValid) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Find any non-failed withdrawal request created in the last 24 hours
        const blockingWithdrawal = await trx('withdrawal_requests')
          .where({ user_id: userId })
          .whereNotIn('status', ['failed', 'cancelled', 'rejected'])
          .where('requested_at', '>=', twentyFourHoursAgo)
          .first();

        if (blockingWithdrawal) {
          const err = new Error('Only one normal withdrawal is allowed every 24 hours');
          err.statusCode = 422;
          err.code = 'WITHDRAWAL_LIMIT_EXCEEDED';
          throw err;
        }
      }

      // 4. Create the withdrawal request record
      const [withdrawalRequest] = await trx('withdrawal_requests')
        .insert({
          user_id: userId,
          amount: amount.toString(),
          status: 'created',
          retry_of_withdrawal_id: retryOfWithdrawalId,
          idempotency_key: idempotencyKey,
        })
        .returning('*');

      const payoutIdempotencyKey = `payout_withdrawal_${withdrawalRequest.id}`;

      // 5. Reserve balance in wallet (debits withdrawable, credits reserved)
      await WalletService.reserveBalance(
        {
          userId,
          amount,
          payoutId: withdrawalRequest.id, // Use withdrawal request ID as payout ID mapping reference
          idempotencyKey: `ledger_reserve_${withdrawalRequest.id}`,
          description: `Reserve for withdrawal request: ${withdrawalRequest.id}`,
        },
        trx
      );

      // 6. Create the payout record
      const [payout] = await trx('payouts')
        .insert({
          id: withdrawalRequest.id, // Keep IDs identical for direct mapping
          user_id: userId,
          type: 'withdrawal',
          amount: amount.toString(),
          status: 'created',
          idempotency_key: payoutIdempotencyKey,
          initiated_at: trx.fn.now(),
        })
        .returning('*');

      // Update statuses to processing
      await trx('withdrawal_requests')
        .where({ id: withdrawalRequest.id })
        .update({ status: 'processing' });
      await trx('payouts').where({ id: payout.id }).update({ status: 'processing' });

      // 7. Call simulated payout gateway
      let gatewayResult;
      try {
        gatewayResult = await MockPayoutGateway.initiatePayout({
          userId,
          amount,
          type: 'withdrawal',
          idempotencyKey: payoutIdempotencyKey,
          simulateStatus,
        });
      } catch (error) {
        gatewayResult = {
          status: 'processing',
          providerReference: null,
          failureReason: error.message,
        };
      }

      // 8. Process immediately if terminal status was returned
      if (gatewayResult.status === 'succeeded') {
        const [updatedRequest] = await trx('withdrawal_requests')
          .where({ id: withdrawalRequest.id })
          .update({ status: 'succeeded', completed_at: trx.fn.now() })
          .returning('*');

        const [updatedPayout] = await trx('payouts')
          .where({ id: payout.id })
          .update({
            status: 'succeeded',
            provider_reference: gatewayResult.providerReference,
            completed_at: trx.fn.now(),
          })
          .returning('*');

        // Debit reserved balance, record completion ledger entry
        await WalletService.completeReservedBalance(
          {
            userId,
            amount,
            payoutId: withdrawalRequest.id,
            idempotencyKey: `ledger_complete_${withdrawalRequest.id}`,
            description: `Withdrawal successfully paid (provider: ${gatewayResult.providerReference})`,
          },
          trx
        );

        return { withdrawalRequest: updatedRequest, payout: updatedPayout, duplicate: false };
      } else if (['failed', 'cancelled', 'rejected'].includes(gatewayResult.status)) {
        const [updatedRequest] = await trx('withdrawal_requests')
          .where({ id: withdrawalRequest.id })
          .update({ status: gatewayResult.status, completed_at: trx.fn.now() })
          .returning('*');

        const [updatedPayout] = await trx('payouts')
          .where({ id: payout.id })
          .update({
            status: gatewayResult.status,
            provider_reference: gatewayResult.providerReference,
            failure_reason: gatewayResult.failureReason,
            completed_at: trx.fn.now(),
          })
          .returning('*');

        // Refund reserved balance back to withdrawable balance
        await WalletService.releaseReservedBalance(
          {
            userId,
            amount,
            payoutId: withdrawalRequest.id,
            idempotencyKey: `ledger_refund_${withdrawalRequest.id}`,
            description: `Withdrawal failed: ${gatewayResult.failureReason}`,
          },
          trx
        );

        return { withdrawalRequest: updatedRequest, payout: updatedPayout, duplicate: false };
      } else {
        // Gateway returned processing (timeout / delayed webhook)
        const [updatedRequest] = await trx('withdrawal_requests')
          .where({ id: withdrawalRequest.id })
          .update({ status: 'processing' })
          .returning('*');

        const [updatedPayout] = await trx('payouts')
          .where({ id: payout.id })
          .update({
            status: 'processing',
            provider_reference: gatewayResult.providerReference,
          })
          .returning('*');

        return { withdrawalRequest: updatedRequest, payout: updatedPayout, duplicate: false };
      }
    });
  }
}

module.exports = new WithdrawalService();
