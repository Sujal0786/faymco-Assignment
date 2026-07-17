const WebhookService = require('../services/WebhookService');

class WebhookController {
  async handleWebhook(req, res, next) {
    try {
      const result = await WebhookService.processWebhook(req.body);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new WebhookController();
