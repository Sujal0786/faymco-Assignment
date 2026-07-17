const db = require('../database/db');
const { rupeesToPaise, paiseToRupees } = require('../utils/money');
const ReconciliationService = require('../services/ReconciliationService');

class SaleController {
  async createSale(req, res, next) {
    try {
      const { userId, brandId, externalReference, earning } = req.body;

      // Convert rupees earning (e.g. 40.00) to paise
      const earningAmountPaise = rupeesToPaise(earning);

      const [sale] = await db('sales')
        .insert({
          user_id: userId,
          brand_id: brandId,
          external_reference: externalReference,
          status: 'pending',
          earning_amount: earningAmountPaise,
          advance_paid_amount: 0,
        })
        .returning('*');

      return res.status(201).json({
        success: true,
        data: {
          id: sale.id,
          userId: sale.user_id,
          brandId: sale.brand_id,
          externalReference: sale.external_reference,
          status: sale.status,
          earningAmount: sale.earning_amount,
          earningRupees: paiseToRupees(sale.earning_amount),
          advancePaidAmount: sale.advance_paid_amount,
          createdAt: sale.created_at,
        },
        message: 'Sale recorded successfully',
      });
    } catch (err) {
      if (err.message.includes('uniqueConstraint') || err.message.includes('unique')) {
        err.statusCode = 409;
        err.message = 'External reference already exists';
      } else if (
        err.message.includes('foreign key constraint') ||
        err.message.includes('violates foreign key')
      ) {
        err.statusCode = 400;
        err.message = 'Invalid user ID or brand ID';
      }
      next(err);
    }
  }

  async getSales(req, res, next) {
    try {
      const { userId, brandId, status, page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      let query = db('sales');

      if (userId) query = query.where({ user_id: userId });
      if (brandId) query = query.where({ brand_id: brandId });
      if (status) query = query.where({ status });

      const totalQuery = query.clone().count('id as count').first();
      const dataQuery = query.clone().orderBy('created_at', 'desc').limit(limit).offset(offset);

      const [totalResult, sales] = await Promise.all([totalQuery, dataQuery]);

      return res.status(200).json({
        success: true,
        data: {
          sales: sales.map((s) => ({
            ...s,
            earningRupees: paiseToRupees(s.earning_amount),
            advancePaidRupees: paiseToRupees(s.advance_paid_amount),
          })),
          pagination: {
            total: parseInt(totalResult.count, 10),
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async getSaleById(req, res, next) {
    try {
      const { saleId } = req.params;
      const sale = await db('sales').where({ id: saleId }).first();

      if (!sale) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Sale not found' },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          ...sale,
          earningRupees: paiseToRupees(sale.earning_amount),
          advancePaidRupees: paiseToRupees(sale.advance_paid_amount),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async getUserSales(req, res, next) {
    try {
      const { userId } = req.params;
      const sales = await db('sales').where({ user_id: userId }).orderBy('created_at', 'desc');

      return res.status(200).json({
        success: true,
        data: sales.map((s) => ({
          ...s,
          earningRupees: paiseToRupees(s.earning_amount),
          advancePaidRupees: paiseToRupees(s.advance_paid_amount),
        })),
      });
    } catch (err) {
      next(err);
    }
  }

  async reconcileSale(req, res, next) {
    try {
      const { saleId } = req.params;
      const { status, adminId, batchId } = req.body;

      if (!adminId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'adminId is required' },
        });
      }

      const result = await ReconciliationService.reconcileSale({
        saleId,
        status,
        adminId,
        batchId,
      });

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          adjustmentRupees: paiseToRupees(result.adjustment),
        },
        message: result.message || 'Sale reconciled successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  async reconcileBatch(req, res, next) {
    try {
      const { sales, adminId, batchId } = req.body;

      if (!adminId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'adminId is required' },
        });
      }

      if (!sales || !Array.isArray(sales) || sales.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sales must be a non-empty array' },
        });
      }

      const result = await ReconciliationService.reconcileBatch({
        sales,
        adminId,
        batchId,
      });

      return res.status(200).json({
        success: true,
        data: {
          ...result,
          results: result.results.map((r) => ({
            ...r,
            adjustmentRupees: paiseToRupees(r.adjustment),
          })),
        },
        message: 'Batch reconciliation processed',
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SaleController();
