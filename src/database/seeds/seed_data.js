exports.seed = async function (knex) {
  // Deletes ALL existing entries in tables in correct order
  await knex('processed_webhook_events').del();
  await knex('withdrawal_requests').del();
  await knex('wallet_ledger_entries').del();
  await knex('payout_allocations').del();
  await knex('payouts').del();
  await knex('wallets').del();
  await knex('sales').del();
  await knex('brands').del();
  await knex('users').del();

  // Create mock user
  const [user] = await knex('users')
    .insert({
      username: 'john_doe',
      email: 'john@example.com',
    })
    .returning('*');

  // Create mock wallet
  await knex('wallets').insert({
    user_id: user.id,
    withdrawable_balance: 0,
    reserved_balance: 0,
  });

  // Create mock brands
  const [brand1] = await knex('brands').insert({ name: 'brand_1' }).returning('*');
  await knex('brands').insert({ name: 'brand_2' });
  await knex('brands').insert({ name: 'brand_3' });

  // Create three pending sales for the ₹120 business case (4000 paise each)
  await knex('sales').insert([
    {
      user_id: user.id,
      brand_id: brand1.id,
      external_reference: 'sale_ref_1',
      status: 'pending',
      earning_amount: 4000, // ₹40
      advance_paid_amount: 0,
    },
    {
      user_id: user.id,
      brand_id: brand1.id,
      external_reference: 'sale_ref_2',
      status: 'pending',
      earning_amount: 4000, // ₹40
      advance_paid_amount: 0,
    },
    {
      user_id: user.id,
      brand_id: brand1.id,
      external_reference: 'sale_ref_3',
      status: 'pending',
      earning_amount: 4000, // ₹40
      advance_paid_amount: 0,
    },
  ]);
};
