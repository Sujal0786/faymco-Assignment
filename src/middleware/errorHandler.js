/**
 * Centralized Express Error Handling Middleware.
 * Formats validation and application errors consistently, hiding stack traces in production.
 */
module.exports = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // Map database constraints or custom codes
  let errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  if (err.message.includes('unique_successful_advance_allocation')) {
    err.statusCode = 409;
    errorCode = 'DUPLICATE_ADVANCE_PAYOUT';
    err.message = 'An advance payout has already been successfully transferred for this sale.';
  } else if (
    err.message.includes('sales_status_check') ||
    err.message.includes('Invalid target reconciliation')
  ) {
    err.statusCode = 400;
    errorCode = 'INVALID_STATUS_TRANSITION';
  } else if (err.message.includes('sales_earning_amount_check')) {
    err.statusCode = 400;
    errorCode = 'INVALID_EARNING_AMOUNT';
  } else if (err.message.includes('Insufficient funds')) {
    err.statusCode = 422;
    errorCode = 'INSUFFICIENT_FUNDS';
  } else if (err.message.includes('Only one normal withdrawal')) {
    err.statusCode = 422;
    errorCode = 'WITHDRAWAL_LIMIT_EXCEEDED';
  }

  const response = {
    success: false,
    error: {
      code: errorCode,
      message: err.message || 'An unexpected error occurred',
    },
  };

  // Add stack trace in development mode
  if (!isProduction) {
    response.error.stack = err.stack;
  }

  // Log server errors (500)
  if (statusCode >= 500) {
    console.error(`[Error] ${err.message}`, err.stack);
  }

  return res.status(err.statusCode || statusCode).json(response);
};
