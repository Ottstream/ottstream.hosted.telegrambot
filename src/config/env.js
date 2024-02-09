
const { Config } = require('ottstream.services.config');
const config = Config.getConfigFromClient(process.env);
module.exports = config
