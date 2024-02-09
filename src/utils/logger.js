const graylog2 = require('graylog2');
const os = require('os');
const winston = require('winston');
const config = require('../config/env');
// console.log(config.graylog.host,5);
const grayLogger = new graylog2.graylog({
  servers: [{ host: config.graylog.host, port: config.graylog.port }],
  hostname: os.hostname(),
  facility: config.graylog.name,
  bufferSize: 1350,
});

grayLogger.on('error', function (error) {
  console.error('Error while trying to write to graylog2:', error);
});

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  return info;
});

const winstonLogger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    enumerateErrorFormat(),
    config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.splat(),
    winston.format.printf(({ level, message }) => `${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
});

const logger = {
  info(e, send = true) {
    winstonLogger.info(e);
    if (send && config.graylog.name !== 'local') {
      grayLogger.info(e);
    }
  },
  error(e, send = true) {
    winstonLogger.error(e);
    if (send) {
      grayLogger.error(e.message);
    }
  },
  warn(e, send = true) {
    winstonLogger.warn(e);
    if (send) {
      grayLogger.warn(e);
    }
  },
};

module.exports = logger;
