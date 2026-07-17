const { v4: uuidv4 } = require('uuid');

class MockPayoutGateway {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Initiates a payout transfer to the user.
   * Supports simulated results for development and testing.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {number} params.amount
   * @param {string} params.type - advance, withdrawal, final
   * @param {string} params.idempotencyKey
   * @param {string} [params.simulateStatus] - success, failure, cancellation, rejection, timeout
   * @returns {Promise<Object>} Payout response from the simulated gateway
   */
  async initiatePayout({ _userId, _amount, _type, idempotencyKey, simulateStatus = 'success' }) {
    // Check in-memory cache for idempotency
    if (this.cache.has(idempotencyKey)) {
      return this.cache.get(idempotencyKey);
    }

    // Generate a unique provider reference
    const providerReference = `prov_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    let response;

    switch (simulateStatus) {
      case 'success':
        response = {
          status: 'succeeded',
          providerReference,
          failureReason: null,
        };
        break;

      case 'failure':
        response = {
          status: 'failed',
          providerReference,
          failureReason:
            'Mock Gateway Simulated: Bank rejected the transfer (insufficient provider funds or invalid account)',
        };
        break;

      case 'cancellation':
        response = {
          status: 'cancelled',
          providerReference,
          failureReason:
            'Mock Gateway Simulated: Payout was cancelled by the administrator or provider',
        };
        break;

      case 'rejection':
        response = {
          status: 'rejected',
          providerReference,
          failureReason:
            'Mock Gateway Simulated: The beneficiary bank rejected the account details',
        };
        break;

      case 'timeout':
        response = {
          status: 'processing',
          providerReference,
          failureReason: null,
        };
        break;

      default:
        throw new Error(`Unsupported simulated status: ${simulateStatus}`);
    }

    // Cache the response to maintain idempotency
    this.cache.set(idempotencyKey, response);
    return response;
  }
}

module.exports = new MockPayoutGateway();
