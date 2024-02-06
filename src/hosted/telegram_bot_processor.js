/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
// schedule to generate invoices
const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../config/env');
// eslint-disable-next-line no-unused-vars
const telegramBotService = require('../services/telegram.bot.service')
const StatisticService = require('../services/statistic.service');
const { ottProviderConversationProviderRepository } = require('ottstream.dataaccess').repositories

// eslint-disable-next-line no-unused-vars
const processTelegramBots = async () => {
  const telegramStatistics = {
    bots: [],
  };
  // TODO generate notification of comment and send to user
  // eslint-disable-next-line no-empty
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

const telegramBotProcessorCronWorker = async () => {
  if (config.processTelegramBots) {
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

module.exports = {
  telegramBotProcessorCron,
};
