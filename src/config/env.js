const dotenv = require('dotenv')
dotenv.config()

module.exports = {
    polling: !!process.env.TELEGRAM_POLLING,
    webhookurl: process.env.TELEGRAM_WEBHOOKURL,
    processTelegramBots: process.env.TELEGRAM_BOTS_PROCESS,
    redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
      },
    graylog: {
      host: process.env.GRAYLOG_HOST,
      port: process.env.GRAYLOG_PORT,
      name: process.env.GRAYLOG_NAME,
    }
}