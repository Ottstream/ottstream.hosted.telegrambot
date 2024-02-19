/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
// schedule to generate invoices
const cron = require('node-cron');
const logger = require('../../../utils/logger/logger');
const config = require('../../../config');
// eslint-disable-next-line no-unused-vars
const { ottProviderConversationProviderRepository } = require('../../../repository');
const serviceCollection = require('../../../services/service_collection');
const StatisticService = require('../../../services/statistics/statistic.service');
// const EasyshipService = require('../../services/shiping/merchant/easyship.service');
// const NotificationService = require('../../services/notification/notification.service');

// eslint-disable-next-line no-unused-vars
const processTelegramBots = async () => {
  const telegramStatistics = {
    bots: [],
  };
  // TODO generate notification of comment and send to user
  // eslint-disable-next-line no-empty
  const telegramBotService = serviceCollection.getService('telegramBotService');
  try {
    const creds = await ottProviderConversationProviderRepository.getList();
    const validCredsDict = creds.reduce((obj, item) => {
      if (item?.telegram?.isValid) {
        // eslint-disable-next-line no-param-reassign
        obj[item.providerId.toString()] = item;
      }
      return obj;
    }, {});
    for (const cred of creds) {
      if (cred.telegram?.isValid) {
        const isRunning = telegramBotService.isRunning(cred.providerId, cred.telegram.authToken);
        if (!isRunning) {
          telegramBotService.runBot(cred.providerId, cred.telegram.authToken);
        }
      }
    }
    const allRunning = telegramBotService.getRunnings();
    for (const bot of allRunning) {
      if (!validCredsDict[bot.provider]) {
        logger.info(`telegram bots: stopoing bot as key deleted or not valid.`);
        telegramBotService.stopBot(bot.provider, bot.token);
      }
    }
    telegramStatistics.bots = telegramBotService.getBots();
    await StatisticService.processTelegramBotsInfo(telegramStatistics);
    logger.info(`telegram bots: overall running ${allRunning.length}`);
  } catch (exception) {
    logger.error(exception, true);
  }
};

const clearTelegramBots = async () => {
  try {
    const telegramBotService = serviceCollection.getService('telegramBotService');

    const allRunning = telegramBotService.getRunnings();
    for (const item of allRunning) {
      await telegramBotService.getBotByTokenAndClear(item.key);
    }
  } catch (error) {
    logger.error(error, true);
  }
};

const telegramBotProcessorCronWorker = async () => {
  if (config.getConfig().hosted.processTelegramBots) {
    logger.info(`cron job: processing telegram bots..`);
    await processTelegramBots();
  }
};

const telegramBotProcessorCron = async () => {
  const callMinutes = '*/1 * * * *';
  await telegramBotProcessorCronWorker();
  cron.schedule(callMinutes, async () => {
    await telegramBotProcessorCronWorker();
  });
};

const telegramBotClearCronWorker = async () => {
  if (config.getConfig().hosted.processTelegramBots) {
    logger.info(`cron job: clearing telegram bots..`);
    await clearTelegramBots();
  }
};

const telegramBotClearCron = async () => {
  const callMinutes = '*/2 * * * *';
  cron.schedule(callMinutes, async () => {
    await telegramBotClearCronWorker();
  });
};

module.exports = {
  telegramBotProcessorCron,
  telegramBotClearCron,
};
