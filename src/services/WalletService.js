class WalletService {
  /**
   * Retrieves a user's wallet, creating it if it doesn't exist, with a row-level lock.
   * Must be run inside a transaction block.
   *
   * @param {string} userId
   * @param {Object} trx - Knex transaction instance
   * @returns {Promise<Object>} Wallet record
   */
  async getWalletWithLock(userId, trx) {
    let wallet = await trx('wallets').where({ user_id: userId }).first().forUpdate();

    if (!wallet) {
      // Lazy initialization of wallet to ensure robust operations
      const [newWallet] = await trx('wallets')
        .insert({
          user_id: userId,
          withdrawable_balance: '0',
          reserved_balance: '0',
          version: 1,
        })
        .returning('*');

      // Re-fetch with lock just to be consistent
      wallet = await trx('wallets').where({ id: newWallet.id }).first().forUpdate();
    }

    return wallet;
  }

  /**
   * Adjusts the withdrawable balance of a wallet and logs an immutable ledger entry.
   * Supports both positive adjustments (credits) and negative adjustments (debits).
   * Enforces strict idempotency.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {number|string} params.amount - Can be positive (credit) or negative (debit) in paise
   * @param {string} params.entryType - ADVANCE_PAYOUT, APPROVED_SALE_REMAINDER, REJECTED_SALE_ADJUSTMENT, etc.
   * @param {string} [params.saleId]
   * @param {string} [params.payoutId]
   * @param {string} params.idempotencyKey
   * @param {string} [params.description]
   * @param {Object} trx
   * @returns {Promise<Object>} Object containing wallet, ledgerEntry, and duplicate status
   */
  async adjustBalance(
    {
      userId,
      amount,
      entryType,
      saleId = null,
      payoutId = null,
      idempotencyKey,
      description = null,
    },
    trx
  ) {
    const wallet = await this.getWalletWithLock(userId, trx);

    // Idempotency check
    const existingLedger = await trx('wallet_ledger_entries')
      .where({ idempotency_key: idempotencyKey })
      .first();

    if (existingLedger) {
      return { wallet, ledgerEntry: existingLedger, duplicate: true };
    }

    const currentBalance = BigInt(wallet.withdrawable_balance);
    const adjustment = BigInt(amount);
    const newBalance = currentBalance + adjustment;

    const [updatedWallet] = await trx('wallets')
      .where({ id: wallet.id })
      .update({
        withdrawable_balance: newBalance.toString(),
        version: wallet.version + 1,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const [ledgerEntry] = await trx('wallet_ledger_entries')
      .insert({
        user_id: userId,
        sale_id: saleId,
        payout_id: payoutId,
        entry_type: entryType,
        amount: amount.toString(),
        balance_after: newBalance.toString(),
        idempotency_key: idempotencyKey,
        description,
      })
      .returning('*');

    return { wallet: updatedWallet, ledgerEntry, duplicate: false };
  }

  /**
   * Reserves a portion of withdrawable balance for an ongoing payout (e.g. withdrawal).
   * Withdrawable balance decreases; Reserved balance increases.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {number|string} params.amount - Positive amount to reserve in paise
   * @param {string} params.payoutId
   * @param {string} params.idempotencyKey
   * @param {string} [params.description]
   * @param {Object} trx
   * @returns {Promise<Object>} Updated wallet and ledger entry
   */
  async reserveBalance({ userId, amount, payoutId, idempotencyKey, description = null }, trx) {
    const wallet = await this.getWalletWithLock(userId, trx);

    const existingLedger = await trx('wallet_ledger_entries')
      .where({ idempotency_key: idempotencyKey })
      .first();

    if (existingLedger) {
      return { wallet, ledgerEntry: existingLedger, duplicate: true };
    }

    const reserveAmount = BigInt(amount);
    if (reserveAmount <= 0n) {
      throw new Error('Reservation amount must be positive');
    }

    const currentWithdrawable = BigInt(wallet.withdrawable_balance);
    if (currentWithdrawable < reserveAmount) {
      throw new Error(
        `Insufficient funds: Withdrawable balance is ${currentWithdrawable} paise, but requested to reserve ${reserveAmount} paise`
      );
    }

    const currentReserved = BigInt(wallet.reserved_balance);
    const newWithdrawable = currentWithdrawable - reserveAmount;
    const newReserved = currentReserved + reserveAmount;

    const [updatedWallet] = await trx('wallets')
      .where({ id: wallet.id })
      .update({
        withdrawable_balance: newWithdrawable.toString(),
        reserved_balance: newReserved.toString(),
        version: wallet.version + 1,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const [ledgerEntry] = await trx('wallet_ledger_entries')
      .insert({
        user_id: userId,
        payout_id: payoutId,
        entry_type: 'WITHDRAWAL_RESERVED',
        amount: (-reserveAmount).toString(), // Debit to withdrawable balance
        balance_after: newWithdrawable.toString(),
        idempotency_key: idempotencyKey,
        description: description || 'Withdrawal request initiated',
      })
      .returning('*');

    return { wallet: updatedWallet, ledgerEntry, duplicate: false };
  }

  /**
   * Completes a payout, releasing the reserved balance permanently.
   * Reserved balance decreases; Withdrawable balance is unchanged.
   */
  async completeReservedBalance(
    { userId, amount, payoutId, idempotencyKey, description = null },
    trx
  ) {
    const wallet = await this.getWalletWithLock(userId, trx);

    const existingLedger = await trx('wallet_ledger_entries')
      .where({ idempotency_key: idempotencyKey })
      .first();

    if (existingLedger) {
      return { wallet, ledgerEntry: existingLedger, duplicate: true };
    }

    const completeAmount = BigInt(amount);
    const currentReserved = BigInt(wallet.reserved_balance);

    if (currentReserved < completeAmount) {
      throw new Error(
        `Insufficient reserved funds: Reserved balance is ${currentReserved} paise, but requested to complete ${completeAmount} paise`
      );
    }

    const newReserved = currentReserved - completeAmount;

    const [updatedWallet] = await trx('wallets')
      .where({ id: wallet.id })
      .update({
        reserved_balance: newReserved.toString(),
        version: wallet.version + 1,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Creates an immutable audit entry with 0 impact to withdrawable balance
    const [ledgerEntry] = await trx('wallet_ledger_entries')
      .insert({
        user_id: userId,
        payout_id: payoutId,
        entry_type: 'WITHDRAWAL_COMPLETED',
        amount: '0',
        balance_after: wallet.withdrawable_balance,
        idempotency_key: idempotencyKey,
        description: description || 'Withdrawal completed successfully',
      })
      .returning('*');

    return { wallet: updatedWallet, ledgerEntry, duplicate: false };
  }

  /**
   * Releases a reserved amount back to withdrawable balance (due to payout failure).
   * Reserved balance decreases; Withdrawable balance increases.
   */
  async releaseReservedBalance(
    { userId, amount, payoutId, idempotencyKey, description = null },
    trx
  ) {
    const wallet = await this.getWalletWithLock(userId, trx);

    const existingLedger = await trx('wallet_ledger_entries')
      .where({ idempotency_key: idempotencyKey })
      .first();

    if (existingLedger) {
      return { wallet, ledgerEntry: existingLedger, duplicate: true };
    }

    const releaseAmount = BigInt(amount);
    const currentReserved = BigInt(wallet.reserved_balance);

    if (currentReserved < releaseAmount) {
      throw new Error(
        `Insufficient reserved funds: Reserved balance is ${currentReserved} paise, but requested to release ${releaseAmount} paise`
      );
    }

    const currentWithdrawable = BigInt(wallet.withdrawable_balance);
    const newWithdrawable = currentWithdrawable + releaseAmount;
    const newReserved = currentReserved - releaseAmount;

    const [updatedWallet] = await trx('wallets')
      .where({ id: wallet.id })
      .update({
        withdrawable_balance: newWithdrawable.toString(),
        reserved_balance: newReserved.toString(),
        version: wallet.version + 1,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const [ledgerEntry] = await trx('wallet_ledger_entries')
      .insert({
        user_id: userId,
        payout_id: payoutId,
        entry_type: 'FAILED_PAYOUT_REFUND',
        amount: releaseAmount.toString(), // Credit back to withdrawable balance
        balance_after: newWithdrawable.toString(),
        idempotency_key: idempotencyKey,
        description: description || 'Failed withdrawal amount refunded',
      })
      .returning('*');

    return { wallet: updatedWallet, ledgerEntry, duplicate: false };
  }
}

module.exports = new WalletService();
