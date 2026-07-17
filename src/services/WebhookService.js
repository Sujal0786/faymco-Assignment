const db = require('../database/db');
const WalletService = require('./WalletService');

class WebhookService {
  /**
   * Processes a webhook event from the payout provider.
   * Ensures strict idempotency by tracking event IDs, handles out-of-order events,
   * and triggers the appropriate failed payout recovery or completion workflows.
   *
   * @param {Object} event
   * @param {string} event.eventId - unique webhook event ID
   * @param {string} event.eventType - payout.succeeded, payout.failed, payout.cancelled, payout.rejected
   * @param {string} [event.payoutId] - internal payout ID
   * @param {string} [event.providerReference] - provider reference
   * @param {string} [event.failureReason] - reason for failures
   * @returns {Promise<Object>} Process result summary
   */
  async processWebhook(event) {
    const { eventId, eventType, payoutId, providerReference, failureReason } = event;

    return await db.transaction(async (trx) => {
      // 1. Idempotency Check: Prevent processing the same webhook event ID multiple times
      const duplicateEvent = await trx('processed_webhook_events')
        .where({ provider_event_id: eventId })
        .first()
        .forUpdate();

      if (duplicateEvent) {
        return {
          success: true,
          message: 'Webhook event already processed (idempotent)',
          eventId,
        };
      }

      // Record that we are processing this event
      await trx('processed_webhook_events').insert({
        provider_event_id: eventId,
        event_type: eventType,
        payload: event,
      });

      // 2. Fetch and lock the payout record
      let query = trx('payouts').forUpdate();
      if (payoutId) {
        query = query.where({ id: payoutId });
      } else if (providerReference) {
        query = query.where({ provider_reference: providerReference });
      } else {
        throw new Error(
          'Either payoutId or providerReference must be supplied in the webhook payload'
        );
      }

      const payout = await query.first();

      if (!payout) {
        throw new Error(
          `Payout record not found for webhook: payoutId=${payoutId}, providerReference=${providerReference}`
        );
      }

      const currentStatus = payout.status;

      // 3. Handle out-of-order / terminal state webhooks
      // If the payout has already reached a terminal state (succeeded, failed, cancelled, rejected), do not change it
      if (['succeeded', 'failed', 'cancelled', 'rejected'].includes(currentStatus)) {
        return {
          success: true,
          message: `Payout already in terminal state: ${currentStatus}. Webhook ignored.`,
          payoutId: payout.id,
          status: currentStatus,
        };
      }

      // Map event types to database statuses
      let targetStatus;
      if (eventType === 'payout.succeeded') {
        targetStatus = 'succeeded';
      } else if (eventType === 'payout.failed') {
        targetStatus = 'failed';
      } else if (eventType === 'payout.cancelled') {
        targetStatus = 'cancelled';
      } else if (eventType === 'payout.rejected') {
        targetStatus = 'rejected';
      } else {
        throw new Error(`Unsupported webhook event type: ${eventType}`);
      }

      // 4. Update the payout status
      await trx('payouts')
        .where({ id: payout.id })
        .update({
          status: targetStatus,
          provider_reference: providerReference || payout.provider_reference,
          failure_reason: failureReason || null,
          completed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

      // 5. Apply type-specific completion or failed payout recovery
      if (payout.type === 'withdrawal') {
        // Update the user's manual withdrawal request record
        await trx('withdrawal_requests').where({ id: payout.id }).update({
          status: targetStatus,
          completed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

        if (targetStatus === 'succeeded') {
          // Success: debit reserved balance, post ledger completion
          await WalletService.completeReservedBalance(
            {
              userId: payout.user_id,
              amount: payout.amount,
              payoutId: payout.id,
              idempotencyKey: `webhook_complete_${payout.id}`,
              description: `Withdrawal payout succeeded (webhook: ${eventId})`,
            },
            trx
          );
        } else {
          // Failure: restore reserved balance back to withdrawable balance, post ledger refund
          await WalletService.releaseReservedBalance(
            {
              userId: payout.user_id,
              amount: payout.amount,
              payoutId: payout.id,
              idempotencyKey: `webhook_refund_${payout.id}`,
              description: `Withdrawal payout failed: ${failureReason || 'unknown failure'} (webhook: ${eventId})`,
            },
            trx
          );
        }
      } else if (payout.type === 'advance') {
        // Update advance allocation
        await trx('payout_allocations').where({ payout_id: payout.id }).update({
          status: targetStatus,
          updated_at: trx.fn.now(),
        });

        if (targetStatus === 'succeeded') {
          // If the advance payout timed out earlier, we complete it now.
          // Get the allocated sale
          const allocation = await trx('payout_allocations')
            .where({ payout_id: payout.id, allocation_type: 'advance' })
            .first();

          if (allocation) {
            const sale = await trx('sales').where({ id: allocation.sale_id }).first().forUpdate();

            if (sale && sale.advance_paid_amount === 0) {
              await trx('sales').where({ id: sale.id }).update({
                advance_paid_amount: payout.amount,
                updated_at: trx.fn.now(),
              });

              // Credit wallet
              await WalletService.adjustBalance(
                {
                  userId: payout.user_id,
                  amount: payout.amount,
                  entryType: 'ADVANCE_PAYOUT',
                  saleId: sale.id,
                  payoutId: payout.id,
                  idempotencyKey: `adv_webhook_credit_${sale.id}_payout_${payout.id}`,
                  description: `Advance payout credit for sale ${sale.external_reference} (webhook: ${eventId})`,
                },
                trx
              );

              // Debit wallet
              await WalletService.adjustBalance(
                {
                  userId: payout.user_id,
                  amount: -payout.amount,
                  entryType: 'ADVANCE_PAYOUT',
                  saleId: sale.id,
                  payoutId: payout.id,
                  idempotencyKey: `adv_webhook_debit_${sale.id}_payout_${payout.id}`,
                  description: `Advance payout transfer for sale ${sale.external_reference} (webhook: ${eventId})`,
                },
                trx
              );
            }
          }
        }
        // If advance fails, we don't do anything because no wallet changes happened during initiation
      }

      return {
        success: true,
        message: `Webhook processed successfully: status updated to ${targetStatus}`,
        payoutId: payout.id,
        status: targetStatus,
      };
    });
  }
}

module.exports = new WebhookService();
