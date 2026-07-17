/**
 * Reusable Express request validation middleware functions.
 */

module.exports = {
  validateUser: (req, res, next) => {
    const { username, email } = req.body;
    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'username is required and must be a non-empty string',
        },
      });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'email is required and must be a valid email address',
        },
      });
    }
    next();
  },

  validateBrand: (req, res, next) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'brand name is required and must be a non-empty string',
        },
      });
    }
    next();
  },

  validateSale: (req, res, next) => {
    const { userId, brandId, externalReference, earning } = req.body;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'userId is required and must be a string' },
      });
    }
    if (!brandId || typeof brandId !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'brandId is required and must be a string' },
      });
    }
    if (
      !externalReference ||
      typeof externalReference !== 'string' ||
      externalReference.trim() === ''
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'externalReference is required and must be a non-empty string',
        },
      });
    }

    // Earning is provided in Rupees (e.g. 40 or 40.50)
    if (earning === undefined || earning === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'earning is required' },
      });
    }
    next();
  },

  validateWithdrawal: (req, res, next) => {
    const { amount, retryOfWithdrawalId } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key header is required' },
      });
    }

    if (amount === undefined || amount === null) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'amount is required' },
      });
    }

    // Verify retryId is a string if provided
    if (
      retryOfWithdrawalId !== undefined &&
      retryOfWithdrawalId !== null &&
      typeof retryOfWithdrawalId !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'retryOfWithdrawalId must be a string' },
      });
    }

    next();
  },

  validateWebhook: (req, res, next) => {
    const { eventId, eventType } = req.body;
    if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'eventId is required in webhook payload' },
      });
    }
    if (!eventType || typeof eventType !== 'string' || eventType.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'eventType is required in webhook payload' },
      });
    }
    next();
  },
};
