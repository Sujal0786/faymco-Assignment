const db = require('../database/db');

class UserController {
  async createUser(req, res, next) {
    try {
      const { username, email } = req.body;
      const result = await db.transaction(async (trx) => {
        // Insert user
        const [user] = await trx('users').insert({ username, email }).returning('*');

        // Initialize wallet for user
        const [wallet] = await trx('wallets')
          .insert({
            user_id: user.id,
            withdrawable_balance: '0',
            reserved_balance: '0',
          })
          .returning('*');

        return { user, wallet };
      });

      return res.status(201).json({
        success: true,
        data: {
          user: result.user,
          wallet: {
            id: result.wallet.id,
            withdrawableBalance: result.wallet.withdrawable_balance,
            reservedBalance: result.wallet.reserved_balance,
          },
        },
        message: 'User created successfully',
      });
    } catch (err) {
      if (err.message.includes('uniqueConstraint') || err.message.includes('unique')) {
        err.statusCode = 409;
        err.message = 'Username or email already exists';
      }
      next(err);
    }
  }

  async getUser(req, res, next) {
    try {
      const { userId } = req.params;
      const user = await db('users').where({ id: userId }).first();
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new UserController();
