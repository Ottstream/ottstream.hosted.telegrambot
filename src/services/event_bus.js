// schedule to generate invoices
const redis = require('redis');
const queue = require('queue');
const logger = require('../utils/logger');
const config = require('../config/env');

class EventBusService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.callbacks = {};
    this.webhookQueue = queue({ results: [], autostart: true, timeout: 0, concurrency: 1000 });
  }

  addToQueue(channel, message) {
    const self = this;
    this.webhookQueue.push(async (cb) => {
      await self.callbacks[channel](message, channel);
      cb(null, {
        status: false,
      });
    });
  }

  async connect() {
    const self = this;
    const url = `redis://${config.redis.host}:${config.redis.port}`;
    this.subClient = redis.createClient({
      url,
      password: config.redis.password,
    });
    this.subClient.connect();
    logger.info(`EventBusService: connecting to redis ${config.redis.host}:${config.redis.port}`);

    return new Promise((resolve) => {
      // Handle successful connection
      this.subClient.on('connect', () => {
        logger.info('EventBusService: connected to Redis');
        self.isConnected = true;
        resolve({ status: true });
      });
      this.subClient.on('error', (err) => {
        self.isConnected = false;
        resolve({ status: false });
        logger.error('EventBusService: error connecting to Redis:', err);
      });
    });
  }

  async subscribe(topic, handler) {
    this.callbacks[topic] = handler;
    // // Subscribe to a Redis channel to listen for messages to send
    this.subClient.subscribe(topic, (message, channel) => {
      try {
        logger.info(`redis recv: ${channel} ${message}`);
        this.addToQueue(channel, message);
      } catch (exc) {
        logger.error(exc);
      }
      // const { id, msg } = JSON.parse(message);
      // const ws = wsConnections.get(id);
      // if (ws) {
      //   ws.send(msg);
      // }
    });
  }

  async disconnect() {
    if (this.subClient) return this.subClient.disconnect();
    return null;
  }

  async send(channel, data) {
    if (this.subClient) {
      logger.info(`redis publish: ${channel} ${JSON.stringify(data)}`);
      return this.subClient.publish(channel, JSON.stringify(data));
    }
    return null;
  }
}

module.exports = EventBusService;
