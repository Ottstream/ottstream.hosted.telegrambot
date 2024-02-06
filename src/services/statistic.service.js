const { ottProviderRepository } = require('ottstream.dataaccess').repositories
const CacheService = require('./cache.service')
const BroadcastService = require('./broadcast.service')

class StatisticService {
    static async processTelegramBotsInfo(telegramData) {
        const provider = await ottProviderRepository.getBaseOttProvider();
        const cacheKey = 'service-info-telegram';
        await CacheService.setex(cacheKey, telegramData, 1800);
        await BroadcastService.broadcastToProvider(provider._id.toString(), 'statistic-info', { telegram: telegramData });
      }
    
}

module.exports = StatisticService