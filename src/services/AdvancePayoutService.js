const db = require('../database/db');
const { calculateAdvanceAmount } = require('../utils/money');
const MockPayoutGateway = require('./MockPayoutGateway');
const WalletService = require('./WalletService');

class AdvancePayoutService {
  /**
   * Finds and processes eligible pending sales for advance payouts.
   * Processes sales one-by-one in isolated transaction blocks using row-level locking
   * (FOR UPDATE SKIP LOCKED) to allow safe concurrent execution of multiple workers.
   *
   * @param {string} [simulateStatus='success'] - simulated gateway response for test purposes
   * @returns {Promise<Array>} List of processed sales and their payout statuses
   */
  async runAdvancePayoutJob(simulateStatus = 'success') {
    const results = [];
    let hasMore = true;

    while (hasMore) {
      const processed = await db.transaction(async (trx) => {
        // Query one eligible pending sale with FOR UPDATE SKIP LOCKED
        const sale = await trx('sales')
          .where({ status: 'pending', advance_paid_amount: 0 })
          .whereNotIn('id', function () {
            this.select('sale_id')
              .from('payout_allocations')
              .where({ allocation_type: 'advance' })
              .whereIn('status', ['created', 'processing', 'succeeded']);
          })
          .first()
          .forUpdate()
          .skipLocked();

        if (!sale) {
          return false; // No more eligible sales
        }

        const advanceAmount = calculateAdvanceAmount(sale.earning_amount);

        // Fetch previous advance payout allocations for this sale to count attempts
        const attempts = await trx('payout_allocations')
          .where({ sale_id: sale.id, allocation_type: 'advance' })
          .count('id as count')
          .first();
        const attemptNumber = parseInt(attempts.count || 0, 10) + 1;
        const idempotencyKey = `adv_payout_${sale.id}_att_${attemptNumber}`;

        // 1. Create a payout record
        const [payout] = await trx('payouts')
          .insert({
            user_id: sale.user_id,
            type: 'advance',
            amount: advanceAmount,
            status: 'created',
            idempotency_key: idempotencyKey,
            initiated_at: trx.fn.now(),
          })
          .returning('*');

        // 2. Create the payout allocation mapping
        await trx('payout_allocations').insert({
          payout_id: payout.id,
          sale_id: sale.id,
          allocation_type: 'advance',
          amount: advanceAmount,
          status: 'created',
        });

        // Set status to processing before making the external call
        await trx('payouts').where({ id: payout.id }).update({ status: 'processing' });
        await trx('payout_allocations')
          .where({ payout_id: payout.id })
          .update({ status: 'processing' });

        // 3. Initiate the payout through Mock Payout Gateway
        let gatewayResult;
        try {
          gatewayResult = await MockPayoutGateway.initiatePayout({
            userId: sale.user_id,
            amount: advanceAmount,
            type: 'advance',
            idempotencyKey,
            simulateStatus,
          });
        } catch (error) {
          // If connection times out, treat as processing to resolve later
          gatewayResult = {
            status: 'processing',
            providerReference: null,
            failureReason: error.message,
          };
        }

        // 4. Update records based on gateway response status
        if (gatewayResult.status === 'succeeded') {
          await trx('payouts').where({ id: payout.id }).update({
            status: 'succeeded',
            provider_reference: gatewayResult.providerReference,
            completed_at: trx.fn.now(),
          });

          await trx('payout_allocations')
            .where({ payout_id: payout.id })
            .update({ status: 'succeeded' });

          await trx('sales')
            .where({ id: sale.id })
            .update({
              advance_paid_amount: advanceAmount,
              version: sale.version + 1,
              updated_at: trx.fn.now(),
            });

          // Ledger Credit: ADVANCE_PAYOUT (+amount)
          await WalletService.adjustBalance(
            {
              userId: sale.user_id,
              amount: advanceAmount,
              entryType: 'ADVANCE_PAYOUT',
              saleId: sale.id,
              payoutId: payout.id,
              idempotencyKey: `adv_ledger_credit_${sale.id}_payout_${payout.id}`,
              description: `Advance payout credit for sale ${sale.external_reference}`,
            },
            trx
          );

          // Ledger Debit: ADVANCE_PAYOUT (-amount) because cash is sent to the user
          await WalletService.adjustBalance(
            {
              userId: sale.user_id,
              amount: -advanceAmount,
              entryType: 'ADVANCE_PAYOUT',
              saleId: sale.id,
              payoutId: payout.id,
              idempotencyKey: `adv_ledger_debit_${sale.id}_payout_${payout.id}`,
              description: `Advance payout transfer for sale ${sale.external_reference}`,
            },
            trx
          );
        } else if (['failed', 'cancelled', 'rejected'].includes(gatewayResult.status)) {
          await trx('payouts').where({ id: payout.id }).update({
            status: gatewayResult.status,
            provider_reference: gatewayResult.providerReference,
            failure_reason: gatewayResult.failureReason,
            completed_at: trx.fn.now(),
          });

          await trx('payout_allocations')
            .where({ payout_id: payout.id })
            .update({ status: gatewayResult.status });

          // Wallet is not updated since no cash transfer took place
        } else {
          // Timeout or still processing: update with provider reference
          await trx('payouts').where({ id: payout.id }).update({
            provider_reference: gatewayResult.providerReference,
          });
        }

        results.push({
          saleId: sale.id,
          payoutId: payout.id,
          status: gatewayResult.status,
          amount: advanceAmount,
        });

        return true;
      });

      if (!processed) {
        hasMore = false;
      }
    }

    return results;
  }
}

module.exports = new AdvancePayoutService();
