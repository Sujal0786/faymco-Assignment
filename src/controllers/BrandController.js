const db = require('../database/db');

class BrandController {
  async createBrand(req, res, next) {
    try {
      const { name } = req.body;
      const [brand] = await db('brands').insert({ name }).returning('*');

      return res.status(201).json({
        success: true,
        data: brand,
        message: 'Brand created successfully',
      });
    } catch (err) {
      if (err.message.includes('uniqueConstraint') || err.message.includes('unique')) {
        err.statusCode = 409;
        err.message = 'Brand name already exists';
      }
      next(err);
    }
  }
}

module.exports = new BrandController();
