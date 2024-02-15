// schedule to generate invoices
const queue = require('queue');
const logger = require('../../../utils/logger/logger');
const serviceCollection = require('../../../services/service_collection');

class HostedEventBusProcessor {
  constructor() {
    this.eventBusService = serviceCollection.getService('receiverEventBusService');
    this.webhookQueue = queue({ results: [], autostart: true, timeout: 0, concurrency: 1 });
  }

  async processSocketStreams() {
    await this.eventBusService.connect();
    await this.eventBusService.subscribe('telegram-bot', async (message) => {
      const parsed = JSON.parse(message);
      logger.info(`hostedEventBus:processTelegram() time: ${new Date().getTime()} ms ${parsed.body}`);
      if (parsed.action === 'run') {
        const { credentials, providerId } = parsed;

        if (credentials && credentials.isValid) {
          const telegramBotService = serviceCollection.getService('telegramBotService');
          const isRunning = telegramBotService.isRunning(providerId, credentials.authToken);
          if (!isRunning) {
            await telegramBotService.runBot(providerId, credentials.authToken);
          }
        }
      } else if (parsed.action === 'stop') {
        const { credentials, providerId } = parsed;

        const telegramBotService = serviceCollection.getService('telegramBotService');
        await telegramBotService.stopBot(providerId, credentials.authToken);
      } else {
        const telegramBotService = serviceCollection.getService('telegramBotService');
        await telegramBotService.processTelegramWebhook(parsed.body);
      }
      // broadcast part
    });

    await this.eventBusService.subscribe('twilio', async (message) => {
      const parsed = JSON.parse(message);
      this.addToQueue(parsed.body);
    });
    logger.info(`event bus: socket stream redis started...`);
  }
}

module.exports = HostedEventBusProcessor;
