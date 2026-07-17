exports.up = async function (knex) {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Users Table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('username').notNullable().unique();
    table.string('email').notNullable().unique();
    table.timestamps(true, true);
  });

  // Brands Table
  await knex.schema.createTable('brands', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name').notNullable().unique();
    table.timestamps(true, true);
  });

  // Sales Table
  await knex.schema.createTable('sales', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('brand_id').notNullable().references('id').inTable('brands').onDelete('RESTRICT');
    table.string('external_reference').notNullable().unique();
    table.string('status').notNullable().defaultTo('pending');
    table.bigInteger('earning_amount').notNullable(); // in paise
    table.bigInteger('advance_paid_amount').notNullable().defaultTo(0); // in paise
    table.timestamp('reconciled_at');
    table.integer('version').notNullable().defaultTo(1);
    table.timestamps(true, true);

    // Checks
    table.check("status IN ('pending', 'approved', 'rejected')", [], 'sales_status_check');
    table.check('earning_amount >= 0', [], 'sales_earning_amount_check');
    table.check('advance_paid_amount >= 0', [], 'sales_advance_paid_amount_check');
  });

  // Wallets Table
  await knex.schema.createTable('wallets', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('user_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    table.bigInteger('withdrawable_balance').notNullable().defaultTo(0); // in paise, can be negative
    table.bigInteger('reserved_balance').notNullable().defaultTo(0); // in paise
    table.integer('version').notNullable().defaultTo(1);
    table.timestamps(true, true);

    // Checks
    table.check('reserved_balance >= 0', [], 'wallets_reserved_balance_check');
  });

  // Payouts Table
  await knex.schema.createTable('payouts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('type').notNullable(); // advance, withdrawal, final
    table.bigInteger('amount').notNullable(); // in paise
    table.string('status').notNullable().defaultTo('created'); // created, processing, succeeded, failed, cancelled, rejected
    table.string('provider_reference');
    table.string('idempotency_key').notNullable().unique();
    table.text('failure_reason');
    table.timestamp('initiated_at');
    table.timestamp('completed_at');
    table.timestamps(true, true);

    // Checks
    table.check("type IN ('advance', 'withdrawal', 'final')", [], 'payouts_type_check');
    table.check(
      "status IN ('created', 'processing', 'succeeded', 'failed', 'cancelled', 'rejected')",
      [],
      'payouts_status_check'
    );
    table.check('amount >= 0', [], 'payouts_amount_check');
  });

  // Payout Allocations Table
  await knex.schema.createTable('payout_allocations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('payout_id').notNullable().references('id').inTable('payouts').onDelete('RESTRICT');
    table.uuid('sale_id').notNullable().references('id').inTable('sales').onDelete('RESTRICT');
    table.string('allocation_type').notNullable(); // advance, final
    table.bigInteger('amount').notNullable(); // in paise
    table.string('status').notNullable().defaultTo('created');
    table.timestamps(true, true);

    // Checks
    table.check("allocation_type IN ('advance', 'final')", [], 'allocations_type_check');
    table.check(
      "status IN ('created', 'processing', 'succeeded', 'failed', 'cancelled', 'rejected')",
      [],
      'allocations_status_check'
    );
    table.check('amount >= 0', [], 'allocations_amount_check');
  });

  // Partial unique index to enforce that a sale can have at most one successful advance allocation
  await knex.raw(`
    CREATE UNIQUE INDEX unique_successful_advance_allocation 
    ON payout_allocations (sale_id) 
    WHERE (allocation_type = 'advance' AND status = 'succeeded')
  `);

  // Wallet Ledger Entries Table
  await knex.schema.createTable('wallet_ledger_entries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('sale_id').references('id').inTable('sales').onDelete('RESTRICT');
    table.uuid('payout_id').references('id').inTable('payouts').onDelete('RESTRICT');
    table.string('entry_type').notNullable();
    table.bigInteger('amount').notNullable(); // positive = credit, negative = debit
    table.bigInteger('balance_after').notNullable();
    table.string('idempotency_key').notNullable().unique();
    table.string('description');
    table.timestamps(true, true);

    // Checks
    table.check(
      "entry_type IN ('ADVANCE_PAYOUT', 'APPROVED_SALE_REMAINDER', 'REJECTED_SALE_ADJUSTMENT', 'WITHDRAWAL_RESERVED', 'WITHDRAWAL_COMPLETED', 'WITHDRAWAL_RELEASED', 'FAILED_PAYOUT_REFUND')",
      [],
      'ledger_entry_type_check'
    );
  });

  // Withdrawal Requests Table
  await knex.schema.createTable('withdrawal_requests', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.bigInteger('amount').notNullable();
    table.string('status').notNullable().defaultTo('created');
    table.timestamp('requested_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at');
    table
      .uuid('retry_of_withdrawal_id')
      .references('id')
      .inTable('withdrawal_requests')
      .onDelete('RESTRICT');
    table.string('idempotency_key').notNullable().unique();
    table.timestamps(true, true);

    // Checks
    table.check('amount > 0', [], 'withdrawal_requests_amount_check');
    table.check(
      "status IN ('created', 'processing', 'succeeded', 'failed', 'cancelled', 'rejected')",
      [],
      'withdrawal_requests_status_check'
    );
  });

  // Processed Webhook Events Table
  await knex.schema.createTable('processed_webhook_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('provider_event_id').notNullable().unique();
    table.string('event_type').notNullable();
    table.jsonb('payload').notNullable();
    table.timestamp('processed_at').defaultTo(knex.fn.now());
  });

  // Create indexes for optimization
  await knex.schema.alterTable('sales', (table) => {
    table.index(['user_id', 'status']);
    table.index(['status', 'advance_paid_amount']);
  });
  await knex.schema.alterTable('payouts', (table) => {
    table.index(['user_id', 'status']);
  });
  await knex.schema.alterTable('withdrawal_requests', (table) => {
    table.index(['user_id', 'requested_at']);
  });
  await knex.schema.alterTable('wallet_ledger_entries', (table) => {
    table.index(['user_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('processed_webhook_events');
  await knex.schema.dropTableIfExists('withdrawal_requests');
  await knex.schema.dropTableIfExists('wallet_ledger_entries');
  await knex.schema.dropTableIfExists('payout_allocations');
  await knex.schema.dropTableIfExists('payouts');
  await knex.schema.dropTableIfExists('wallets');
  await knex.schema.dropTableIfExists('sales');
  await knex.schema.dropTableIfExists('brands');
  await knex.schema.dropTableIfExists('users');
};
