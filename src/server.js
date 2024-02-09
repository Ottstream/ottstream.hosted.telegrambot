const logger = require('./utils/logger');
const { telegramBotProcessorCron } = require('./hosted/telegram_bot_processor');
const HostedEventBusProcessor = require('./hosted/hosted_evenbus_processor');
// const { init } = require('ottstream.dataaccess')
const serviceCollection = require('./services/service_collection');
// init('mongodb://127.0.0.1:27017/ottstream') //ToDo need to move to lib
  const eventBusProcessor = new HostedEventBusProcessor();
  eventBusProcessor
    .processSocketStreams()
    .then(() => {})
    .catch(() => {});
  
  telegramBotProcessorCron().then(() => {});
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




