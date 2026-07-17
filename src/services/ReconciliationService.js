const db = require('../database/db');
const WalletService = require('./WalletService');

class ReconciliationService {
  /**
   * Reconciles a single sale with a target status (approved or rejected).
   * Enforces row-level locking, optimistic concurrency safety, and idempotency.
   *
   * @param {Object} params
   * @param {string} params.saleId
   * @param {string} params.status - approved or rejected
   * @param {string} params.adminId
   * @param {string} [params.batchId]
   * @returns {Promise<Object>} Reconciliation result containing status and financial adjustment
   */
  async reconcileSale({ saleId, status, adminId, batchId = null }) {
    if (!['approved', 'rejected'].includes(status)) {
      throw new Error(`Invalid target reconciliation status: ${status}`);
    }

    return await db.transaction(async (trx) => {
      // 1. Lock the sale row to prevent concurrent reconciliation
      const sale = await trx('sales').where({ id: saleId }).first().forUpdate();

      if (!sale) {
        const err = new Error(`Sale not found: ${saleId}`);
        err.statusCode = 404;
        throw err;
      }

      const previousStatus = sale.status;

      // 2. Check if already reconciled
      if (previousStatus !== 'pending') {
        if (previousStatus === status) {
          // Idempotency: Repeated request with SAME status -> Return success without duplicate ledger entry
          return {
            success: true,
            saleId,
            previousStatus,
            finalStatus: status,
            adjustment: 0,
            message: 'Sale already reconciled with the same status (idempotent)',
          };
        } else {
          // Conflict: Attempt to change to a DIFFERENT reconciled status -> Reject
          const err = new Error(
            `Conflicting reconciliation request: Sale is already reconciled as ${previousStatus}`
          );
          err.statusCode = 409;
          throw err;
        }
      }

      // 3. Calculate adjustment amount
      const earnings = BigInt(sale.earning_amount);
      const advancePaid = BigInt(sale.advance_paid_amount);
      let adjustment = 0n;
      let entryType;

      if (status === 'approved') {
        adjustment = earnings - advancePaid;
        entryType = 'APPROVED_SALE_REMAINDER';
      } else {
        // rejected
        adjustment = -advancePaid;
        entryType = 'REJECTED_SALE_ADJUSTMENT';
      }

      // 4. Update the sale status
      await trx('sales')
        .where({ id: saleId })
        .update({
          status,
          reconciled_at: trx.fn.now(),
          version: sale.version + 1,
          updated_at: trx.fn.now(),
        });

      // 5. Adjust the wallet balance if adjustment is non-zero
      if (adjustment !== 0n) {
        const idempotencyKey = `reconcile_sale_${saleId}_status_${status}`;
        const description = `Reconciled by ${adminId}. Prev status: ${previousStatus}, Final status: ${status}. Batch: ${batchId || 'N/A'}`;

        await WalletService.adjustBalance(
          {
            userId: sale.user_id,
            amount: adjustment.toString(),
            entryType,
            saleId: sale.id,
            idempotencyKey,
            description,
          },
          trx
        );
      }

      return {
        success: true,
        saleId,
        previousStatus,
        finalStatus: status,
        adjustment: adjustment.toString(),
      };
    });
  }

  /**
   * Reconciles a batch of sales.
   * Processes each sale in its own isolated transaction so that individual failures
   * do not abort the entire batch.
   *
   * @param {Object} params
   * @param {Array} params.sales - List of { saleId, status }
   * @param {string} params.adminId
   * @param {string} [params.batchId]
   * @returns {Promise<Object>} Summary of processed batch containing success and error lists
   */
  async reconcileBatch({ sales, adminId, batchId = null }) {
    const results = [];
    const errors = [];

    for (const item of sales) {
      try {
        const res = await this.reconcileSale({
          saleId: item.saleId,
          status: item.status,
          adminId,
          batchId,
        });
        results.push(res);
      } catch (err) {
        errors.push({
          saleId: item.saleId,
          status: item.status,
          error: err.message,
          statusCode: err.statusCode || 500,
        });
      }
    }

    return {
      batchId: batchId || `batch_${Date.now()}`,
      processedCount: results.length,
      failedCount: errors.length,
      results,
      errors,
    };
  }
}

module.exports = new ReconciliationService();
