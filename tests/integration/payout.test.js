process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/database/db');
const WalletService = require('../../src/services/WalletService');

describe('User Payout Management System Integration Tests', () => {
  beforeAll(async () => {
    // Run migrations on the test database
    await db.migrate.latest();
  });

  beforeEach(async () => {
    // Re-seed before each test to ensure a clean slate
    await db.seed.run();
  });

  afterAll(async () => {
    // Close the database connection
    await db.destroy();
  });

  describe('The ₹120 Business Case (₹68 wallet balance proof)', () => {
    test('Calculates final adjustments correctly and yields exactly ₹68 total', async () => {
      // 1. Retrieve the seeded user and sales
      const user = await db('users').where({ username: 'john_doe' }).first();
      const sales = await db('sales')
        .where({ user_id: user.id })
        .orderBy('external_reference', 'asc');

      expect(sales.length).toBe(3);
      expect(sales[0].earning_amount).toBe('4000'); // ₹40
      expect(sales[1].earning_amount).toBe('4000'); // ₹40
      expect(sales[2].earning_amount).toBe('4000'); // ₹40

      // 2. Run the advance payout job
      const jobRes = await request(app)
        .post('/api/admin/advance-payouts/run')
        .send({ simulateStatus: 'success' });

      expect(jobRes.status).toBe(200);
      expect(jobRes.body.success).toBe(true);
      expect(jobRes.body.data.length).toBe(3);

      // Verify that each sale got ₹4 (400 paise) advance paid
      jobRes.body.data.forEach((p) => {
        expect(p.amount).toBe(400); // 10% of 4000
      });

      // Verify sale records are updated
      const updatedSalesAfterAdvance = await db('sales')
        .where({ user_id: user.id })
        .orderBy('external_reference', 'asc');
      updatedSalesAfterAdvance.forEach((s) => {
        expect(s.advance_paid_amount).toBe('400');
      });

      // 3. Reconcile sales: Sale 1 rejected, Sale 2 approved, Sale 3 approved
      const reconcile1 = await request(app)
        .post(`/api/admin/sales/${sales[0].id}/reconcile`)
        .send({ status: 'rejected', adminId: 'admin_1' });
      expect(reconcile1.status).toBe(200);
      expect(reconcile1.body.data.adjustment).toBe('-400'); // Debit ₹4

      const reconcile2 = await request(app)
        .post(`/api/admin/sales/${sales[1].id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });
      expect(reconcile2.status).toBe(200);
      expect(reconcile2.body.data.adjustment).toBe('3600'); // Credit ₹36 (4000 - 400)

      const reconcile3 = await request(app)
        .post(`/api/admin/sales/${sales[2].id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });
      expect(reconcile3.status).toBe(200);
      expect(reconcile3.body.data.adjustment).toBe('3600'); // Credit ₹36 (4000 - 400)

      // 4. Verify wallet balance is exactly ₹68 (6800 paise)
      const walletRes = await request(app).get(`/api/users/${user.id}/wallet`);

      expect(walletRes.status).toBe(200);
      expect(walletRes.body.data.withdrawableBalancePaise).toBe(6800); // -400 + 3600 + 3600 = 6800
      expect(walletRes.body.data.withdrawableBalanceRupees).toBe('68.00');
    });
  });

  describe('Advance Payout Job Edge Cases', () => {
    test('Job runs multiple times without double paying', async () => {
      // Run 1
      const job1 = await request(app)
        .post('/api/admin/advance-payouts/run')
        .send({ simulateStatus: 'success' });
      expect(job1.body.data.length).toBe(3);

      // Run 2
      const job2 = await request(app)
        .post('/api/admin/advance-payouts/run')
        .send({ simulateStatus: 'success' });
      expect(job2.body.data.length).toBe(0); // No more pending payouts
    });

    test('Allows a failed payout attempt to be retried safely', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();
      const sales = await db('sales')
        .where({ user_id: user.id })
        .orderBy('external_reference', 'asc');

      // Run with simulationStatus = failure
      const jobFail = await request(app)
        .post('/api/admin/advance-payouts/run')
        .send({ simulateStatus: 'failure' });

      expect(jobFail.body.data[0].status).toBe('failed');

      // Sale should not have advancePaidAmount set since it failed
      const saleAfterFail = await db('sales').where({ id: sales[0].id }).first();
      expect(saleAfterFail.advance_paid_amount).toBe('0');

      // Run again with success simulation
      const jobRetry = await request(app)
        .post('/api/admin/advance-payouts/run')
        .send({ simulateStatus: 'success' });

      // Should process the sales successfully now
      expect(jobRetry.body.data.length).toBe(3);
      expect(jobRetry.body.data[0].status).toBe('succeeded');

      const saleAfterSuccess = await db('sales').where({ id: sales[0].id }).first();
      expect(saleAfterSuccess.advance_paid_amount).toBe('400');
    });
  });

  describe('Reconciliation Workflow Edge Cases', () => {
    test('Approved sale with NO advance payment credits full earnings', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();
      const brand = await db('brands').first();

      // Create a sale that will NOT go through the advance job
      const [sale] = await db('sales')
        .insert({
          user_id: user.id,
          brand_id: brand.id,
          external_reference: 'sale_no_advance',
          status: 'pending',
          earning_amount: 3000, // ₹30
          advance_paid_amount: 0,
        })
        .returning('*');

      // Reconcile it as approved
      const res = await request(app)
        .post(`/api/admin/sales/${sale.id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });

      expect(res.status).toBe(200);
      expect(res.body.data.adjustment).toBe('3000'); // Credits full ₹30

      const wallet = await db('wallets').where({ user_id: user.id }).first();
      expect(wallet.withdrawable_balance).toBe('3000');
    });

    test('Rejected sale with NO advance payment makes zero adjustment', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();
      const brand = await db('brands').first();

      const [sale] = await db('sales')
        .insert({
          user_id: user.id,
          brand_id: brand.id,
          external_reference: 'sale_no_advance_reject',
          status: 'pending',
          earning_amount: 5000, // ₹50
          advance_paid_amount: 0,
        })
        .returning('*');

      const res = await request(app)
        .post(`/api/admin/sales/${sale.id}/reconcile`)
        .send({ status: 'rejected', adminId: 'admin_1' });

      expect(res.status).toBe(200);
      expect(res.body.data.adjustment).toBe('0'); // Zero adjustment

      const wallet = await db('wallets').where({ user_id: user.id }).first();
      expect(wallet.withdrawable_balance).toBe('0');
    });

    test('Reconciliation is idempotent', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();
      const sales = await db('sales').where({ user_id: user.id });

      // Run 1
      const res1 = await request(app)
        .post(`/api/admin/sales/${sales[0].id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });
      expect(res1.status).toBe(200);

      const ledger1 = await db('wallet_ledger_entries').where({ sale_id: sales[0].id });
      expect(ledger1.length).toBe(1);

      // Run 2 (same status)
      const res2 = await request(app)
        .post(`/api/admin/sales/${sales[0].id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });
      expect(res2.status).toBe(200);
      expect(res2.body.message).toContain('idempotent');

      // Ledger count should still be 1 (no duplicates)
      const ledger2 = await db('wallet_ledger_entries').where({ sale_id: sales[0].id });
      expect(ledger2.length).toBe(1);
    });

    test('Reconciling to a different status is rejected with 409', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();
      const sales = await db('sales').where({ user_id: user.id });

      // Reconcile approved
      await request(app)
        .post(`/api/admin/sales/${sales[0].id}/reconcile`)
        .send({ status: 'approved', adminId: 'admin_1' });

      // Reconcile rejected
      const res = await request(app)
        .post(`/api/admin/sales/${sales[0].id}/reconcile`)
        .send({ status: 'rejected', adminId: 'admin_1' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('Withdrawal Workflow & 24-Hour limit', () => {
    test('Enforces balance check and 24-hour limit with failed payout retry exception', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();

      // 1. Manually credit the wallet balance to ₹100
      await db.transaction(async (trx) => {
        await WalletService.adjustBalance(
          {
            userId: user.id,
            amount: 10000, // ₹100
            entryType: 'APPROVED_SALE_REMAINDER',
            idempotencyKey: 'manual_credit_100',
            description: 'Seeded balance for withdrawal tests',
          },
          trx
        );
      });

      // 2. Reject withdrawal amount exceeding balance
      const exceedRes = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_exceed')
        .send({ amount: 150 }); // ₹150 > ₹100
      expect(exceedRes.status).toBe(422);
      expect(exceedRes.body.error.code).toBe('INSUFFICIENT_FUNDS');

      // 3. Successful withdrawal request
      const w1 = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_1')
        .send({ amount: 40 }); // ₹40

      expect(w1.status).toBe(201);
      expect(w1.body.data.withdrawalRequest.status).toBe('succeeded');
      expect(w1.body.data.withdrawalRequest.amountRupees).toBe('40.00');

      // Wallet withdrawable balance should be ₹60 (100 - 40)
      const walletAfterW1 = await db('wallets').where({ user_id: user.id }).first();
      expect(walletAfterW1.withdrawable_balance).toBe('6000');

      // 4. Second withdrawal within 24 hours should be BLOCKED
      const w2 = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_2')
        .send({ amount: 10 }); // ₹10
      expect(w2.status).toBe(422);
      expect(w2.body.error.code).toBe('WITHDRAWAL_LIMIT_EXCEEDED');

      // 5. Withdrawal failure restores the balance
      const wFail = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_fail')
        .send({ amount: 30, simulateStatus: 'failure' }); // ₹30

      expect(wFail.status).toBe(201);
      expect(wFail.body.data.withdrawalRequest.status).toBe('failed');

      // Wallet withdrawable balance should still be ₹60 (60 - 30 + 30 refunded)
      const walletAfterFail = await db('wallets').where({ user_id: user.id }).first();
      expect(walletAfterFail.withdrawable_balance).toBe('6000');

      // 6. Immediate retry bypasses the 24-hour limit
      const wRetry = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_retry')
        .send({
          amount: 30, // up to the restored ₹30
          retryOfWithdrawalId: wFail.body.data.withdrawalRequest.id,
        });

      expect(wRetry.status).toBe(201);
      expect(wRetry.body.data.withdrawalRequest.status).toBe('succeeded');
      expect(wRetry.body.data.withdrawalRequest.retryOfWithdrawalId).toBe(
        wFail.body.data.withdrawalRequest.id
      );

      // Wallet should have ₹30 now (60 - 30)
      const walletAfterRetry = await db('wallets').where({ user_id: user.id }).first();
      expect(walletAfterRetry.withdrawable_balance).toBe('3000');

      // 7. Retry with amount exceeding failed amount must fail
      const wFail2 = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_fail_2')
        .send({ amount: 10, simulateStatus: 'failure' }); // ₹10

      const wRetryExceed = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_retry_exceed')
        .send({
          amount: 15, // Try to withdraw ₹15 when only ₹10 was restored
          retryOfWithdrawalId: wFail2.body.data.withdrawalRequest.id,
        });
      expect(wRetryExceed.status).toBe(400);
      expect(wRetryExceed.body.error.message).toContain('exceeds the original failed amount');
    });
  });

  describe('Webhook & Failed Payout Recovery', () => {
    test('Idempotently processes webhooks and recovers balances', async () => {
      const user = await db('users').where({ username: 'john_doe' }).first();

      // Seed wallet balance to ₹50
      await db.transaction(async (trx) => {
        await WalletService.adjustBalance(
          {
            userId: user.id,
            amount: 5000,
            entryType: 'APPROVED_SALE_REMAINDER',
            idempotencyKey: 'manual_credit_50',
            description: 'Seeded balance for webhook tests',
          },
          trx
        );
      });

      // Initiate a timeout withdrawal (status = processing)
      const wReq = await request(app)
        .post(`/api/users/${user.id}/withdrawals`)
        .set('Idempotency-Key', 'withdrawal_timeout')
        .send({ amount: 20, simulateStatus: 'timeout' }); // ₹20

      expect(wReq.status).toBe(201);
      expect(wReq.body.data.withdrawalRequest.status).toBe('processing');

      // Balance should be reserved: withdrawable = ₹30, reserved = ₹20
      let wallet = await db('wallets').where({ user_id: user.id }).first();
      expect(wallet.withdrawable_balance).toBe('3000');
      expect(wallet.reserved_balance).toBe('2000');

      // Send payout.failed webhook
      const webhookRes1 = await request(app).post('/api/webhooks/payout-provider').send({
        eventId: 'evt_web_fail_1',
        eventType: 'payout.failed',
        payoutId: wReq.body.data.withdrawalRequest.id,
        providerReference: wReq.body.data.payout.providerReference,
        failureReason: 'Bank network down',
      });

      expect(webhookRes1.status).toBe(200);
      expect(webhookRes1.body.status).toBe('failed');

      // Balance should be refunded: withdrawable = ₹50, reserved = 0
      wallet = await db('wallets').where({ user_id: user.id }).first();
      expect(wallet.withdrawable_balance).toBe('5000');
      expect(wallet.reserved_balance).toBe('0');

      // Send duplicate payout.failed webhook -> should be ignored idempotently
      const webhookRes2 = await request(app).post('/api/webhooks/payout-provider').send({
        eventId: 'evt_web_fail_1', // Same eventId
        eventType: 'payout.failed',
        payoutId: wReq.body.data.withdrawalRequest.id,
        providerReference: wReq.body.data.payout.providerReference,
        failureReason: 'Bank network down',
      });

      expect(webhookRes2.status).toBe(200);
      expect(webhookRes2.body.message).toContain('already processed');

      // Balance remains unchanged
      wallet = await db('wallets').where({ user_id: user.id }).first();
      expect(wallet.withdrawable_balance).toBe('5000');
    });
  });
});
