
// eslint-disable-next-line import/no-extraneous-dependencies
const { Config } = require('ottstream.services.config');
// eslint-disable-next-line import/no-extraneous-dependencies
const dataAccess = require('ottstream.dataaccess');

const path = require('path');
// read config
const envPath = path.join(__dirname, '../.env');

Config.readEnv(envPath);

// set api ocnfig
const appConfig = require('./config');

appConfig.initConfig();

// set dataacess config dataacess

dataAccess.config.initConfig(appConfig.getConfig());
dataAccess.DbSetup.initDb();

const config = require('./config');

const logger = require('./utils/logger/logger');

const serviceCollection = require('./services/service_collection');

// eslint-disable-next-line no-unused-vars
const { telegramBotProcessorCron, telegramBotClearCron } = require('./config/hosted/telegram/telegram_bot_processor');

const HostedEventBusProcessor = require('./config/hosted/event_bus/hosted_evenbus_processor');

const eventBusProcessor = new HostedEventBusProcessor();
eventBusProcessor
  .processSocketStreams()
  .then(() => {})
  .catch(() => {});
// const {
//   basicUserRoles,
//   basicOttProvider,
//   defaultChannelIconSet,
//   defaultIconType,
//   supportedPaymentMethods,
//   supportedPaymentImplementations,
// } = require('./utils/startup');

// running cron job for invoices
telegramBotProcessorCron().then(() => {});
telegramBotClearCron().then(() => {});

if (!config.getConfig().sync.sync_middleware) {
  logger.warn(`syncing middleware is disabled`);
} else {
  middlewareSyncCron().then(() => {});
}

const exitHandler = () => {};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
});
