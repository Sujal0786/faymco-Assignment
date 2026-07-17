const db = require('../database/db');
const AdvancePayoutService = require('../services/AdvancePayoutService');
const { paiseToRupees } = require('../utils/money');

class PayoutController {
  async runAdvancePayouts(req, res, next) {
    try {
      const { simulateStatus = 'success' } = req.body;

      const processed = await AdvancePayoutService.runAdvancePayoutJob(simulateStatus);

      return res.status(200).json({
        success: true,
        data: processed.map((p) => ({
          ...p,
          amountRupees: paiseToRupees(p.amount),
        })),
        message: `Advance payout job run completed. Processed ${processed.length} sales.`,
      });
    } catch (err) {
      next(err);
    }
  }

  async getAdvancePayouts(req, res, next) {
    try {
      const payouts = await db('payouts').where({ type: 'advance' }).orderBy('created_at', 'desc');

      // Fetch allocations for these payouts to trace back to sales
      const payoutIds = payouts.map((p) => p.id);
      let allocations = [];
      if (payoutIds.length > 0) {
        allocations = await db('payout_allocations').whereIn('payout_id', payoutIds);
      }

      return res.status(200).json({
        success: true,
        data: payouts.map((p) => ({
          ...p,
          amountRupees: paiseToRupees(p.amount),
          allocations: allocations.filter((a) => a.payout_id === p.id),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PayoutController();
